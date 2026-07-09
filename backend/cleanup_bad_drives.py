"""
cleanup_bad_drives.py
---------------------
One-off repair script:
  1. Deletes the 4 company workspaces (and all their associated data) that were
     incorrectly created by update emails misclassified as NEW_DRIVE.
  2. Resets the source raw ingestion jobs to 'pending' so they re-run through
     the patched pipeline (which will now correctly park them as PendingCompanyEvent
     or attach them to an existing company).

Companies to remove:
  - UBS                   (created by job c21b135e-4095-4851-a6ef-77d69144d144)
  - Gene Technologies     (created by job fdd32ed7-12a2-4819-9ace-122ddd1e6081)
  - TCS                   (created by job 020f30cc-08a3-4a59-a636-c7cfd981695e)
  - Varroc Engineering Ltd (created by job 23d2a364-d3e6-4bfc-9012-3dd5599fa7ee)

Run with the backend venv:
  d:\\NextupAI\\Project-NextUp\\backend\\venv\\Scripts\\python.exe cleanup_bad_drives.py
"""
import sys
import os

# Allow running from the backend directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal
from app.models.models import (
    Company, CompanyEvent, CompanyChangeLog, AttachmentMetadata,
    NotificationJob, Application, OpportunityState,
    PendingCompanyEvent, RawIngestionJob, CalendarEvent,
    IngestionExecutionLog,
)
from sqlalchemy import text
from datetime import datetime

# ------------------------------------------------------------------
# Jobs that created the bad company workspaces
# ------------------------------------------------------------------
BAD_JOB_IDS = [
    "c21b135e-4095-4851-a6ef-77d69144d144",  # UBS
    "fdd32ed7-12a2-4819-9ace-122ddd1e6081",  # Gene Technologies
    "020f30cc-08a3-4a59-a636-c7cfd981695e",  # TCS
    "23d2a364-d3e6-4bfc-9012-3dd5599fa7ee",  # Varroc Engineering Ltd
]

# Key fragments to identify companies in DB (case-insensitive)
BAD_COMPANY_KEYWORDS = ["ubs", "gene tech", "tcs", "varroc"]


def company_is_bad(name: str) -> bool:
    n = (name or "").lower()
    return any(kw in n for kw in BAD_COMPANY_KEYWORDS)


def delete_company_cascade(db, company: Company):
    cname = company.name
    cid = company.id
    print(f"\n  Deleting company: {cname!r} (id={cid})")

    # 1. Notification jobs for events of this company
    events = db.query(CompanyEvent).filter(CompanyEvent.company_id == cid).all()
    for ev in events:
        notifs = db.query(NotificationJob).filter(
            NotificationJob.company_event_id == ev.id
        ).all()
        for n in notifs:
            db.delete(n)
        # AttachmentMetadata linked to the event
        atts = db.query(AttachmentMetadata).filter(
            AttachmentMetadata.company_event_id == ev.id
        ).all()
        for a in atts:
            db.delete(a)
        db.delete(ev)
    print(f"    Deleted {len(events)} company events + notifications/attachments")

    # 2. Change logs
    logs = db.query(CompanyChangeLog).filter(CompanyChangeLog.company_id == cid).all()
    for l in logs:
        db.delete(l)
    print(f"    Deleted {len(logs)} change logs")

    # 3. Application records for this company
    try:
        apps = db.query(Application).filter(Application.company_id == cid).all()
        for a in apps:
            db.delete(a)
        print(f"    Deleted {len(apps)} application records")
    except Exception:
        print(f"    (No application records or column mismatch — skipped)")

    # 4. OpportunityState rows
    try:
        states = db.query(OpportunityState).filter(OpportunityState.company_id == cid).all()
        for s in states:
            db.delete(s)
        print(f"    Deleted {len(states)} opportunity state records")
    except Exception:
        print(f"    (No opportunity state records or column mismatch — skipped)")

    # 5. Attachment metadata linked to company directly
    try:
        atts_direct = db.query(AttachmentMetadata).filter(
            AttachmentMetadata.company_id == cid
        ).all()
        for a in atts_direct:
            db.delete(a)
        print(f"    Deleted {len(atts_direct)} company-level attachments")
    except Exception:
        print(f"    (No company-level attachments — skipped)")

    # 6. PendingCompanyEvent rows for this company name
    pending = db.query(PendingCompanyEvent).filter(
        PendingCompanyEvent.company_name.ilike(f"%{cname.split()[0]}%")
    ).all()
    for p in pending:
        db.delete(p)
    print(f"    Deleted {len(pending)} PendingCompanyEvent rows")

    # 7. CalendarEvent rows for this company
    try:
        cal_events = db.query(CalendarEvent).filter(CalendarEvent.company_id == cid).all()
        for c in cal_events:
            db.delete(c)
        print(f"    Deleted {len(cal_events)} calendar events")
    except Exception:
        print(f"    (No calendar events — skipped)")

    # 8. Delete the company itself
    db.delete(company)
    print(f"    Deleted company row.")


