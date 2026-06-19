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
    Application, Notification, RawIngestionJob, AttachmentMetadata, NotificationJob,
    IngestionAuditLog
)
from app.services.email_parser import parse_placement_email
from app.services.excel_parser import extract_neo_ids_from_excel
from app.services.pdf_extractor import parse_job_description
from app.services.ai_service import precompute_jd_intelligence_deterministic
from app.services.validator import validate_and_normalize_parsed_data, normalize_role_name

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
        if isinstance(job_id, str):
            try:
                job_id = UUID(job_id)
            except ValueError:
                pass
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
        
        # 3. Pre-extract attachment text to provide full context to LLM
        attachment_texts = []
        for att in attachments:
            filename = att.get("filename", "")
            base64_data = att.get("base64_data", "")
            if not base64_data:
                continue
            file_bytes = base64.b64decode(base64_data)

            # PDF: full text extraction
            if filename.lower().endswith(".pdf"):
                try:
                    from app.services.pdf_extractor import extract_text_from_pdf
                    txt = extract_text_from_pdf(file_bytes)
                    if txt:
                        attachment_texts.append(f"--- ATTACHMENT (PDF): {filename} ---\n{txt[:3000]}")
                except Exception as e:
                    logger.warning(f"Failed to extract PDF text from {filename}: {str(e)}")

            # Excel: extract first 20 rows as plain text context for LLM
            elif filename.lower().endswith((".xls", ".xlsx")):
                try:
                    import io
                    import pandas as pd
                    df = pd.read_excel(io.BytesIO(file_bytes), engine="openpyxl", nrows=20)
                    excel_preview = f"--- ATTACHMENT (EXCEL PREVIEW): {filename} ---\n"
                    excel_preview += f"Columns: {list(df.columns)}\n"
                    excel_preview += df.to_string(index=False, max_rows=20)
                    attachment_texts.append(excel_preview[:1500])
                except Exception as e:
                    logger.warning(f"Failed to extract Excel preview from {filename}: {str(e)}")

        attachment_text = "\n\n".join(attachment_texts)

        # 4. Parse Email Body with Escalating LLM chain
        raw_parsed_info = parse_placement_email(body, subject, attachment_text)
        
        # Save raw parsed response into DB
        job.parsed_output = raw_parsed_info
        db.commit()
        
        # 5. Run Validation & Normalization
        validated_info = validate_and_normalize_parsed_data(raw_parsed_info, db)
        
        # Save validated response into DB
        job.validated_output = validated_info
        db.commit()
        
        # Extract fields from validated output
        ext_data = validated_info.get("extracted_data", {})
        company_name = ext_data.get("company", {}).get("value", "Unknown Company").strip()
        event_type = ext_data.get("event_type", {}).get("value", "GENERAL_UPDATE").strip()
        location = ext_data.get("job_location", {}).get("value")
        registration_deadline_str = ext_data.get("deadline_iso", {}).get("value")
        registration_deadline = datetime.fromisoformat(registration_deadline_str) if registration_deadline_str else None
        registration_link = ext_data.get("registration_link", {}).get("value")
        requires_review = validated_info.get("parser_metadata", {}).get("requires_review", False)
        
        # Determine Batch Year from email subject or body, default to current/next year
        batch_year = datetime.utcnow().year
        year_match = re.search(r"\b(202\d)\b", subject + " " + body)
        if year_match:
            batch_year = int(year_match.group(1))
            
        recruitment_cycle = "Default"
        cycle_match = re.search(r"\b(Internship|Full-Time|Placement|Summer Intern)\b", subject + " " + body, re.I)
        if cycle_match:
            recruitment_cycle = cycle_match.group(1)

        # Multi-Role Splitting: Process each role in validated_info["extracted_data"]["roles"]
        roles_list = ext_data.get("roles", [])
        
        processed_events = []
        for r_item in roles_list:
            role = r_item.get("role", {}).get("value", "Software Engineer").strip()
            ctc = r_item.get("ctc", {}).get("value")
            stipend = r_item.get("stipend", {}).get("value")
            eligible_branches = r_item.get("eligible_branches", {}).get("value", [])
            min_cgpa = r_item.get("min_cgpa", {}).get("value")
            requires_no_arrears = r_item.get("requires_no_arrears", {}).get("value", False)
            
            # Determine category from text — check internship FIRST to avoid misclassification
            cat_match = re.search(
                r"(Dream\s*Internship|Regular\s*Internship|Summer\s*Intern(?:ship)?|Super\s*Dream|Mass\s*Recruiter|Dream\s*Offer|Dream|Regular)",
                subject + " " + body,
                re.I
            )
            category = "Regular"
            if cat_match:
                cat = cat_match.group(1).lower()
                if "super" in cat:
                    category = "Super Dream"
                elif "mass" in cat:
                    category = "Mass Recruiter"
                elif "internship" in cat or "intern" in cat:
                    category = "Internship"
                elif "dream" in cat:
                    category = "Dream"
                else:
                    category = "Regular"
                    
            fingerprint_input = f"{company_name.upper()}|{role.upper()}|{category.upper()}|{batch_year}|{recruitment_cycle.upper()}"
            fingerprint = hashlib.sha256(fingerprint_input.encode("utf-8")).hexdigest()
            
            # Check if company exists
            company = db.query(Company).filter(Company.fingerprint == fingerprint).first()
            
            # Fuzzy match candidates
            if not company:
                candidate_companies = db.query(Company).all()
                best_match = None
                best_score = -1
                for c in candidate_companies:
                    role_score = 0
                    if normalize_role_name(c.role) == normalize_role_name(role):
                        role_score = 20
                    elif len(c.role) >= 3 and (c.role.lower() in role.lower() or role.lower() in c.role.lower()):
                        role_score = 10
                        
                    db_name_clean = re.sub(r'\b(solutions|technologies|pvt|ltd|inc|co|india|corporation|group)\b', '', c.name, flags=re.I).strip().lower()
                    ext_name_clean = re.sub(r'\b(solutions|technologies|pvt|ltd|inc|co|india|corporation|group)\b', '', company_name, flags=re.I).strip().lower()
                    
                    db_name_clean = re.sub(r'\s+', ' ', db_name_clean)
                    ext_name_clean = re.sub(r'\s+', ' ', ext_name_clean)
                    
                    score = role_score
                    name_matched = False
                    if db_name_clean == ext_name_clean:
                        score += 60
                        name_matched = True
                    elif (len(db_name_clean) >= 3 and db_name_clean in ext_name_clean) or (len(ext_name_clean) >= 3 and ext_name_clean in db_name_clean):
                        overlap_ratio = len(db_name_clean) / len(ext_name_clean) if len(ext_name_clean) > 0 else 0
                        if overlap_ratio > 1:
                            overlap_ratio = 1 / overlap_ratio
                        score += int(30 * overlap_ratio) + 20
                        name_matched = True
                    elif len(db_name_clean) >= 3 and db_name_clean in subject.lower():
                        score += 40
                        name_matched = True
                        
                    if not name_matched:
                        continue
                    
                    if c.recruitment_cycle.lower() == recruitment_cycle.lower():
                        score += 20
                    elif recruitment_cycle.lower() == "default" or c.recruitment_cycle.lower() == "default":
                        score += 10
                        
                    c_batch = c.created_at.year if c.created_at else datetime.utcnow().year
                    if abs(c_batch - batch_year) <= 1:
                        score += 20
                        
                    if score > best_score:
                        best_score = score
                        best_match = c
                        
                if best_score >= 50:
                    company = best_match
                    logger.info(f"Fuzzy matched incoming email to existing company: {company.name} (ID: {company.id}, Match Score: {best_score})")

            eligibility_rules = {
                "min_cgpa": min_cgpa,
                "min_tenth_marks": None,
                "min_twelfth_marks": None,
                "requires_no_arrears": requires_no_arrears,
                "date_of_visit": ext_data.get("date_of_visit", {}).get("value") or "Will be announced later"
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
                    fingerprint=fingerprint,
                    requires_review=requires_review
                )
                db.add(company)
                db.flush()
                logger.info(f"Created new company registry: {company_name} - {role}")
            else:
                updates = {
                    "ctc": ctc,
                    "stipend": stipend,
                    "job_location": location,
                    "registration_deadline": registration_deadline,
                    "registration_link": registration_link,
                    "eligibility_rules": eligibility_rules,
                    "eligible_branches": eligible_branches,
                    "requires_review": requires_review
                }
                for key, val in updates.items():
                    old_val = getattr(company, key)
                    if isinstance(old_val, (dict, list)) or isinstance(val, (dict, list)):
                        has_changed = json.dumps(old_val, sort_keys=True) != json.dumps(val, sort_keys=True)
                    else:
                        has_changed = old_val != val
                        
                    if val is not None and has_changed:
                        db.add(CompanyChangeLog(
                            company_id=company.id,
                            field_name=key,
                            old_value=str(old_val) if old_val is not None else "",
                            new_value=str(val)
                        ))
                        setattr(company, key, val)
                logger.info(f"Updated existing company registry: {company_name} - {role}")

            # Create Company Event for this role/workspace
            event = db.query(CompanyEvent).filter(
                CompanyEvent.company_id == company.id,
                CompanyEvent.event_type == event_type,
                CompanyEvent.subject == subject,
                CompanyEvent.timestamp == email_timestamp
            ).first()

            if not event:
                event = CompanyEvent(
                    company_id=company.id,
                    event_type=event_type,
                    subject=subject,
                    sender=sender,
                    body=body,
                    timestamp=email_timestamp
                )
                db.add(event)
                db.flush()
                
                notification_job = NotificationJob(
                    company_event_id=event.id,
                    status='pending'
                )
                db.add(notification_job)
            else:
                logger.info(f"Re-using existing company event {event.id} ingested by Edge Function.")
                
            processed_events.append(event)
            update_recruitment_states(db, company, event_type, email_timestamp, body)

            # Log audit items in ingestion_audit_logs for low-confidence fields
            if requires_review:
                for field_name, f_data in ext_data.items():
                    if field_name == "roles":
                        continue
                    if isinstance(f_data, dict) and "confidence" in f_data:
                        conf = f_data["confidence"]
                        val = f_data.get("value")
                        if conf < 0.80 and val is not None:
                            exist_log = db.query(IngestionAuditLog).filter(
                                IngestionAuditLog.company_event_id == event.id,
                                IngestionAuditLog.field_name == field_name
                            ).first()
                            if not exist_log:
                                db.add(IngestionAuditLog(
                                    company_event_id=event.id,
                                    field_name=field_name,
                                    original_text=str(val),
                                    parsed_value=str(val),
                                    confidence_score=conf * 100,
                                    status='pending'
                                ))

        # 6. Parse and store attachments for each processed event
        for event in processed_events:
            company = event.company
            
            for att in attachments:
                filename = att.get("filename", "")
                base64_data = att.get("base64_data", "")
                if not base64_data:
                    continue
                    
                file_bytes = base64.b64decode(base64_data)
                
                att_meta = db.query(AttachmentMetadata).filter(
                    AttachmentMetadata.company_event_id == event.id,
                    AttachmentMetadata.file_name == filename
                ).first()

                if not att_meta:
                    att_meta = AttachmentMetadata(
                        company_event_id=event.id,
                        file_name=filename,
                        file_type="JD_PDF" if filename.lower().endswith(".pdf") else "SHORTLIST_EXCEL",
                        storage_path=f"attachments/{event.id}/{filename}",
                        parsed_meta={}
                    )
                    db.add(att_meta)
                    db.flush()
                else:
                    logger.info(f"Re-using existing attachment metadata for {filename}.")
                
                # Process JD PDF
                if filename.lower().endswith(".pdf"):
                    try:
                        jd_info = parse_job_description(file_bytes)
                        jd_text = jd_info.get("jd_text", "")
                        required_skills = jd_info.get("skills", [])
                        
                        company.jd_text = jd_text
                        company.jd_required_skills = required_skills
                        company.jd_ats_keywords = jd_info.get("ats_keywords", [])
                        
                        jd_intel = precompute_jd_intelligence_deterministic(jd_text, required_skills)
                        company.jd_preferred_skills = jd_intel.get("preferred_skills", [])
                        company.interview_topics = jd_intel.get("interview_topics", [])
                        
                        att_meta.parsed_meta = {
                            "skills": required_skills,
                            "preferred_skills": company.jd_preferred_skills,
                            "interview_topics": company.interview_topics,
                            "ats_keywords_count": len(company.jd_ats_keywords)
                        }
                        logger.info(f"Processed JD PDF attachment: {filename} for event {event.id}.")
                    except Exception as e:
                        logger.error(f"Failed to process PDF {filename}: {str(e)}")
                    
                # Process Shortlist Excel
                elif filename.lower().endswith((".xls", ".xlsx")):
                    try:
                        neo_ids = extract_neo_ids_from_excel(file_bytes)
                        att_meta.parsed_meta = {"extracted_count": len(neo_ids)}
                        
                        matched_count = 0
                        matched_user_ids = set()
                        shortlist_hashes = set()
                        
                        for nid in neo_ids:
                            nid_hash = generate_blind_index(nid, settings.PEPPER)
                            shortlist_hashes.add(nid_hash)
                            
                            profile = db.query(StudentProfile).filter(StudentProfile.neo_id_hash == nid_hash).first()
                            if profile:
                                matched_user_ids.add(profile.user_id)
                                app = db.query(Application).filter(
                                    Application.user_id == profile.user_id,
                                    Application.company_id == company.id
                                ).first()
                                
                                if not app:
                                    app = Application(
                                        user_id=profile.user_id,
                                        company_id=company.id,
                                        status='Shortlisted',
                                        recruitment_state='Shortlisted',
                                        current_round='Shortlist Announcement'
                                    )
                                    db.add(app)
                                else:
                                    if app.status not in ('Offer', 'Rejected', 'Declined', 'Ignored'):
                                        app.status = 'Shortlisted'
                                        app.recruitment_state = 'Shortlisted'
                                        app.current_round = 'Shortlisted'
                                        
                                notif_msg = f"🎉 Congratulations! You are shortlisted in the {company.name} drive for the {company.role} role."
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
                                
                        active_apps = db.query(Application).filter(
                            Application.company_id == company.id,
                            Application.status.in_(('Applied', 'Shortlisted', 'OA', 'Interview'))
                        ).all()
                        
                        for app in active_apps:
                            if app.user_id not in matched_user_ids:
                                profile = db.query(StudentProfile).filter(StudentProfile.user_id == app.user_id).first()
                                if profile and profile.neo_id_hash not in shortlist_hashes:
                                    app.status = 'Likely Rejected'
                                    logger.info(f"Student {app.user_id} marked as Likely Rejected for company {company.name}")
                        logger.info(f"Processed Shortlist Excel attachment: {filename}. Matched {matched_count} system students.")
                    except Exception as e:
                        logger.error(f"Failed to process Shortlist Excel {filename}: {str(e)}")
                
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
                    
                # Create the notification message based on event type
                if event.event_type == 'REGISTRATION':
                    deadline_str = company.registration_deadline.strftime('%b %d, %I:%M %p') if company.registration_deadline else 'N/A'
                    msg = f"📢 New drive: {company.name} is hiring for {company.role} ({company.category}). Deadline: {deadline_str}."
                    notif_type = 'company_update'
                elif event.event_type == 'DEADLINE_EXTENSION':
                    deadline_str = company.registration_deadline.strftime('%b %d, %I:%M %p') if company.registration_deadline else 'N/A'
                    msg = f"⏰ Deadline extended! {company.name} ({company.role}) new deadline: {deadline_str}."
                    notif_type = 'deadline'
                elif event.event_type == 'SHORTLIST':
                    # Shortlisted students notified individually. Skip broadcast.
                    continue
                elif event.event_type == 'OA':
                    msg = f"📝 Online Assessment scheduled for {company.name} ({company.role}). Check email for details."
                    notif_type = 'company_update'
                elif event.event_type == 'OA_RESULT':
                    msg = f"📊 OA results announced for {company.name} ({company.role}). Check your application status."
                    notif_type = 'company_update'
                elif event.event_type == 'INTERVIEW':
                    msg = f"🎤 Interview scheduled for {company.name} ({company.role}). Check email for slot details."
                    notif_type = 'company_update'
                elif event.event_type == 'INTERVIEW_RESULT':
                    msg = f"📋 Interview results announced for {company.name} ({company.role}). Check your application status."
                    notif_type = 'company_update'
                elif event.event_type == 'OFFER':
                    msg = f"🎉 Offers released by {company.name} for {company.role}! Check your application status."
                    notif_type = 'offer'
                elif event.event_type == 'REJECTION':
                    # Rejection notifications — can be noisy, send as system update
                    msg = f"📬 Update from {company.name} ({company.role}): {event.subject}."
                    notif_type = 'company_update'
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

