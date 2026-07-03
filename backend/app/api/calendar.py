import logging
from typing import List, Optional
from uuid import UUID
from datetime import datetime, timedelta
import urllib.parse
import requests
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.models import User, CalendarEvent, Company, UserGoogleCredentials
from app.schemas.schemas import CalendarEventCreate, CalendarEventUpdate, CalendarEventOut
from app.core.redis import get_cache, set_cache, get_user_version, bump_user_version
from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/calendar", tags=["calendar"])

@router.get("/google/auth-url")
def get_google_auth_url(current_user: User = Depends(get_current_user)):
    """
    Generates the Google OAuth consent screen URL for linking Google Calendar.
    """
    client_id = settings.GOOGLE_CLIENT_ID
    # Needs to match the authorized redirect URIs in Google Console
    redirect_uri = "http://localhost:8000/api/calendar/google/callback"
    scopes = "https://www.googleapis.com/auth/calendar.events"
    
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": scopes,
        "access_type": "offline",
        "prompt": "consent",
        "state": str(current_user.id)
    }
    
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params)
    return {"url": url}

@router.get("/google/callback")
def google_callback(code: str, state: str, db: Session = Depends(get_db)):
    """
    Google OAuth Callback endpoint. Exchanges authorization code for tokens,
    saves credentials in the database, triggers initial sync, and redirects back to frontend.
    """
    token_url = "https://oauth2.googleapis.com/token"
    payload = {
        "code": code,
        "client_id": settings.GOOGLE_CLIENT_ID,
        "client_secret": settings.GOOGLE_CLIENT_SECRET,
        "redirect_uri": "http://localhost:8000/api/calendar/google/callback",
        "grant_type": "authorization_code"
    }
    
    try:
        res = requests.post(token_url, data=payload, timeout=10)
        if res.status_code != 200:
            logger.error(f"Token exchange failed: {res.text}")
            return RedirectResponse("http://localhost:3000/calendar?error=oauth_failed")
            
        data = res.json()
        access_token = data["access_token"]
        refresh_token = data.get("refresh_token")
        expires_in = data.get("expires_in", 3600)
        expiry = datetime.utcnow() + timedelta(seconds=expires_in)
        
        user_id = UUID(state)
        creds = db.query(UserGoogleCredentials).filter(UserGoogleCredentials.user_id == user_id).first()
        if not creds:
            creds = UserGoogleCredentials(
                user_id=user_id,
                access_token=access_token,
                refresh_token=refresh_token,
                token_uri=token_url,
                client_id=settings.GOOGLE_CLIENT_ID,
                client_secret=settings.GOOGLE_CLIENT_SECRET,
                scopes=[data.get("scope", "https://www.googleapis.com/auth/calendar.events")],
                expiry=expiry
            )
            db.add(creds)
        else:
            creds.access_token = access_token
            if refresh_token:
                creds.refresh_token = refresh_token
            creds.expiry = expiry
            creds.updated_at = datetime.utcnow()
            db.add(creds)
            
        db.commit()
        
        # Trigger an initial background sync of all user's calendar events
        from app.services.google_calendar import sync_all_events_to_google
        try:
            sync_all_events_to_google(db, user_id)
        except Exception as e:
            logger.error(f"Error during initial Google Calendar sync: {e}")
            
        return RedirectResponse("http://localhost:3000/calendar?connected=true")
    except Exception as e:
        logger.error(f"Exception in Google callback: {e}")
        return RedirectResponse("http://localhost:3000/calendar?error=system_error")

@router.get("/google/status")
def google_status(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Checks connection status to Google Calendar.
    """
    creds = db.query(UserGoogleCredentials).filter(UserGoogleCredentials.user_id == current_user.id).first()
    return {"connected": creds is not None}

@router.post("/google/sync")
def trigger_google_sync(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Manually triggers full sync of all active events to Google Calendar.
    """
    from app.services.google_calendar import sync_all_events_to_google
    count = sync_all_events_to_google(db, current_user.id)
    return {"status": "success", "synced_count": count}

@router.post("/google/disconnect")
def google_disconnect(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Disconnects the Google account and deletes stored credentials.
    """
    creds = db.query(UserGoogleCredentials).filter(UserGoogleCredentials.user_id == current_user.id).first()
    if creds:
        db.delete(creds)
        db.commit()
    return {"status": "success"}

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

    # Sync to Google Calendar if connected
    from app.services.google_calendar import sync_event_to_google
    try:
        sync_event_to_google(db, current_user.id, new_event.id)
    except Exception as e:
        logger.error(f"Failed to sync newly created event {new_event.id} to Google: {e}")

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

    # Sync update to Google Calendar if connected
    from app.services.google_calendar import sync_event_to_google
    try:
        sync_event_to_google(db, current_user.id, event.id)
    except Exception as e:
        logger.error(f"Failed to sync updated event {event.id} to Google: {e}")

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

    google_event_id = event.google_event_id

    if event.source == 'manual':
        db.delete(event)
    else:
        event.is_deleted = True
        db.add(event)
        
    db.commit()
    bump_user_version(current_user.id)

    # If the event was linked to a Google Calendar event, delete it from Google Calendar
    if google_event_id:
        from app.services.google_calendar import get_valid_access_token
        token = get_valid_access_token(db, current_user.id)
        if token:
            headers = {"Authorization": f"Bearer {token}"}
            url = f"https://www.googleapis.com/calendar/v3/calendars/primary/events/{google_event_id}"
            try:
                res = requests.delete(url, headers=headers, timeout=10)
                logger.info(f"Deleted Google event {google_event_id} for event {id}, status: {res.status_code}")
            except Exception as e:
                logger.error(f"Failed to delete Google event {google_event_id}: {e}")

    return None

