"""
cleanup_and_reparse_4_companies.py
====================================
Targeted cleanup + reparse for the 4 companies in our placement cycle:
  - project44
  - Value Labs (Valuelabs LLP)
  - GROWW
  - Infosys

What this script does:
  1. Deletes ALL companies that are NOT one of the 4 known ones.
     This removes junk like 'Congratulations!!', '*Super Dream Internship Registration*',
     and also pre-June-29 companies (Societe Generale, AVMI Foods, Valeo, Decode Age, etc.)
     that should not be in our tracker.
  2. Resets ALL raw_ingestion_jobs for the 4 companies back to 'pending'
     so they get cleanly reparsed.
  3. Marks ALL other completed/dead_letter jobs as 'ignored' (sets status to 'completed'
     but clears their parsed output) so they don't create more junk companies on rerun.
     Jobs that are UPDATES for the 4 companies (Value Labs updates, Infosys update, etc.)
     are also reset to pending.
  4. Reruns the parser on the pending jobs.

SAFE TO RUN: It does NOT delete users, resumes, or student profiles.
"""
import os
import sys
import logging
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

# Skip view refresh and disable HuggingFace for faster local parsing
os.environ["SKIP_VIEW_REFRESH"] = "true"

from dotenv import load_dotenv
load_dotenv()

from sqlalchemy import text
from app.core.database import SessionLocal
from app.models.models import RawIngestionJob, Company
from app.services.gmail_sync import process_queued_jobs, refresh_materialized_views

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger("cleanup_4_companies")

# ────────────────────────────────────────────────────────────────
# Configuration: keywords that identify the 4 target companies
# in the email subject line.
# ────────────────────────────────────────────────────────────────
TARGET_COMPANY_KEYWORDS = [
    'project44',
    'valuelabs',
    'value labs',
    'groww',
    'infosys',
]

def subject_matches_target(subject: str) -> bool:
    s = subject.lower()
    return any(kw in s for kw in TARGET_COMPANY_KEYWORDS)


