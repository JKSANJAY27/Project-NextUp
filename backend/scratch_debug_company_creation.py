import sys
import os
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal
from app.models.models import Company, CompanyEvent, RawIngestionJob

db = SessionLocal()
try:
    c = db.query(Company).filter(Company.name == "Name of the Company").first()
    if c:
        print(f"Company ID: {c.id}")
        print(f"Name: {c.name}")
        print(f"Role: {c.role}")
        print(f"Category: {c.category}")
        print(f"CTC: {c.ctc}")
        print(f"Stipend: {c.stipend}")
        print(f"Fingerprint: {c.fingerprint}")
        print(f"Created At: {c.created_at}")
        
        events = db.query(CompanyEvent).filter(CompanyEvent.company_id == c.id).all()
        print(f"Found {len(events)} events linked:")
        for e in events:
            print(f"  - Event ID: {e.id}")
            print(f"    Type: {e.event_type}")
            print(f"    Subject: {e.subject!r}")
            print(f"    Timestamp: {e.timestamp}")
            print(f"    Body (first 500 chars):")
            print(repr(e.body[:500]))
            print("-" * 30)
    else:
        print("Company 'Name of the Company' not found!")
finally:
    db.close()
