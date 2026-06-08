import threading
from typing import Dict, Optional, List
from uuid import UUID

# Thread-safe in-memory cache for user derived AES keys
_cache_lock = threading.Lock()
_session_keys: Dict[UUID, str] = {}

def add_session_key(user_id: UUID, key: str) -> None:
    """Register the derived key for the active user session."""
    with _cache_lock:
        _session_keys[user_id] = key

def remove_session_key(user_id: UUID) -> None:
    """Remove the derived key when the user logs out or session expires."""
    with _cache_lock:
        _session_keys.pop(user_id, None)

def get_session_key(user_id: UUID) -> Optional[str]:
    """Retrieve the derived key to perform on-the-fly decryption."""
    with _cache_lock:
        return _session_keys.get(user_id)

def get_active_user_ids() -> List[UUID]:
    """Get all user IDs currently having active sessions."""
    with _cache_lock:
        return list(_session_keys.keys())
