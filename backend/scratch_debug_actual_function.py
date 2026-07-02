import sys
import os
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal
from app.models.models import Company, CompanyEvent
from app.services.email_parser import parse_placement_email
import json

db = SessionLocal()
try:
    c = db.query(Company).filter(Company.name.like("%Super Dream%")).first()
    if c:
        print(f"Company Name in DB: {c.name!r}")
        print(f"Role: {c.role!r}")
        print(f"CTC: {c.ctc!r}")
        print(f"Stipend: {c.stipend!r}")
        
        # Get the first event (email)
        event = db.query(CompanyEvent).filter(CompanyEvent.company_id == c.id).first()
        if event:
            print(f"Event Type: {event.event_type!r}")
            print(f"Subject: {event.subject!r}")
            print(f"Body snippet:\n{event.body[:500]}\n...")
            
            # Reprocess the exact body and subject
            reparsed = parse_placement_email(event.body, event.subject)
            print("=== REPARSED FROM EVENT BODY ===")
            print(json.dumps(reparsed, indent=2))
        else:
            print("No events found for this company.")
    else:
        print("No company matching 'Super Dream' found in DB.")
finally:
    db.close()
