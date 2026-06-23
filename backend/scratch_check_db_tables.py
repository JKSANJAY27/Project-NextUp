import sys
import os
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal
from app.models.models import Company, CompanyEvent

db = SessionLocal()
try:
    print("=== COMPANIES IN DATABASE ===")
    companies = db.query(Company).all()
    for c in companies:
        print(f"Company ID: {c.id}")
        print(f"  Name: {c.name!r}")
        print(f"  Role: {c.role!r}")
        print(f"  Category: {c.category!r}")
        print(f"  CTC: {c.ctc!r}")
        print(f"  Stipend: {c.stipend!r}")
        print(f"  Location: {c.job_location!r}")
        print(f"  Branches: {c.eligible_branches}")
        print(f"  Rules: {c.eligibility_rules}")
        print(f"  Deadline: {c.registration_deadline}")
        print(f"  Link: {c.registration_link!r}")
        print(f"  Website: {c.website!r}")
        print(f"  Eligibility Text: {c.eligibility_raw_text!r}")
        
        # Events
        events = db.query(CompanyEvent).filter(CompanyEvent.company_id == c.id).all()
        print("  Events:")
        for e in events:
            print(f"    - Event ID: {e.id} | Type: {e.event_type} | Timestamp: {e.timestamp}")
        print("-" * 50)
finally:
    db.close()
