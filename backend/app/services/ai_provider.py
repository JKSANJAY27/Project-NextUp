"""
Provider-agnostic AI inference layer.

All AI calls in the backend go through an AIGateway, which owns:
  - ordered provider fallback (primary -> secondary -> ...)
  - per-request timeouts
  - exponential-backoff retries per provider
  - a circuit breaker per provider (skip providers that keep failing)
  - a global concurrency cap so AI calls can never exhaust the threadpool
  - structured logging + in-process usage metrics
  - health reporting

Providers implement a single blocking `generate()` call. Everything here is
synchronous by design: callers are worker threads (resume worker, APScheduler,
FastAPI sync endpoints running in the threadpool), never the event loop.
"""

import json
import logging
import threading
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import requests

from app.core.config import settings

logger = logging.getLogger("nextup.ai")


class AIProviderError(Exception):
    """Raised when a provider fails to produce a completion."""


class AIUnavailableError(Exception):
    """Raised by the gateway when every provider failed (graceful-degradation signal)."""


@dataclass
class AIResult:
    text: str
    provider: str
    model: str
    latency_ms: int
    attempts: int = 1

    def parse_json(self) -> Dict[str, Any]:
        """Parse the completion as JSON, tolerating fences/prose via json_repair."""
        raw = (self.text or "").strip()
        if raw.startswith("```"):
            raw = raw.strip("`")
            if raw.lower().startswith("json"):
                raw = raw[4:]
        start, end = raw.find("{"), raw.rfind("}")
        if start != -1 and end > start:
            raw = raw[start:end + 1]
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            import json_repair
            return json.loads(json_repair.repair_json(raw))


class AIProvider(ABC):
    """Abstraction over an inference backend. Swap implementations freely."""

    name: str = "abstract"
    model: str = ""

    @abstractmethod
    def generate(
        self,
        prompt: str,
        *,
        system: Optional[str] = None,
        max_tokens: int = 1024,
        temperature: float = 0.2,
        json_mode: bool = False,
        timeout: Optional[float] = None,
    ) -> str:
        """Return the raw completion text. Raise AIProviderError on failure."""

    def health(self) -> Dict[str, Any]:
        """Cheap reachability probe. Never raises."""
        return {"provider": self.name, "model": self.model, "status": "unknown"}


class OllamaProvider(AIProvider):
    """Ollama /api/generate — used for the in-container parser model."""

    def __init__(self, base_url: str, model: str, name: str = "ollama",
                 num_ctx: int = 16384, ping_timeout: float = 5.0):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.name = name
        self.num_ctx = num_ctx
        self.ping_timeout = ping_timeout

    def _ping(self) -> bool:
        try:
            resp = requests.get(f"{self.base_url}/api/tags", timeout=self.ping_timeout)
            return resp.status_code == 200
        except Exception:
            return False

    def generate(self, prompt, *, system=None, max_tokens=1024, temperature=0.2,
                 json_mode=False, timeout=None) -> str:
        if not self._ping():
            raise AIProviderError(f"{self.name}: endpoint {self.base_url} not responding")
        full_prompt = f"{system.strip()}\n\n{prompt}" if system else prompt
        payload = {
            "model": self.model,
            "prompt": full_prompt,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
                "num_thread": 4,
                "num_ctx": self.num_ctx,
            },
        }
        if json_mode:
            payload["format"] = "json"
        try:
            resp = requests.post(
                f"{self.base_url}/api/generate",
                json=payload,
                timeout=timeout or settings.AI_REQUEST_TIMEOUT_SECONDS,
            )
        except requests.RequestException as e:
            raise AIProviderError(f"{self.name}: request failed: {e}") from e
        if resp.status_code != 200:
            raise AIProviderError(f"{self.name}: HTTP {resp.status_code}: {resp.text[:200]}")
        text = (resp.json().get("response") or "").strip()
        if not text:
            raise AIProviderError(f"{self.name}: empty completion")
        return text

    def health(self) -> Dict[str, Any]:
        ok = self._ping()
        return {"provider": self.name, "model": self.model,
                "status": "up" if ok else "down", "endpoint": self.base_url}


