import logging
import time
import gzip
import threading
from typing import Any, Optional
from uuid import UUID
import redis
from app.core.config import settings

logger = logging.getLogger("nextup.cache")

try:
    import orjson
    HAS_ORJSON = True
except ImportError:
    import json
    HAS_ORJSON = False

# Initialize redis connection pool
_redis_metrics_lock = threading.Lock()

def _connect() -> "redis.Redis":
    client = redis.Redis.from_url(
        settings.REDIS_URL,
        socket_timeout=2.0,
        socket_connect_timeout=2.0,
        max_connections=20
    )
    client.ping()
    return client

try:
    redis_client = _connect()
    logger.info("Successfully connected to Redis cache with connection pool.")
except Exception as e:
    logger.warning(f"Redis connection failed (caching disabled, retrying in background): {e}")
    redis_client = None

# A Redis that was down at boot used to disable caching for the process
# LIFETIME. _ensure_client() retries the connection at most once every
# 30 seconds, so caching self-heals when Redis becomes reachable.
_reconnect_lock = threading.Lock()
_last_reconnect_attempt = 0.0
_RECONNECT_INTERVAL = 30.0

def _ensure_client() -> bool:
    global redis_client, _last_reconnect_attempt
    if redis_client is not None:
        return True
    now = time.monotonic()
    if now - _last_reconnect_attempt < _RECONNECT_INTERVAL:
        return False
    with _reconnect_lock:
        if redis_client is not None:
            return True
        if time.monotonic() - _last_reconnect_attempt < _RECONNECT_INTERVAL:
            return False
        _last_reconnect_attempt = time.monotonic()
        try:
            redis_client = _connect()
            logger.info("Redis connection (re)established — caching enabled.")
            return True
        except Exception as e:
            logger.debug(f"Redis still unreachable: {e}")
            return False

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

def _serialize(value: Any) -> bytes:
    if HAS_ORJSON:
        return orjson.dumps(value)
    else:
        import json
        return json.dumps(value, default=str).encode("utf-8")

def _deserialize(data: bytes) -> Any:
    if HAS_ORJSON:
        return orjson.loads(data)
    else:
        import json
        return json.loads(data.decode("utf-8"))

def get_cache(key: str) -> Optional[Any]:
    """Retrieve and decompress cached JSON data from Redis."""
    if not _ensure_client():
        _incr_metric("db_fallback")
        return None
    
    start_time = time.perf_counter()
    _incr_metric("total_gets")
    
    try:
        data = redis_client.get(key)
        if data is None:
            _incr_metric("miss")
            logger.info(f"Cache MISS for key: {key}")
            return None
        
        # Decompress gzip
        try:
            decompressed = gzip.decompress(data)
            value = _deserialize(decompressed)
        except Exception as decomp_err:
            # Fallback to plain if not compressed
            try:
                value = _deserialize(data)
            except Exception:
                raise decomp_err
        
        _incr_metric("hit")
        elapsed = (time.perf_counter() - start_time) * 1000.0
        with _redis_metrics_lock:
            metrics["total_get_time_ms"] += elapsed
            avg_time = metrics["total_get_time_ms"] / metrics["total_gets"]
        logger.info(f"Cache HIT for key: {key} in {elapsed:.2f}ms (Avg: {avg_time:.2f}ms).")
        return value
        
    except Exception as e:
        _incr_metric("error")
        _incr_metric("db_fallback")
        logger.warning(f"Redis get error (falling back to DB): {e}")
        return None

def set_cache(key: str, value: Any, expire_seconds: int = 300) -> bool:
    """Compress with gzip and cache serialized JSON data in Redis."""
    if not _ensure_client():
        return False
    try:
        serialized = _serialize(value)
        compressed = gzip.compress(serialized)
        redis_client.setex(key, expire_seconds, compressed)
        return True
    except Exception as e:
        _incr_metric("error")
        logger.warning(f"Redis set error: {e}")
        return False

def get_jd_strategy_cache(company_id: UUID) -> Optional[dict]:
    """Retrieve cached JD Strategy for a company. Cached for 24h by default."""
    version = get_company_version(company_id)
    key = f"nextup:cache:company:{company_id}:jd_strategy:v{version}"
    return get_cache(key)