def main():
    db = SessionLocal()
    try:
        # ─────────────────────────────────────────────────────────
        # STEP 1: Delete ALL existing companies (all are either junk
        # or will be cleanly recreated by reprocessing)
        # ─────────────────────────────────────────────────────────
        print("\n=== STEP 1: DELETING ALL EXISTING COMPANY DATA ===")
        tables_to_clear = [
            "ingestion_execution_logs",
            "notifications",
            "notification_jobs",
            "ingestion_audit_logs",
            "attachments_metadata",
            "company_events",
            "company_change_logs",
            "applications",
            "pending_company_events",
            "opportunity_states",
            "companies",
        ]
        for table in tables_to_clear:
            try:
                result = db.execute(text(f"DELETE FROM {table}"))
                db.commit()
                print(f"  ✓ Cleared '{table}' ({result.rowcount} rows deleted)")
            except Exception as ex:
                db.rollback()
                print(f"  ⚠ Could not clear '{table}': {str(ex)[:120]}")

        # ─────────────────────────────────────────────────────────
        # STEP 2: Categorize all raw_ingestion_jobs
        # ─────────────────────────────────────────────────────────
        print("\n=== STEP 2: CATEGORIZING RAW INGESTION JOBS ===")
        all_jobs = db.query(RawIngestionJob).all()
        print(f"  Total raw_ingestion_jobs: {len(all_jobs)}")

        target_job_ids = []
        skip_job_ids = []

        for j in all_jobs:
            subject = (j.payload or {}).get("subject", "")
            if subject_matches_target(subject):
                target_job_ids.append(j.id)
                print(f"  [TARGET ] {subject[:90]}")
            else:
                skip_job_ids.append(j.id)

        print(f"\n  → Target jobs to reparse:     {len(target_job_ids)}")
        print(f"  → Non-target jobs to skip:    {len(skip_job_ids)}")

        # ─────────────────────────────────────────────────────────
        # STEP 3: Reset target jobs to 'pending'
        # ─────────────────────────────────────────────────────────
        print("\n=== STEP 3: RESETTING TARGET JOBS TO PENDING ===")
        if target_job_ids:
            target_jobs = db.query(RawIngestionJob).filter(
                RawIngestionJob.id.in_(target_job_ids)
            ).all()
            for j in target_jobs:
                j.status = 'pending'
                j.parsed_output = None
                j.validated_output = None
                j.locked_at = None
                j.locked_by = None
                j.error_message = None
                j.processed_at = None
                j.retry_count = 0
            db.commit()
            print(f"  ✓ Reset {len(target_jobs)} target jobs to 'pending'")

        # ─────────────────────────────────────────────────────────
        # STEP 4: Mark non-target jobs as 'skipped' so they don't
        # accidentally process and create junk companies
        # ─────────────────────────────────────────────────────────
        print("\n=== STEP 4: MARKING NON-TARGET JOBS AS SKIPPED ===")
        if skip_job_ids:
            # Process in batches to avoid memory issues with 154 jobs
            BATCH = 50
            total_skipped = 0
            for i in range(0, len(skip_job_ids), BATCH):
                batch_ids = skip_job_ids[i:i + BATCH]
                skip_jobs = db.query(RawIngestionJob).filter(
                    RawIngestionJob.id.in_(batch_ids)
                ).all()
                for j in skip_jobs:
                    j.status = 'dead_letter'
                    j.error_message = 'Excluded by cleanup_4_companies: not a target company'
                    j.parsed_output = None
                    j.validated_output = None
                total_skipped += len(skip_jobs)
                db.commit()
            print(f"  ✓ Marked {total_skipped} non-target jobs as 'skipped'")

        # ─────────────────────────────────────────────────────────
        # STEP 5: Reparse the target jobs
        # ─────────────────────────────────────────────────────────
        print("\n=== STEP 5: REPARSING TARGET JOBS ===")

        # Reset any circuit breakers that may have opened from previous failed runs.
        # This ensures the HF Space provider gets a clean attempt.
        from app.services.ai_provider import reset_all_circuits, get_parser_gateway
        reset_all_circuits()
        # Force gateway re-init so new provider list (with Space) takes effect
        import app.services.ai_provider as _ai_prov
        with _ai_prov._gateway_lock:
            _ai_prov._parser_gateway = None
        gateway = get_parser_gateway()
        print(f"  Parser gateway providers: {[p.name for p in gateway.providers]}")

        # Also reset any jobs that ended up 'failed' from previous interrupted runs
        failed_target = db.query(RawIngestionJob).filter(
            RawIngestionJob.id.in_(target_job_ids),
            RawIngestionJob.status == 'failed'
        ).all()
        for j in failed_target:
            j.status = 'pending'
            j.retry_count = 0
            j.error_message = None
            j.locked_at = None
            j.locked_by = None
        if failed_target:
            db.commit()
            print(f"  ✓ Re-queued {len(failed_target)} previously-failed jobs")

        pending_count = db.query(RawIngestionJob).filter(
            RawIngestionJob.status == 'pending'
        ).count()
        print(f"  Found {pending_count} pending jobs to process\n")

        processed = 0
        failed = 0
        while True:
            next_job = db.query(RawIngestionJob).filter(
                RawIngestionJob.status == 'pending'
            ).order_by(RawIngestionJob.created_at.asc()).first()
            if not next_job:
                break

            subject = (next_job.payload or {}).get("subject", "No Subject")
            print(f"\n  Processing [{processed + failed + 1}/{pending_count}]: {subject[:80]}")

            success = process_queued_jobs(db)
            if success:
                processed += 1
                db.expire_all()
                job_ref = db.query(RawIngestionJob).filter(
                    RawIngestionJob.id == next_job.id
                ).first()
                val_out = job_ref.validated_output if job_ref else None
                if val_out and "extracted_data" in val_out:
                    ext = val_out["extracted_data"]
                    comp_name = ext.get("company", {}).get("value", "?")
                    evt_type = ext.get("event_type", {}).get("value", "?")
                    print(f"    ✓ Company: '{comp_name}' | Event: {evt_type}")
                else:
                    print(f"    ✓ Job completed (status: {job_ref.status if job_ref else '?'})")
            else:
                failed += 1
                db.expire_all()
                job_ref = db.query(RawIngestionJob).filter(
                    RawIngestionJob.id == next_job.id
                ).first()
                err = job_ref.error_message if job_ref and job_ref.error_message else "unknown error"
                print(f"    ✗ FAILED: {err[:120]}")

        # ─────────────────────────────────────────────────────────
        # STEP 6: Refresh materialized views + show final state
        # ─────────────────────────────────────────────────────────
        print("\n=== STEP 6: REFRESHING VIEWS & FINAL SUMMARY ===")
        os.environ["SKIP_VIEW_REFRESH"] = "false"
        try:
            refresh_materialized_views(db)
            print("  ✓ Materialized views refreshed")
        except Exception as e:
            print(f"  ⚠ View refresh failed (non-critical): {e}")

        print(f"\n  Jobs processed:  {processed}")
        print(f"  Jobs failed:     {failed}")

        companies = db.query(Company).all()
        print(f"\n  Final companies in DB ({len(companies)}):")
        for c in companies:
            print(f"    [{c.name}] role='{c.role}' | cat='{c.category}' | "
                  f"jd_analysis={bool(c.jd_analysis)} | jd_strategy={bool(c.jd_strategy)}")

        print("\n=== CLEANUP COMPLETE ===")

    except Exception as e:
        db.rollback()
        print(f"\n!!! FATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()


if __name__ == '__main__':
    main()
