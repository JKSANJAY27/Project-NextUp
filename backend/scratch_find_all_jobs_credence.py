import sys
import os
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob
import json

db = SessionLocal()
try:
    jobs = db.query(RawIngestionJob).filter(
        RawIngestionJob.status != "pending"
    ).all()
    print(f"Total non-pending jobs: {len(jobs)}")
    for j in jobs:
        payload = j.payload
        subject = payload.get("subject", "")
        if "GROWW" in subject or "Super Dream" in subject:
            print(f"Job ID: {j.id} | Status: {j.status} | Created At: {j.created_at}")
            print(f"  Subject: {subject!r}")
            print(f"  Final Classification: {j.final_classification}")
            print("  Parsed Output:")
            print(json.dumps(j.parsed_output, indent=2))
            print("  Validated Output:")
            print(json.dumps(j.validated_output, indent=2))
            print("-" * 50)
finally:
    db.close()
