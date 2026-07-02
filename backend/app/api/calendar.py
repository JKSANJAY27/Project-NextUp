import logging
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.models import User, CalendarEvent, Company
from app.schemas.schemas import CalendarEventCreate, CalendarEventUpdate, CalendarEventOut
from app.core.redis import get_cache, set_cache, get_user_version, bump_user_version

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/calendar", tags=["calendar"])

@router.get("", response_model=List[CalendarEventOut])
def list_calendar_events(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Retrieves all non-deleted calendar events for the current user.
    Triggers dynamic synchronization to ensure populated states.
    """
    version = get_user_version(current_user.id)
    cache_key = f"nextup:cache:user:{current_user.id}:calendar:v{version}"
    cached = get_cache(cache_key)
    if cached is not None:
        return cached

    from app.services.calendar_sync import sync_user_calendar_events
    sync_user_calendar_events(db, current_user.id)

    events = db.query(CalendarEvent).filter(
        CalendarEvent.user_id == current_user.id,
        CalendarEvent.is_deleted == False
    ).order_by(CalendarEvent.date.asc()).all()
    
    # Serialize response list using CalendarEventOut schema to avoid Pydantic serialization issues
    serialized_events = [CalendarEventOut.from_orm(e).dict() for e in events]
    set_cache(cache_key, serialized_events, expire_seconds=30)
    return serialized_events

@router.post("", response_model=CalendarEventOut)
def create_calendar_event(
    event_in: CalendarEventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Creates a manual calendar event.
    """
    company_name = None
    role = None
    if event_in.company_id:
        company = db.query(Company).filter(Company.id == event_in.company_id).first()
        if company:
            company_name = company.name
            role = company.role

    new_event = CalendarEvent(
        user_id=current_user.id,
        company_id=event_in.company_id,
        title=event_in.title,
        company_name=company_name,
        role=role,
        event_type=event_in.event_type,
        date=event_in.date,
        location_platform=event_in.location_platform,
        notes=event_in.notes,
        completed=False,
        is_manual=True,
        is_deleted=False,
        is_user_modified=False,
        source='manual',
        source_key=None
    )
    db.add(new_event)
    db.commit()
    db.refresh(new_event)
    bump_user_version(current_user.id)
    return new_event

@router.put("/{id}", response_model=CalendarEventOut)
def update_calendar_event(
    id: UUID,
    event_in: CalendarEventUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Updates calendar event details.
    Editing date, time, title, notes, location, or type sets is_user_modified = True for synced events.
    """
    event = db.query(CalendarEvent).filter(
        CalendarEvent.id == id,
        CalendarEvent.user_id == current_user.id
    ).first()
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Calendar event not found."
        )

    # Check if fields other than 'completed' are being changed
    modifying_fields = ["title", "event_type", "date", "location_platform", "notes", "company_id"]
    update_data = event_in.dict(exclude_unset=True)
    
    is_modified = any(f in update_data for f in modifying_fields)
    
    if is_modified and event.source == 'application_timeline':
        event.is_user_modified = True

    # If company_id is updated, refresh company metadata fields
    if "company_id" in update_data:
        new_company_id = update_data["company_id"]
        if new_company_id:
            company = db.query(Company).filter(Company.id == new_company_id).first()
            if company:
                event.company_name = company.name
                event.role = company.role
        else:
            event.company_name = None
            event.role = None

    for field, value in update_data.items():
        setattr(event, field, value)

    db.add(event)
    db.commit()
    db.refresh(event)
    bump_user_version(current_user.id)
    return event

@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_calendar_event(
    id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Deletes calendar event.
    Manual events are hard deleted. Synced events are soft deleted (is_deleted = True) so they won't recreate on sync.
    """
    event = db.query(CalendarEvent).filter(
        CalendarEvent.id == id,
        CalendarEvent.user_id == current_user.id
    ).first()
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Calendar event not found."
        )

    if event.source == 'manual':
        db.delete(event)
    else:
        event.is_deleted = True
        db.add(event)
        
    db.commit()
    bump_user_version(current_user.id)
    return None
