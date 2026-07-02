import sys
import os
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob, Company
import json

db = SessionLocal()
try:
    # Find jobs containing "Super Dream Placement" or "GROWW" in payload
    jobs = db.query(RawIngestionJob).all()
    print(f"Total Ingestion Jobs: {len(jobs)}")
    for j in jobs:
        payload = j.payload
        subject = payload.get("subject", "")
        if "GROWW" in subject or "Super Dream Placement / Internship - 2027 Batch" in subject:
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
