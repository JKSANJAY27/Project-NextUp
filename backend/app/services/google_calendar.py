import logging
import requests
from datetime import datetime, timedelta
from uuid import UUID
from sqlalchemy.orm import Session
from app.models.models import UserGoogleCredentials, CalendarEvent
from app.core.config import settings

logger = logging.getLogger(__name__)

def get_google_creds(db: Session, user_id: UUID) -> UserGoogleCredentials:
    return db.query(UserGoogleCredentials).filter(UserGoogleCredentials.user_id == user_id).first()

def get_valid_access_token(db: Session, user_id: UUID) -> str:
    creds = get_google_creds(db, user_id)
    if not creds:
        return None

    # Check if token is expired or close to expiring (within 5 minutes)
    now = datetime.utcnow()
    expiry = creds.expiry.replace(tzinfo=None) if creds.expiry else None
    if not expiry or now >= expiry - timedelta(minutes=5):
        if not creds.refresh_token:
            logger.warning(f"No refresh token available for user {user_id}")
            return None
        
        logger.info(f"Refreshing Google access token for user {user_id}")
        payload = {
            "client_id": creds.client_id,
            "client_secret": creds.client_secret,
            "refresh_token": creds.refresh_token,
            "grant_type": "refresh_token",
        }
        try:
            res = requests.post(creds.token_uri, data=payload, timeout=10)
            if res.status_code == 200:
                data = res.json()
                creds.access_token = data["access_token"]
                expires_in = data.get("expires_in", 3600)
                creds.expiry = datetime.utcnow() + timedelta(seconds=expires_in)
                creds.updated_at = datetime.utcnow()
                db.add(creds)
                db.commit()
                db.refresh(creds)
                logger.info(f"Successfully refreshed Google token for user {user_id}")
            else:
                logger.error(f"Failed to refresh Google token: {res.text}")
                return None
        except Exception as e:
            logger.error(f"Exception during Google token refresh for user {user_id}: {e}")
            return None

    return creds.access_token

def sync_event_to_google(db: Session, user_id: UUID, event_id: UUID):
    """
    Syncs a single CalendarEvent to Google Calendar.
    If the event is soft deleted, it deletes it from Google Calendar.
    """
    token = get_valid_access_token(db, user_id)
    if not token:
        return

    event = db.query(CalendarEvent).filter(CalendarEvent.id == event_id, CalendarEvent.user_id == user_id).first()
    if not event:
        return

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    # If event is deleted (or soft-deleted), remove it from Google Calendar
    if event.is_deleted:
        if event.google_event_id:
            url = f"https://www.googleapis.com/calendar/v3/calendars/primary/events/{event.google_event_id}"
            try:
                res = requests.delete(url, headers=headers, timeout=10)
                if res.status_code in (200, 204, 410): # 410 means already deleted
                    event.google_event_id = None
                    db.add(event)
                    db.commit()
                    logger.info(f"Deleted Google Calendar event for event {event.id}")
                else:
                    logger.error(f"Failed to delete Google Calendar event {event.google_event_id}: {res.text}")
            except Exception as e:
                logger.error(f"Error deleting Google Calendar event: {e}")
        return

    # Prepare Google Calendar event payload
    start_dt = event.date
    end_dt = start_dt + timedelta(hours=1)

    payload = {
        "summary": event.title,
        "description": f"{event.notes or ''}\n\nSynced from Nextup Placement Tracker.",
        "location": event.location_platform or "",
        "start": {
            "dateTime": start_dt.isoformat() + ("Z" if not start_dt.tzinfo else ""),
            "timeZone": "UTC"
        },
        "end": {
            "dateTime": end_dt.isoformat() + ("Z" if not end_dt.tzinfo else ""),
            "timeZone": "UTC"
        }
    }

    if event.google_event_id:
        # Update existing Google Calendar event
        url = f"https://www.googleapis.com/calendar/v3/calendars/primary/events/{event.google_event_id}"
        try:
            res = requests.put(url, headers=headers, json=payload, timeout=10)
            if res.status_code == 200:
                logger.info(f"Updated Google Calendar event {event.google_event_id} for event {event.id}")
            elif res.status_code == 404:
                # If deleted on Google side, recreate it
                event.google_event_id = None
                db.add(event)
                db.commit()
                sync_event_to_google(db, user_id, event_id)
            else:
                logger.error(f"Failed to update Google Calendar event {event.google_event_id}: {res.text}")
        except Exception as e:
            logger.error(f"Error updating Google Calendar event: {e}")
    else:
        # Insert new Google Calendar event
        url = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
        try:
            res = requests.post(url, headers=headers, json=payload, timeout=10)
            if res.status_code in (200, 201):
                data = res.json()
                event.google_event_id = data["id"]
                db.add(event)
                db.commit()
                logger.info(f"Created Google Calendar event {event.google_event_id} for event {event.id}")
            else:
                logger.error(f"Failed to create Google Calendar event: {res.text}")
        except Exception as e:
            logger.error(f"Error creating Google Calendar event: {e}")

def sync_all_events_to_google(db: Session, user_id: UUID) -> int:
    """
    Syncs all non-deleted calendar events for a user to Google Calendar.
    Returns the count of successfully synced events.
    """
    token = get_valid_access_token(db, user_id)
    if not token:
        logger.warning(f"Google Calendar not linked or token invalid for user {user_id}")
        return 0

    events = db.query(CalendarEvent).filter(
        CalendarEvent.user_id == user_id,
        CalendarEvent.is_deleted == False
    ).all()

    success_count = 0
    for event in events:
        try:
            sync_event_to_google(db, user_id, event.id)
            success_count += 1
        except Exception as e:
            logger.error(f"Failed to sync event {event.id} during bulk sync: {e}")
    
    return success_count
