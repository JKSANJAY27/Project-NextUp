"""One-off repair (2026-07-07):

1. Recreate the Groww OA update's main email event — scratch_dedup_companies.py
   (old version) deleted all stage=NULL events, which are the real email-trail
   events. Recreated with the corrected event_type OA + body, and a pending
   NotificationJob so students get notified about tomorrow's test.

2. Recompute ALL timeline milestone dates from each job's validated_output:
   - ground the date against the actual email text (drop hallucinated dates,
     e.g. Valuelabs' fabricated 8/9/10-July schedule)
   - convert the parser's naive IST clock to true UTC (fixes the +5:30 display
     shift, e.g. GROWW registration 9:00 AM shown as 2:30 PM)
   - apply subject-based stage reclassification for update mails (the Groww
     OA mail's milestone was stored as REGISTRATION, clobbering the real
     registration deadline)

3. Fix companies.registration_deadline with the same IST->UTC conversion.

Touches only dates/stages of existing rows + recreates one deleted event.
Creates NO companies.
"""
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding="utf-8")

from dotenv import load_dotenv
load_dotenv()

from sqlalchemy import text
from app.core.database import SessionLocal
from app.models.models import Company, CompanyEvent, RawIngestionJob, NotificationJob
from app.services.gmail_sync import (
    IST_OFFSET, milestone_date_is_grounded,
    OA_SUBJECT_KEYWORDS, INTERVIEW_SUBJECT_KEYWORDS,
    process_notification_jobs,
)

OA_KEYWORDS = ["online test", "online assessment", "online assignment",
               "aptitude test", "hackathon", "coding test",
               "written test", "proctored test", "assessment test"]
PPT_KEYWORDS = ["pre placement talk", "ppt", "pre-placement", "campus visit",
                "company presentation", "info session"]
HR_KEYWORDS = ["hr interview", "hr round", "hr discussion"]
TECH_KEYWORDS = ["technical interview", "tech interview", "technical round",
                 "coding interview", "system design"]


def effective_stage(stage, label, venue, subject, is_announcement):
    txt = f"{label or ''} {venue or ''}".lower()
    if not is_announcement:
        txt += " " + (subject or "").lower()
    if stage in ("REGISTRATION", "GENERAL_UPDATE"):
        if any(k in txt for k in TECH_KEYWORDS):
            return "TECHNICAL_INTERVIEW"
        if any(k in txt for k in HR_KEYWORDS):
            return "HR_INTERVIEW"
        if any(k in txt for k in OA_KEYWORDS):
            return "ONLINE_ASSESSMENT"
        if any(k in txt for k in PPT_KEYWORDS) and stage == "REGISTRATION":
            return "PRE_PLACEMENT_TALK"
    return stage


def to_utc(dt_iso: str):
    try:
        dt = datetime.fromisoformat(dt_iso)
    except (ValueError, TypeError):
        return None
    if dt.tzinfo:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt - IST_OFFSET  # naive = IST local clock


