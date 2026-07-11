import logging
import time
import gzip
import threading
from typing import Any, Optional
from uuid import UUID
from app.core.config import settings

logger = logging.getLogger("nextup.cache")

try:
    import orjson
    HAS_ORJSON = True
except ImportError:
    import json
    HAS_ORJSON = False

# Initialize redis connection with graceful fallback
_redis_metrics_lock = threading.Lock()

class NoOpRedis:
    """Fallback when Redis is unavailable. Caching is simply skipped."""
    def ping(self):
        return True
    def get(self, key: str):
        return None
    def set(self, key: str, value):
        pass
    def setex(self, key: str, seconds: int, value):
        pass
    def delete(self, *keys):
        pass
    def incr(self, key: str):
        return 1

def _connect():
    """Try to connect to Redis. On failure, return NoOp client (app still works)."""
    if not settings.REDIS_URL:
        logger.info("REDIS_URL not configured; caching disabled.")
        return NoOpRedis()

    try:
        import redis
        client = redis.Redis.from_url(
            settings.REDIS_URL,
            socket_timeout=5.0,
            socket_connect_timeout=5.0,
            max_connections=20,
            decode_responses=False
        )
        client.ping()
        logger.info("Successfully connected to Redis cache.")
        return client
    except Exception as e:
        logger.warning(
            f"Redis connection failed ({type(e).__name__}: {e}). "
            f"Caching disabled; app continues without cache. "
            f"Will retry every 30 seconds."
        )
        return NoOpRedis()

try:
    redis_client = _connect()
except Exception as e:
    logger.error(f"Failed to initialize Redis fallback: {e}")
    redis_client = NoOpRedis()

# A Redis that was down at boot retries every 30 seconds (self-healing)
_reconnect_lock = threading.Lock()
_last_reconnect_attempt = 0.0
_RECONNECT_INTERVAL = 30.0

def _ensure_client() -> bool:
    global redis_client, _last_reconnect_attempt
    if isinstance(redis_client, NoOpRedis):
        now = time.monotonic()
        if now - _last_reconnect_attempt < _RECONNECT_INTERVAL:
            return False
        with _reconnect_lock:
            if not isinstance(redis_client, NoOpRedis):
                return True
            if time.monotonic() - _last_reconnect_attempt < _RECONNECT_INTERVAL:
                return False
            _last_reconnect_attempt = time.monotonic()
            try:
                new_client = _connect()
                if not isinstance(new_client, NoOpRedis):
                    redis_client = new_client
                    logger.info("Redis connection established (caching enabled).")
                    return True
            except Exception as e:
                logger.debug(f"Redis still unavailable: {e}")
            return False
    return True

# Metrics Counters
metrics = {
    "hit": 0,
    "miss": 0,
    "error": 0,
    "db_fallback": 0,
    "total_get_time_ms": 0.0,
    "total_gets": 0
}

def _incr_metric(key: str, val: int = 1):
    with _redis_metrics_lock:
        metrics[key] += val

def get_cache(cache_key: str) -> Optional[Any]:
    """Retrieve a cached value. Returns None if not found or Redis unavailable."""
    if not _ensure_client():
        _incr_metric("miss")
        return None

    try:
        start = time.monotonic()
        compressed_bytes = redis_client.get(cache_key)
        elapsed_ms = (time.monotonic() - start) * 1000

        _incr_metric("total_get_time_ms", int(elapsed_ms))
        _incr_metric("total_gets")

        if compressed_bytes is None:
            _incr_metric("miss")
            return None

        if HAS_ORJSON:
            data = orjson.loads(gzip.decompress(compressed_bytes))
        else:
            data = json.loads(gzip.decompress(compressed_bytes).decode("utf-8"))

        _incr_metric("hit")
        return data
    except Exception as e:
        logger.debug(f"Cache get failed: {e}")
        _incr_metric("error")
        _incr_metric("db_fallback")
        return None

def set_cache(cache_key: str, data: Any, expire_seconds: int = 3600) -> bool:
    """Store a value in cache. Returns False if Redis unavailable (caller falls back to DB)."""
    if not _ensure_client() or isinstance(redis_client, NoOpRedis):
        _incr_metric("db_fallback")
        return False

    try:
        if HAS_ORJSON:
            serialized = orjson.dumps(data)
        else:
            serialized = json.dumps(data).encode("utf-8")

        compressed = gzip.compress(serialized)
        redis_client.setex(cache_key, expire_seconds, compressed)
        return True
    except Exception as e:
        logger.debug(f"Cache set failed: {e}")
        _incr_metric("error")
        _incr_metric("db_fallback")
        return False

# Version management (cache invalidation)
def get_user_version(user_id: UUID) -> int:
    """Get cache version for a user (invalidates all user caches when incremented)."""
    if not _ensure_client():
        return 0
    try:
        version = redis_client.get(f"nextup:version:user:{user_id}")
        if version is None:
            redis_client.set(f"nextup:version:user:{user_id}", 1)
            return 1
        return int(version) if isinstance(version, int) else int(version.decode())
    except:
        return 0

def bump_user_version(user_id: UUID) -> int:
    """Invalidate all caches for a user by incrementing their version."""
    if not _ensure_client() or isinstance(redis_client, NoOpRedis):
        return 1
    try:
        new_version = redis_client.incr(f"nextup:version:user:{user_id}")
        return new_version if isinstance(new_version, int) else int(new_version)
    except:
        return 1

def get_companies_list_version() -> int:
    """Get cache version for the companies list."""
    if not _ensure_client():
        return 0
    try:
        version = redis_client.get("nextup:version:companies:list")
        if version is None:
            redis_client.set("nextup:version:companies:list", 1)
            return 1
        return int(version) if isinstance(version, int) else int(version.decode())
    except:
        return 0

def bump_companies_list_version() -> int:
    """Invalidate the companies list cache."""
    if not _ensure_client() or isinstance(redis_client, NoOpRedis):
        return 1
    try:
        new_version = redis_client.incr("nextup:version:companies:list")
        return new_version if isinstance(new_version, int) else int(new_version)
    except:
        return 1

def get_company_version(company_id: UUID) -> int:
    """Get cache version for a specific company."""
    if not _ensure_client():
        return 0
    try:
        version = redis_client.get(f"nextup:version:company:{company_id}")
        if version is None:
            redis_client.set(f"nextup:version:company:{company_id}", 1)
            return 1
        return int(version) if isinstance(version, int) else int(version.decode())
    except:
        return 0

def bump_company_version(company_id: UUID) -> int:
    """Invalidate all caches for a company."""
    if not _ensure_client() or isinstance(redis_client, NoOpRedis):
        return 1
    try:
        new_version = redis_client.incr(f"nextup:version:company:{company_id}")
        return new_version if isinstance(new_version, int) else int(new_version)
    except:
        return 1

def get_announcements_version() -> int:
    """Get cache version for announcements."""
    if not _ensure_client():
        return 0
    try:
        version = redis_client.get("nextup:version:announcements")
        if version is None:
            redis_client.set("nextup:version:announcements", 1)
            return 1
        return int(version) if isinstance(version, int) else int(version.decode())
    except:
        return 0

def bump_announcements_version() -> int:
    """Invalidate the announcements cache."""
    if not _ensure_client() or isinstance(redis_client, NoOpRedis):
        return 1
    try:
        new_version = redis_client.incr("nextup:version:announcements")
        return new_version if isinstance(new_version, int) else int(new_version)
    except:
        return 1