class RemoteSpaceProvider(AIProvider):
    """
    Dedicated inference Hugging Face Space (e.g. the resume-generation Space).
    Speaks the small contract exposed by resume-space/app.py:
      POST {base}/api/generate  {prompt, system, max_tokens, temperature, json}
      GET  {base}/health
    """

    def __init__(self, base_url: str, model: str, auth_token: str = "",
                 name: str = "resume-space"):
        url = base_url.rstrip("/")
        if url.endswith("/tailor"):
            url = url[:-7]
        self.base_url = url.rstrip("/")
        self.model = model
        self.auth_token = auth_token
        self.name = name

    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.auth_token:
            headers["Authorization"] = f"Bearer {self.auth_token}"
        return headers

    def generate(self, prompt, *, system=None, max_tokens=1024, temperature=0.2,
                 json_mode=False, timeout=None) -> str:
        try:
            resp = requests.post(
                f"{self.base_url}/api/generate",
                headers=self._headers(),
                json={
                    "prompt": prompt,
                    "system": system or "",
                    "model": self.model,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    "json": bool(json_mode),
                },
                timeout=timeout or settings.AI_REQUEST_TIMEOUT_SECONDS,
            )
        except requests.RequestException as e:
            raise AIProviderError(f"{self.name}: request failed: {e}") from e
        if resp.status_code == 503:
            raise AIProviderError(f"{self.name}: space busy/loading (503)")
        if resp.status_code != 200:
            raise AIProviderError(f"{self.name}: HTTP {resp.status_code}: {resp.text[:200]}")
        text = (resp.json().get("text") or "").strip()
        if not text:
            raise AIProviderError(f"{self.name}: empty completion")
        return text

    def health(self) -> Dict[str, Any]:
        try:
            resp = requests.get(f"{self.base_url}/health",
                                headers=self._headers(), timeout=6)
            body = resp.json() if resp.status_code == 200 else {}
            return {"provider": self.name, "model": self.model,
                    "status": "up" if resp.status_code == 200 else "down",
                    "endpoint": self.base_url, "detail": body}
        except Exception as e:
            return {"provider": self.name, "model": self.model,
                    "status": "down", "endpoint": self.base_url, "detail": str(e)}


class HFRouterProvider(AIProvider):
    """Hugging Face router (OpenAI-compatible chat completions) — escalation tier."""

    API_URL = "https://router.huggingface.co/v1/chat/completions"

    def __init__(self, model: str, token: str, name: str = "hf-router"):
        self.model = model
        self.token = token
        self.name = name

    def generate(self, prompt, *, system=None, max_tokens=1024, temperature=0.2,
                 json_mode=False, timeout=None) -> str:
        if not self.token:
            raise AIProviderError(f"{self.name}: HF_API_TOKEN not configured")
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        body: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        try:
            resp = requests.post(
                self.API_URL,
                headers={"Authorization": f"Bearer {self.token}",
                         "Content-Type": "application/json"},
                json=body,
                timeout=timeout or settings.AI_REQUEST_TIMEOUT_SECONDS,
            )
        except requests.RequestException as e:
            raise AIProviderError(f"{self.name}: request failed: {e}") from e
        if resp.status_code != 200:
            raise AIProviderError(f"{self.name}: HTTP {resp.status_code}: {resp.text[:300]}")
        text = (
            resp.json().get("choices", [{}])[0].get("message", {}).get("content", "")
        ).strip()
        if not text:
            raise AIProviderError(f"{self.name}: empty completion")
        return text

    def health(self) -> Dict[str, Any]:
        return {"provider": self.name, "model": self.model,
                "status": "configured" if self.token else "unconfigured"}


@dataclass
class _CircuitState:
    consecutive_failures: int = 0
    opened_at: float = 0.0

    def is_open(self) -> bool:
        if self.consecutive_failures < settings.AI_CIRCUIT_FAILURE_THRESHOLD:
            return False
        return (time.monotonic() - self.opened_at) < settings.AI_CIRCUIT_COOLDOWN_SECONDS

    def record_failure(self):
        self.consecutive_failures += 1
        if self.consecutive_failures >= settings.AI_CIRCUIT_FAILURE_THRESHOLD:
            self.opened_at = time.monotonic()

    def record_success(self):
        self.consecutive_failures = 0
        self.opened_at = 0.0


@dataclass
class _Metrics:
    requests: int = 0
    successes: int = 0
    failures: int = 0
    total_latency_ms: int = 0
    per_provider: Dict[str, Dict[str, int]] = field(default_factory=dict)

    def snapshot(self) -> Dict[str, Any]:
        avg = (self.total_latency_ms / self.successes) if self.successes else 0
        return {
            "requests": self.requests,
            "successes": self.successes,
            "failures": self.failures,
            "avg_latency_ms": round(avg),
            "providers": self.per_provider,
        }