def main():
    db = SessionLocal()
    try:
        # ---------- 1. Recreate the deleted Groww OA email event ----------
        job = db.query(RawIngestionJob).filter(
            RawIngestionJob.id == "7671a0cb-8fdc-481a-9ec8-516e77878312"
        ).first()
        groww = db.query(Company).filter(Company.name == "GROWW").first()
        if job and groww and job.payload:
            subj = job.payload.get("subject")
            ts = datetime.fromisoformat(job.payload["timestamp"].replace("Z", "+00:00"))
            exists = db.query(CompanyEvent).filter(
                CompanyEvent.company_id == groww.id,
                CompanyEvent.subject == subj,
                CompanyEvent.stage.is_(None),
            ).first()
            if not exists:
                ev = CompanyEvent(
                    company_id=groww.id,
                    event_type="OA",
                    subject=subj,
                    sender=job.payload.get("sender"),
                    body=job.payload.get("body"),
                    timestamp=ts,
                    parsed_metadata={"oa_platform": None, "venue": "PRP 717",
                                     "label": "Online Test"},
                )
                db.add(ev)
                db.flush()
                db.add(NotificationJob(company_event_id=ev.id, status="pending"))
                db.commit()
                print(f"[1] Recreated Groww OA email event {ev.id} + notification job")
            else:
                print("[1] Groww OA email event already present — skipped")
        else:
            print("[1] Groww OA job/company not found — skipped")

        # ---------- 2. Recompute milestone dates from validated_output ----------
        jobs = db.query(RawIngestionJob).filter(
            RawIngestionJob.status == "completed",
            RawIngestionJob.validated_output.isnot(None),
        ).all()
        # order by email timestamp so later update mails win
        def _job_ts(j):
            t = (j.payload or {}).get("timestamp") or ""
            return t
        jobs.sort(key=_job_ts)

        for j in jobs:
            payload = j.payload or {}
            subj = payload.get("subject") or ""
            body = payload.get("body") or ""
            ground = f"{subj}\n{body}".lower()
            ext = (j.validated_output or {}).get("extracted_data", {})
            evs = ext.get("events") or []
            if not evs or not subj:
                continue
            is_announcement = (j.final_classification == "NEW_DRIVE")

            # companies this email belongs to = companies having an event with this subject
            comp_ids = [r[0] for r in db.query(CompanyEvent.company_id).filter(
                CompanyEvent.subject == subj).distinct().all()]
            for cid in comp_ids:
                for ev in evs:
                    stage = effective_stage(ev.get("stage"), ev.get("label"),
                                            ev.get("venue"), subj, is_announcement)
                    rnd = ev.get("round_number")
                    q = db.query(CompanyEvent).filter(
                        CompanyEvent.company_id == cid,
                        CompanyEvent.stage == stage,
                    )
                    q = q.filter(CompanyEvent.round_number == rnd) if rnd is not None \
                        else q.filter(CompanyEvent.round_number.is_(None))
                    milestone = q.first()
                    if not milestone:
                        continue
                    new_date = to_utc(ev.get("date_iso")) if ev.get("date_iso") else None
                    if new_date is not None and not milestone_date_is_grounded(new_date, ground):
                        print(f"    [{subj[:45]}] {stage}: date {ev.get('date_iso')} NOT in email text -> NULL")
                        new_date = None
                    old = milestone.date
                    old_naive = old.replace(tzinfo=None) if (old is not None and old.tzinfo) else old
                    if old_naive != new_date:
                        print(f"    [{subj[:45]}] {stage}: {old} -> {new_date}")
                        milestone.date = new_date
        db.commit()
        print("[2] Milestone dates recomputed")

        # ---------- 3. Fix companies.registration_deadline (IST->UTC) ----------
        for j in jobs:
            if j.final_classification != "NEW_DRIVE":
                continue
            ext = (j.validated_output or {}).get("extracted_data", {})
            dl = (ext.get("deadline_iso") or {}).get("value")
            subj = (j.payload or {}).get("subject") or ""
            if not dl or not subj:
                continue
            new_dl = to_utc(dl)
            if not new_dl:
                continue
            comp_ids = [r[0] for r in db.query(CompanyEvent.company_id).filter(
                CompanyEvent.subject == subj).distinct().all()]
            for cid in comp_ids:
                c = db.query(Company).filter(Company.id == cid).first()
                if c:
                    old = c.registration_deadline_db
                    old_naive = old.replace(tzinfo=None) if (old is not None and old.tzinfo) else old
                    if old_naive != new_dl:
                        print(f"    [{c.name}] registration_deadline: {old} -> {new_dl}")
                        c.registration_deadline_db = new_dl
        db.commit()
        print("[3] Registration deadlines fixed")

        # ---------- 4. Send the pending notifications ----------
        process_notification_jobs(db)
        print("[4] Notification jobs processed")

        # Bump caches so the UI refreshes
        try:
            from app.core.redis import bump_companies_list_version, bump_company_version
            bump_companies_list_version()
            for c in db.query(Company).all():
                bump_company_version(c.id)
            print("[5] Cache versions bumped")
        except Exception as e:
            print(f"[5] Cache bump skipped: {e}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
