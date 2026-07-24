from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from typing import List, Dict, Optional
from uuid import UUID
from collections import defaultdict
from datetime import datetime

from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.models import User, Notification, CompanyEvent, Company, IngestionAuditLog, Application, OpportunityState
from app.schemas.schemas import NotificationOut, NotificationDetail, NotificationBundle
from app.services.calendar_sync import is_rejected_status

router = APIRouter(prefix="/notifications", tags=["notifications"])

@router.get("", response_model=List[NotificationBundle])
def get_notifications(
    cursor: Optional[datetime] = None,
    limit: int = 100,
    scope: str = "all_active",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Fetch all notifications for the authenticated user, bundled by company/workspace."""
    # Find companies where application is rejected or opportunity state is archived
    apps = db.query(Application).filter(Application.user_id == current_user.id).all()
    opp_states = db.query(OpportunityState).filter(OpportunityState.user_id == current_user.id).all()

    rejected_company_ids = {
        app.company_id for app in apps if is_rejected_status(app.status)
    }
    archived_company_ids = {
        os.company_id for os in opp_states if os.state in ("archived", "auto_archived")
    }
    suppressed_company_ids = rejected_company_ids | archived_company_ids

    query = (
        db.query(Notification)
        .options(
            joinedload(Notification.company_event).joinedload(CompanyEvent.company)
        )
        .filter(Notification.user_id == current_user.id)
    )

    if cursor:
        query = query.filter(Notification.created_at < cursor)

    notifications = query.order_by(Notification.created_at.desc()).limit(limit * 2).all()

    bundles = {}

    # Pre-fetch ingestion audit logs for all events to compile confidence scores
    event_ids = [n.company_event_id for n in notifications if n.company_event_id]
    audit_logs = []
    if event_ids:
        audit_logs = db.query(IngestionAuditLog).filter(IngestionAuditLog.company_event_id.in_(event_ids)).all()

    confidence_map = defaultdict(dict)
    for log in audit_logs:
        confidence_map[log.company_event_id][log.field_name] = float(log.confidence_score) if log.confidence_score else 0.0

    for n in notifications:
        event = n.company_event
        if not event:
            continue

        company = event.company
        if not company:
            continue

        company_id = company.id
        is_suppressed = company_id in suppressed_company_ids

        # Scope routing: rejected or archived company notifications move to 'archived' scope
        if scope == "all_active":
            if is_suppressed or n.notification_scope == "ARCHIVED":
                continue
        elif scope == "archived":
            if not is_suppressed and n.notification_scope != "ARCHIVED":
                continue

        if company_id not in bundles:
            bundles[company_id] = {

                "company_id": company_id,
                "company_name": company.name,
                "role": company.role,
                "category": company.category,
                "unread_count": 0,
                "notifications": []
            }
            
        if not n.is_read:
            bundles[company_id]["unread_count"] += 1
            
        detail = NotificationDetail(
            id=n.id,
            message=n.message,
            is_read=n.is_read,
            notification_type=n.notification_type,
            created_at=n.created_at,
            company_event_id=n.company_event_id,
            notification_scope=n.notification_scope,
            expires_at=n.expires_at,
            company_id=company_id,
            subject=event.subject,
            sender=event.sender,
            body=None,
            timestamp=event.timestamp,
            confidence_scores=confidence_map[n.company_event_id]
        )
        bundles[company_id]["notifications"].append(detail.dict())
        
    def _notif_ts(b):
        if not b["notifications"]:
            return datetime.min
        t = b["notifications"][0]["created_at"]
        if t is None:
            return datetime.min
        return t.replace(tzinfo=None) if t.tzinfo else t

    sorted_bundles = sorted(
        bundles.values(),
        key=_notif_ts,
        reverse=True
    )
    
    return sorted_bundles

@router.patch("/{notification_id}/read", response_model=NotificationOut)
def mark_as_read(
    notification_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Mark a single notification as read."""
    notif = (
        db.query(Notification)
        .filter(Notification.id == notification_id, Notification.user_id == current_user.id)
        .first()
    )
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")
        
    notif.is_read = True
    db.commit()
    db.refresh(notif)
    return notif

@router.post("/company/{company_id}/read")
def mark_company_notifications_as_read(
    company_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Mark all notifications of a specific company/workspace as read."""
    notifications = (
        db.query(Notification)
        .join(CompanyEvent)
        .filter(
            Notification.user_id == current_user.id,
            Notification.is_read == False,
            CompanyEvent.company_id == company_id
        )
        .all()
    )
    
    for n in notifications:
        n.is_read = True
        
    db.commit()
    return {"message": f"Successfully marked {len(notifications)} notifications for company as read."}

@router.post("/read-all")
def mark_all_as_read(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Mark all notifications as read."""
    unread_notifs = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id, Notification.is_read == False)
        .all()
    )
    for notif in unread_notifs:
        notif.is_read = True
    db.commit()
    return {"message": f"Successfully marked {len(unread_notifs)} notifications as read."}

@router.delete("/{notification_id}", status_code=status.HTTP_200_OK)
def delete_notification(
    notification_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a single notification."""
    notif = (
        db.query(Notification)
        .filter(Notification.id == notification_id, Notification.user_id == current_user.id)
        .first()
    )
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")
        
    db.delete(notif)
    db.commit()
    return {"message": "Notification successfully deleted."}


