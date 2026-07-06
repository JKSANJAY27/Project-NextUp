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
    User, StudentProfile, Company, CompanyEvent, CompanyChangeLog, Announcement,
    Application, Notification, RawIngestionJob, AttachmentMetadata, NotificationJob,
    IngestionAuditLog, OpportunityState, PendingCompanyEvent, IngestionExecutionLog
)
from app.services.email_parser import parse_placement_email, build_regex_fallback_response
from app.services.excel_parser import extract_neo_ids_from_excel
from app.services.pdf_extractor import parse_job_description
from app.services.ai_service import precompute_jd_intelligence_deterministic
from app.services.validator import validate_and_normalize_parsed_data, normalize_role_name
from app.services.eligibility import check_eligibility
from app.core.redis import bump_companies_list_version, bump_announcements_version, bump_user_version

logger = logging.getLogger(__name__)

def log_execution_stage(db: Session, job_id: UUID, stage: str, status: str, message: Optional[str] = None):
    import uuid
    try:
        log = IngestionExecutionLog(
            id=uuid.uuid4(),
            job_id=job_id,
            stage=stage,
            status=status,
            message=message,
            timestamp=datetime.utcnow()
        )
        db.add(log)
        db.commit()
    except Exception as e:
        logger.error(f"Failed to log execution stage {stage} for job {job_id}: {str(e)}")
        db.rollback()

def clean_company_name_key(name: str) -> str:
    if not name:
        return ""
    # Strip leading asterisks, hashes, hyphens, and other special characters
    name_stripped = re.sub(r'^[*#_\s\-–—]+', '', name).strip()
    cleaned = re.sub(
        r'\b(solutions|technologies|pvt|ltd|inc|co|india|corporation|group)\b',
        '',
        name_stripped,
        flags=re.I
    ).strip().lower()
    return re.sub(r'\s+', ' ', cleaned)

def is_company_name_match(name1: str, name2: str) -> bool:
    if not name1 or not name2:
        return False
    k1 = clean_company_name_key(name1)
    k2 = clean_company_name_key(name2)
    if not k1 or not k2:
        return False
    
    if k1 == k2:
        return True
        
    if (len(k1) >= 3 and k1 in k2) or (len(k2) >= 3 and k2 in k1):
        overlap_ratio = len(k1) / len(k2) if len(k2) > 0 else 0
        if overlap_ratio > 1:
            overlap_ratio = 1 / overlap_ratio
        score = int(70 * overlap_ratio) + 20
        if score >= 60:
            return True
            
    return False

# Global scheduler
scheduler = BackgroundScheduler()

def start_scheduler():
    if not scheduler.running:
        # coalesce + misfire_grace_time: if a tick is delayed because a long
        # LLM parse is still running (max_instances=1), run ONE catch-up tick
        # instead of silently skipping — a skipped tick was how the queue
        # froze for days with 18 pending emails.
        scheduler.add_job(
            process_queued_jobs_cron, "interval", minutes=5,
            id="queue_processor_job", replace_existing=True,
            coalesce=True, misfire_grace_time=600, max_instances=1,
        )
        scheduler.add_job(refresh_views_cron, "interval", minutes=30, id="view_refresher_job", replace_existing=True, coalesce=True, misfire_grace_time=600)
        scheduler.add_job(opportunity_lifecycle_cron, "interval", hours=6, id="opportunity_lifecycle_job", replace_existing=True, coalesce=True, misfire_grace_time=3600)
        scheduler.start()
        logger.info("Background queue processor, view refresher, and opportunity lifecycle scheduler started.")
        # Run opportunity lifecycle check once on startup immediately
        try:
            logger.info("Running initial opportunity lifecycle update on startup...")
            opportunity_lifecycle_cron()
        except Exception as e:
            logger.error(f"Failed to run initial opportunity lifecycle update: {e}", exc_info=True)

def shutdown_scheduler():
    if scheduler.running:
        scheduler.shutdown()
        logger.info("Background scheduler stopped.")

def opportunity_lifecycle_cron():
    """Scheduled job: run opportunity lifecycle transitions for all users every 6 hours."""
    from app.services.opportunity_lifecycle import run_lifecycle_for_all_users
    db = SessionLocal()
    try:
        run_lifecycle_for_all_users(db)
    except Exception as e:
        logger.error(f"Opportunity lifecycle cron failed: {e}", exc_info=True)
    finally:
        db.close()

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

    # Auto-retry failed parses. Previously 'failed' jobs were stranded forever
    # (the queue only selects 'pending'), so a transient AI outage — e.g. the
    # HF router returning 402 — permanently dropped those emails (Groww,
    # Valuelabs, ...). Re-queue them with a time backoff; after
    # PARSER_MAX_AI_RETRIES attempts the processor falls back to regex, and
    # after 5 attempts jobs still go to dead_letter.
    try:
        backoff_minutes = settings.PARSER_FAILED_RETRY_MINUTES
        if is_sqlite:
            result = db.execute(text(f"""
                UPDATE raw_ingestion_jobs
                SET status = 'pending'
                WHERE status = 'failed'
                  AND retry_count < 5
                  AND (locked_at IS NULL OR locked_at < datetime('now', '-{backoff_minutes} minutes'))
            """))
        else:
            result = db.execute(text(f"""
                UPDATE raw_ingestion_jobs
                SET status = 'pending'
                WHERE status = 'failed'
                  AND retry_count < 5
                  AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '{backoff_minutes} minutes')
            """))
        db.commit()
        if result.rowcount > 0:
            logger.info(f"Re-queued {result.rowcount} failed raw_ingestion_jobs for retry.")
    except Exception as e:
        db.rollback()
        logger.error(f"Error re-queueing failed jobs: {str(e)}")

def refresh_materialized_views(db: Session):
    """
    Refreshes performance materialized views concurrently.
    """
    if os.getenv("SKIP_VIEW_REFRESH", "").lower() == "true":
        logger.info("Skipping materialized view refresh via SKIP_VIEW_REFRESH env var.")
        return
        
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

def clean_job_payload(job: RawIngestionJob):
    """
    Cleans up base64 data from the job's payload attachments to reduce database size and egress.
    """
    if not job or not job.payload:
        return
    try:
        payload = job.payload
        if isinstance(payload, dict) and "attachments" in payload:
            attachments = payload.get("attachments", [])
            modified = False
            for att in attachments:
                if att.get("base64_data"):
                    att["base64_data"] = ""
                    modified = True
            if modified:
                job.payload = payload
                from sqlalchemy.orm.attributes import flag_modified
                flag_modified(job, "payload")
                logger.info(f"Cleaned large base64 attachments from job {job.id} payload.")
    except Exception as e:
        logger.warning(f"Failed to clean job payload for {job.id}: {e}")

def extract_neo_ids_from_text(text_val: str) -> list:
    """Extract Neo-ID-shaped tokens from free text (shortlists pasted into the
    email body instead of an Excel attachment)."""
    if not text_val:
        return []
    core = settings.NEO_ID_REGEX.strip("^$")
    matches = re.findall(rf"(?<![A-Za-z0-9])({core})(?![A-Za-z0-9])", text_val)
    seen, out = set(), []
    for m in matches:
        nid = (m if isinstance(m, str) else m[0]).strip().upper()
        if nid and nid not in seen:
            seen.add(nid)
            out.append(nid)
    return out


# Human wording for shortlist notifications, by the round the email announces
_SHORTLIST_STAGE_WORDING = {
    "OA_RESULT": "cleared the online assessment",
    "INTERVIEW_RESULT": "cleared the interview round",
    "OFFER_RELEASED": "been placed on the final selection list",
    "OFFER": "been placed on the final selection list",
}


