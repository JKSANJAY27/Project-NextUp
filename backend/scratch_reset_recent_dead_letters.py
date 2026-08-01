"""
Reset recent dead_letter and failed ingestion jobs back to 'pending' so they
get re-processed now that the email_parser settings bug is fixed.

Only resets jobs created in the last 7 days (all the ones that hit the bug).
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from datetime import datetime, timedelta
from app.core.database import SessionLocal
from app.models.models import RawIngestionJob

db = SessionLocal()
try:
    cutoff = datetime.utcnow() - timedelta(days=7)
    jobs = db.query(RawIngestionJob).filter(
        RawIngestionJob.status.in_(['dead_letter', 'failed']),
        RawIngestionJob.created_at >= cutoff,
        # Only reset jobs that hit the "settings" bug (not other failures)
        RawIngestionJob.error_message == "name 'settings' is not defined"
    ).order_by(RawIngestionJob.created_at.asc()).all()

    print(f"\nFound {len(jobs)} jobs to reset (dead_letter/failed with settings bug, last 7 days):")
    for j in jobs:
        subj = j.payload.get('subject', 'N/A') if j.payload else 'N/A'
        ts = j.created_at.strftime('%Y-%m-%d %H:%M') if j.created_at else 'N/A'
        print(f"  [{ts}] {j.status:12s} | {subj[:80]}")

    print(f"\nResetting {len(jobs)} jobs to 'pending'...")
    for j in jobs:
        j.status = 'pending'
        j.locked_at = None
        j.locked_by = None
        j.processed_at = None
        j.retry_count = 0
        j.error_message = None
        # Keep parsed_output/validated_output cleared so fresh parse happens
        j.parsed_output = None
        j.validated_output = None

    db.commit()
    print(f"\n[OK] Successfully reset {len(jobs)} jobs to 'pending'.")
    print("     They will be reprocessed on the next cron tick (every 5 min).")
    print("     Or trigger /api/v1/gmail/reprocess_all to process immediately.")

except Exception as e:
    db.rollback()
    print(f"[ERROR] {e}")
    import traceback; traceback.print_exc()
finally:
    db.close()
