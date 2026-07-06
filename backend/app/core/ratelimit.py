"""
In-process sliding-window rate limiter.

The backend deliberately runs as a SINGLE uvicorn worker (the session-key
vault and AI gateway circuit state are in-process), so a process-local
limiter is authoritative — no Redis round-trip needed on the hot path.

Usage (FastAPI dependency):

    @router.post("/resumes/parse",
                 dependencies=[Depends(rate_limit("resume_parse", 6, 3600))])
"""

import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Tuple

from fastapi import HTTPException, Request

_lock = threading.Lock()
_hits: Dict[Tuple[str, str], Deque[float]] = defaultdict(deque)
_last_prune = 0.0


def _client_key(request: Request) -> str:
    """Prefer the authenticated user id; fall back to client IP."""
    user = getattr(request.state, "rate_user_id", None)
    if user:
        return f"u:{user}"
    fwd = request.headers.get("X-Forwarded-For", "")
    ip = fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown")
    return f"ip:{ip}"


def check_rate(bucket: str, key: str, max_calls: int, window_seconds: int) -> bool:
    """Record a hit and return True when within the limit."""
    global _last_prune
    now = time.monotonic()
    with _lock:
        q = _hits[(bucket, key)]
        cutoff = now - window_seconds
        while q and q[0] < cutoff:
            q.popleft()
        if len(q) >= max_calls:
            return False
        q.append(now)

        # Occasionally drop long-idle keys so the table can't grow unbounded
        if now - _last_prune > 300:
            _last_prune = now
            stale = [k for k, dq in _hits.items() if not dq or dq[-1] < now - 3600]
            for k in stale:
                del _hits[k]
    return True


def rate_limit(bucket: str, max_calls: int, window_seconds: int):
    """Dependency factory: HTTP 429 when the caller exceeds the limit."""
    def _dep(request: Request):
        if not check_rate(bucket, _client_key(request), max_calls, window_seconds):
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit exceeded for this action "
                       f"({max_calls} per {window_seconds // 60 or 1} min). Please slow down.",
            )
    return _dep
