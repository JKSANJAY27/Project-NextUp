import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob
from app.services.email_parser import parse_placement_email

db = SessionLocal()
all_jobs = db.query(RawIngestionJob).all()
job = None
for j in all_jobs:
    if j.payload and 'infosys' in j.payload.get('subject', '').lower():
        job = j
        break

if job:
    payload = job.payload or {}
    print(f"Subject: {payload.get('subject')}")
    print("--- Body ---")
    print(payload.get("body", "")[:2000])
    print("--- End Body ---")
    
    # Try parsing
    print("\n--- TRYING PARSE ---")
    try:
        res = parse_placement_email(payload.get("body"), payload.get("subject"))
        print("Result company:", res.get("extracted_data", {}).get("company", {}).get("value"))
        print("Result role:", res.get("extracted_data", {}).get("roles", [{}])[0].get("role", {}).get("value"))
    except Exception as e:
        print("Error parsing:", e)
else:
    print("No Infosys job found")

db.close()
