from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session
from typing import Dict, Any, Optional
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed

from app.core.database import get_db, SessionLocal
from app.api.auth import get_current_user
from app.models.models import User
from app.core.redis import (
    get_cache, set_cache, get_user_version,
    get_companies_list_version, get_announcements_version,
)

# Import the existing handler functions to avoid duplicating logic
from app.api.companies import list_companies
from app.api.applications import list_applications
from app.api.notifications import get_notifications
from app.api.calendar import list_calendar_events
from app.api.announcements import get_announcements

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

@router.get("", response_model=Dict[str, Any])
def get_dashboard_data(
    x_client_key: Optional[str] = Header(None, alias="X-Client-Key"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Unified endpoint to fetch all necessary data for the Dashboard in a single request.
    Sub-APIs are called in parallel to minimise total latency.
    """
    user_version = get_user_version(current_user.id)
    companies_version = get_companies_list_version()
    announcements_version = get_announcements_version()
    cache_key = (
        f"nextup:cache:user:{current_user.id}:dashboard:uv{user_version}:"
        f"cv{companies_version}:av{announcements_version}"
    )
    cached = get_cache(cache_key)
    if cached is not None:
        return cached

    errors = {}

    # ── Parallel fetch ────────────────────────────────────────────────────
    # Each sub-API opens its own DB session so they can run concurrently
    # without sharing state. The parent session (db) is only used for
    # list_companies which needs it for the eligibility check loop.
    def _fetch_companies():
        return list_companies(skip=0, limit=500, x_client_key=x_client_key, db=db, current_user=current_user)

    def _fetch_applications():
        _db = SessionLocal()
        try:
            return list_applications(skip=0, limit=500, db=_db, current_user=current_user)
        finally:
            _db.close()

    def _fetch_notifications():
        _db = SessionLocal()
        try:
            return get_notifications(db=_db, current_user=current_user)
        finally:
            _db.close()

    def _fetch_calendar():
        _db = SessionLocal()
        try:
            return list_calendar_events(db=_db, current_user=current_user)
        finally:
            _db.close()

    def _fetch_announcements():
        _db = SessionLocal()
        try:
            return get_announcements(db=_db, current_user=current_user)
        finally:
            _db.close()

    tasks = {
        "companies": _fetch_companies,
        "applications": _fetch_applications,
        "notifications": _fetch_notifications,
        "calendar": _fetch_calendar,
        "announcements": _fetch_announcements,
    }
    results: Dict[str, Any] = {}

    with ThreadPoolExecutor(max_workers=5) as pool:
        future_to_key = {pool.submit(fn): key for key, fn in tasks.items()}
        for future in as_completed(future_to_key):
            key = future_to_key[future]
            try:
                results[key] = future.result()
            except Exception:
                results[key] = []
                errors[key] = traceback.format_exc()

    companies_data = results.get("companies", [])
    applications_data = results.get("applications", [])
    notifications_data = results.get("notifications", [])
    calendar_data = results.get("calendar", [])
    announcements_data = results.get("announcements", [])

    stats = {
        "total_tracked": len([a for a in applications_data if isinstance(a, dict) and a.get("record_type") == "application" and a.get("user_decision") == "tracking"]),
        "unread_notifications": sum(b.get("unread_count", 0) for b in notifications_data if isinstance(b, dict)) if isinstance(notifications_data, list) else 0,
    }

    response = {
        "companies": companies_data,
        "applications": applications_data,
        "notifications": notifications_data,
        "calendar": calendar_data,
        "announcements": announcements_data,
        "stats": stats,
        "_errors": errors,  # Will be empty dict {} if all succeeded
    }
    # Never cache a partial dashboard response. A transient dependency error
    # should recover on the next request instead of looking like empty data.
    if not errors:
        # 120 s TTL — dashboard data doesn't change every 30 s and the cache
        # is version-keyed so it invalidates immediately on any write anyway.
        set_cache(cache_key, response, expire_seconds=120)
    return response
