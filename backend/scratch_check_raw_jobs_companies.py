"""
Check raw_ingestion_jobs to map emails to the 4 companies.
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')
from dotenv import load_dotenv
load_dotenv()

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob, Company

db = SessionLocal()

print("=== CURRENT COMPANIES TABLE ===")
companies = db.query(Company).all()
for c in companies:
    print(f"  [{c.id}] name='{c.name}' | role='{c.role}' | cat='{c.category}' | jd_analysis={bool(c.jd_analysis)} | jd_strategy={bool(c.jd_strategy)}")
print(f"\nTotal companies: {len(companies)}")

print("\n=== ALL RAW INGESTION JOBS (ordered by email timestamp) ===")
jobs = db.query(RawIngestionJob).order_by(RawIngestionJob.created_at.asc()).all()
print(f"Total raw_ingestion_jobs: {len(jobs)}\n")

TARGET_KEYWORDS = ['project44', 'value lab', 'valuelab', 'groww', 'infosys']

print("--- FILTERING FOR 4 TARGET COMPANIES ---")
for j in jobs:
    subject = ""
    ts = ""
    if j.payload:
        subject = j.payload.get("subject", "")
        ts = j.payload.get("timestamp", "")[:19]
    
    subj_lower = subject.lower()
    matched = any(k in subj_lower for k in TARGET_KEYWORDS)
    if matched:
        print(f"  [MATCH] [{ts}] status={j.status:12s} | id={j.id} | subject={subject[:100]}")

print("\n--- ALL JOBS WITH TIMESTAMPS (for date filtering) ---")
for j in jobs:
    subject = ""
    ts = ""
    if j.payload:
        subject = j.payload.get("subject", "")[:80]
        ts = j.payload.get("timestamp", "")[:19]
    # Replace special chars for display
    subject = subject.encode('ascii', errors='replace').decode('ascii')
    print(f"  [{ts}] {j.status:12s} | {subject}")

db.close()
