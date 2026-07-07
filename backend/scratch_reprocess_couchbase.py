"""
Reset Couchbase dead_letter job and reprocess it.
The job was dead_lettered by the old historical filter (July 7 cutoff).
After the fix to June 29 cutoff, it should process fine.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob
from app.services.gmail_sync import process_queued_jobs

db = SessionLocal()

# Find Couchbase job
couchbase_job = None
jobs = db.query(RawIngestionJob).filter(RawIngestionJob.status == 'dead_letter').all()
for j in jobs:
    subj = (j.payload or {}).get('subject', '')
    if 'couchbase' in subj.lower():
        couchbase_job = j
        break

if not couchbase_job:
    print("Couchbase job not found in dead_letter. Checking all statuses...")
    for j in db.query(RawIngestionJob).all():
        subj = (j.payload or {}).get('subject', '')
        if 'couchbase' in subj.lower():
            print(f"  Found: [{j.status}] {subj} | id={j.id}")
            couchbase_job = j
            break

if couchbase_job:
    print(f"Found Couchbase job: {couchbase_job.id}")
    print(f"Subject: {(couchbase_job.payload or {}).get('subject')}")
    print(f"Timestamp: {(couchbase_job.payload or {}).get('timestamp')}")
    print(f"Current status: {couchbase_job.status}")
    
    # Reset to pending
    couchbase_job.status = 'pending'
    couchbase_job.retry_count = 0
    couchbase_job.error_message = None
    couchbase_job.locked_at = None
    couchbase_job.locked_by = None
    couchbase_job.parsed_output = None
    couchbase_job.validated_output = None
    db.commit()
    print("Reset to pending. Processing...")
    
    result = process_queued_jobs(db)
    print(f"Process result: {result}")
    
    db.expire_all()
    couchbase_job = db.query(RawIngestionJob).filter(RawIngestionJob.id == couchbase_job.id).first()
    if couchbase_job and couchbase_job.validated_output:
        ext = couchbase_job.validated_output.get('extracted_data', {})
        company = ext.get('company', {}).get('value', 'N/A')
        event_type = ext.get('event_type', {}).get('value', 'N/A')
        print(f"Company: {company}")
        print(f"Event: {event_type}")
    print(f"Final status: {couchbase_job.status if couchbase_job else '?'}")
else:
    print("Couchbase job NOT found!")

db.close()
