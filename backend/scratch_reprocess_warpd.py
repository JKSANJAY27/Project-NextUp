import os, sys
from dotenv import load_dotenv
load_dotenv()
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
if sys.platform.startswith('win'):
    sys.stdout.reconfigure(encoding='utf-8')

from sqlalchemy import text
from app.core.database import SessionLocal
from app.models.models import RawIngestionJob, Company, CompanyEvent, CompanyChangeLog

db = SessionLocal()

# Step 1: Delete existing WarpDrive companies (cascade events)
warps = db.query(Company).filter(Company.name.ilike('%warp%')).all()
for w in warps:
    db.query(CompanyEvent).filter(CompanyEvent.company_id == w.id).delete()
    db.query(CompanyChangeLog).filter(CompanyChangeLog.company_id == w.id).delete()
    db.delete(w)
db.commit()
print(f"Deleted {len(warps)} existing WarpDrive entries.")

# Step 2: Reset WarpDrive jobs to pending
warp_job_ids = [
    'e2b34da3-83dc-4b6b-a0da-418cb79f4a10',  # Registration
    '42c274c7-954f-4685-a5d9-cf7918f1f72d',  # OA 1
    'fc330a4f-2c06-47aa-ac70-606ab7feaa92',  # OA 2
    'd7c2dd0c-e627-4722-9a88-7bf48cb5382f',  # OA 3 (Re:)
    '66cd6043-3cc1-4a43-91ae-5fba8e8f4fbd',  # OA 4
]
for jid in warp_job_ids:
    db.execute(text(
        "UPDATE raw_ingestion_jobs SET status='pending', parsed_output=NULL, "
        "validated_output=NULL, locked_at=NULL, locked_by=NULL, error_message=NULL, "
        "processed_at=NULL, retry_count=0 WHERE id=:jid"
    ), {'jid': jid})
db.commit()
print(f"Reset {len(warp_job_ids)} WarpDrive jobs to pending.")

# Step 3: Reprocess
from app.services.gmail_sync import process_queued_jobs, refresh_materialized_views
for i in range(len(warp_job_ids)):
    result = process_queued_jobs(db)
    print(f"  Job {i+1}: success={result}")

# Step 4: Show results
print()
print("WarpDrive companies now:")
db.expire_all()
companies = db.query(Company).filter(Company.name.ilike('%warp%')).order_by(Company.role).all()
for c in companies:
    evts = db.query(CompanyEvent).filter(CompanyEvent.company_id == c.id).all()
    print(f"  '{c.name}' | '{c.role}' | CTC: {c.ctc} | Stipend: {c.stipend}")
    print(f"    Events: {[e.event_type for e in evts]}")

print()
refresh_materialized_views(db)
print("Views refreshed.")
db.close()
