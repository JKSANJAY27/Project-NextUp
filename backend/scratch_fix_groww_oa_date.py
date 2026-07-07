"""
Fix GROWW ONLINE_ASSESSMENT milestone with correct date/time/venue
from the 'Groww Online Test Is Scheduled On 08-07-2026 at 2.30pm @ PRP 717' email.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from datetime import datetime
from app.core.database import SessionLocal
from app.models.models import Company, CompanyEvent

db = SessionLocal()

groww = db.query(Company).filter(Company.name == 'GROWW').first()
if groww:
    oa_event = db.query(CompanyEvent).filter(
        CompanyEvent.company_id == groww.id,
        CompanyEvent.stage == 'ONLINE_ASSESSMENT'
    ).first()
    
    if oa_event:
        print(f"Current OA event: date={oa_event.date} | venue={oa_event.parsed_metadata}")
        # Fix date: July 8, 2026 at 14:30 (2:30 PM) IST = 09:00 UTC
        # The email said "2.30pm @ PRP 717"
        # Store in UTC: 2:30 PM IST = 9:00 AM UTC
        oa_event.date = datetime(2026, 7, 8, 9, 0, 0)  # 2:30 PM IST = 9:00 AM UTC
        pm = dict(oa_event.parsed_metadata or {})
        pm['venue'] = 'PRP 717 (Venue as per CDC)'
        pm['label'] = 'Online Test'
        oa_event.parsed_metadata = pm
        db.commit()
        print(f"Fixed: date=2026-07-08 09:00:00 UTC (2:30 PM IST) | venue=PRP 717")
    else:
        print("OA event not found!")
else:
    print("GROWW not found!")

db.close()

# Also refresh views
from app.core.database import SessionLocal as SL2
from app.services.gmail_sync import refresh_materialized_views
db2 = SL2()
refresh_materialized_views(db2)
print("Views refreshed.")
db2.close()
