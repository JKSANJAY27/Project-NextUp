import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob

db = SessionLocal()
all_jobs = db.query(RawIngestionJob).all()
for j in all_jobs:
    if j.payload and 'infosys' in j.payload.get('subject', '').lower():
        print(f"ID: {j.id}")
        print(f"Subject: {j.payload.get('subject')}")
        print(f"Status: {j.status}")
        print(f"Parsed: {j.parsed_output is not None}")
        print(f"Validated: {j.validated_output is not None}")
        if j.validated_output:
            ext = j.validated_output.get("extracted_data", {})
            print(f"  Company: {ext.get('company')}")
            print(f"  Event Type: {ext.get('event_type')}")
            roles = ext.get('roles', [])
            print(f"  Roles count: {len(roles)}")
            for r in roles:
                print(f"    Role: {r.get('role')}")
        print()
db.close()
