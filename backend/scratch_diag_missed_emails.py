"""
Diagnosis: Find missed/failed ingestion jobs for Nutanix, Prodapt, IDFC.
Also checks current application status and event history.
"""
import os, sys
sys.path.insert(0, '.')
from app.core.database import SessionLocal
from app.models.models import RawIngestionJob, Company, CompanyEvent, Application
from datetime import datetime, timezone, timedelta
import json

IST = timezone(timedelta(hours=5, minutes=30))
db = SessionLocal()

TARGET_COMPANIES = ['nutanix', 'prodapt', 'idfc']

print("=" * 70)
print("RECENT INGESTION JOBS (last 100)")
print("=" * 70)
jobs = db.query(RawIngestionJob).order_by(RawIngestionJob.created_at.desc()).limit(100).all()

found_jobs = []
for j in jobs:
    ts_ist = j.created_at.replace(tzinfo=timezone.utc).astimezone(IST) if j.created_at else None
    payload = j.payload or {}
    if isinstance(payload, str):
        try: payload = json.loads(payload)
        except: pass
    subject = payload.get('subject', '') if isinstance(payload, dict) else ''
    subject_lower = subject.lower()
    if any(k in subject_lower for k in TARGET_COMPANIES):
        found_jobs.append(j)
        print(f"[{ts_ist}] status={j.status}")
        print(f"  subject: {subject[:80]}")
        if j.error_message:
            print(f"  ERROR: {j.error_message[:150]}")
        print()

print(f"Total relevant jobs found: {len(found_jobs)}")

print()
print("=" * 70)
print("ALL INGESTION JOBS STATUS SUMMARY")
print("=" * 70)
all_statuses = db.query(RawIngestionJob.status).all()
from collections import Counter
counts = Counter(s[0] for s in all_statuses)
for status, count in sorted(counts.items()):
    print(f"  {status}: {count}")

print()
print("=" * 70)
print("FAILED / DEAD_LETTER JOBS (recent)")
print("=" * 70)
failed = db.query(RawIngestionJob).filter(
    RawIngestionJob.status.in_(['failed', 'dead_letter', 'error'])
).order_by(RawIngestionJob.created_at.desc()).limit(20).all()
for j in failed:
    ts_ist = j.created_at.replace(tzinfo=timezone.utc).astimezone(IST) if j.created_at else None
    payload = j.payload or {}
    if isinstance(payload, str):
        try: payload = json.loads(payload)
        except: pass
    subject = payload.get('subject', '') if isinstance(payload, dict) else ''
    print(f"[{ts_ist}] status={j.status} source_id={j.source_id}")
    print(f"  subject: {subject[:80]}")
    if j.error_message:
        print(f"  error: {j.error_message[:150]}")
    print()

print()
print("=" * 70)
print("NUTANIX EVENTS DETAIL (checking shortlist_sig)")
print("=" * 70)
nutanix = db.query(Company).filter(Company.name.ilike('%Nutanix%')).first()
if nutanix:
    evts = db.query(CompanyEvent).filter(CompanyEvent.company_id == nutanix.id).all()
    for e in evts:
        ts_ist = e.timestamp.replace(tzinfo=timezone.utc).astimezone(IST) if e.timestamp else None
        meta = e.parsed_metadata or {}
        print(f"[{ts_ist}] type={e.event_type} stage={e.stage}")
        print(f"  subject: {repr(e.subject[:70]) if e.subject else None}")
        if meta:
            print(f"  metadata: shortlist_sig={meta.get('shortlist_sig')} shortlist_for={meta.get('shortlist_for')}")
        print()
