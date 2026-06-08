import os
import json
import logging
import base64
import tempfile
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from uuid import UUID

from sqlalchemy.orm import Session
from apscheduler.schedulers.background import BackgroundScheduler
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request as GoogleRequest
from googleapiclient.discovery import build

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import decrypt_field, encrypt_field
from app.core import gmail_token_cache
from app.models.models import User, Company, Application, Notification
from app.services.email_parser import parse_placement_email
from app.services.excel_parser import extract_neo_ids_from_excel
from app.services.pdf_extractor import parse_job_description
from app.services.eligibility import check_eligibility  # Let's check if this matches the file name

logger = logging.getLogger(__name__)

# Global scheduler
scheduler = BackgroundScheduler()

def start_scheduler():
    if not scheduler.running:
        scheduler.add_job(sync_all_active_users, "interval", minutes=10, id="gmail_sync_job", replace_existing=True)
        scheduler.start()
        logger.info("Background Gmail sync scheduler started.")

def shutdown_scheduler():
    if scheduler.running:
        scheduler.shutdown()
        logger.info("Background Gmail sync scheduler stopped.")

def get_gmail_service(token_data: Dict[str, Any]) -> Credentials:
    """Build Credentials object from decrypted token dictionary."""
    return Credentials(
        token=token_data.get("token"),
        refresh_token=token_data.get("refresh_token"),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        scopes=["https://www.googleapis.com/auth/gmail.readonly"]
    )

