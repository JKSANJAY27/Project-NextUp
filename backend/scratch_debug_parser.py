import sys
import json
import os
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob

db = SessionLocal()
try:
    jobs = db.query(RawIngestionJob).all()
    print(f"Total jobs: {len(jobs)}")
    for j in jobs:
        payload = j.payload or {}
        subject = payload.get("subject", "")
        body = payload.get("body", "")
        
        # Check if Ericsson or Credence
        is_ericsson = "ericsson" in subject.lower() or "ericsson" in body.lower()
        is_credence = "credence" in subject.lower() or "credence" in body.lower()
        
        if is_ericsson or is_credence:
            print("====================================")
            print(f"Job ID: {j.id}, Status: {j.status}")
            print(f"Subject: {subject}")
            print("----------------- BODY -----------------")
            print(body[:2000])
            print("----------------------------------------")
            print(f"Parsed Output: {json.dumps(j.parsed_output, indent=2)}")
            print(f"Validated Output: {json.dumps(j.validated_output, indent=2)}")
            print("====================================\n")
finally:
    db.close()
