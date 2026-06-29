"""
Trigger immediate processing of all pending raw ingestion jobs.
Processes ONE at a time (as the queue processor normally does), but runs in a loop.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from app.core.database import SessionLocal
from app.services.gmail_sync import process_queued_jobs
from app.models.models import RawIngestionJob

def count_pending(db):
    return db.query(RawIngestionJob).filter(RawIngestionJob.status == 'pending').count()

print("Starting batch re-processing of pending jobs...")
db = SessionLocal()
try:
    total = count_pending(db)
    print(f"Pending jobs to process: {total}")
finally:
    db.close()

processed = 0
failed = 0
consecutive_errors = 0
while True:
    db = SessionLocal()
    try:
        pending = count_pending(db)
        if pending == 0:
            break
        print(f"\n[{processed + failed + 1}/{total}] Processing next job... ({pending} remaining)")
        result = process_queued_jobs(db)
        if result:
            processed += 1
            consecutive_errors = 0
        else:
            # No job was processed (either none pending or lock contention)
            break
    except Exception as e:
        print(f"  JOB ERROR (continuing): {e}")
        failed += 1
        consecutive_errors += 1
        if consecutive_errors >= 5:
            print("  Too many consecutive errors, stopping.")
            break
    finally:
        db.close()


print(f"\n=== Done! Processed: {processed}, Failed: {failed} ===")
