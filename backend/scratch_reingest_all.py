"""
Re-ingestion script: resets completed/failed raw_ingestion_jobs back to 'pending'
so they get re-processed by the queue processor with the updated parser.

Usage:
  # Dry run (shows what would be reset):
  venv/Scripts/python scratch_reingest_all.py --dry-run

  # Reset only drive-related jobs (not announcements):
  venv/Scripts/python scratch_reingest_all.py --drives-only

  # Reset ALL jobs (drives + announcements):
  venv/Scripts/python scratch_reingest_all.py --all

  # Reset a specific job by ID:
  venv/Scripts/python scratch_reingest_all.py --job-id <uuid>

After running this script, the queue processor will re-process on the next
scheduler tick (every 5 minutes) OR you can call:
  POST /api/v1/admin/process-jobs
to trigger immediately.
"""
import sys
import os
import argparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob, Company, CompanyEvent, CompanyChangeLog, Announcement

def reset_jobs(dry_run: bool, drives_only: bool, job_id: str = None):
    db = SessionLocal()
    try:
        if job_id:
            jobs = db.query(RawIngestionJob).filter(RawIngestionJob.id == job_id).all()
            if not jobs:
                print(f"[ERROR] Job {job_id} not found.")
                return
        else:
            query = db.query(RawIngestionJob).filter(
                RawIngestionJob.status.in_(['completed', 'failed', 'dead_letter'])
            )
            if drives_only:
                # Only reset jobs that were NOT processed as GENERAL_ANNOUNCEMENT
                # i.e., jobs whose validated_output has a company/event_type
                jobs = []
                for j in query.all():
                    vo = j.validated_output or {}
                    cat = vo.get('extracted_data', {}).get('email_category', '')
                    if cat != 'GENERAL_ANNOUNCEMENT':
                        jobs.append(j)
            else:
                jobs = query.all()

        print(f"\n{'[DRY RUN] ' if dry_run else ''}Found {len(jobs)} job(s) to reset.\n")

        companies_to_delete = set()
        events_to_delete = set()

        for j in jobs:
            vo = j.validated_output or {}
            cat = vo.get('extracted_data', {}).get('email_category', '')
            company_name = vo.get('extracted_data', {}).get('company', {}).get('value', 'N/A')
            print(f"  Job {j.id} | Status: {j.status} | Category: {cat} | Company: {company_name}")

            if not dry_run:
                # Collect company records to purge (we will recreate them on re-ingest)
                # Find company events linked to this job's ingestion time
                # NOTE: We use timestamp matching since we don't store job→event linkage directly
                # Instead, we delete companies that were ONLY created from this job
                # For safety, just reset the job status and let re-processing overwrite/merge
                j.status = 'pending'
                j.locked_at = None
                j.locked_by = None
                j.processed_at = None
                j.retry_count = 0
                j.error_message = None
                j.parsed_output = None
                j.validated_output = None

        if not dry_run:
            db.commit()
            print(f"\n[OK] Reset {len(jobs)} job(s) to 'pending'. They will be reprocessed on the next queue tick.")
            print("     Run: POST /api/v1/admin/process-jobs  to trigger immediately.")
        else:
            print(f"\n[DRY RUN] No changes made. Remove --dry-run to proceed.")

    except Exception as e:
        db.rollback()
        print(f"[ERROR] {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()


def show_current_stats():
    db = SessionLocal()
    try:
        from sqlalchemy import func
        stats = db.query(
            RawIngestionJob.status,
            func.count(RawIngestionJob.id).label('count')
        ).group_by(RawIngestionJob.status).all()

        print("\n--- Current Raw Ingestion Jobs Status ---")
        total = 0
        for status, count in stats:
            print(f"  {status:20s}: {count}")
            total += count
        print(f"  {'TOTAL':20s}: {total}")

        company_count = db.query(Company).count()
        event_count = db.query(CompanyEvent).count()
        ann_count = db.query(Announcement).count()
        print(f"\n  Companies in DB : {company_count}")
        print(f"  Events in DB    : {event_count}")
        print(f"  Announcements   : {ann_count}")
        print("-" * 45)
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Re-ingest raw email jobs")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--dry-run', action='store_true', help='Show what would be reset without making changes')
    group.add_argument('--drives-only', action='store_true', help='Reset only drive-related jobs (not announcements)')
    group.add_argument('--all', action='store_true', help='Reset all completed/failed jobs')
    group.add_argument('--job-id', type=str, help='Reset a specific job by ID')
    args = parser.parse_args()

    show_current_stats()

    if args.dry_run:
        reset_jobs(dry_run=True, drives_only=False)
    elif args.drives_only:
        reset_jobs(dry_run=False, drives_only=True)
    elif args.all:
        reset_jobs(dry_run=False, drives_only=False)
    elif args.job_id:
        reset_jobs(dry_run=False, drives_only=False, job_id=args.job_id)
