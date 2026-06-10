import os
import re
import json
import logging
import base64
import hashlib
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session
from sqlalchemy.exc import DBAPIError
from apscheduler.schedulers.background import BackgroundScheduler

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import generate_blind_index
from app.models.models import (
    User, StudentProfile, Company, CompanyEvent, CompanyChangeLog,
    Application, Notification, RawIngestionJob, AttachmentMetadata, NotificationJob
)
from app.services.email_parser import parse_placement_email
from app.services.excel_parser import extract_neo_ids_from_excel
from app.services.pdf_extractor import parse_job_description
from app.services.ai_service import precompute_jd_intelligence_deterministic

logger = logging.getLogger(__name__)

# Global scheduler
scheduler = BackgroundScheduler()

def start_scheduler():
    if not scheduler.running:
        scheduler.add_job(process_queued_jobs_cron, "interval", minutes=5, id="queue_processor_job", replace_existing=True)
        scheduler.add_job(refresh_views_cron, "interval", minutes=30, id="view_refresher_job", replace_existing=True)
        scheduler.start()
        logger.info("Background queue processor and view refresher scheduler started.")

def shutdown_scheduler():
    if scheduler.running:
        scheduler.shutdown()
        logger.info("Background scheduler stopped.")

def recover_stale_jobs(db: Session):
    """
    Recovers jobs that have been stuck in 'processing' state for more than 30 minutes,
    resetting them back to 'pending'.
    """
    is_sqlite = "sqlite" in settings.DATABASE_URL.lower()
    try:
        if is_sqlite:
            # SQLite compatibility syntax
            result = db.execute(text("""
                UPDATE raw_ingestion_jobs 
                SET status = 'pending', 
                    locked_at = NULL, 
                    locked_by = NULL, 
                    error_message = 'Stale lock timeout - reset to pending.' 
                WHERE status = 'processing' 
                  AND locked_at < datetime('now', '-30 minutes')
            """))
        else:
            # PostgreSQL syntax
            result = db.execute(text("""
                UPDATE raw_ingestion_jobs 
                SET status = 'pending', 
                    locked_at = NULL, 
                    locked_by = NULL, 
                    error_message = 'Stale lock timeout - reset to pending.' 
                WHERE status = 'processing' 
                  AND locked_at < NOW() - INTERVAL '30 minutes'
            """))
        db.commit()
        if result.rowcount > 0:
            logger.info(f"Recovered {result.rowcount} stale raw_ingestion_jobs.")
    except Exception as e:
        db.rollback()
        logger.error(f"Error recovering stale jobs: {str(e)}")

def refresh_materialized_views(db: Session):
    """
    Refreshes performance materialized views concurrently.
    """
    # Bypass for SQLite local dev environments
    if "sqlite" in settings.DATABASE_URL.lower():
        logger.info("Skipping materialized view refresh (SQLite database does not support it).")
        return
        
    try:
        db.execute(text("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_branch_offer_counts"))
        db.execute(text("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_application_stages_ratio"))
        db.commit()
        logger.info("Successfully refreshed materialized views concurrently.")
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to refresh materialized views concurrently: {str(e)}")

def process_queued_jobs_cron():
    """Wrapper function for cron trigger (uses own session)."""
    db = SessionLocal()
    try:
        process_queued_jobs(db)
    finally:
        db.close()

def refresh_views_cron():
    """Wrapper function for periodic view refreshing (uses own session)."""
    db = SessionLocal()
    try:
        refresh_materialized_views(db)
    finally:
        db.close()

