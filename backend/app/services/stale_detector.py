from datetime import datetime, timedelta
from typing import List
from sqlalchemy.orm import Session, joinedload
from app.models.models import Application, CompanyEvent

def is_application_stale(app: Application) -> bool:
    """
    Checks if a student application tracker is stale:
    - Status is not terminal (Offer, Rejected, Declined, Ignored)
    - No new company events or user activity for >= 30 days
    """
    status_lower = (app.status or "").lower()
    state_lower = (app.recruitment_state or "").lower()
    
    # Terminal states do not become stale
    if status_lower in ('offer', 'rejected', 'declined', 'ignored') or state_lower in ('offer', 'rejected'):
        return False
        
    # Baseline update time is the latest of applied_at and last_user_activity_at
    dates = [d for d in (app.applied_at, app.last_user_activity_at) if d is not None]
    last_update_time = max(dates) if dates else datetime.utcnow()
    
    # Check if there are any company events that are newer
    if app.company and app.company.events:
        for event in app.company.events:
            if event.timestamp and event.timestamp > last_update_time:
                last_update_time = event.timestamp
                
    now = datetime.utcnow()
    # Stale if no updates for 30 days
    return (now - last_update_time) >= timedelta(days=30)

def get_stale_applications_for_user(db: Session, user_id: str) -> List[Application]:
    """
    Fetches all stale applications for a specific user.
    """
    apps = db.query(Application).options(
        joinedload(Application.company).joinedload(Company.events)
    ).filter(Application.user_id == user_id).all()
    
    return [app for app in apps if is_application_stale(app)]
