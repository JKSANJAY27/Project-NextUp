from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session
from typing import Dict, Any, Optional

from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.models import User

# Import the existing handler functions to avoid duplicating logic
from app.api.companies import list_companies
from app.api.applications import list_applications
from app.api.notifications import get_notifications
from app.api.calendar import list_calendar_events
from app.api.announcements import list_announcements

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

@router.get("", response_model=Dict[str, Any])
def get_dashboard_data(
    x_client_key: Optional[str] = Header(None, alias="X-Client-Key"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Unified endpoint to fetch all necessary data for the Dashboard in a single request.
    This significantly reduces the number of API calls made by the frontend on load.
    """
    # We call the existing functions. Note that we pass the dependencies manually.
    
    # 1. Companies
    companies_data = list_companies(x_client_key=x_client_key, db=db, current_user=current_user)
    
    # 2. Applications
    applications_data = list_applications(db=db, current_user=current_user)
    
    # 3. Notifications
    notifications_data = get_notifications(db=db, current_user=current_user)
    
    # 4. Calendar Events
    calendar_data = list_calendar_events(db=db, current_user=current_user)
    
    # 5. Announcements
    announcements_data = list_announcements(db=db, current_user=current_user)
    
    # Optional: We could also calculate quick stats server-side
    stats = {
        "total_tracked": len([a for a in applications_data if a.get("record_type") == "application" and a.get("user_decision") == "tracking"]),
        "unread_notifications": sum(b.get("unread_count", 0) for b in notifications_data) if isinstance(notifications_data, list) else 0,
    }
    
    return {
        "companies": companies_data,
        "applications": applications_data,
        "notifications": notifications_data,
        "calendar": calendar_data,
        "announcements": announcements_data,
        "stats": stats
    }
