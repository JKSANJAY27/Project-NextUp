import sys
import os
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal
from app.models.models import CompanyEvent
from app.services.email_parser import parse_placement_email
import json

db = SessionLocal()
try:
    e = db.query(CompanyEvent).filter(CompanyEvent.id == "4c525724-6762-4111-8ba6-cac8779002df").first()
    if e:
        print("=== EVENT BODY ===")
        print(repr(e.body))
        print("=== EVENT PARSED ===")
        parsed = parse_placement_email(e.body, e.subject)
        print(json.dumps(parsed, indent=2))
    else:
        print("Event not found.")
finally:
    db.close()
