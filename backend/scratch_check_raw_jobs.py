import sys
import json
sys.stdout.reconfigure(encoding='utf-8')

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob

db = SessionLocal()
try:
    jobs = db.query(RawIngestionJob).all()
    for j in jobs:
        payload = j.payload or {}
        subject = payload.get("subject", "")
        if "Tube Products" in subject or "Tube Products" in str(j.parsed_output):
            print("====================================")
            print(f"Job ID: {j.id}, Status: {j.status}")
            print(f"Subject: {subject}")
            print(f"Payload body: {payload.get('body')[:500]}...")
            print(f"Parsed Output: {json.dumps(j.parsed_output, indent=2)}")
            print(f"Validated Output: {json.dumps(j.validated_output, indent=2)}")
            print(f"Error Message: {j.error_message}")
            print("====================================")
finally:
    db.close()
