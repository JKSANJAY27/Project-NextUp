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
        val_out = j.validated_output or {}
        ext = val_out.get("extracted_data", {})
        comp = ext.get("company", {}).get("value")
        if comp == "Name of the Company" or (j.parsed_output and j.parsed_output.get("extracted_data", {}).get("company", {}).get("value") == "Name of the Company"):
            print(f"=== JOB ID: {j.id} ===")
            print(f"Subject: {j.payload.get('subject')}")
            print(f"Status: {j.status}")
            print("Body (first 500 chars):")
            print(repr(j.payload.get('body')[:500]))
            print("-" * 50)
finally:
    db.close()
