"""
Re-run already-completed jobs for GROWW to fix milestone stage reclassification.
The Groww OA update email already completed, but the stage may have been stored as
REGISTRATION instead of ONLINE_ASSESSMENT. Reprocess to apply new reclassification logic.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob, Company, CompanyEvent

db = SessionLocal()

# Check current GROWW milestones
groww = db.query(Company).filter(Company.name == 'GROWW').first()
if groww:
    print(f"GROWW company: {groww.id}")
    events = db.query(CompanyEvent).filter(CompanyEvent.company_id == groww.id).order_by(CompanyEvent.sequence).all()
    print(f"Timeline milestones ({len(events)}):")
    for ev in events:
        print(f"  [{ev.sequence}] stage={ev.stage} | event_type={ev.event_type} | date={ev.date} | label={ev.parsed_metadata.get('label') if ev.parsed_metadata else None}")
    
    # Find the OA event that was misclassified - look for REGISTRATION with OA-like label
    misclassified = []
    for ev in events:
        pm = ev.parsed_metadata or {}
        label_lower = (pm.get('label') or '').lower()
        if ev.stage == 'REGISTRATION' and any(kw in label_lower for kw in ['online test', 'oa', 'assessment', 'test']):
            misclassified.append(ev)
            print(f"\n  --> MISCLASSIFIED: {ev.id} | stage={ev.stage} | label={pm.get('label')}")
    
    if misclassified:
        for ev in misclassified:
            print(f"  Reclassifying {ev.id} from REGISTRATION to ONLINE_ASSESSMENT")
            ev.stage = 'ONLINE_ASSESSMENT'
            ev.event_type = 'OA'
            # Fix sequence - OA should be seq 2
            if not ev.sequence:
                ev.sequence = 2
        db.commit()
        print("Reclassification done.")
    else:
        print("\n  No misclassified milestones found.")
else:
    print("GROWW company not found!")

db.close()
