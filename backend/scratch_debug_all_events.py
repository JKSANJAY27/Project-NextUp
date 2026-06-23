import sys
import os
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal
from app.models.models import CompanyEvent, Company

db = SessionLocal()
try:
    events = db.query(CompanyEvent).all()
    print(f"Total company events: {len(events)}")
    for e in events:
        if "credence" in e.subject.lower() or "credence" in e.body.lower():
            c = db.query(Company).filter(Company.id == e.company_id).first()
            comp_name = c.name if c else "Unknown"
            print(f"Event ID: {e.id}")
            print(f"  Company Name: {comp_name}")
            print(f"  Event Type: {e.event_type}")
            print(f"  Subject: {e.subject!r}")
            print(f"  Body snippet: {repr(e.body[:150])}")
            print("-" * 50)
finally:
    db.close()
