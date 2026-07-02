import sys
import os
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob, Company, IngestionExecutionLog
import json

db = SessionLocal()
try:
    c = db.query(Company).filter(Company.id == "79eb1639-9668-460a-a8bf-759d57e9ea51").first()
    if c:
        print(f"Company ID: {c.id} | Name: {c.name!r} | Fingerprint: {c.fingerprint!r}")
        # Find any execution logs that mention this company
        logs = db.query(IngestionExecutionLog).filter(
            IngestionExecutionLog.message.like(f"%79eb1639-9668-%") | 
            IngestionExecutionLog.message.like(f"%{c.name[:20]}%")
        ).all()
        print(f"Found {len(logs)} execution logs:")
        for l in logs:
            print(f"  Job ID: {l.job_id} | Stage: {l.stage} | Status: {l.status} | Timestamp: {l.timestamp}")
            print(f"  Message: {l.message!r}")
            # print the job details
            j = db.query(RawIngestionJob).filter(RawIngestionJob.id == l.job_id).first()
            if j:
                print(f"    Job Subject: {j.payload.get('subject')!r} | Status: {j.status} | Classification: {j.final_classification}")
    else:
        print("Company not found.")
finally:
    db.close()
