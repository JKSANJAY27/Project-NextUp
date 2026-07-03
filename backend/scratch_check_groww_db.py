import sys
import os
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal
from app.models.models import Company, CompanyEvent

db = SessionLocal()
try:
    c = db.query(Company).filter(Company.name.like("%GROWW%")).first()
    if c:
        print("GROWW Company:")
        print(f"  ID: {c.id}")
        print(f"  registration_deadline: {c.registration_deadline} (type: {type(c.registration_deadline)})")
        
        events = db.query(CompanyEvent).filter(CompanyEvent.company_id == c.id).all()
        for e in events:
            print(f"  Event ID: {e.id}")
            print(f"    event_type: {e.event_type}")
            print(f"    stage: {e.stage}")
            print(f"    date: {e.date} (type: {type(e.date)})")
            print(f"    timestamp: {e.timestamp}")
            print(f"    parsed_metadata: {e.parsed_metadata}")
    else:
        print("Company GROWW not found.")
finally:
    db.close()
