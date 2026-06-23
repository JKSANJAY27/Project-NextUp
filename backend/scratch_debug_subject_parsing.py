import sys
import os
import re
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal
from app.models.models import Company, RawIngestionJob
from app.services.email_parser import extract_company_from_subject

db = SessionLocal()
try:
    print("=== SUBJECT PARSING TEST ON RAW JOBS ===")
    jobs = db.query(RawIngestionJob).all()
    for j in jobs:
        payload = j.payload or {}
        subject = payload.get("subject", "")
        extracted = extract_company_from_subject(subject)
        print(f"Subject: {subject!r} -> Extracted: {extracted!r}")
finally:
    db.close()
