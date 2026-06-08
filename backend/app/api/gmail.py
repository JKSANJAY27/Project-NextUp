import os
import json
import logging
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from google_auth_oauthlib.flow import Flow

from app.core.config import settings
from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.models import User
from app.core.security import encrypt_field
from app.core.gmail_token_cache import get_session_key
from app.services.gmail_sync import sync_user_gmail

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/gmail", tags=["gmail"])

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

def get_oauth_flow(redirect_uri: str) -> Flow:
    client_config = {
        "web": {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
        }
    }
    return Flow.from_client_config(
        client_config,
        scopes=SCOPES,
        redirect_uri=redirect_uri
    )

@router.get("/auth-url")
def get_auth_url(current_user: User = Depends(get_current_user)):
    # Check if mock mode is enabled or if client credentials aren't set
    mock_mode = os.getenv("MOCK_GMAIL", "false").lower() == "true"
    if mock_mode or not settings.GOOGLE_CLIENT_ID:
        # In mock mode or if not configured, return a custom mock oauth trigger
        return {"auth_url": "mock-oauth-flow"}

    redirect_uri = "http://localhost:8000/api/gmail/callback"
    try:
        flow = get_oauth_flow(redirect_uri)
        auth_url, state = flow.authorization_url(
            access_type="offline",
            include_granted_scopes="true",
            prompt="consent",
            state=str(current_user.id)
        )
        return {"auth_url": auth_url}
    except Exception as e:
        logger.error(f"Failed to generate authorization URL: {str(e)}")
        # Fallback to mock oauth flow URL if Google API call fails
        return {"auth_url": "mock-oauth-flow"}

@router.get("/callback")
def callback(code: str = None, state: str = None, error: str = None, db: Session = Depends(get_db)):
    if error:
        logger.error(f"OAuth callback error: {error}")
        return RedirectResponse(url="http://localhost:3000/profile?error=oauth_denied")

    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing authorization code or state")

    user_id = state
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    derived_key = get_session_key(user.id)
    if not derived_key:
        return RedirectResponse(url="http://localhost:3000/profile?error=no_session_key")

    redirect_uri = "http://localhost:8000/api/gmail/callback"
    try:
        flow = get_oauth_flow(redirect_uri)
        flow.fetch_token(code=code)
        creds = flow.credentials

        token_data = {
            "token": creds.token,
            "refresh_token": creds.refresh_token,
            "expiry": creds.expiry.isoformat() if creds.expiry else None
        }

        # Encrypt token with client's derived key
        user.gmail_token_enc = encrypt_field(json.dumps(token_data), derived_key)
        user.gmail_connected = True
        db.commit()

        return RedirectResponse(url="http://localhost:3000/profile?connected=true")
    except Exception as e:
        logger.error(f"Error fetching token: {str(e)}")
        return RedirectResponse(url="http://localhost:3000/profile?error=token_exchange_failed")

@router.post("/mock-connect")
def mock_connect(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Convenience endpoint to simulate successful OAuth connection for local dev."""
    derived_key = get_session_key(current_user.id)
    if not derived_key:
        raise HTTPException(status_code=400, detail="Active session key missing. Please log in.")

    token_data = {
        "token": "mock_access_token_12345",
        "refresh_token": "mock_refresh_token_abcde",
        "expiry": None
    }
    
    current_user.gmail_token_enc = encrypt_field(json.dumps(token_data), derived_key)
    current_user.gmail_connected = True
    db.commit()
    
    return {"message": "Mock Gmail connected successfully."}

@router.post("/sync")
def trigger_sync(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Allows users to manually trigger Gmail poll/sync."""
    if not current_user.gmail_connected:
        raise HTTPException(status_code=400, detail="Gmail is not connected.")
    
    success = sync_user_gmail(current_user.id, db)
    if success:
        return {"status": "success", "message": "Gmail sync completed successfully."}
    else:
        raise HTTPException(status_code=500, detail="Sync failed. Check credentials or connection.")

@router.get("/status")
def get_status(current_user: User = Depends(get_current_user)):
    """Gets connection state and last sync timestamp."""
    return {
        "connected": current_user.gmail_connected,
        "last_synced": current_user.gmail_last_synced.isoformat() if current_user.gmail_last_synced else None
    }
