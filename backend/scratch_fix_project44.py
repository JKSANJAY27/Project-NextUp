"""
Fix Project44 wrong OA date (July 30 instead of something reasonable).
Also relabel the event type since it's a technical discussion, not OA.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from datetime import datetime
from app.core.database import SessionLocal
from app.models.models import Company, CompanyEvent

db = SessionLocal()

p44 = db.query(Company).filter(Company.name == 'Project44').first()
if p44:
    events = db.query(CompanyEvent).filter(
        CompanyEvent.company_id == p44.id
    ).order_by(CompanyEvent.sequence).all()
    
    print("Project44 events:")
    for ev in events:
        pm = ev.parsed_metadata or {}
        print(f"  [{ev.sequence}] {ev.stage} | {ev.date} | label={pm.get('label')}")
    
    # The OA event with 2026-07-30 is suspicious
    # The Project44 email from June 29 likely mentioned hiring rounds but didn't specify July 30
    # This is likely a parsing error - the model may have grabbed a wrong date
    # For now, mark it as no date (null) since we don't have confirmed info
    for ev in events:
        if ev.stage == 'ONLINE_ASSESSMENT' and ev.date:
            # July 30 is 30 days after July 1 - this looks like a wrong parse
            # Check if it's specifically July 30 (likely wrong)
            if ev.date.month == 7 and ev.date.day == 30:
                print(f"Clearing suspicious Project44 OA date: {ev.date}")
                ev.date = None
                pm = dict(ev.parsed_metadata or {})
                pm['label'] = 'Technical Discussion & Hiring Manager Round (via Zoom)'
                pm['venue'] = 'Zoom (Remote)'
                ev.parsed_metadata = pm
                # This is actually a technical interview, not OA
                ev.stage = 'TECHNICAL_INTERVIEW'
                ev.event_type = 'INTERVIEW'
                ev.sequence = 2
                print("Reclassified as TECHNICAL_INTERVIEW (Zoom interview)")
    
    db.commit()
    print("Fixed.")
else:
    print("Project44 not found")

db.close()

# Refresh views
from app.core.database import SessionLocal as SL2
from app.services.gmail_sync import refresh_materialized_views
db2 = SL2()
refresh_materialized_views(db2)
print("Views refreshed.")
db2.close()
