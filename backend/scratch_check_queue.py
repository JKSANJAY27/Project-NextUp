import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()
from app.core.database import SessionLocal
from app.models.models import RawIngestionJob

db = SessionLocal()
jobs = db.query(RawIngestionJob).all()
print(f"Total raw_ingestion_jobs: {len(jobs)}")

print("\n=== PENDING / FAILED / PROCESSING JOBS ===")
for j in jobs:
    if j.status not in ('dead_letter', 'skipped', 'completed'):
        subj = (j.payload or {}).get('subject', '')
        print(f"  [{j.status.upper()}] {subj[:80]}")

print("\n=== SEARCHING FOR GROWW/COUCHBASE ===")
found = False
for j in jobs:
    subj = (j.payload or {}).get('subject', '')
    ts = (j.payload or {}).get('timestamp', '')
    if 'groww' in subj.lower() or 'couchbase' in subj.lower():
        found = True
        print(f"  [{j.status.upper()}] {subj[:80]} | {str(ts)[:16]}")

if not found:
    print("  --> NOT FOUND in raw_ingestion_jobs. Need a fresh Gmail sync.")

print("\n=== RECENT COMPLETED JOBS (last 15) ===")
completed = [j for j in jobs if j.status == 'completed']
completed_sorted = sorted(completed, key=lambda x: (x.payload or {}).get('timestamp', ''), reverse=True)
for j in completed_sorted[:15]:
    subj = (j.payload or {}).get('subject', '')
    ts = (j.payload or {}).get('timestamp', '')
    print(f"  [COMPLETED] {subj[:70]} | {str(ts)[:16]}")

db.close()
