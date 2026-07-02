import sys
import os
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal
from app.models.models import Company, CompanyEvent
import json

db = SessionLocal()
try:
    c = db.query(Company).filter(Company.name.like("%Super Dream%")).first()
    if c:
        print(f"Company: {c.name!r} | ID: {c.id}")
        events = db.query(CompanyEvent).filter(CompanyEvent.company_id == c.id).all()
        for e in events:
            print(f"Event ID: {e.id}")
            print(f"  Type: {e.event_type!r}")
            print(f"  Subject: {e.subject!r}")
            print(f"  Timestamp: {e.timestamp}")
            print(f"  Parsed Metadata: {e.parsed_metadata}")
            print("-" * 30)
    else:
        print("Not found.")
finally:
    db.close()
