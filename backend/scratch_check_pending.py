import sys
import os
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal
from app.models.models import PendingCompanyEvent, CompanyEvent
import json

db = SessionLocal()
try:
    print("=== PENDING COMPANY EVENTS ===")
    pes = db.query(PendingCompanyEvent).all()
    for pe in pes:
        print(f"ID: {pe.id} | Job ID: {pe.raw_ingestion_job_id} | Company: {pe.company_name!r} | Event: {pe.event_type} | Status: {pe.status}")
        
    print("\n=== COMPANY EVENTS ===")
    events = db.query(CompanyEvent).all()
    for e in events:
        if "GROWW" in e.subject or "Super Dream" in e.subject:
            print(f"ID: {e.id} | CoID: {e.company_id} | Type: {e.event_type} | Subject: {e.subject!r}")
            print(f"  Parsed Metadata: {e.parsed_metadata}")
            
finally:
    db.close()
