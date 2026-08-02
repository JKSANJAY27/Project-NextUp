import os, sys
sys.path.insert(0, '.')
from app.core.database import SessionLocal
from app.models.models import Company, CompanyEvent, Application, RawIngestionJob
from datetime import datetime, timezone, timedelta
import json

IST = timezone(timedelta(hours=5, minutes=30))
db = SessionLocal()

# Show Nutanix events with shortlist_sig
nutanix = db.query(Company).filter(Company.name.ilike('%Nutanix%')).first()
print('=== NUTANIX EVENTS ===')
evts = db.query(CompanyEvent).filter(CompanyEvent.company_id == nutanix.id).all()
for e in evts:
    ts = e.timestamp.replace(tzinfo=timezone.utc).astimezone(IST) if e.timestamp else None
    meta = e.parsed_metadata or {}
    sig = meta.get("shortlist_sig")
    sf = meta.get("shortlist_for")
    print(f'  [{ts}] type={e.event_type} stage={e.stage}')
    print(f'    subject: {e.subject}')
    print(f'    shortlist_sig={sig} shortlist_for={sf}')
    print()

print()
print('=== FAILED/PROCESSING JOBS (Nutanix-related) ===')
jobs = db.query(RawIngestionJob).filter(RawIngestionJob.status.in_(['failed', 'processing'])).all()
for j in jobs:
    payload = j.payload or {}
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except:
            pass
    subject = payload.get('subject', '') if isinstance(payload, dict) else ''
    if 'nutanix' in subject.lower():
        ts_ist = j.created_at.replace(tzinfo=timezone.utc).astimezone(IST) if j.created_at else None
        print(f'[{ts_ist}] status={j.status}')
        print(f'  subject: {subject}')
        print(f'  error: {j.error_message}')
        print(f'  retry_count: {j.retry_count}')
        print()

# Check Prodapt - find missed shortlist for OA
print()
print('=== PRODAPT - LOOKING FOR MISSED SHORTLIST ===')
prodapt = db.query(Company).filter(Company.name.ilike('%Prodapt%')).first()
print(f'Prodapt ID: {prodapt.id}')
apps = db.query(Application).filter(Application.company_id == prodapt.id).all()
print(f'Application status: {[(a.status, a.user_decision) for a in apps]}')

# Check if there are jobs related to prodapt shortlist that are in dead_letter or failed
all_jobs = db.query(RawIngestionJob).order_by(RawIngestionJob.created_at.desc()).all()
for j in all_jobs:
    payload = j.payload or {}
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except:
            pass
    subject = payload.get('subject', '') if isinstance(payload, dict) else ''
    if 'prodapt' in subject.lower() and any(kw in subject.lower() for kw in ['shortlist', 'select', 'result']):
        ts_ist = j.created_at.replace(tzinfo=timezone.utc).astimezone(IST) if j.created_at else None
        print(f'  [{ts_ist}] status={j.status} subject={subject[:80]}')
        print(f'    error: {j.error_message}')
