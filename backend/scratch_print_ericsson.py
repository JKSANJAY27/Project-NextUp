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
        if "ericsson" in subject.lower() or "ericsson" in body.lower():
            print(f"=== JOB ID: {j.id} ===")
            print(f"Subject: {subject!r}")
            print("Body (first 1000 chars):")
            print(repr(body[:1000]))
            print("Body (middle 1000 chars around last date):")
            idx = body.lower().find("last date")
            if idx != -1:
                print(repr(body[idx-100:idx+300]))
            else:
                print("Last date not found")
            print("-" * 50)
finally:
    db.close()
