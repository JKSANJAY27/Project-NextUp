import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob

db = SessionLocal()
job = db.query(RawIngestionJob).filter(RawIngestionJob.id == '7d110017-1763-4f84-be84-79d860f766d7').first()
if job:
    print("Subject:", job.payload.get('subject'))
    print("Status:", job.status)
else:
    print("Job not found")

pending_jobs = db.query(RawIngestionJob).filter(RawIngestionJob.status == 'pending').all()
print("Pending jobs count:", len(pending_jobs))
for pj in pending_jobs:
    print(f"- {pj.id}: {pj.payload.get('subject')}")

db.close()
