import sys
import os
import json
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob
from app.services.email_parser import extract_placements_regex

db = SessionLocal()
try:
    jobs = db.query(RawIngestionJob).all()
    for j in jobs:
        payload = j.payload or {}
        subject = payload.get("subject", "")
        body = payload.get("body", "")
        if "ericsson" in subject.lower() or "ericsson" in body.lower():
            print(f"=== JOB ID: {j.id} ===")
            res = extract_placements_regex(body, subject)
            print(json.dumps(res, indent=2))
        elif "credence" in subject.lower() or "credence" in body.lower():
            print(f"=== JOB ID: {j.id} ===")
            res = extract_placements_regex(body, subject)
            print(json.dumps(res, indent=2))
finally:
    db.close()
