"""
NextUp Resume Generation Space — thin FastAPI shim over an in-container Ollama.

This Space does inference ONLY. All business logic (prompting, validation,
LaTeX rendering) lives in the NextUp backend, which calls:

    POST /api/generate  {prompt, system, model, max_tokens, temperature, json}
    GET  /health

Free-tier Spaces run on ~2 vCPU, so generation is slow (minutes, not seconds).
The backend treats this as an async job — timeouts here are deliberately long.
"""

import logging
import os
import threading

import requests
from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Optional

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("resume-space")

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434").rstrip("/")
DEFAULT_MODEL = os.getenv("SPACE_MODEL", "qwen2.5:3b")
# Optional shared-secret auth: set SPACE_AUTH_TOKEN in the Space's secrets and
# the same value as RESUME_AI_AUTH_TOKEN in the backend.
AUTH_TOKEN = os.getenv("SPACE_AUTH_TOKEN", "")
NUM_THREADS = int(os.getenv("OLLAMA_NUM_THREADS", "2"))  # free tier = 2 vCPU
GENERATE_TIMEOUT = int(os.getenv("GENERATE_TIMEOUT_SECONDS", "570"))
MAX_CONCURRENT = int(os.getenv("MAX_CONCURRENT_GENERATIONS", "2"))

app = FastAPI(title="NextUp Resume Generation Space")

_slots = threading.BoundedSemaphore(MAX_CONCURRENT)
_active = 0
_active_lock = threading.Lock()


class GenerateRequest(BaseModel):
    prompt: str
    system: Optional[str] = ""
    model: Optional[str] = None
    max_tokens: Optional[int] = 1024
    temperature: Optional[float] = 0.2
    json_mode: Optional[bool] = Field(default=False, alias="json")

    class Config:
        populate_by_name = True


def check_auth(request: Request):
    if not AUTH_TOKEN:
        return
    header = request.headers.get("Authorization", "")
    if header != f"Bearer {AUTH_TOKEN}":
        raise HTTPException(status_code=401, detail="Invalid or missing bearer token.")


def _ollama_models() -> list:
    resp = requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
    resp.raise_for_status()
    return [m.get("name", "") for m in resp.json().get("models", [])]


@app.get("/health")
def health():
    """Real readiness probe: Ollama reachable AND the model is present."""
    try:
        models = _ollama_models()
    except Exception as e:
        return {"status": "down", "detail": f"ollama unreachable: {e}", "model": DEFAULT_MODEL}
    model_ready = any(m.startswith(DEFAULT_MODEL) for m in models)
    with _active_lock:
        active = _active
    return {
        "status": "up" if model_ready else "loading",
        "model": DEFAULT_MODEL,
        "models_available": models,
        "active_generations": active,
        "max_concurrent": MAX_CONCURRENT,
    }


@app.post("/api/generate")
def generate(req: GenerateRequest, _: None = Depends(check_auth)):
    global _active
    # Only honour explicit Ollama-style model names (e.g. "qwen2.5:3b");
    # anything else (HF paths like "Qwen/Qwen2.5-7B-Instruct") maps to default.
    model = req.model if (req.model or "").count(":") else DEFAULT_MODEL

    # Shed load fast instead of queueing minutes-long generations invisibly.
    if not _slots.acquire(blocking=False):
        raise HTTPException(
            status_code=503,
            detail=f"Space busy: {MAX_CONCURRENT} generations already in flight.",
        )
    with _active_lock:
        _active += 1
    try:
        full_prompt = f"{req.system.strip()}\n\n{req.prompt}" if req.system else req.prompt
        payload = {
            "model": model,
            "prompt": full_prompt,
            "stream": False,
            "options": {
                "temperature": req.temperature or 0.2,
                "num_predict": req.max_tokens or 1024,
                "num_thread": NUM_THREADS,
                "num_ctx": int(os.getenv("OLLAMA_NUM_CTX", "8192")),
            },
        }
        if req.json_mode:
            payload["format"] = "json"

        logger.info(
            "generate start model=%s prompt_chars=%d max_tokens=%s json=%s",
            model, len(full_prompt), req.max_tokens, req.json_mode,
        )
        try:
            response = requests.post(
                f"{OLLAMA_URL}/api/generate", json=payload, timeout=GENERATE_TIMEOUT
            )
        except requests.Timeout:
            raise HTTPException(
                status_code=504,
                detail=f"Generation exceeded {GENERATE_TIMEOUT}s on this hardware. "
                       "Reduce prompt size / max_tokens.",
            )
        except requests.RequestException as e:
            raise HTTPException(status_code=502, detail=f"Ollama unreachable: {e}")

        if response.status_code != 200:
            raise HTTPException(status_code=502, detail=response.text[:300])

        data = response.json()
        text = (data.get("response") or "").strip()
        if not text:
            raise HTTPException(status_code=502, detail="Ollama returned an empty completion.")
        logger.info(
            "generate done model=%s eval_count=%s duration_ms=%s",
            model, data.get("eval_count"),
            int(data.get("total_duration", 0) / 1_000_000),
        )
        return {"text": text, "model": model, "eval_count": data.get("eval_count")}
    finally:
        with _active_lock:
            _active -= 1
        _slots.release()
