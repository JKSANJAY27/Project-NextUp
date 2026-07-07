import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob
from app.services.gmail_sync import process_queued_jobs

db = SessionLocal()

# Find and reset the failed Infosys job
job = db.query(RawIngestionJob).filter(RawIngestionJob.id == '95dde53d-d70c-48d9-9751-54abe51136c2').first()
if job:
    print(f"Found job: {job.id}")
    print(f"Current status: {job.status}")
    print(f"Error: {job.error_message}")
    job.status = 'pending'
    job.retry_count = 0
    job.error_message = None
    job.locked_at = None
    job.locked_by = None
    job.parsed_output = None
    job.validated_output = None
    db.commit()
    print("Reset to pending")
    
    print("\nProcessing...")
    success = process_queued_jobs(db)
    print(f"Success: {success}")
    
    db.expire_all()
    job = db.query(RawIngestionJob).filter(RawIngestionJob.id == '95dde53d-d70c-48d9-9751-54abe51136c2').first()
    if job and job.validated_output:
        ext = job.validated_output.get('extracted_data', {})
        print(f"Company: {ext.get('company', {}).get('value')}")
        print(f"Event: {ext.get('event_type', {}).get('value')}")
    print(f"Status: {job.status if job else '?'}")
else:
    print("Job not found!")

db.close()