class AIGateway:
    """
    Central entry point for all AI inference. Owns fallback order, retries,
    circuit breaking, concurrency limiting, metrics and structured logging.
    """

    def __init__(self, providers: List[AIProvider], name: str = "gateway"):
        if not providers:
            raise ValueError("AIGateway needs at least one provider")
        self.providers = providers
        self.name = name
        self._lock = threading.Lock()
        self._circuits: Dict[str, _CircuitState] = {p.name: _CircuitState() for p in providers}
        self._metrics = _Metrics()
        self._semaphore = threading.BoundedSemaphore(settings.AI_MAX_CONCURRENT_REQUESTS)

    def generate(
        self,
        prompt: str,
        *,
        system: Optional[str] = None,
        max_tokens: int = 1024,
        temperature: float = 0.2,
        json_mode: bool = False,
        timeout: Optional[float] = None,
        purpose: str = "generic",
    ) -> AIResult:
        """
        Try providers in order; within a provider retry with exponential backoff.
        Raises AIUnavailableError when everything failed.
        """
        acquired = self._semaphore.acquire(timeout=timeout or settings.AI_REQUEST_TIMEOUT_SECONDS)
        if not acquired:
            raise AIUnavailableError(f"{self.name}: too many concurrent AI requests")
        started = time.monotonic()
        attempts = 0
        errors: List[str] = []
        try:
            with self._lock:
                self._metrics.requests += 1
            for provider in self.providers:
                circuit = self._circuits[provider.name]
                if circuit.is_open():
                    errors.append(f"{provider.name}: circuit open")
                    logger.warning("[ai:%s] skipping %s (circuit open) purpose=%s",
                                   self.name, provider.name, purpose)
                    continue
                for attempt in range(1 + settings.AI_MAX_RETRIES):
                    attempts += 1
                    try:
                        call_start = time.monotonic()
                        text = provider.generate(
                            prompt, system=system, max_tokens=max_tokens,
                            temperature=temperature, json_mode=json_mode, timeout=timeout,
                        )
                        latency = int((time.monotonic() - call_start) * 1000)
                        circuit.record_success()
                        self._record(provider.name, success=True, latency_ms=latency)
                        logger.info(
                            "[ai:%s] success provider=%s model=%s purpose=%s attempt=%d latency_ms=%d",
                            self.name, provider.name, provider.model, purpose, attempts, latency,
                        )
                        return AIResult(text=text, provider=provider.name,
                                        model=provider.model, latency_ms=latency,
                                        attempts=attempts)
                    except AIProviderError as e:
                        circuit.record_failure()
                        self._record(provider.name, success=False)
                        errors.append(str(e))
                        logger.warning(
                            "[ai:%s] failure provider=%s purpose=%s attempt=%d err=%s",
                            self.name, provider.name, purpose, attempts, str(e)[:300],
                        )
                        if circuit.is_open():
                            break  # stop hammering a dead provider
                        if attempt < settings.AI_MAX_RETRIES:
                            time.sleep(settings.AI_RETRY_BASE_DELAY_SECONDS * (2 ** attempt))
            with self._lock:
                self._metrics.failures += 1
            raise AIUnavailableError(
                f"{self.name}: all providers failed for purpose={purpose}: " + " | ".join(errors)
            )
        finally:
            self._semaphore.release()
            logger.debug("[ai:%s] request finished purpose=%s elapsed_ms=%d",
                         self.name, purpose, int((time.monotonic() - started) * 1000))

    def generate_json(self, prompt: str, **kwargs) -> Dict[str, Any]:
        """generate() + robust JSON parsing. Raises AIUnavailableError / ValueError."""
        result = self.generate(prompt, json_mode=True, **kwargs)
        try:
            return result.parse_json()
        except Exception as e:
            raise AIUnavailableError(
                f"{self.name}: provider {result.provider} returned unparseable JSON: {e}"
            ) from e

    def _record(self, provider_name: str, *, success: bool, latency_ms: int = 0):
        with self._lock:
            stats = self._metrics.per_provider.setdefault(
                provider_name, {"successes": 0, "failures": 0}
            )
            if success:
                stats["successes"] += 1
                self._metrics.successes += 1
                self._metrics.total_latency_ms += latency_ms
            else:
                stats["failures"] += 1

    def metrics(self) -> Dict[str, Any]:
        with self._lock:
            return self._metrics.snapshot()

    def reset_circuits(self):
        """Reset all circuit breakers to closed state (e.g. after a provider recovers)."""
        with self._lock:
            for state in self._circuits.values():
                state.consecutive_failures = 0
                state.opened_at = 0.0
        logger.info("[ai:%s] all circuit breakers reset", self.name)

    def health(self) -> Dict[str, Any]:
        return {
            "gateway": self.name,
            "providers": [p.health() for p in self.providers],
            "circuits": {
                name: {"open": c.is_open(), "consecutive_failures": c.consecutive_failures}
                for name, c in self._circuits.items()
            },
            "metrics": self.metrics(),
        }


