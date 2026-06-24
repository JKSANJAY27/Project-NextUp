import os, sys
from dotenv import load_dotenv
load_dotenv()
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

if sys.platform.startswith('win'):
    sys.stdout.reconfigure(encoding='utf-8')

from app.core.database import SessionLocal
from app.models.models import PendingCompanyEvent, Company, CompanyEvent, RawIngestionJob

db = SessionLocal()

print("=" * 60)
print("PENDING COMPANY EVENTS")
print("=" * 60)
pending = db.query(PendingCompanyEvent).all()
print(f"Total PendingCompanyEvents: {len(pending)}")
print()

by_status = {}
for pe in pending:
    by_status.setdefault(pe.status, []).append(pe)

for status, items in by_status.items():
    print(f"  [{status}] — {len(items)} entries:")
    for pe in items:
        job = db.query(RawIngestionJob).filter(RawIngestionJob.id == pe.raw_ingestion_job_id).first()
        subj = job.payload.get("subject", "?") if job else "?"
        print(f"    • {pe.company_name} / {pe.role_name} | Type: {pe.event_type} | Subject: {subj[:70]}")
    print()

print("=" * 60)
print("COMPANY REGISTRY SUMMARY")
print("=" * 60)
companies = db.query(Company).order_by(Company.name).all()
print(f"Total Companies: {len(companies)}")
print()
for c in companies:
    events = db.query(CompanyEvent).filter(CompanyEvent.company_id == c.id).all()
    etypes = ", ".join(sorted(set(e.event_type for e in events)))
    ctc_display = c.ctc or "(none)"
    branches = ", ".join(c.eligible_branches) if c.eligible_branches else "(none)"
    print(f"  {c.name} | {c.role} | CTC: {ctc_display} | Events: {etypes}")
    print(f"    Branches: {branches}")

print()
print("=" * 60)
print("JOBS BY STATUS")
print("=" * 60)
from sqlalchemy import func
rows = db.execute(__import__("sqlalchemy").text(
    "SELECT status, COUNT(*) FROM raw_ingestion_jobs GROUP BY status ORDER BY status"
)).fetchall()
for row in rows:
    print(f"  {row[0]}: {row[1]}")

db.close()