def apply_shortlist_matches(db: Session, company: Company, event: Optional[CompanyEvent],
                            neo_ids: list, source: str = "excel",
                            event_type_hint: str = "") -> int:
    """Core shortlist matching, shared by the Excel-attachment and email-body
    paths. Matches Neo IDs against registered students via blind-index hashes,
    advances their applications, and notifies BOTH outcomes:

      - matched  -> "you are shortlisted / cleared round X"
      - unmatched active applicants -> "not on the list; verify the original
        email and archive this workspace if you were not selected"

    Returns the number of matched system students.
    """
    if not neo_ids:
        return 0

    shortlist_hashes = set()
    for nid in neo_ids:
        shortlist_hashes.add(generate_blind_index(nid, settings.PEPPER))

    # Dedup notifications per event across all users (the unique constraint
    # (user_id, company_event_id) makes duplicates a commit-time error).
    notified_user_ids = set()
    if event:
        existing_notifs = db.query(Notification).filter(
            Notification.company_event_id == event.id
        ).all()
        notified_user_ids = {n.user_id for n in existing_notifs}

    # 1. Bulk query matched StudentProfiles
    profiles = db.query(StudentProfile).filter(
        StudentProfile.neo_id_hash.in_(list(shortlist_hashes))
    ).all()
    matched_user_ids = {p.user_id for p in profiles}

    matched_count = 0
    if profiles:
        existing_apps = db.query(Application).filter(
            Application.company_id == company.id,
            Application.user_id.in_(list(matched_user_ids))
        ).all()
        apps_by_user_id = {app.user_id: app for app in existing_apps}

        existing_opp_states = db.query(OpportunityState).filter(
            OpportunityState.company_id == company.id,
            OpportunityState.user_id.in_(list(matched_user_ids))
        ).all()
        opp_states_by_user_id = {os.user_id: os for os in existing_opp_states}

        stage_wording = _SHORTLIST_STAGE_WORDING.get(
            event_type_hint, "been shortlisted for the next round"
        )

        for profile in profiles:
            # Application status logic
            app = apps_by_user_id.get(profile.user_id)
            if not app:
                app = Application(
                    user_id=profile.user_id,
                    company_id=company.id,
                    status='Shortlisted',
                    recruitment_state='Shortlisted',
                    current_round='Shortlist Announcement',
                    user_decision='tracking',
                )
                db.add(app)
            else:
                if app.status not in ('Offer', 'Rejected', 'Declined', 'Ignored'):
                    app.status = 'Shortlisted'
                    app.recruitment_state = 'Shortlisted'
                    app.current_round = 'Shortlisted'
                    app.user_decision = 'tracking'

            # OpportunityState logic
            opp_state = opp_states_by_user_id.get(profile.user_id)
            if not opp_state:
                opp_state = OpportunityState(
                    user_id=profile.user_id,
                    company_id=company.id,
                    state='tracking',
                )
                db.add(opp_state)
            else:
                if opp_state.state not in ('tracking',):
                    opp_state.previous_state = opp_state.state
                opp_state.state = 'tracking'
                opp_state.archive_reason = None
                opp_state.archived_at = None
                opp_state.updated_at = datetime.utcnow()

            # Notification logic
            if event and profile.user_id not in notified_user_ids:
                notif_msg = (f"🎉 Congratulations! You have {stage_wording} in the "
                             f"{company.name} drive ({company.role}). Check the workspace "
                             f"for next-round details.")
                db.add(Notification(
                    user_id=profile.user_id,
                    company_event_id=event.id,
                    message=notif_msg,
                    notification_type='shortlist',
                    severity=4,
                ))
                notified_user_ids.add(profile.user_id)
            matched_count += 1

    # 2. Students actively tracking this drive who are NOT on the list:
    # mark Likely Rejected and ask them to verify + archive.
    active_apps = db.query(Application).filter(
        Application.company_id == company.id,
        Application.status.in_(('Applied', 'Shortlisted', 'OA', 'Interview'))
    ).all()

    unmatched_active_apps = [app for app in active_apps if app.user_id not in matched_user_ids]
    if unmatched_active_apps:
        unmatched_user_ids = {app.user_id for app in unmatched_active_apps}
        unmatched_profiles = db.query(StudentProfile).filter(
            StudentProfile.user_id.in_(list(unmatched_user_ids))
        ).all()
        unmatched_profiles_by_user_id = {p.user_id: p for p in unmatched_profiles}

        for app in unmatched_active_apps:
            profile = unmatched_profiles_by_user_id.get(app.user_id)
            if profile and profile.neo_id_hash not in shortlist_hashes:
                app.status = 'Likely Rejected'
                logger.info(f"Student {app.user_id} marked as Likely Rejected for company {company.name}")
                if event and app.user_id not in notified_user_ids:
                    db.add(Notification(
                        user_id=app.user_id,
                        company_event_id=event.id,
                        message=(f"⚠ Your Neo ID was not found on the {company.name} "
                                 f"({company.role}) shortlist. Please verify against the "
                                 f"original CDC email — if you were not selected, archive "
                                 f"this workspace from the tracker."),
                        notification_type='shortlist',
                        severity=3,
                    ))
                    notified_user_ids.add(app.user_id)

    logger.info(f"Shortlist ({source}): matched {matched_count} students, "
                f"{len(unmatched_active_apps)} active applicants not on the list "
                f"for {company.name}.")
    return matched_count


def process_shortlist_excel_batched(db: Session, company: Company, event: Optional[CompanyEvent], filename: str, file_bytes: bytes, att_meta: AttachmentMetadata):
    """Parse a CDC shortlist Excel attachment and apply matches in bulk."""
    try:
        neo_ids = extract_neo_ids_from_excel(file_bytes)
        att_meta.parsed_meta = {"extracted_count": len(neo_ids)}

        if not neo_ids:
            logger.info(f"No Neo IDs extracted from shortlist Excel: {filename}")
            return

        event_type_hint = event.event_type if event else ""
        apply_shortlist_matches(db, company, event, neo_ids,
                                source=f"excel:{filename}",
                                event_type_hint=event_type_hint)
    except Exception as e:
        logger.error(f"Failed to process Shortlist Excel {filename}: {str(e)}", exc_info=True)

def process_event_attachments(db: Session, event: CompanyEvent, attachments: list):
    """
    Parses and stores attachments for a processed company event.
    Handles PDF job descriptions and Excel shortlists (with student Neo ID matching).
    """
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
                parsed_meta={},
                file_data=file_bytes
            )
            db.add(att_meta)
            db.flush()
        else:
            logger.info(f"Re-using existing attachment metadata for {filename}.")
            att_meta.file_data = file_bytes
        
        # Write file to storage
        storage_dir = "storage"
        full_path = os.path.join(storage_dir, att_meta.storage_path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "wb") as f:
            f.write(file_bytes)
        logger.info(f"Wrote attachment file to disk: {full_path}")
        
        # Process JD PDF
        if filename.lower().endswith(".pdf"):
            try:
                jd_info = parse_job_description(file_bytes)
                jd_text = jd_info.get("jd_text", "")
                required_skills = jd_info.get("skills", [])

                # PDF JD is the richest source — but never clobber existing
                # JD text with an empty extraction (e.g. scanned-image PDFs).
                if jd_text:
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
            process_shortlist_excel_batched(db, company, event, filename, file_bytes, att_meta)

def extract_event_metadata(body: str, subject: str, event_type: str, ext_data: dict) -> dict:
    meta = {
        "deadline_iso": ext_data.get("deadline_iso", {}).get("value"),
        "registration_link": ext_data.get("registration_link", {}).get("value"),
        "job_location": ext_data.get("job_location", {}).get("value")
    }
    
    # 1. Detect OA platform
    if event_type == "OA":
        platforms = ["neopat", "cocubes", "hackerearth", "hackerrank", "mettl", "shl", "glider", "hirepro", "litcoder", "google form", "ms forms"]
        for p in platforms:
            if re.search(r'\b' + re.escape(p) + r'\b', body.lower()) or re.search(r'\b' + re.escape(p) + r'\b', subject.lower()):
                meta["oa_platform"] = p.upper()
                break
                
    # 2. Detect Interview details (meeting links, venue)
    if event_type == "INTERVIEW":
        if "zoom.us" in body.lower():
            meta["interview_platform"] = "ZOOM"
            zoom_match = re.search(r'((?:https?://)?[a-zA-Z0-9-.]*zoom\.us/[^\s\)\"\'>]+)', body)
            if zoom_match:
                link = zoom_match.group(1)
                if not link.startswith(("http://", "https://")):
                    link = "https://" + link
                meta["meeting_link"] = link
        elif "teams.microsoft.com" in body.lower():
            meta["interview_platform"] = "MS_TEAMS"
            teams_match = re.search(r'((?:https?://)?[a-zA-Z0-9-.]*teams\.microsoft\.com/[^\s\)\"\'>]+)', body)
            if teams_match:
                link = teams_match.group(1)
                if not link.startswith(("http://", "https://")):
                    link = "https://" + link
                meta["meeting_link"] = link
        elif "meet.google.com" in body.lower():
            meta["interview_platform"] = "GOOGLE_MEET"
            meet_match = re.search(r'((?:https?://)?meet\.google\.com/[a-zA-Z0-9-]+)', body)
            if meet_match:
                link = meet_match.group(1)
                if not link.startswith(("http://", "https://")):
                    link = "https://" + link
                meta["meeting_link"] = link
        else:
            meta["interview_platform"] = "PHYSICAL"
            venue_match = re.search(r'(?:venue|location|room|hall|lab)\s*[:\-–—\s]\s*([^\n\r.]+)', body, re.I)
            if venue_match:
                meta["venue"] = venue_match.group(1).strip()

    return meta