def update_recruitment_states(db: Session, company: Company, event_type: str, event_timestamp: datetime, email_body: str):
    """
    Updates recruitment_state for all student applications linked to the company
    based on the canonical event type of the incoming event.
    """
    apps = db.query(Application).filter(Application.company_id == company.id).all()

    for app in apps:
        old_state = app.recruitment_state

        if event_type == 'REGISTRATION':
            if app.recruitment_state is None or app.recruitment_state == 'Registration':
                app.recruitment_state = 'Registration'

        elif event_type == 'DEADLINE_EXTENSION':
            # Deadline extended — no state change, but update the company deadline
            # (company.registration_deadline already updated by caller)
            pass

        elif event_type == 'OA':
            is_past = event_timestamp < datetime.utcnow()
            if is_past or any(k in email_body.lower() for k in ["completed", "results", "conducted", "held"]):
                app.recruitment_state = 'Awaiting OA Result'
            else:
                if app.recruitment_state in (None, 'Registration', 'Shortlisted', 'Awaiting Shortlist'):
                    app.recruitment_state = 'OA'
                    if app.status in ('Applied', 'Shortlisted'):
                        app.status = 'OA'

        elif event_type == 'OA_RESULT':
            # OA results announced — move waiting students forward
            if app.recruitment_state in ('OA', 'Awaiting OA Result'):
                app.recruitment_state = 'Awaiting OA Result'

        elif event_type == 'INTERVIEW':
            is_past = event_timestamp < datetime.utcnow()
            if is_past or any(k in email_body.lower() for k in ["completed", "results", "conducted", "held", "feedback"]):
                app.recruitment_state = 'Awaiting Interview Result'
            else:
                if app.recruitment_state in (None, 'Registration', 'Shortlisted', 'OA', 'Awaiting OA Result'):
                    app.recruitment_state = 'Interview'
                    if app.status in ('Applied', 'Shortlisted', 'OA'):
                        app.status = 'Interview'

        elif event_type == 'INTERVIEW_RESULT':
            # Interview results announced — move waiting students to 'Awaiting Result'
            if app.recruitment_state in ('Interview', 'Awaiting Interview Result'):
                app.recruitment_state = 'Awaiting Interview Result'

        elif event_type == 'OFFER':
            if app.recruitment_state in (None, 'Registration', 'Shortlisted', 'OA', 'Interview', 'Awaiting Interview Result'):
                app.recruitment_state = 'Offer'
                if app.status not in ('Rejected', 'Declined', 'Ignored'):
                    app.status = 'Offer'

        elif event_type == 'REJECTION':
            app.recruitment_state = 'Rejected'
            app.status = 'Rejected'

        elif event_type == 'SHORTLIST':
            if app.recruitment_state in (None, 'Registration', 'Awaiting Shortlist'):
                app.recruitment_state = 'Shortlisted'
                if app.status == 'Applied':
                    app.status = 'Shortlisted'

        # Update last activity timestamp if state changed
        if app.recruitment_state != old_state:
            app.last_user_activity_at = datetime.utcnow()
            logger.info(f"Updated Application {app.id} recruitment_state: {old_state} -> {app.recruitment_state}")

    db.commit()