def sync_user_gmail(user_id: UUID, db: Session) -> bool:
    """Sync Gmail for a single user."""
    logger.info(f"Starting Gmail sync for user: {user_id}")
    
    # 1. Retrieve derived key from in-memory cache
    derived_key = gmail_token_cache.get_session_key(user_id)
    if not derived_key:
        logger.warning(f"No derived key in cache for user {user_id}. Skipping sync.")
        return False
        
    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.gmail_token_enc:
        logger.warning(f"User {user_id} has no Gmail connection or encrypted token.")
        return False
        
    # 2. Decrypt token
    try:
        token_json_str = decrypt_field(user.gmail_token_enc, derived_key)
        token_data = json.loads(token_json_str)
    except Exception as e:
        logger.error(f"Failed to decrypt Gmail token for user {user_id}: {str(e)}")
        return False

    # Check for MOCK mode override
    mock_mode = settings.MOCK_GMAIL
    
    if mock_mode:
        logger.info(f"Running in MOCK_GMAIL mode for user {user_id}")
        run_mock_sync(user, db, derived_key)
        user.gmail_last_synced = datetime.utcnow()
        db.commit()
        return True

    # 3. Authenticate with Google
    try:
        creds = get_gmail_service(token_data)
        if creds.expired and creds.refresh_token:
            creds.refresh(GoogleRequest())
            # Save refreshed credentials
            new_token_data = {
                "token": creds.token,
                "refresh_token": creds.refresh_token,
                "expiry": creds.expiry.isoformat() if creds.expiry else None
            }
            user.gmail_token_enc = encrypt_field(json.dumps(new_token_data), derived_key)
            db.commit()
            
        service = build("gmail", "v1", credentials=creds)
    except Exception as e:
        logger.error(f"Google authentication failed for user {user_id}: {str(e)}")
        return False

    # 4. Fetch Emails matching placement rules
    try:
        # Fetch emails from the last 5 days
        q = f"from:({settings.CDC_SENDER_EMAIL} OR noreply.cdcinfo@vit.ac.in) subject:(Dream OR 'Super Dream' OR Shortlisted OR 'Online Test' OR 'Interview Schedule' OR 'Offer')"
        results = service.users().messages().list(userId="me", q=q, maxResults=15).execute()
        messages = results.get("messages", [])
        
        for msg in messages:
            msg_id = msg["id"]
            # Check if this email was already processed (or just process it safely)
            msg_detail = service.users().messages().get(userId="me", id=msg_id, format="full").execute()
            
            # Extract headers and body
            payload = msg_detail.get("payload", {})
            headers = payload.get("headers", [])
            subject = next((h["value"] for h in headers if h["name"].lower() == "subject"), "No Subject")
            sender = next((h["value"] for h in headers if h["name"].lower() == "from"), "")
            
            body = ""
            if "parts" in payload:
                for part in payload["parts"]:
                    if part.get("mimeType") == "text/plain" and "data" in part.get("body", {}):
                        body += base64.urlsafe_b64decode(part["body"]["data"].encode("ASCII")).decode("utf-8")
            elif "body" in payload and "data" in payload["body"]:
                body = base64.urlsafe_b64decode(payload["body"]["data"].encode("ASCII")).decode("utf-8")
                
            if not body:
                continue
                
            # Parse company announcement info
            parsed_info = parse_placement_email(body)
            company_name = parsed_info.get("company", "Unknown")
            
            # Check if company already exists
            company = db.query(Company).filter(Company.name == company_name, Company.role == parsed_info.get("role")).first()
            if not company:
                company = Company(
                    name=company_name,
                    category=parsed_info.get("category"),
                    role=parsed_info.get("role"),
                    ctc=parsed_info.get("ctc"),
                    stipend=parsed_info.get("stipend"),
                    job_location=parsed_info.get("job_location"),
                    eligible_branches=parsed_info.get("eligible_branches"),
                    min_cgpa=parsed_info.get("min_cgpa"),
                    requires_no_arrears=parsed_info.get("requires_no_arrears"),
                    registration_deadline=datetime.fromisoformat(parsed_info["deadline_iso"]) if parsed_info.get("deadline_iso") else None,
                    registration_link=parsed_info.get("registration_link"),
                    source_email_id=msg_id,
                    source_email_body=body,
                    additional_info={"subject": subject, "sender": sender}
                )
                db.add(company)
                db.commit()
                db.refresh(company)

            # Handle attachments (e.g., Shortlists, JDs)
            parts = payload.get("parts", [])
            for part in parts:
                filename = part.get("filename")
                if filename and part.get("body", {}).get("attachmentId"):
                    att_id = part["body"]["attachmentId"]
                    att = service.users().messages().attachments().get(userId="me", messageId=msg_id, id=att_id).execute()
                    att_bytes = base64.urlsafe_b64decode(att["data"].encode("ASCII"))
                    
                    # Process shortlist excel
                    if filename.endswith((".xls", ".xlsx")):
                        neo_ids = extract_neo_ids_from_excel(att_bytes)
                        # Decrypt student's neo_id
                        if user.neo_id_enc:
                            student_neo_id = decrypt_field(user.neo_id_enc, derived_key)
                            if student_neo_id.upper() in [nid.upper() for nid in neo_ids]:
                                # User is shortlisted! Update or create application
                                app = db.query(Application).filter(Application.user_id == user.id, Application.company_id == company.id).first()
                                encrypted_shortlisted = encrypt_field("Shortlisted", derived_key)
                                if not app:
                                    app = Application(
                                        user_id=user.id,
                                        company_id=company.id,
                                        status_enc=encrypted_shortlisted,
                                        current_round="Shortlist Announcement"
                                    )
                                    db.add(app)
                                else:
                                    app.status_enc = encrypted_shortlisted
                                    app.current_round = "Shortlisted"
                                
                                # Send notification
                                db.add(Notification(
                                    user_id=user.id,
                                    message=f"🎉 Congratulations! You are shortlisted in the {company_name} drive for the {company.role} role."
                                ))
                                db.commit()

                    # Process Job Description PDF
                    elif filename.endswith(".pdf"):
                        jd_info = parse_job_description(att_bytes)
                        company.jd_text = jd_info.get("jd_text")
                        company.jd_required_skills = jd_info.get("skills")
                        company.jd_ats_keywords = jd_info.get("ats_keywords")
                        db.commit()

        # Update sync timestamp
        user.gmail_last_synced = datetime.utcnow()
        db.commit()
        return True
        
    except Exception as e:
        logger.error(f"Gmail sync process failed for user {user_id}: {str(e)}")
        return False