def reconcile_pending_events_for_company(db: Session, company: Company):
    """
    Finds and processes all pending company events that match the given newly created company.
    Converts PendingCompanyEvent directly to CompanyEvent, parses its attachments,
    updates applications states, and sends notifications.
    """
    pending_events = db.query(PendingCompanyEvent).filter(
        PendingCompanyEvent.status == "PENDING_PARENT"
    ).all()
    
    if not pending_events:
        return
        
    logger.info(f"Reconciling pending events for newly created company '{company.name}' (Role: '{company.role}').")
    
    reconciled_count = 0
    for pe in pending_events:
        if not is_company_name_match(pe.company_name, company.name):
            continue
            
        if pe.role_name and company.role:
            r1 = pe.role_name.lower()
            r2 = company.role.lower()
            if r1 not in r2 and r2 not in r1:
                tokens1 = set(re.findall(r'\w+', r1)) - {"intern", "internship", "engineer", "developer", "role", "job", "position", "analyst"}
                tokens2 = set(re.findall(r'\w+', r2)) - {"intern", "internship", "engineer", "developer", "role", "job", "position", "analyst"}
                if not tokens1.intersection(tokens2):
                    continue
                    
        job = db.query(RawIngestionJob).filter(RawIngestionJob.id == pe.raw_ingestion_job_id).first()
        if not job:
            pe.status = "FAILED"
            db.add(pe)
            continue
            
        payload = job.payload
        if not payload:
            pe.status = "FAILED"
            db.add(pe)
            continue
            
        subject = payload.get("subject", "")
        body = payload.get("body", "")
        sender = payload.get("sender", "Unknown")
        email_timestamp_str = payload.get("timestamp")
        attachments = payload.get("attachments", [])
        
        email_timestamp = datetime.fromisoformat(email_timestamp_str.replace("Z", "+00:00")) if email_timestamp_str else datetime.utcnow()
        
        event = db.query(CompanyEvent).filter(
            CompanyEvent.company_id == company.id,
            CompanyEvent.event_type == pe.event_type,
            CompanyEvent.subject == subject,
            CompanyEvent.timestamp == email_timestamp
        ).first()
        
        if not event:
            # Extract parsed metadata from the saved payload
            ext_d = {}
            if pe.parsed_payload and isinstance(pe.parsed_payload, dict):
                ext_d = pe.parsed_payload.get("extracted_data", {})
            parsed_meta = extract_event_metadata(body, subject, pe.event_type, ext_d)

            event = CompanyEvent(
                company_id=company.id,
                event_type=pe.event_type,
                subject=subject,
                sender=sender,
                body=body,
                timestamp=email_timestamp,
                parsed_metadata=parsed_meta
            )
            db.add(event)
            db.flush()
            
            notification_job = NotificationJob(
                company_event_id=event.id,
                status='pending'
            )
            db.add(notification_job)
            log_execution_stage(db, job.id, "EVENT_CREATED", "SUCCESS", f"Created reconciled event: {pe.event_type}")
            
        process_event_attachments(db, event, attachments)
        log_execution_stage(db, job.id, "ATTACHMENTS_PROCESSED", "SUCCESS")

        # Shortlist pasted in the body (no Excel): same handling as the main
        # path, applied when the parked update finally attaches to its drive.
        has_excel = any(str(a.get("filename", "")).lower().endswith((".xls", ".xlsx"))
                        for a in attachments)
        if (pe.event_type in ("SHORTLIST_RELEASED", "OA_RESULT", "INTERVIEW_RESULT",
                              "OFFER_RELEASED", "SHORTLIST", "OFFER")
                and not has_excel and body):
            try:
                body_neo_ids = extract_neo_ids_from_text(body)
                if body_neo_ids:
                    apply_shortlist_matches(db, company, event, body_neo_ids,
                                            source="email-body(reconciled)",
                                            event_type_hint=pe.event_type)
            except Exception as e:
                logger.error(f"Reconciliation body-shortlist failed: {e}", exc_info=True)

        # Generate JD Strategy if not already generated
        if not company.jd_text and body:
            company.jd_text = body
        if company.jd_text and (not company.jd_strategy or not isinstance(company.jd_strategy, dict) or not company.jd_strategy.get("required_skills")):
            try:
                logger.info(f"Reconciliation: Generating JD Strategy for company {company.name} (ID: {company.id})...")
                from app.services.ai_service import generate_jd_strategy
                strategy = generate_jd_strategy(
                    company.jd_text, role=company.role, company_name=company.name
                )
                if strategy and (strategy.get("required_skills") or strategy.get("role_summary")):
                    company.jd_strategy = strategy
                    logger.info(f"Reconciliation: Saved JD Strategy for company {company.name}.")
            except Exception as e:
                logger.error(f"Reconciliation: Failed to generate JD strategy for company {company.name} in job: {e}")
        
        update_recruitment_states(db, company, pe.event_type, email_timestamp, body)
        log_execution_stage(db, job.id, "APPLICATIONS_UPDATED", "SUCCESS")
        
        pe.status = "RECONCILED"
        pe.matched_company_id = company.id
        job.status = "completed"
        job.error_message = f"Reconciled directly with company: {company.name} - {company.role}"
        job.processed_at = datetime.utcnow()
        clean_job_payload(job)
        
        db.add(pe)
        db.add(job)
        reconciled_count += 1
        log_execution_stage(db, job.id, "COMPLETED", "SUCCESS", f"Reconciled with matched company: {company.name} (Role: {company.role})")
        logger.info(f"Successfully reconciled pending event {pe.id} to company {company.name}.")
        
    if reconciled_count > 0:
        db.commit()
        process_notification_jobs(db)

def process_queued_jobs_cron():
    """Cron tick: drain up to PARSER_JOBS_PER_TICK pending emails.

    One-per-tick meant a burst of N emails took N*5 minutes to ingest and the
    queue could never catch up after an outage. In-container parses take
    ~2-3 minutes each, so a small batch per tick keeps CPU pressure bounded
    while still draining backlogs.
    """
    db = SessionLocal()
    try:
        for _ in range(max(1, settings.PARSER_JOBS_PER_TICK)):
            if not process_queued_jobs(db):
                break  # queue empty
    finally:
        db.close()

def process_all_jobs_loop():
    """Loops and processes all pending raw ingestion jobs in the background."""
    logger.info("Starting background batch reprocessing loop...")
    db = SessionLocal()
    try:
        count = 0
        while True:
            success = process_queued_jobs(db)
            if not success:
                logger.info("Batch reprocessing complete. No more pending jobs.")
                break
            count += 1
            logger.info(f"Processed job {count} in background loop.")
    except Exception as e:
        logger.error(f"Error in background batch reprocessing: {str(e)}")
    finally:
        db.close()

def refresh_views_cron():
    """Wrapper function for periodic view refreshing (uses own session)."""
    db = SessionLocal()
    try:
        refresh_materialized_views(db)
    finally:
        db.close()