def set_jd_strategy_cache(company_id: UUID, strategy: dict) -> bool:
    """Store company JD Strategy in cache for 24 hours."""
    version = get_company_version(company_id)
    key = f"nextup:cache:company:{company_id}:jd_strategy:v{version}"
    return set_cache(key, strategy, expire_seconds=86400)


# Versioning Helpers

def get_user_version(user_id: UUID) -> int:
    """Get the current cache version for a user. Defaults to 1 if not set."""
    if not _ensure_client():
        return 1
    try:
        version = redis_client.get(f"nextup:version:user:{user_id}")
        if version is None:
            redis_client.set(f"nextup:version:user:{user_id}", 1)
            return 1
        return int(version)
    except Exception as e:
        logger.warning(f"Redis get_user_version error: {e}")
        return 1

def bump_user_version(user_id: UUID) -> int:
    """Increment the cache version for a user, effectively invalidating their caches."""
    if not _ensure_client():
        return 1
    try:
        new_version = redis_client.incr(f"nextup:version:user:{user_id}")
        logger.info(f"Bumped cache version for user {user_id} to {new_version}")
        return new_version
    except Exception as e:
        logger.warning(f"Redis bump_user_version error: {e}")
        return 1

def get_companies_list_version() -> int:
    """Get the current cache version for the companies list. Defaults to 1."""
    if not _ensure_client():
        return 1
    try:
        version = redis_client.get("nextup:version:companies:list")
        if version is None:
            redis_client.set("nextup:version:companies:list", 1)
            return 1
        return int(version)
    except Exception as e:
        logger.warning(f"Redis get_companies_list_version error: {e}")
        return 1

def bump_companies_list_version() -> int:
    """Increment companies list cache version."""
    if not _ensure_client():
        return 1
    try:
        new_version = redis_client.incr("nextup:version:companies:list")
        logger.info(f"Bumped companies list cache version to {new_version}")
        return new_version
    except Exception as e:
        logger.warning(f"Redis bump_companies_list_version error: {e}")
        return 1

def get_company_version(company_id: UUID) -> int:
    """Get the cache version of an individual company. Defaults to 1."""
    if not _ensure_client():
        return 1
    try:
        version = redis_client.get(f"nextup:version:company:{company_id}")
        if version is None:
            redis_client.set(f"nextup:version:company:{company_id}", 1)
            return 1
        return int(version)
    except Exception as e:
        logger.warning(f"Redis get_company_version error: {e}")
        return 1

def bump_company_version(company_id: UUID) -> int:
    """Increment cache version for an individual company."""
    if not _ensure_client():
        return 1
    try:
        new_version = redis_client.incr(f"nextup:version:company:{company_id}")
        logger.info(f"Bumped company details cache version for {company_id} to {new_version}")
        # When an individual company changes, the companies list is also affected, so bump list too.
        bump_companies_list_version()
        return new_version
    except Exception as e:
        logger.warning(f"Redis bump_company_version error: {e}")
        return 1

def get_announcements_version() -> int:
    """Get the current cache version for announcements. Defaults to 1."""
    if not _ensure_client():
        return 1
    try:
        version = redis_client.get("nextup:version:announcements")
        if version is None:
            redis_client.set("nextup:version:announcements", 1)
            return 1
        return int(version)
    except Exception as e:
        logger.warning(f"Redis get_announcements_version error: {e}")
        return 1

def bump_announcements_version() -> int:
    """Increment announcements cache version."""
    if not _ensure_client():
        return 1
    try:
        new_version = redis_client.incr("nextup:version:announcements")
        logger.info(f"Bumped announcements cache version to {new_version}")
        return new_version
    except Exception as e:
        logger.warning(f"Redis bump_announcements_version error: {e}")
        return 1

def log_cache_metrics():
    """Output summary of cache hit/miss metrics."""
    total = metrics["hit"] + metrics["miss"]
    hit_rate = (metrics["hit"] / total) if total > 0 else 0.0
    logger.info(
        f"Cache Metrics - Hits: {metrics['hit']}, Misses: {metrics['miss']}, "
        f"Errors: {metrics['error']}, Fallbacks: {metrics['db_fallback']}, "
        f"Hit Rate: {hit_rate:.2%}"
    )
