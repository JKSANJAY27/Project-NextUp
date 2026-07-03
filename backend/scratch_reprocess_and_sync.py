import sys
import os
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal
from app.models.models import User, Company, CompanyEvent, CalendarEvent
from app.services.calendar_sync import sync_user_calendar_events

# Run reprocess_all script
print("Running reprocess_all.py...")
import reprocess_all
reprocess_all.main()

db = SessionLocal()
try:
    # 1. Fetch Groww company
    c = db.query(Company).filter(Company.name.like("%GROWW%")).first()
    if not c:
        print("Company GROWW not found.")
        sys.exit(1)
        
    print("\n=== GROWW COMPANY AFTER REPROCESSING ===")
    print(f"Company Name: {c.name}")
    print(f"Registration Deadline: {c.registration_deadline}")
    
    # 2. Fetch milestone events
    print("\n=== GROWW COMPANY EVENTS ===")
    events = db.query(CompanyEvent).filter(CompanyEvent.company_id == c.id).all()
    for e in events:
        print(f"Event ID: {e.id} | Type: {e.event_type} | Stage: {e.stage} | Date: {e.date} | Timestamp: {e.timestamp}")
        print(f"  Parsed Metadata: {e.parsed_metadata}")

    # 3. Fetch users and sync calendar events
    print("\n=== SYNCING CALENDAR EVENTS FOR ALL USERS ===")
    users = db.query(User).all()
    for u in users:
        print(f"Syncing calendar for user: {u.email} (ID: {u.id})")
        sync_user_calendar_events(db, u.id)
        
    # 4. Fetch and print GROWW calendar events for the user
    print("\n=== GROWW CALENDAR EVENTS IN DATABASE ===")
    cal_events = db.query(CalendarEvent).filter(CalendarEvent.company_id == c.id).all()
    for ce in cal_events:
        print(f"CalendarEvent ID: {ce.id}")
        print(f"  Title: {ce.title!r}")
        print(f"  Type: {ce.event_type!r}")
        print(f"  Date: {ce.date} (type: {type(ce.date)})")
        print(f"  Source: {ce.source!r}")
        print(f"  Source Key: {ce.source_key!r}")
        print(f"  Notes: {ce.notes!r}")
        print("-" * 40)
        
finally:
    db.close()
