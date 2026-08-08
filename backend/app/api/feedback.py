"""Authenticated issue reports, delivered through Resend or SMTP."""
import json
import logging
import smtplib
from email.message import EmailMessage
from urllib.error import HTTPError
from urllib import request as urllib_request

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
    report_text = (
        "New issue report\n\n"
        f"From: {display_name} <{user.email}>\n"
        f"Page: {page_url or 'not provided'}\n\n"
        f"{message}"
    )

    if not smtp_configured and not getattr(settings, "RESEND_API_KEY", ""):
        # SMTP not yet configured - persist the report to server logs so it's
        # never silently dropped. Render logs are retained and searchable.
        logging.warning(
            "[FEEDBACK] SMTP not configured - logging report to server logs.\n"
            f"From: {display_name} <{user.email}>\n"
            f"Page: {page_url or 'not provided'}\n"
            f"Message:\n{message}"
        )

    email = EmailMessage()
    email["Subject"] = f"[NextUp issue] {user.email}"
    from_addr = settings.FEEDBACK_FROM_EMAIL or settings.FEEDBACK_SMTP_USERNAME
    if from_addr:
        email["From"] = from_addr
    email["To"] = settings.FEEDBACK_RECIPIENT_EMAIL
    email.set_content(report_text)
    recipients = [addr.strip() for addr in settings.FEEDBACK_RECIPIENT_EMAIL.split(",") if addr.strip()]

    if not recipients:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Issue reporting is temporarily unavailable: no recipient email is configured.",
        )

    delivered = False

    # Primary: Resend HTTP API.
    resend_api_key = getattr(settings, "RESEND_API_KEY", "") or ""
    if resend_api_key:
        # Resend's onboarding@resend.dev sender can only deliver to the
        # account owner's email. Send each recipient separately so one
        # invalid/unverified address does not prevent the valid one.
        resend_from = f"NextUp Issue Reports <{settings.FEEDBACK_FROM_EMAIL or 'onboarding@resend.dev'}>"
        for recipient in recipients:
            try:
                payload = json.dumps({
                    "from": resend_from,
                    "to": [recipient],
                    "subject": email["Subject"],
                    "text": report_text,
                }).encode()
                req = urllib_request.Request(
                    "https://api.resend.com/emails",
                    data=payload,
                    headers={
                        "Authorization": f"Bearer {resend_api_key.strip()}",
                        "Content-Type": "application/json",
                    },
                    method="POST",
                )
                with urllib_request.urlopen(req, timeout=15) as resp:
                    if resp.status in (200, 201):
                        delivered = True
                        logging.info("[FEEDBACK] Delivered via Resend to %s", recipient)
            except HTTPError as exc:
                body = exc.read().decode("utf-8", errors="replace")[:500]
                logging.warning("[FEEDBACK] Resend delivery failed for %s (HTTP %s): %s", recipient, exc.code, body)
            except Exception as exc:
                logging.warning("[FEEDBACK] Resend delivery failed for %s: %s", recipient, exc)

    # Secondary: SMTP (works locally; usually blocked on Render).
    smtp_configured = bool(
        settings.FEEDBACK_SMTP_HOST
        and settings.FEEDBACK_SMTP_USERNAME
        and settings.FEEDBACK_SMTP_PASSWORD
    )
    if not delivered and smtp_configured:
        from_addr = settings.FEEDBACK_FROM_EMAIL or settings.FEEDBACK_SMTP_USERNAME
        for port, use_ssl in [(465, True), (settings.FEEDBACK_SMTP_PORT, False)]:
            try:
                if use_ssl:
                    ctx = smtplib.SMTP_SSL(settings.FEEDBACK_SMTP_HOST, port, timeout=15)
                else:
                    ctx = smtplib.SMTP(settings.FEEDBACK_SMTP_HOST, port, timeout=15)
                    ctx.ehlo()
                    ctx.starttls()
                    ctx.ehlo()
                with ctx as smtp:
                    smtp.login(settings.FEEDBACK_SMTP_USERNAME, settings.FEEDBACK_SMTP_PASSWORD)
                    smtp.sendmail(from_addr, recipients, email.as_string())
                delivered = True
                logging.info("[FEEDBACK] Delivered via SMTP port %s", port)
                break
            except Exception as exc:
                logging.warning("[FEEDBACK] SMTP port %s failed: %s", port, exc)

    # Fallback: preserve in Render logs.
    if not delivered:
        logging.warning(
            "[FEEDBACK-REPORT] All delivery methods failed - report preserved here.\n"
            "From: %s <%s>\nPage: %s\nMessage:\n%s",
            display_name, user.email, page_url or "not provided", message,
        )

    if not delivered:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Your report could not be delivered right now. Please try again "
                "shortly; the team has a copy in the server logs."
            ),
        )

    return {"status": "sent"}