def is_placeholder_or_empty(val) -> bool:
    if val is None:
        return True
    if isinstance(val, bool):
        return False
    if isinstance(val, (int, float)):
        return False
    if isinstance(val, str):
        val_clean = val.strip().lower()
        if not val_clean or "announced later" in val_clean or val_clean == "refer jd" or val_clean == "none":
            return True
    if isinstance(val, (list, dict, set)) and not val:
        return True
    return False

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
    log_execution_stage(db, job.id, "INGESTED", "SUCCESS")
    
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
        
        # 3. Pre-extract attachment text to provide full context to LLM.
        # jd_pdf_full_text keeps the (much longer) untruncated JD text so it
        # can be stored on the company for JD-strategy generation and resume
        # tailoring — the parser prompt itself only gets a capped excerpt.
        attachment_texts = []
        jd_pdf_full_text = ""
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
                        attachment_texts.append(f"--- ATTACHMENT (PDF): {filename} ---\n{txt[:4000]}")
                        if len(txt) > len(jd_pdf_full_text):
                            jd_pdf_full_text = txt[:20000]
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
                    attachment_texts.append(excel_preview[:800])
                except Exception as e:
                    logger.warning(f"Failed to extract Excel preview from {filename}: {str(e)}")

        attachment_text = "\n\n".join(attachment_texts)

        # 4. Parse Email Body via the AI gateway. The LLM gets
        # PARSER_MAX_AI_RETRIES attempts (spread across cron cycles via the
        # failed-job re-queue); after that the regex fallback guarantees the
        # email is still ingested — an AI outage must never lose emails.
        from app.services.ai_provider import AIUnavailableError
        try:
            raw_parsed_info = parse_placement_email(body, subject, attachment_text, email_timestamp=email_timestamp)
        except AIUnavailableError as ai_err:
            if (job.retry_count or 0) < settings.PARSER_MAX_AI_RETRIES:
                raise  # marked failed; auto-retried on a later cron tick
            logger.warning(
                f"Job {job.id}: AI providers exhausted after {job.retry_count} retries "
                f"({str(ai_err)[:200]}). Falling back to regex parser."
            )
            from app.services.email_parser import ground_role_facts_in_source
            raw_parsed_info = ground_role_facts_in_source(
                build_regex_fallback_response(body, subject, email_timestamp=email_timestamp),
                body,
            )
        
        # Save raw parsed response into DB
        job.parsed_output = raw_parsed_info
        db.commit()
        log_execution_stage(db, job.id, "PARSED", "SUCCESS")
        
        # 5. Run Validation & Normalization
        validated_info = validate_and_normalize_parsed_data(raw_parsed_info, db, email_timestamp=email_timestamp)
        
        # Save validated response into DB
        job.validated_output = validated_info
        db.commit()
        log_execution_stage(db, job.id, "VALIDATED", "SUCCESS")
        
        # Extract fields from validated output
        ext_data = validated_info.get("extracted_data", {})
        email_category = ext_data.get("email_category", "UNKNOWN")
        
        if email_category == "GENERAL_ANNOUNCEMENT":
            import uuid
            job.final_classification = "GENERAL_ANNOUNCEMENT"
            
            ann_data = ext_data.get("announcement", {})
            title = ann_data.get("title", {}).get("value") or subject or "General Announcement"
            ann_type = ann_data.get("announcement_type", {}).get("value") or "GENERAL"
            deadline_str = ann_data.get("deadline_iso", {}).get("value")
            deadline = datetime.fromisoformat(deadline_str) if deadline_str else None
            
            # Check if this announcement already exists by checking source_email_id
            announcement = db.query(Announcement).filter(
                Announcement.source_email_id == str(job.id)
            ).first()
            
            if not announcement:
                announcement = Announcement(
                    id=uuid.uuid4(),
                    title=title,
                    body=body,
                    announcement_type=ann_type,
                    deadline=deadline,
                    source_email_id=str(job.id)
                )
                db.add(announcement)
                db.flush()
                logger.info(f"Created new announcement: {title}")
                log_execution_stage(db, job.id, "EVENT_CREATED", "SUCCESS", f"Created general announcement: {title}")
                
            # Process and store attachments for the announcement
            has_attachments = False
            for att in attachments:
                filename = att.get("filename", "")
                base64_data = att.get("base64_data", "")
                if not base64_data:
                    continue
                    
                file_bytes = base64.b64decode(base64_data)
                
                att_meta = db.query(AttachmentMetadata).filter(
                    AttachmentMetadata.announcement_id == announcement.id,
                    AttachmentMetadata.file_name == filename
                ).first()

                if not att_meta:
                    att_meta = AttachmentMetadata(
                        announcement_id=announcement.id,
                        file_name=filename,
                        file_type="ANNOUNCEMENT_ATTACHMENT",
                        storage_path=f"attachments/announcements/{announcement.id}/{filename}",
                        parsed_meta={},
                        file_data=file_bytes
                    )
                    db.add(att_meta)
                    db.flush()
                    logger.info(f"Processed and linked attachment {filename} to announcement {announcement.id}.")
                else:
                    att_meta.file_data = file_bytes
                
                # Write file to storage
                storage_dir = "storage"
                full_path = os.path.join(storage_dir, att_meta.storage_path)
                os.makedirs(os.path.dirname(full_path), exist_ok=True)
                with open(full_path, "wb") as f:
                    f.write(file_bytes)
                logger.info(f"Wrote announcement attachment file to disk: {full_path}")
                has_attachments = True
            
            if has_attachments:
                log_execution_stage(db, job.id, "ATTACHMENTS_PROCESSED", "SUCCESS")
            
            # Complete job successfully
            job.status = 'completed'
            job.processed_at = datetime.utcnow()
            clean_job_payload(job)
            db.commit()
            logger.info(f"Job {job.id} processed as GENERAL_ANNOUNCEMENT successfully.")
            log_execution_stage(db, job.id, "COMPLETED", "SUCCESS", "Processed as general cdc announcement.")
            return True

        company_name = ext_data.get("company", {}).get("value") or "Unknown Company"
        company_name = company_name.strip()

        # -----------------------------------------------------------------------
        # GUARD: If the company name is unknown/generic after parsing, do not
        # create a workspace. The email could not be identified — flag it for
        # manual review by setting requires_review=True and skipping workspace creation.
        # -----------------------------------------------------------------------
        from app.services.email_parser import is_generic_company_name
        if is_generic_company_name(company_name):
            logger.warning(
                f"Job {job.id}: Parser returned generic/unknown company name '{company_name}'. "
                f"Email subject: '{subject}'. Marking job as requires_review and skipping workspace creation."
            )
            job.status = "failed"
            job.final_classification = "UNKNOWN_COMPANY"
            job.processed_at = datetime.utcnow()
            log_execution_stage(db, job.id, "COMPANY_MATCHED", "SKIPPED",
                f"Company name '{company_name}' is generic/unknown. No workspace created. Manual review required.")
            db.commit()
            return False

        event_type = ext_data.get("event_type", {}).get("value", "GENERAL_UPDATE").strip()
        location = ext_data.get("job_location", {}).get("value")
        registration_deadline_str = ext_data.get("deadline_iso", {}).get("value")
        registration_deadline = datetime.fromisoformat(registration_deadline_str) if registration_deadline_str else None
        registration_link = ext_data.get("registration_link", {}).get("value")
        requires_review = validated_info.get("parser_metadata", {}).get("requires_review", False)
        
        # Determine whether this is an announcement email (can create/update company metadata).
        # IMPORTANT: Only treat as announcement if email_category is explicitly NEW_DRIVE.
        # DO NOT rely on event_type == REGISTRATION here — the regex fallback returns REGISTRATION
        # as a default for any unrecognized email, which would incorrectly create new company workspaces
        # for OA/Shortlist/Interview emails that the parser failed to classify.
        UPDATE_ONLY_EVENT_TYPES = {
            "OA", "OA_RESULT", "SHORTLIST", "INTERVIEW", "INTERVIEW_RESULT",
            "OFFER", "REJECTION", "DEADLINE_EXTENSION", "GENERAL_UPDATE"
        }
        # Thread replies (Re:/Fwd:) are always updates to an existing drive —
        # a first announcement is never a reply. Without this, a misclassified
        # reply ("Re: <Company> - Online test ...") could create a fake drive.
        is_thread_reply = bool(re.match(r"^\s*(re|fwd|fw)\s*:", subject or "", re.IGNORECASE))

        is_announcement = (
            email_category == "NEW_DRIVE"
            and event_type not in UPDATE_ONLY_EVENT_TYPES
            and not is_thread_reply
        )
        if is_thread_reply and email_category == "NEW_DRIVE":
            logger.info(f"Job {job.id}: subject is a thread reply — downgrading NEW_DRIVE to update routing.")
            if event_type == "NEW_DRIVE":
                event_type = "GENERAL_UPDATE"
        
        # Set final classification on the raw ingestion job
        job.final_classification = "NEW_DRIVE" if is_announcement else event_type
        
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

        # Same-email deduplication guard:
        # Tracks Company objects we create from THIS specific email by normalized company name key.
        # Prevents one email with spurious multi-role LLM output from creating two Company rows
        # for the same company (e.g. 'Decode Age - Software Engineer' + 'Decode Age - Data Intelligence Intern').
        companies_created_this_job: dict = {}  # { norm_company_key: Company }
        
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
                    
            norm_company_name = clean_company_name_key(company_name).upper()
            norm_role_name = normalize_role_name(role).upper()
            norm_recruitment_cycle = recruitment_cycle.upper()
            fingerprint_input = f"{norm_company_name}|{norm_role_name}|{norm_recruitment_cycle}"
            fingerprint = hashlib.sha256(fingerprint_input.encode("utf-8")).hexdigest()
            
            # Check if company exists
            company = db.query(Company).filter(Company.fingerprint == fingerprint).first()
            
            # Fuzzy match candidates
            if not company:
                candidate_companies = db.query(Company).all()
                best_match = None
                best_score = -1
                subject_clean = clean_company_name_key(subject).lower()
                for c in candidate_companies:
                    role_score = 0
                    if normalize_role_name(c.role) == normalize_role_name(role):
                        role_score = 20
                    elif len(c.role) >= 3 and (c.role.lower() in role.lower() or role.lower() in c.role.lower()):
                        role_score = 10
                    else:
                        continue
                        
                    db_name_clean = clean_company_name_key(c.name).lower()
                    ext_name_clean = clean_company_name_key(company_name).lower()
                    
                    score = role_score
                    name_matched = False

                    # 1. Exact name match
                    if db_name_clean == ext_name_clean:
                        score += 60
                        name_matched = True
                    # 2. Substring name match (parsed company name contains/is-contained-by DB name)
                    elif (len(db_name_clean) >= 3 and db_name_clean in ext_name_clean) or (len(ext_name_clean) >= 3 and ext_name_clean in db_name_clean):
                        overlap_ratio = len(db_name_clean) / len(ext_name_clean) if len(ext_name_clean) > 0 else 0
                        if overlap_ratio > 1:
                            overlap_ratio = 1 / overlap_ratio
                        score += int(30 * overlap_ratio) + 20
                        name_matched = True
                    # 3. DB company name appears in the email subject (catches cases where the parser
                    #    returned the subject line as the company name, e.g., regex fallback failures)
                    elif len(db_name_clean) >= 3 and db_name_clean in subject_clean:
                        score += 45
                        name_matched = True
                    # 4. Parsed company name appears in the DB company name (handles partial matches
                    #    like 'Resmed Technology' matching 'ResMed Technology Pvt Ltd')
                    elif len(ext_name_clean) >= 3 and ext_name_clean in db_name_clean:
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

                # For update-type emails (non-announcement), use a lower threshold (40) so
                # we prefer attaching to an existing company over creating a new one.
                # For announcements, keep the higher threshold (50) to avoid merging distinct drives.
                fuzzy_threshold = 40 if not is_announcement else 50
                if best_score >= fuzzy_threshold:
                    company = best_match
                    logger.info(f"Fuzzy matched incoming email to existing company: {company.name} (ID: {company.id}, Match Score: {best_score})")

            # -----------------------------------------------------------------
            # SAME-EMAIL DEDUP GUARD (Fix for multi-role over-splitting):
            # If we still have no company match AND this is a NEW_DRIVE, check
            # whether a company with the SAME name was already created by an
            # EARLIER role object from this very same email (same job.id).
            # If yes, reuse it — update the role field to the more-specific name
            # rather than spinning up a second company workspace.
            # -----------------------------------------------------------------
            norm_company_key_for_dedup = clean_company_name_key(company_name)
            if not company and is_announcement and norm_company_key_for_dedup in companies_created_this_job:
                company = companies_created_this_job[norm_company_key_for_dedup]
                # Prefer the more specific / longer role name
                if role and (not company.role or len(role) > len(company.role or "")):
                    logger.info(
                        f"Same-email dedup: reusing existing company '{company.name}' (ID: {company.id}), "
                        f"updating role from '{company.role}' -> '{role}'."
                    )
                    company.role = role
                    db.flush()
                else:
                    logger.info(
                        f"Same-email dedup: reusing existing company '{company.name}' (ID: {company.id}). "
                        f"Role '{role}' not adopted (existing '{company.role}' is equally or more specific)."
                    )
                log_execution_stage(
                    db, job.id, "COMPANY_MATCHED", "SUCCESS",
                    f"Same-email dedup reused company workspace: {company.name} (Role: {company.role})"
                )

            # -----------------------------------------------------------------
            # GUARD: If this is an update mail (not an announcement) and we
            # couldn't find an existing company, park it as a PendingCompanyEvent.
            # We never let update mails create new company workspaces.
            # -----------------------------------------------------------------
            if not company and not is_announcement:
                import uuid as _uuid
                pe = PendingCompanyEvent(
                    id=_uuid.uuid4(),
                    raw_ingestion_job_id=job.id,
                    company_name=company_name,
                    role_name=role,
                    event_type=event_type,
                    status="PENDING_PARENT",
                    parsed_payload=validated_info
                )
                db.add(pe)
                db.flush()
                logger.warning(
                    f"Job {job.id} is a non-announcement email ({event_type}) with no matching company. "
                    f"Stored as PendingCompanyEvent {pe.id} for '{company_name}' / '{role}'."
                )
                log_execution_stage(db, job.id, "COMPANY_MATCHED", "PENDING", f"No matching company workspace found. Parked in pending_company_events.")
                # Skip the rest of the role loop for this role
                continue

            degree_types = r_item.get("degree_types", {}).get("value", [])
            specializations = r_item.get("specializations", {}).get("value", [])
            min_tenth_marks = r_item.get("min_tenth_marks", {}).get("value")
            min_twelfth_marks = r_item.get("min_twelfth_marks", {}).get("value")
            min_ug_cgpa = r_item.get("min_ug_cgpa", {}).get("value")
            eligibility_raw_text = ext_data.get("eligibility_raw_text", {}).get("value")

            allow_all_specializations = False
            if not specializations or specializations == ["CSE_CORE"]:
                allow_all_specializations = True

            eligibility_rules = {
                "degree_types": degree_types,
                "specializations": specializations,
                "allow_all_specializations": allow_all_specializations,
                "min_cgpa": min_cgpa,
                "min_tenth_marks": min_tenth_marks,
                "min_twelfth_marks": min_twelfth_marks,
                "requires_no_arrears": requires_no_arrears,
                "min_ug_cgpa": min_ug_cgpa,
                "date_of_visit": ext_data.get("date_of_visit", {}).get("value") or "Will be announced later"
            }
            
            if not company:
                # Only announcement mails reach here (is_announcement == True)
                company = Company(
                    name=company_name,
                    role=role,
                    category=category,
                    ctc=ctc,
                    stipend=stipend,
                    job_location=location,
                    eligible_branches=eligible_branches,
                    eligibility_rules=eligibility_rules,
                    eligibility_raw_text=eligibility_raw_text,
                    registration_deadline=registration_deadline,
                    registration_link=registration_link,
                    recruitment_cycle=recruitment_cycle,
                    fingerprint=fingerprint,
                    requires_review=requires_review
                )
                db.add(company)
                db.flush()
                logger.info(f"Created new company registry: {company_name} - {role}")
                log_execution_stage(db, job.id, "COMPANY_CREATED", "SUCCESS", f"Created new company workspace: {company_name} (Role: {role})")
                # Register in same-email dedup map so subsequent role objects from this email
                # do not create a second workspace for the same company name.
                companies_created_this_job[norm_company_key_for_dedup] = company
                # Immediately reconcile any pending update mails that arrived before this announcement
                reconcile_pending_events_for_company(db, company)
            else:
                log_execution_stage(db, job.id, "COMPANY_MATCHED", "SUCCESS", f"Matched company ID: {company.id}")
                if is_announcement:
                    # Announcement mail updating an existing company workspace:
                    # allow CTC, eligibility, branches, deadline, link to be refreshed.
                    current_deadline = registration_deadline
                    current_link = registration_link
                    if event_type not in ("REGISTRATION", "DEADLINE_EXTENSION", "NEW_DRIVE"):
                        current_deadline = None
                        current_link = None

                    updates = {
                        "ctc": ctc,
                        "stipend": stipend,
                        "job_location": location,
                        "registration_deadline": current_deadline,
                        "registration_link": current_link,
                        "eligibility_rules": eligibility_rules,
                        "eligibility_raw_text": eligibility_raw_text,
                        "eligible_branches": eligible_branches,
                        "requires_review": requires_review
                    }
                    for key, val in updates.items():
                        old_val = getattr(company, key)
                        
                        # Merge eligibility_rules dict instead of full overwrite
                        if key == "eligibility_rules" and isinstance(old_val, dict) and isinstance(val, dict):
                            merged_rules = dict(old_val)
                            for r_key, r_val in val.items():
                                if not is_placeholder_or_empty(r_val) or is_placeholder_or_empty(merged_rules.get(r_key)):
                                    merged_rules[r_key] = r_val
                            val = merged_rules

                        # Avoid overwriting a valid/non-empty old value with a placeholder/empty new value
                        if not is_placeholder_or_empty(old_val) and is_placeholder_or_empty(val):
                            continue

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
                    logger.info(f"Updated existing company registry (announcement): {company_name} - {role}")
                    log_execution_stage(db, job.id, "COMPANY_CREATED", "SUCCESS", f"Updated company workspace metadata: {company.name}")
                else:
                    # Non-announcement mail (SHORTLIST, OA, INTERVIEW, RESULT) on an existing company:
                    # Under strict separation design, do NOT overwrite/modify any company metadata!
                    if requires_review and not company.requires_review:
                        company.requires_review = True
                    logger.info(
                        f"Non-announcement email ({event_type}) matched to existing company: "
                        f"{company_name} - {role}. Metadata protected (no updates)."
                    )

            # Create Company Event for this role/workspace
            event = db.query(CompanyEvent).filter(
                CompanyEvent.company_id == company.id,
                CompanyEvent.event_type == event_type,
                CompanyEvent.subject == subject,
                CompanyEvent.timestamp == email_timestamp
            ).first()

            if not event:
                parsed_meta = extract_event_metadata(body, subject, event_type, ext_data)
                
                event = CompanyEvent(
                    company_id=company.id,
                    event_type=event_type,
                    subject=subject,
                    sender=sender,
                    body=body,
                    timestamp=email_timestamp,
                    parsed_metadata=parsed_meta
                )
                db.add(event)
                db.flush()
                
                notification_job = NotificationJob(
                    company_event_id=event.id,
                    status='pending'
                )
                db.add(notification_job)
                log_execution_stage(db, job.id, "EVENT_CREATED", "SUCCESS", f"Created event of type: {event_type}")
                log_execution_stage(db, job.id, "NOTIFICATION_CREATED", "SUCCESS")
            else:
                logger.info(f"Re-using existing company event {event.id} ingested by Edge Function.")
                
            processed_events.append(event)
            update_recruitment_states(db, company, event_type, email_timestamp, body)
            log_execution_stage(db, job.id, "APPLICATIONS_UPDATED", "SUCCESS")
            log_execution_stage(db, job.id, "CALENDAR_CREATED", "SUCCESS")

            # ------------------------------------------------------------------
            # Persist structured timeline milestone events from the events[] array.
            # Each milestone has stage, date_iso, round_number, sequence, venue, mandatory.
            # We upsert by (company_id, stage, round_number) to avoid duplicates across re-ingestion.
            # ------------------------------------------------------------------
            parsed_events_list = ext_data.get("events") or []
            for ev_item in parsed_events_list:
                if not isinstance(ev_item, dict):
                    continue
                ev_stage = ev_item.get("stage")
                if not ev_stage:
                    continue
                ev_date_iso = ev_item.get("date_iso")
                ev_date = None
                if ev_date_iso:
                    try:
                        from datetime import timezone as _tz
                        ev_date = datetime.fromisoformat(ev_date_iso)
                        if ev_date.tzinfo:
                            ev_date = ev_date.replace(tzinfo=None)
                    except (ValueError, TypeError):
                        pass
                ev_round = ev_item.get("round_number")
                ev_sequence = ev_item.get("sequence")
                ev_mandatory = ev_item.get("mandatory", True)
                ev_label = ev_item.get("label", ev_stage)
                ev_venue = ev_item.get("venue")

                # Map canonical stage → event_type
                STAGE_TO_EVENT_TYPE = {
                    "REGISTRATION": "NEW_DRIVE",
                    "ONLINE_ASSESSMENT": "OA",
                    "PRE_PLACEMENT_TALK": "GENERAL_UPDATE",
                    "TECHNICAL_INTERVIEW": "INTERVIEW",
                    "HR_INTERVIEW": "INTERVIEW",
                    "OFFER": "OFFER",
                    "REJECTION": "REJECTION_RELEASED",
                    "GENERAL_UPDATE": "GENERAL_UPDATE",
                }
                milestone_event_type = STAGE_TO_EVENT_TYPE.get(ev_stage, "GENERAL_UPDATE")

                # Check if milestone event already exists (deduplicate by company+stage+round)
                existing_milestone = db.query(CompanyEvent).filter(
                    CompanyEvent.company_id == company.id,
                    CompanyEvent.stage == ev_stage,
                    CompanyEvent.round_number == ev_round
                ).first()

                if existing_milestone:
                    # Update date and stage info if we have better/changed data now
                    changed = False
                    if ev_date and existing_milestone.date != ev_date:
                        existing_milestone.date = ev_date
                        changed = True
                    if ev_sequence and existing_milestone.sequence != ev_sequence:
                        existing_milestone.sequence = ev_sequence
                        changed = True
                    
                    parsed_meta = dict(existing_milestone.parsed_metadata or {})
                    meta_changed = False
                    if ev_venue and parsed_meta.get("venue") != ev_venue:
                        parsed_meta["venue"] = ev_venue
                        meta_changed = True
                    if ev_label and parsed_meta.get("label") != ev_label:
                        parsed_meta["label"] = ev_label
                        meta_changed = True
                    if ev_mandatory != parsed_meta.get("mandatory"):
                        parsed_meta["mandatory"] = ev_mandatory
                        meta_changed = True
                    
                    if meta_changed:
                        existing_milestone.parsed_metadata = parsed_meta
                        changed = True
                        
                    if changed:
                        db.flush()
                else:
                    milestone_event = CompanyEvent(
                        company_id=company.id,
                        event_type=milestone_event_type,
                        stage=ev_stage,
                        date=ev_date,
                        status="pending",
                        subject=subject,
                        sender=sender,
                        body=None,  # Keep body null for milestones to save space
                        timestamp=email_timestamp,
                        source_email=sender,
                        round_number=ev_round,
                        sequence=ev_sequence,
                        parsed_metadata={
                            "venue": ev_venue,
                            "label": ev_label,
                            "mandatory": ev_mandatory,
                            "confidence": ev_item.get("confidence", 0.5),
                        }
                    )
                    db.add(milestone_event)

            if parsed_events_list:
                db.flush()
                logger.info(f"Persisted {len(parsed_events_list)} timeline milestones for company {company.id}")

            # For update-type events (OA, SHORTLIST, INTERVIEW, etc.) that carry a deadline,
            # update the company's stored deadline and record the label so the frontend
            # can show "OA Deadline" instead of "Registration Deadline".
            UPDATE_TYPE_DEADLINE_LABELS = {
                "OA": "OA Deadline",
                "SHORTLIST": "Shortlist Deadline",
                "INTERVIEW": "Interview Deadline",
                "INTERVIEW_RESULT": "Result Deadline",
                "OA_RESULT": "OA Result Deadline",
                "DEADLINE_EXTENSION": "Extended Deadline",
                "GENERAL_UPDATE": "Updated Deadline",
            }
            if not is_announcement and event_type in UPDATE_TYPE_DEADLINE_LABELS:
                event_deadline_iso = event.parsed_metadata.get("deadline_iso") if event.parsed_metadata else None
                if event_deadline_iso:
                    try:
                        new_deadline_dt = datetime.fromisoformat(event_deadline_iso)
                        company.registration_deadline_db = new_deadline_dt
                        # Store a human-readable label for this deadline in event metadata
                        if event.parsed_metadata is None:
                            event.parsed_metadata = {}
                        event.parsed_metadata["deadline_label"] = UPDATE_TYPE_DEADLINE_LABELS[event_type]
                        db.add(event)
                        logger.info(
                            f"Updated company deadline from {event_type} event: {new_deadline_dt} ({event.id})"
                        )
                    except (ValueError, TypeError) as e:
                        logger.warning(f"Could not parse deadline_iso from event {event.id}: {e}")

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
        excel_shortlist_processed = False
        for event in processed_events:
            company = event.company
            has_attachments = False
            
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
                        parsed_meta={},
                        file_data=file_bytes
                    )
                    db.add(att_meta)
                    db.flush()
                else:
                    logger.info(f"Re-using existing attachment metadata for {filename}.")
                    att_meta.file_data = file_bytes
                
                # Write file to storage
                storage_dir = "storage"
                full_path = os.path.join(storage_dir, att_meta.storage_path)
                os.makedirs(os.path.dirname(full_path), exist_ok=True)
                with open(full_path, "wb") as f:
                    f.write(file_bytes)
                logger.info(f"Wrote attachment file to disk: {full_path}")
                has_attachments = True
                
                # Process JD PDF
                if filename.lower().endswith(".pdf"):
                    try:
                        jd_info = parse_job_description(file_bytes)
                        jd_text = jd_info.get("jd_text", "")
                        required_skills = jd_info.get("skills", [])
                        
                        company.jd_text = jd_text
                        
                        # Store in jd_analysis JSON column
                        company.jd_analysis = {
                            "required_skills": required_skills,
                            "ats_keywords": jd_info.get("ats_keywords", []),
                            "preferred_skills": [],
                            "interview_topics": []
                        }
                        
                        jd_intel = precompute_jd_intelligence_deterministic(jd_text, required_skills)
                        company.jd_analysis["preferred_skills"] = jd_intel.get("preferred_skills", [])
                        company.jd_analysis["interview_topics"] = jd_intel.get("interview_topics", [])
                        
                        from sqlalchemy.orm.attributes import flag_modified
                        flag_modified(company, "jd_analysis")
                        
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
                    process_shortlist_excel_batched(db, company, event, filename, file_bytes, att_meta)
                    excel_shortlist_processed = True

            if has_attachments:
                log_execution_stage(db, job.id, "ATTACHMENTS_PROCESSED", "SUCCESS")

        # Shortlists pasted directly into the email body (no Excel attached):
        # extract Neo-ID tokens from the body and run the same matching +
        # notification flow as the Excel path. Skipped when an Excel shortlist
        # was already processed for this email to avoid double notifications.
        SHORTLIST_BODY_EVENT_TYPES = {
            "SHORTLIST_RELEASED", "OA_RESULT", "INTERVIEW_RESULT",
            "OFFER_RELEASED", "SHORTLIST", "OFFER",
        }
        if (event_type in SHORTLIST_BODY_EVENT_TYPES
                and not excel_shortlist_processed and body and processed_events):
            try:
                body_neo_ids = extract_neo_ids_from_text(body)
                if body_neo_ids:
                    logger.info(f"Job {job.id}: found {len(body_neo_ids)} Neo IDs in email body — applying shortlist matches.")
                    for event in processed_events:
                        apply_shortlist_matches(
                            db, event.company, event, body_neo_ids,
                            source="email-body", event_type_hint=event_type,
                        )
            except Exception as e:
                logger.error(f"Job {job.id}: body shortlist processing failed: {e}", exc_info=True)

        # Store JD text + generate the reusable JD Strategy (once per drive).
        # Preference order for JD text: attached JD PDF (richest) > email body.
        # The strategy JSON is cached on the company and reused by every
        # student's resume-tailoring request — it is never regenerated unless
        # the JD text itself changes (jd_hash comparison).
        import hashlib as _hashlib
        for event in processed_events:
            company = event.company

            best_jd_text = jd_pdf_full_text or company.jd_text or body or ""
            if best_jd_text and best_jd_text != (company.jd_text or ""):
                # Upgrade stored JD when we found a richer source (e.g. PDF)
                if not company.jd_text or len(best_jd_text) > len(company.jd_text):
                    company.jd_text = best_jd_text

            if not company.jd_text:
                continue

            jd_hash = _hashlib.sha256(company.jd_text.encode("utf-8")).hexdigest()[:16]
            existing = company.jd_strategy if isinstance(company.jd_strategy, dict) else {}
            strategy_is_current = (
                existing.get("required_skills")
                and existing.get("jd_hash") == jd_hash
            )
            if strategy_is_current:
                continue

            try:
                logger.info(f"Generating JD Strategy for company {company.name} (ID: {company.id})...")
                from app.services.ai_service import generate_jd_strategy
                strategy = generate_jd_strategy(
                    company.jd_text, role=company.role, company_name=company.name
                )
                if strategy and (strategy.get("required_skills") or strategy.get("role_summary")):
                    strategy["jd_hash"] = jd_hash
                    company.jd_strategy = strategy
                    logger.info(f"Successfully saved JD Strategy for company {company.name}.")
            except Exception as e:
                logger.error(f"Failed to generate JD strategy for company {company.name} in job: {e}")

        # 7. Complete job successfully
        job.status = 'completed'
        job.processed_at = datetime.utcnow()
        clean_job_payload(job)
        # If no events were produced (all roles parked as PendingCompanyEvent), annotate the job
        if not processed_events:
            job.error_message = f"Suspended: non-announcement email ({event_type}) — stored as PendingCompanyEvent, awaiting parent announcement for '{company_name}'."
        db.commit()
        log_execution_stage(db, job.id, "COMPLETED", "SUCCESS", "Processed placement ingestion job successfully.")
        logger.info(f"Job {job.id} processed successfully.")

        # 8a. Bump Redis cache versions so next page load reflects new data.
        # Always bump companies list since company data may have been created/updated.
        try:
            if processed_events:
                bump_companies_list_version()
                # Bump each affected company's individual cache
                affected_company_ids = {e.company_id for e in processed_events}
                for cid in affected_company_ids:
                    from app.core.redis import bump_company_version
                    bump_company_version(cid)
                logger.info(f"Bumped company cache versions for {len(affected_company_ids)} companies.")
            elif email_category == "GENERAL_ANNOUNCEMENT":
                bump_announcements_version()
                logger.info("Bumped announcements cache version.")
        except Exception as cache_err:
            logger.warning(f"Cache version bump failed (non-critical): {cache_err}")

        # 8b. Refresh views
        refresh_materialized_views(db)
        
        # Process notification jobs queue immediately
        process_notification_jobs(db)
        
        return True
        
    except Exception as e:
        db.rollback()
        logger.error(f"Error processing job {job.id}: {str(e)}", exc_info=True)
        log_execution_stage(db, job.id, "FAILED", "FAILED", str(e))
        
        # Re-fetch job in a clean transaction to update retry / failed state
        try:
            db.begin_nested() # use nested transaction to bypass rollback state
            db.add(job)
            job.retry_count += 1
            if job.retry_count >= 5:
                job.status = 'dead_letter'
                clean_job_payload(job)
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
            
            # Map event type → (severity int, is_high_visibility bool)
            EVENT_SEVERITY = {
                'OFFER':            (5, True),
                'INTERVIEW_RESULT': (4, True),
                'INTERVIEW':        (4, True),
                'OA_RESULT':        (3, True),
                'OA':               (3, True),
                'SHORTLIST':        (4, True),
                'DEADLINE_EXTENSION': (2, False),
                'REGISTRATION':     (1, False),
                'REJECTION':        (1, False),
            }
            ev_severity, is_high_vis = EVENT_SEVERITY.get(event.event_type, (1, False))

            for profile in profiles:
                # Check eligibility
                status_elig, _, _ = check_eligibility(profile, company)
                if status_elig == "NOT_ELIGIBLE":
                    continue

                # Check application state to see if notifications are silenced
                app = db.query(Application).filter(
                    Application.user_id == profile.user_id,
                    Application.company_id == company.id
                ).first()

                if app and app.status in ('Rejected', 'Declined', 'Ignored'):
                    # Silenced — always skip
                    continue

                # Check opportunity state to determine if this is an archived drive
                opp_state = db.query(OpportunityState).filter(
                    OpportunityState.user_id == profile.user_id,
                    OpportunityState.company_id == company.id
                ).first()
                opp_current = opp_state.state if opp_state else "unseen"

                # Deduplicate — always check first
                existing = db.query(Notification).filter(
                    Notification.user_id == profile.user_id,
                    Notification.company_event_id == event.id
                ).first()
                if existing:
                    continue

                if opp_current in ('archived', 'auto_archived'):
                    # User archived this drive — create a low-priority collapsed notification (severity = 1), don't auto-read.
                    event_label = event.event_type.replace('_', ' ').title()
                    msg = f"📬 [Archived Update: {event_label}] {company.name} ({company.role}): {event.subject or 'New update'}."
                    notif_type = 'system'
                    severity = 1
                else:
                    # Standard notification path for active/tracking/unseen states
                    if event.event_type == 'REGISTRATION':
                        deadline_str = company.registration_deadline.strftime('%b %d, %I:%M %p') if company.registration_deadline else 'N/A'
                        msg = f"📢 New drive: {company.name} is hiring for {company.role} ({company.category}). Deadline: {deadline_str}."
                        notif_type = 'company_update'
                        severity = ev_severity
                    elif event.event_type == 'DEADLINE_EXTENSION':
                        deadline_str = company.registration_deadline.strftime('%b %d, %I:%M %p') if company.registration_deadline else 'N/A'
                        msg = f"⏰ Deadline extended! {company.name} ({company.role}) new deadline: {deadline_str}."
                        notif_type = 'deadline'
                        severity = ev_severity
                    elif event.event_type == 'SHORTLIST':
                        # Check if this user is tracking this company
                        if app and app.user_decision == 'tracking':
                            # Verify if their Neo ID is in the shortlist
                            is_found = check_if_student_shortlisted(db, profile.user_id, event)
                            if not is_found:
                                msg = f"⚠️ Shortlist released for {company.name} ({company.role}), but your Neo ID was not found. Please manually check and confirm."
                                notif_type = 'confirm_archive'
                                severity = 5
                            else:
                                msg = f"🎉 Congratulations! You are shortlisted for {company.name} ({company.role})! Prepare for next steps."
                                notif_type = 'company_update'
                                severity = 4
                        else:
                            # Skip if they aren't tracking / applied to this company
                            continue
                    elif event.event_type == 'OA':
                        msg = f"📝 Online Assessment scheduled for {company.name} ({company.role}). Check email for details."
                        notif_type = 'company_update'
                        severity = ev_severity
                    elif event.event_type == 'OA_RESULT':
                        msg = f"📊 OA results announced for {company.name} ({company.role}). Check your application status."
                        notif_type = 'company_update'
                        severity = ev_severity
                    elif event.event_type == 'INTERVIEW':
                        msg = f"🎤 Interview scheduled for {company.name} ({company.role}). Check email for slot details."
                        notif_type = 'company_update'
                        severity = ev_severity
                    elif event.event_type == 'INTERVIEW_RESULT':
                        msg = f"📋 Interview results announced for {company.name} ({company.role}). Check your application status."
                        notif_type = 'company_update'
                        severity = ev_severity
                    elif event.event_type == 'OFFER':
                        msg = f"🎉 Offers released by {company.name} for {company.role}! Check your application status."
                        notif_type = 'offer'
                        severity = ev_severity
                    elif event.event_type == 'REJECTION':
                        msg = f"📬 Update from {company.name} ({company.role}): {event.subject}."
                        notif_type = 'company_update'
                        severity = ev_severity
                    else:
                        msg = f"📅 Update from {company.name}: {event.subject}."
                        notif_type = 'company_update'
                        severity = ev_severity

                db.add(Notification(
                    user_id=profile.user_id,
                    company_event_id=event.id,
                    message=msg,
                    notification_type=notif_type,
                    severity=severity
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
            # Normalize event_timestamp to naive UTC for comparison
            ts = event_timestamp.replace(tzinfo=None) if event_timestamp.tzinfo else event_timestamp
            is_past = ts < datetime.utcnow()
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
            ts = event_timestamp.replace(tzinfo=None) if event_timestamp.tzinfo else event_timestamp
            is_past = ts < datetime.utcnow()
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

    # Bump Redis cache versions for all users whose applications were updated
    try:
        affected_user_ids = {app.user_id for app in apps}
        for uid in affected_user_ids:
            bump_user_version(uid)
    except Exception as cache_err:
        logger.warning(f"Cache version bump failed in update_recruitment_states (non-critical): {cache_err}")

    # Synchronize calendar events for all users tracking this company
    from app.services.calendar_sync import sync_user_calendar_events
    for app in apps:
        try:
            sync_user_calendar_events(db, app.user_id, company.id)
        except Exception as sync_err:
            logger.error(f"Error triggering calendar sync for user {app.user_id} and company {company.id}: {str(sync_err)}")



def check_if_student_shortlisted(db: Session, user_id: UUID, event: CompanyEvent) -> bool:
    """
    Analyzes whether the student's credentials (email prefix, name, or hashed Neo ID)
    are present in the company event body, subject, or any attachments.
    Returns True if found, False otherwise.
    """
    import io
    import pandas as pd
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return False
    profile = db.query(StudentProfile).filter(StudentProfile.user_id == user_id).first()
    if not profile:
        return False

    # 1. Plaintext checks: email prefix and full name
    email_prefix = user.email.split('@')[0].lower()
    full_name = profile.full_name.lower()
    
    # Text accumulator
    all_text = f"{event.subject or ''}\n{event.body or ''}"
    
    # 2. Check attachments
    attachments = db.query(AttachmentMetadata).filter(AttachmentMetadata.company_event_id == event.id).all()
    for att in attachments:
        if not att.storage_path:
            continue
        full_path = os.path.join("storage", att.storage_path)
        if not os.path.exists(full_path):
            continue
            
        try:
            if att.file_name.lower().endswith(('.xls', '.xlsx')):
                with open(full_path, "rb") as f:
                    excel_bytes = f.read()
                # Use in-memory pandas parser to find all sheet values
                df = pd.read_excel(io.BytesIO(excel_bytes), engine="openpyxl")
                # Flatten all string contents
                for col in df.columns:
                    col_vals = df[col].dropna().astype(str).str.strip().tolist()
                    all_text += "\n" + "\n".join(col_vals)
            elif att.file_name.lower().endswith('.pdf'):
                with open(full_path, "rb") as f:
                    pdf_bytes = f.read()
                from app.services.pdf_extractor import extract_text_from_pdf
                pdf_text = extract_text_from_pdf(pdf_bytes)
                all_text += "\n" + pdf_text
        except Exception as e:
            logger.error(f"Error parsing attachment {att.file_name} for shortlist verification: {e}")

    # Case-insensitive checks
    all_text_lower = all_text.lower()
    if email_prefix in all_text_lower:
        logger.info(f"Student {user.email} shortlisted (email prefix matched in text)")
        return True
    if len(full_name) > 3 and full_name in all_text_lower:
        logger.info(f"Student {user.email} shortlisted (full name matched in text)")
        return True

    # 3. Blind Index / Hashed Neo ID check
    NEO_ID_REGEX = re.compile(r"\b[A-Za-z]\d[A-Za-z]\d[A-Za-z]\d[A-Za-z]\d\b")
    candidates = NEO_ID_REGEX.findall(all_text)
    for cand in set(candidates):
        cand_upper = cand.upper()
        cand_hash = generate_blind_index(cand_upper, settings.PEPPER)
        if cand_hash == profile.neo_id_hash:
            logger.info(f"Student {user.email} shortlisted (blind index Neo ID match: {cand_upper})")
            return True

    logger.warning(f"Student {user.email} NOT found in shortlist event {event.id}")
    return False


