import os, sys
from dotenv import load_dotenv
load_dotenv()
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
if sys.platform.startswith('win'):
    sys.stdout.reconfigure(encoding='utf-8')

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob, Company

db = SessionLocal()

# Find all WarpDrive jobs
jobs = db.query(RawIngestionJob).all()
warp_jobs = [j for j in jobs if 'warp' in (j.payload or {}).get('subject', '').lower()]

print(f"WarpDrive jobs: {len(warp_jobs)}")
for j in warp_jobs:
    subj = j.payload.get('subject', '')
    print(f"\nJob {j.id}")
    print(f"  Subject: {subj}")
    print(f"  Status: {j.status}")
    if j.validated_output:
        ext = j.validated_output.get('extracted_data', {})
        print(f"  email_category: {ext.get('email_category')}")
        print(f"  event_type: {ext.get('event_type', {}).get('value')}")
        roles = ext.get('roles', [])
        print(f"  roles extracted: {len(roles)}")
        for i, r in enumerate(roles):
            print(f"    Role {i+1}: {r.get('role', {}).get('value')} | CTC: {r.get('ctc', {}).get('value')} | Stipend: {r.get('stipend', {}).get('value')}")
    else:
        print("  No validated output")

print("\n\nWarpDrive companies in DB:")
companies = db.query(Company).filter(Company.name.ilike('%warp%')).all()
for c in companies:
    print(f"  {c.name} | {c.role} | CTC: {c.ctc} | Stipend: {c.stipend}")

db.close()
