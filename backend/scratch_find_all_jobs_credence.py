import sys
import os
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
        body = payload.get("body", "")
        if "credence" in subject.lower() or "credence" in body.lower():
            print(f"Job ID: {j.id}")
            print(f"  Subject: {subject!r}")
            print(f"  Status: {j.status}")
            print(f"  Created At: {j.created_at}")
            print(f"  Model used: {j.parsed_output.get('parser_metadata', {}).get('model_used') if j.parsed_output else None}")
            print("-" * 50)
finally:
    db.close()
