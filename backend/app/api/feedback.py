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

    smtp_configured = bool(
        settings.FEEDBACK_SMTP_HOST
        and settings.FEEDBACK_SMTP_USERNAME
        and settings.FEEDBACK_SMTP_PASSWORD
    )

    display_name = (user.profile.full_name if user.profile else None) or "Student"

    if not smtp_configured:
        # SMTP not yet configured — persist the report to server logs so it's
        # never silently dropped. Render logs are retained and searchable.
        logging.warning(
            "[FEEDBACK] SMTP not configured — logging report to server logs.\n"
            f"From: {display_name} <{user.email}>\n"
            f"Page: {page_url or 'not provided'}\n"
            f"Message:\n{message}"
        )
        return {"status": "sent"}
    email = EmailMessage()
    email["Subject"] = f"[NextUp issue] {user.email}"
    email["From"] = settings.FEEDBACK_FROM_EMAIL or settings.FEEDBACK_SMTP_USERNAME
    email["To"] = settings.FEEDBACK_RECIPIENT_EMAIL
    email.set_content(f"New issue report\n\nFrom: {display_name} <{user.email}>\nPage: {page_url or 'not provided'}\n\n{message}")
    # Parse the comma-separated recipient list into individual addresses so
    # smtplib delivers to each mailbox regardless of how the To header is set.
    recipients = [addr.strip() for addr in settings.FEEDBACK_RECIPIENT_EMAIL.split(",") if addr.strip()]
    try:
        with smtplib.SMTP(settings.FEEDBACK_SMTP_HOST, settings.FEEDBACK_SMTP_PORT, timeout=20) as smtp:
            smtp.ehlo()          # identify ourselves to the server
            smtp.starttls()      # upgrade to TLS
            smtp.ehlo()          # re-identify over the encrypted channel (required by Gmail)
            smtp.login(settings.FEEDBACK_SMTP_USERNAME, settings.FEEDBACK_SMTP_PASSWORD)
            smtp.sendmail(
                from_addr=settings.FEEDBACK_FROM_EMAIL or settings.FEEDBACK_SMTP_USERNAME,
                to_addrs=recipients,
                msg=email.as_string(),
            )
    except smtplib.SMTPAuthenticationError as exc:
        logging.error("[FEEDBACK] SMTP authentication failed — check username/app-password: %s", exc)
        raise HTTPException(status_code=503, detail="Could not deliver the report. Please try again.")
    except Exception as exc:
        logging.exception("[FEEDBACK] Failed to deliver feedback email: %s", exc)
        raise HTTPException(status_code=503, detail="Could not deliver the report. Please try again.")
    return {"status": "sent"}
