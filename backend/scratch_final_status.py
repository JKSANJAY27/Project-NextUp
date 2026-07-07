import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob, Company

db = SessionLocal()

print("=== ALL COMPANIES ===")
companies = db.query(Company).all()
for c in companies:
    print(f"  [{c.name}] role='{c.role}' | cat='{c.category}' | jd={bool(c.jd_analysis)} | strat={bool(c.jd_strategy)}")

print("\n=== TARGET JOBS STATUS ===")
target_keywords = ['project44', 'valuelabs', 'value labs', 'groww', 'infosys']
all_jobs = db.query(RawIngestionJob).all()
for j in all_jobs:
    subject = (j.payload or {}).get('subject', '')
    if any(kw in subject.lower() for kw in target_keywords):
        print(f"  [{j.status.upper()}] {subject[:80]}")

db.close()