def sync_all_active_users():
    """Runs through all active (logged-in) users and triggers Gmail sync."""
    logger.info("Executing background sync job for all active users...")
    db = SessionLocal()
    try:
        active_ids = gmail_token_cache.get_active_user_ids()
        for user_id in active_ids:
            sync_user_gmail(user_id, db)
    except Exception as e:
        logger.error(f"Error in sync_all_active_users job: {str(e)}")
    finally:
        db.close()

def run_mock_sync(user: User, db: Session, derived_key: str):
    """Generates mock placement sync events for local development."""
    mock_drives = [
        {
            "company": "Nokia",
            "role": "Software Developer",
            "category": "Dream",
            "ctc": "12 LPA",
            "stipend": "30,000 pm",
            "location": "Bangalore",
            "deadline": datetime.utcnow() + timedelta(days=2),
            "branches": ["CSE", "IT", "ECE"],
            "cgpa": 7.5,
            "no_arrears": True,
            "link": "https://careers.nokia.com/mock-vit-registration"
        },
        {
            "company": "Microsoft",
            "role": "Software Engineering Intern",
            "category": "Super Dream",
            "ctc": "44 LPA",
            "stipend": "1,00,000 pm",
            "location": "Hyderabad",
            "deadline": datetime.utcnow() + timedelta(days=4),
            "branches": ["CSE", "IT"],
            "cgpa": 8.5,
            "no_arrears": True,
            "link": "https://microsoft.com/careers"
        }
    ]
    
    for drive in mock_drives:
        # Check if already exists
        company = db.query(Company).filter(Company.name == drive["company"], Company.role == drive["role"]).first()
        if not company:
            company = Company(
                name=drive["company"],
                category=drive["category"],
                role=drive["role"],
                ctc=drive["ctc"],
                stipend=drive["stipend"],
                job_location=drive["location"],
                eligible_branches=drive["branches"],
                min_cgpa=drive["cgpa"],
                requires_no_arrears=drive["no_arrears"],
                registration_deadline=drive["deadline"],
                registration_link=drive["link"],
                jd_required_skills=["Python", "C++", "Data Structures", "Algorithms"],
                jd_ats_keywords=["software", "development", "intern", "cloud", "algorithms"],
                source_email_body=f"Dear Students,\n\nWe are pleased to announce that {drive['company']} is hiring for the role of {drive['role']}. The details are as follows:\n- CTC: {drive['ctc']}\n- Stipend: {drive['stipend']}\n- Location: {drive['location']}\n- Deadline: {drive['deadline'].strftime('%d %b %Y')}\n\nApply via link: {drive['link']}\n\nBest Regards,\nVIT Career Development Centre (CDC)",
                additional_info={
                    "subject": f"Recruitment Announcement: {drive['company']}",
                    "sender": "noreply.cdcinfo@vit.ac.in",
                    "important_links": [
                        {"label": "Direct Google Form", "url": drive["link"]},
                        {"label": "CDC Portal", "url": "https://vtop.vit.ac.in"}
                    ]
                }
            )
            db.add(company)
            db.commit()
            db.refresh(company)
            
            # Send notification about new drive
            db.add(Notification(
                user_id=user.id,
                message=f"📢 New drive registered: {company.name} is hiring for {company.role} ({company.category}). Deadline: {company.registration_deadline.strftime('%b %d, %I:%M %p')}."
            ))
            db.commit()

    # Simulate shortlist selection for Nokia
    nokia_comp = db.query(Company).filter(Company.name == "Nokia").first()
    if nokia_comp:
        app = db.query(Application).filter(Application.user_id == user.id, Application.company_id == nokia_comp.id).first()
        if not app:
            encrypted_status = encrypt_field("Shortlisted", derived_key)
            app = Application(
                user_id=user.id,
                company_id=nokia_comp.id,
                status_enc=encrypted_status,
                current_round="Shortlisted",
                match_score=85
            )
            db.add(app)
            db.add(Notification(
                user_id=user.id,
                message=f"🎉 Congratulations! You have been shortlisted in the Nokia recruitment drive. Check your dashboard!"
            ))
            db.commit()