def process_queued_jobs(db: Session, job_id: Optional[str] = None) -> bool:
    """
    Iterates through pending raw ingestion jobs, acquires lock on them,
    parses emails and attachments, and records structured data.
    """
    # 1. Recover stale jobs first
    recover_stale_jobs(db)
    
    worker_id = f"worker-{os.getpid()}"
    
    # 2. Acquire a job lock
    # If job_id is passed, we try to lock that specific job. Otherwise, we lock the oldest pending job.
    query = db.query(RawIngestionJob)
    if job_id:
        # Check if the job exists and is pending, otherwise return False or get the oldest pending
        query = query.filter(RawIngestionJob.id == job_id, RawIngestionJob.status == 'pending')
    else:
        query = query.filter(RawIngestionJob.status == 'pending').order_by(RawIngestionJob.created_at.asc())
        
    job = query.with_for_update(skip_locked=True).first()
    
    if not job:
        logger.info("No pending raw ingestion jobs found.")
        return False
        
    # Mark as processing
    job.status = 'processing'
    job.locked_at = datetime.utcnow()
    job.locked_by = worker_id
    db.commit()
    
    logger.info(f"Locked job {job.id} for processing.")
    
    try:
        payload = job.payload
        if not payload:
            raise ValueError("Empty payload in raw ingestion job.")
            
        message_id = payload.get("message_id")
        sender = payload.get("sender", "Unknown")
        subject = payload.get("subject", "")
        body = payload.get("body", "")
        email_timestamp_str = payload.get("timestamp")
        attachments = payload.get("attachments", [])
        
        email_timestamp = datetime.fromisoformat(email_timestamp_str.replace("Z", "+00:00")) if email_timestamp_str else datetime.utcnow()
        
        # 3. Parse Email Body
        parsed_info = parse_placement_email(body)
        company_name = parsed_info.get("company", "Unknown").strip()
        role = parsed_info.get("role", "Software Engineer").strip()
        category = parsed_info.get("category", "Dream").strip()
        ctc = parsed_info.get("ctc")
        stipend = parsed_info.get("stipend")
        location = parsed_info.get("job_location")
        eligible_branches = parsed_info.get("eligible_branches", [])
        min_cgpa = parsed_info.get("min_cgpa")
        requires_no_arrears = parsed_info.get("requires_no_arrears", False)
        registration_deadline_str = parsed_info.get("deadline_iso")
        registration_deadline = datetime.fromisoformat(registration_deadline_str) if registration_deadline_str else None
        registration_link = parsed_info.get("registration_link")
        
        # Determine Batch Year from email subject or body, default to current/next year
        batch_year = datetime.utcnow().year
        year_match = re.search(r"\b(202\d)\b", subject + " " + body)
        if year_match:
            batch_year = int(year_match.group(1))
            
        recruitment_cycle = "Default"
        cycle_match = re.search(r"\b(Internship|Full-Time|Placement|Summer Intern)\b", subject + " " + body, re.I)
        if cycle_match:
            recruitment_cycle = cycle_match.group(1)
            
        # 4. Generate Fingerprint & check if Company already exists
        # Fingerprint Input = Company|Role|Category|Batch|Cycle
        fingerprint_input = f"{company_name.upper()}|{role.upper()}|{category.upper()}|{batch_year}|{recruitment_cycle.upper()}"
        fingerprint = hashlib.sha256(fingerprint_input.encode("utf-8")).hexdigest()
        
        company = db.query(Company).filter(Company.fingerprint == fingerprint).first()
        
        # Eligibility rules JSONB setup
        eligibility_rules = {
            "min_cgpa": min_cgpa,
            "min_tenth_marks": None,
            "min_twelfth_marks": None,
            "requires_no_arrears": requires_no_arrears
        }
        
        if not company:
            company = Company(
                name=company_name,
                role=role,
                category=category,
                ctc=ctc,
                stipend=stipend,
                job_location=location,
                eligible_branches=eligible_branches,
                eligibility_rules=eligibility_rules,
                registration_deadline=registration_deadline,
                registration_link=registration_link,
                recruitment_cycle=recruitment_cycle,
                fingerprint=fingerprint
            )
            db.add(company)
            db.flush() # Populate company.id
            logger.info(f"Created new company registry: {company_name} - {role}")
        else:
            # Update and log modifications in company_change_logs
            updates = {
                "ctc": ctc,
                "stipend": stipend,
                "job_location": location,
                "registration_deadline": registration_deadline,
                "registration_link": registration_link,
                "eligibility_rules": eligibility_rules,
                "eligible_branches": eligible_branches
            }
            for key, val in updates.items():
                old_val = getattr(company, key)
                # Standardize comparison for dict / list
                if isinstance(old_val, (dict, list)) or isinstance(val, (dict, list)):
                    has_changed = json.dumps(old_val, sort_keys=True) != json.dumps(val, sort_keys=True)
                else:
                    has_changed = old_val != val
                    
                if val is not None and has_changed:
                    # Log change
                    db.add(CompanyChangeLog(
                        company_id=company.id,
                        field_name=key,
                        old_value=str(old_val) if old_val is not None else "",
                        new_value=str(val)
                    ))
                    setattr(company, key, val)
            logger.info(f"Updated existing company registry: {company_name} - {role}")
            
        # 5. Insert Company Event
        event_type = 'REGISTRATION'
        if 'shortlist' in subject.lower() or 'shortlist' in body.lower():
            event_type = 'SHORTLIST'
        elif 'online test' in subject.lower() or 'assessment' in subject.lower() or ' oa ' in (' ' + subject.lower() + ' '):
            event_type = 'OA'
        elif 'interview' in subject.lower() or 'schedule' in subject.lower():
            event_type = 'INTERVIEW'
        elif 'offer' in subject.lower() or 'congratulations' in subject.lower():
            event_type = 'OFFER'
            
        event = CompanyEvent(
            company_id=company.id,
            event_type=event_type,
            subject=subject,
            sender=sender,
            body=body,
            timestamp=email_timestamp
        )
        db.add(event)
        db.flush() # Populate event.id
        
        # Queue notification job for this event
        notification_job = NotificationJob(
            company_event_id=event.id,
            status='pending'
        )
        db.add(notification_job)
        
        # 6. Parse and store attachments
        for att in attachments:
            filename = att.get("filename", "")
            content_type = att.get("content_type", "")
            base64_data = att.get("base64_data", "")
            if not base64_data:
                continue
                
            file_bytes = base64.b64decode(base64_data)
            
            # Record attachment metadata (Storage path is simulated for zero-cost local / supabase storage)
            att_meta = AttachmentMetadata(
                company_event_id=event.id,
                file_name=filename,
                file_type="JD_PDF" if filename.lower().endswith(".pdf") else "SHORTLIST_EXCEL",
                storage_path=f"attachments/{event.id}/{filename}",
                parsed_meta={}
            )
            db.add(att_meta)
            
            # Process JD PDF
            if filename.lower().endswith(".pdf"):
                jd_info = parse_job_description(file_bytes)
                jd_text = jd_info.get("jd_text", "")
                required_skills = jd_info.get("skills", [])
                
                company.jd_text = jd_text
                company.jd_required_skills = required_skills
                company.jd_ats_keywords = jd_info.get("ats_keywords", [])
                
                # Precompute JD Intelligence (preferred skills & topics)
                jd_intel = precompute_jd_intelligence_deterministic(jd_text, required_skills)
                company.jd_preferred_skills = jd_intel.get("preferred_skills", [])
                company.interview_topics = jd_intel.get("interview_topics", [])
                
                att_meta.parsed_meta = {
                    "skills": required_skills,
                    "preferred_skills": company.jd_preferred_skills,
                    "interview_topics": company.interview_topics,
                    "ats_keywords_count": len(company.jd_ats_keywords)
                }
                logger.info(f"Processed JD PDF attachment: {filename} with precomputed JD intelligence.")
                
            # Process Shortlist Excel
            elif filename.lower().endswith((".xls", ".xlsx")):
                neo_ids = extract_neo_ids_from_excel(file_bytes)
                att_meta.parsed_meta = {"extracted_count": len(neo_ids)}
                
                # Check for zero-knowledge matches in student profiles
                matched_count = 0
                for nid in neo_ids:
                    # Calculate blind index hash
                    nid_hash = generate_blind_index(nid, settings.PEPPER)
                    
                    profile = db.query(StudentProfile).filter(StudentProfile.neo_id_hash == nid_hash).first()
                    if profile:
                        # Create or update application for student
                        app = db.query(Application).filter(
                            Application.user_id == profile.user_id,
                            Application.company_id == company.id
                        ).first()
                        
                        if not app:
                            app = Application(
                                user_id=profile.user_id,
                                company_id=company.id,
                                status='Shortlisted',
                                current_round='Shortlist Announcement'
                            )
                            db.add(app)
                        else:
                            # If they are already offers or rejected, don't overwrite status
                            if app.status not in ('Offer', 'Rejected', 'Declined', 'Ignored'):
                                app.status = 'Shortlisted'
                                app.current_round = 'Shortlisted'
                                
                        # Insert Direct Notification
                        notif_msg = f"🎉 Congratulations! You are shortlisted in the {company_name} drive for the {role} role."
                        # Unique constraint prevents duplicate notifications
                        existing_notif = db.query(Notification).filter(
                            Notification.user_id == profile.user_id,
                            Notification.company_event_id == event.id
                        ).first()
                        if not existing_notif:
                            db.add(Notification(
                                user_id=profile.user_id,
                                company_event_id=event.id,
                                message=notif_msg,
                                notification_type='shortlist'
                            ))
                        matched_count += 1
                logger.info(f"Processed Shortlist Excel attachment: {filename}. Matched {matched_count} system students.")
                
        # 7. Complete job successfully
        job.status = 'completed'
        job.processed_at = datetime.utcnow()
        db.commit()
        logger.info(f"Job {job.id} processed successfully.")
        
        # 8. Refresh views
        refresh_materialized_views(db)
        
        # Process notification jobs queue immediately
        process_notification_jobs(db)
        
        return True
        
    except Exception as e:
        db.rollback()
        logger.error(f"Error processing job {job.id}: {str(e)}", exc_info=True)
        
        # Re-fetch job in a clean transaction to update retry / failed state
        try:
            db.begin_nested() # use nested transaction to bypass rollback state
            db.add(job)
            job.retry_count += 1
            if job.retry_count >= 5:
                job.status = 'dead_letter'
            else:
                job.status = 'failed'
            job.error_message = str(e)
            db.commit()
        except Exception as err:
            logger.error(f"Failed to record job failure: {str(err)}")
            db.rollback()
            
        return False