# ---------------------------------------------------------------------------
# Gateway singletons. The parser and resume gateways are fully independent so
# heavy resume traffic can never starve email parsing (and vice versa).
# ---------------------------------------------------------------------------

_parser_gateway: Optional[AIGateway] = None
_resume_gateway: Optional[AIGateway] = None
_gateway_lock = threading.Lock()


def get_parser_gateway() -> AIGateway:
    """
    Email parsing chain.
    Provider order:
      1. Ollama (HF Space / local) — only included when DISABLE_OLLAMA != 'true'
         and OLLAMA_BASE_URL is configured.
      2. HuggingFace Router (Llama-3.3-70B-Instruct) — always included as the
         primary/mandatory provider.  This is the main parser the system relies on.

    Regex is NOT a provider here — if both providers exhaust retries the gateway
    raises AIUnavailableError and the ingestion job is retried later.
    """
    import os
    global _parser_gateway
    with _gateway_lock:
        if _parser_gateway is None:
            providers: List[AIProvider] = []
            disable_ollama = os.getenv("DISABLE_OLLAMA", "").lower() == "true"
            if not disable_ollama and settings.OLLAMA_BASE_URL:
                providers.append(
                    OllamaProvider(
                        settings.OLLAMA_BASE_URL, settings.OLLAMA_MODEL,
                        name="parser-ollama",
                    )
                )
            # HF Router is always present — it is the mandatory parser.
            providers.append(
                HFRouterProvider(
                    settings.HF_FALLBACK_MODEL, settings.HF_API_TOKEN,
                    name="parser-hf-router",
                )
            )
            _parser_gateway = AIGateway(providers, name="parser")
            logger.info(
                "[parser-gateway] initialised with providers: %s",
                [p.name for p in providers],
            )
        return _parser_gateway


def get_resume_gateway() -> AIGateway:
    """
    Resume generation chain: dedicated resume Space -> HF router -> local Ollama.

    Provider order:
      1. RemoteSpaceProvider (dedicated HF Space) — primary, free, unlimited.
         Only added when HUGGINGFACE_RESUME_SPACE_URL / RESUME_AI_BASE_URL is set.
      2. HFRouterProvider — escalation fallback (uses HF API credits).
      3. OllamaProvider — last resort; only added when DISABLE_OLLAMA != 'true'
         AND OLLAMA_BASE_URL is a real local endpoint (not a remote HF Space URL).
    """
    import os
    global _resume_gateway
    with _gateway_lock:
        if _resume_gateway is None:
            providers: List[AIProvider] = []

            # Tier 1: dedicated resume HF Space (free, unlimited, preferred)
            if settings.RESUME_AI_BASE_URL:
                providers.append(RemoteSpaceProvider(
                    settings.RESUME_AI_BASE_URL, settings.RESUME_AI_MODEL,
                    settings.RESUME_AI_AUTH_TOKEN, name="resume-space",
                ))

            # Tier 2: HF router (uses HF API credits — escalation only)
            providers.append(HFRouterProvider(
                settings.HF_FALLBACK_MODEL, settings.HF_API_TOKEN, name="resume-hf-router",
            ))

            # Tier 3: local Ollama — only when it is actually a local process.
            # DISABLE_OLLAMA=true skips it entirely (same guard as the parser gateway).
            # We also skip it when OLLAMA_BASE_URL points to a remote HF Space URL
            # because OllamaProvider speaks the /api/tags + /api/generate protocol
            # which remote HF Spaces do not expose.
            disable_ollama = os.getenv("DISABLE_OLLAMA", "").lower() == "true"
            ollama_url = settings.OLLAMA_BASE_URL or ""
            is_local_ollama = ollama_url.startswith(("http://localhost", "http://127.0.0.1"))
            if not disable_ollama and is_local_ollama:
                providers.append(OllamaProvider(
                    ollama_url, settings.OLLAMA_MODEL, name="resume-local-ollama",
                ))

            _resume_gateway = AIGateway(providers, name="resume")
            logger.info(
                "[resume-gateway] initialised with providers: %s",
                [p.name for p in providers],
            )
        return _resume_gateway


def reset_all_circuits():
    """Reset circuit breakers for all instantiated gateways (call after provider recovery)."""
    with _gateway_lock:
        if _parser_gateway is not None:
            _parser_gateway.reset_circuits()
        if _resume_gateway is not None:
            _resume_gateway.reset_circuits()
    logger.info("All AI gateway circuits have been reset.")