def reset_job(db, job_id: str):
    job = db.query(RawIngestionJob).filter(
        text("CAST(id AS TEXT) = :jid")
    ).params(jid=job_id).first()

    if not job:
        print(f"  WARNING: job {job_id} not found in DB, skipping reset.")
        return

    old_status = job.status
    job.status = "pending"
    job.locked_at = None
    job.locked_by = None
    job.processed_at = None
    job.retry_count = 0
    job.error_message = None
    job.final_classification = None
    # Clear parsed/validated output so it fully re-parses
    job.parsed_output = None
    job.validated_output = None

    # Remove old execution logs for this job so the re-run starts clean
    try:
        db.query(IngestionExecutionLog).filter(
            text("CAST(job_id AS TEXT) = :jid")
        ).params(jid=job_id).delete(synchronize_session=False)
    except Exception as e:
        print(f"  (Could not delete execution logs for {job_id}: {e})")

    print(f"  Reset job {job_id}: {old_status!r} -> 'pending'")


def main():
    import argparse
    parser_cli = argparse.ArgumentParser()
    parser_cli.add_argument("--yes", action="store_true", help="Skip confirmation prompt")
    args = parser_cli.parse_args()

    db = SessionLocal()
    try:
        print("=" * 60)
        print("NextupAI — Bad Drive Cleanup")
        print("=" * 60)

        # ------------------------------------------------------------------
        # 1. Find & delete bad companies
        # ------------------------------------------------------------------
        all_companies = db.query(Company).all()
        bad_companies = [c for c in all_companies if company_is_bad(c.name)]

        if not bad_companies:
            print("\nNo matching bad companies found in the database.")
        else:
            print(f"\nFound {len(bad_companies)} bad company workspaces to delete:")
            for c in bad_companies:
                print(f"  - {c.name!r} (id={c.id})")

            if not args.yes:
                confirm = input("\nProceed with deletion? (yes/no): ").strip().lower()
                if confirm != "yes":
                    print("Aborted.")
                    return
            else:
                print("\n--yes flag set, proceeding automatically.")

            for c in bad_companies:
                delete_company_cascade(db, c)

            db.flush()

        # ------------------------------------------------------------------
        # 2. Reset source jobs to pending for re-processing
        # ------------------------------------------------------------------
        print(f"\nResetting {len(BAD_JOB_IDS)} source ingestion jobs to 'pending'...")
        for jid in BAD_JOB_IDS:
            reset_job(db, jid)

        # ------------------------------------------------------------------
        # 3. Commit
        # ------------------------------------------------------------------
        db.commit()
        print("\n" + "=" * 60)
        print("Cleanup committed successfully.")
        print("The reset jobs will be re-processed on the next cron tick.")
        print("With the patched pipeline they should route to PendingCompanyEvent")
        print("(no company in DB) instead of creating new workspaces.")
        print("=" * 60)

    except Exception as e:
        db.rollback()
        print(f"\nERROR — rolled back: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
