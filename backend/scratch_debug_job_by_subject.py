import sys
import os
import json
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob

db = SessionLocal()
try:
    jobs = db.query(RawIngestionJob).all()
    for j in jobs:
        payload = j.payload or {}
        subject = payload.get("subject", "")
        if "online test is scheduled on 23-06-2026" in subject.lower():
            print(f"Job ID: {j.id}")
            print(f"Subject: {subject!r}")
            print(f"Status: {j.status}")
            print(f"Parsed Output: {json.dumps(j.parsed_output, indent=2)}")
            print("-" * 50)
finally:
    db.close()