def process_notification_jobs(db: Session):
    """
    Processes pending jobs in `notification_jobs` queue.
    For each job, it matches students eligible for notifications (e.g. registered or matched candidates)
    and sends appropriate alerts.
    """
    pending_jobs = db.query(NotificationJob).filter(NotificationJob.status == 'pending').all()
    for job in pending_jobs:
        job.status = 'processing'
        db.commit()
        
        try:
            event = job.company_event
            company = event.company
            
            # Simple notification broadcast logic:
            # Find all students eligible for this company based on their profile branch/CGPA
            # AND who haven't explicitly set their application to Declined or Rejected
            profiles = db.query(StudentProfile).all()
            
            for profile in profiles:
                # Check branch eligibility
                if company.eligible_branches:
                    user_branch = (profile.branch or "").strip().upper()
                    eligible_branches_upper = [b.strip().upper() for b in company.eligible_branches]
                    if user_branch not in eligible_branches_upper:
                        continue
                        
                # Check application state to see if notifications are silenced
                app = db.query(Application).filter(
                    Application.user_id == profile.user_id,
                    Application.company_id == company.id
                ).first()
                
                if app and app.status in ('Rejected', 'Declined', 'Ignored'):
                    # Silenced state
                    continue
                    
                # Create the notification message
                if event.event_type == 'REGISTRATION':
                    msg = f"📢 New drive registered: {company.name} is hiring for {company.role} ({company.category}). Deadline: {company.registration_deadline.strftime('%b %d, %I:%M %p') if company.registration_deadline else 'N/A'}."
                    notif_type = 'company_update'
                elif event.event_type == 'SHORTLIST':
                    # Shortlisted students are already notified individually during shortlist extraction,
                    # but we can notify others they were NOT selected (or keep it silent). Let's keep it silent.
                    continue
                else:
                    msg = f"📅 Update from {company.name}: {event.subject}."
                    notif_type = 'company_update'
                    
                # Unique constraint UNIQUE(user_id, company_event_id) prevents duplication
                existing = db.query(Notification).filter(
                    Notification.user_id == profile.user_id,
                    Notification.company_event_id == event.id
                ).first()
                
                if not existing:
                    db.add(Notification(
                        user_id=profile.user_id,
                        company_event_id=event.id,
                        message=msg,
                        notification_type=notif_type
                    ))
                    
            job.status = 'completed'
            job.processed_at = datetime.utcnow()
            db.commit()
            
        except Exception as e:
            db.rollback()
            job.status = 'failed'
            logger.error(f"Failed to process notification job {job.id}: {str(e)}")
            db.commit()
