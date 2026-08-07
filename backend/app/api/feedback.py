"""Authenticated issue reports, delivered to the product mailbox via SMTP."""
import logging
import smtplib
from email.message import EmailMessage
from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.auth import get_current_user
from app.core.config import settings
from app.models.models import User

router = APIRouter(prefix="/feedback", tags=["feedback"])
@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def submit_feedback(
    request: Request,
    user: User = Depends(get_current_user),
):
    # Deliberately JSON-only: issue reports are text-only. Removing file
    # uploads eliminates multipart boundary/list coercion errors and makes
    # the feedback path dependable on browsers and mobile networks.
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read the issue report.")

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="The issue report format is invalid.")
    message = str(payload.get("message") or "").strip()
    page_url = str(payload.get("page_url") or "").strip()
    if not 8 <= len(message) <= 5000:
        raise HTTPException(status_code=400, detail="Describe the issue using 8 to 5,000 characters.")
    if len(page_url) > 2000:
        raise HTTPException(status_code=400, detail="The page URL is too long.")

    if not settings.FEEDBACK_SMTP_HOST or not settings.FEEDBACK_SMTP_USERNAME or not settings.FEEDBACK_SMTP_PASSWORD:
        logging.error("Feedback SMTP is not configured")
        raise HTTPException(status_code=503, detail="Issue reporting is temporarily unavailable.")
    email = EmailMessage()
    email["Subject"] = f"[NextUp issue] {user.email}"
    email["From"] = settings.FEEDBACK_FROM_EMAIL or settings.FEEDBACK_SMTP_USERNAME
    email["To"] = settings.FEEDBACK_RECIPIENT_EMAIL
    display_name = (user.profile.full_name if user.profile else None) or "Student"
    email.set_content(f"New issue report\n\nFrom: {display_name} <{user.email}>\nPage: {page_url or 'not provided'}\n\n{message}")
    try:
        with smtplib.SMTP(settings.FEEDBACK_SMTP_HOST, settings.FEEDBACK_SMTP_PORT, timeout=20) as smtp:
            smtp.starttls()
            smtp.login(settings.FEEDBACK_SMTP_USERNAME, settings.FEEDBACK_SMTP_PASSWORD)
            smtp.send_message(email)
    except Exception:
        logging.exception("Failed to deliver feedback email")
        raise HTTPException(status_code=503, detail="Could not deliver the report. Please try again.")
    return {"status": "sent"}
