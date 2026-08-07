"""Authenticated issue reports, delivered to the product mailbox via SMTP."""
import logging
import mimetypes
import smtplib
from email.message import EmailMessage
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.api.auth import get_current_user
from app.core.config import settings
from app.models.models import User

router = APIRouter(prefix="/feedback", tags=["feedback"])
MAX_FILES = 3
MAX_FILE_SIZE = 5 * 1024 * 1024


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def submit_feedback(
    message: str = Form(..., min_length=8, max_length=5000),
    page_url: str = Form("", max_length=2000),
    screenshots: Optional[List[UploadFile]] = File(None),
    user: User = Depends(get_current_user),
):
    if not settings.FEEDBACK_SMTP_HOST or not settings.FEEDBACK_SMTP_USERNAME or not settings.FEEDBACK_SMTP_PASSWORD:
        logging.error("Feedback SMTP is not configured")
        raise HTTPException(status_code=503, detail="Issue reporting is temporarily unavailable.")
    attachments = screenshots or []
    if len(attachments) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"Attach at most {MAX_FILES} screenshots.")

    email = EmailMessage()
    email["Subject"] = f"[NextUp issue] {user.email}"
    email["From"] = settings.FEEDBACK_FROM_EMAIL or settings.FEEDBACK_SMTP_USERNAME
    email["To"] = settings.FEEDBACK_RECIPIENT_EMAIL
    email.set_content(f"New issue report\n\nFrom: {user.full_name or 'Student'} <{user.email}>\nPage: {page_url or 'not provided'}\n\n{message}")
    for upload in attachments:
        if not (upload.content_type or "").startswith("image/"):
            raise HTTPException(status_code=400, detail="Only image screenshots can be attached.")
        data = await upload.read()
        if len(data) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="Each screenshot must be 5 MB or smaller.")
        mime_type, _ = mimetypes.guess_type(upload.filename or "screenshot.png")
        maintype, subtype = (mime_type or "image/png").split("/", 1)
        email.add_attachment(data, maintype=maintype, subtype=subtype, filename=upload.filename or "screenshot.png")
    try:
        with smtplib.SMTP(settings.FEEDBACK_SMTP_HOST, settings.FEEDBACK_SMTP_PORT, timeout=20) as smtp:
            smtp.starttls()
            smtp.login(settings.FEEDBACK_SMTP_USERNAME, settings.FEEDBACK_SMTP_PASSWORD)
            smtp.send_message(email)
    except Exception:
        logging.exception("Failed to deliver feedback email")
        raise HTTPException(status_code=503, detail="Could not deliver the report. Please try again.")
    return {"status": "sent"}
