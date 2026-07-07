"""
Cleanup script (revised):
1. Remove null-stage events (seq=None, stage=None) - orphan re-ingest artifacts
2. Remove stray Valuelabs LLP - Software Engineer entry (1 event, no real data)
   - This came from an "update" email that should have merged into the existing Forward Deployed entry
   - NOT removing the Infosys duplicates - those are legitimate separate roles
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from app.core.database import SessionLocal
from app.models.models import Company, CompanyEvent

db = SessionLocal()

print("=== STEP 1: Remove null-stage orphan events ===")
# WARNING (fixed 2026-07-07): stage=NULL events are NOT junk — they are the
# MAIN email events that carry the email body shown in the workspace "Email
# Trail" / "View Source Email". A previous run of this script deleted every
# email body in the app, plus the Groww OA update event. Only delete
# null-stage events that ALSO have no subject and no body (true orphans).
orphans = db.query(CompanyEvent).filter(
    CompanyEvent.stage == None,
    CompanyEvent.subject == None,
    CompanyEvent.body == None,
).all()
print(f"  Found {len(orphans)} true orphan events (no stage, no subject, no body) to delete")
for ev in orphans:
    db.delete(ev)
db.commit()
print("  [OK] Deleted true orphan events only (email-trail events preserved)")

print("\n=== STEP 2: Remove stray Valuelabs LLP - Software Engineer (1 event only) ===")
# This entry has only 1 null-stage event (now deleted) - it's an orphan from the update email
# The real Valuelabs LLP entry is 'Forward Deployed Engineer' with 5 meaningful timeline events
valuelabs_se = db.query(Company).filter(
    Company.name == 'Valuelabs LLP',
    Company.role == 'Software Engineer'
).first()
if valuelabs_se:
    # Check how many events remain after null-stage cleanup
    remaining_events = db.query(CompanyEvent).filter(CompanyEvent.company_id == valuelabs_se.id).count()
    print(f"  Stray entry has {remaining_events} events remaining after cleanup")
    if remaining_events == 0:
        print(f"  Deleting stray empty entry: [{valuelabs_se.name}] - {valuelabs_se.role}")
        db.delete(valuelabs_se)
        db.commit()
        print("  [OK] Done")
    else:
        print(f"  Keeping entry (still has {remaining_events} events)")
else:
    print("  Not found or already removed")

print("\n=== FINAL STATE ===")
companies = db.query(Company).order_by(Company.name).all()
print(f"  Total companies: {len(companies)}")
for c in companies:
    events = db.query(CompanyEvent).filter(
        CompanyEvent.company_id == c.id
    ).order_by(CompanyEvent.sequence).all()
    print(f"\n  [{c.name}] - {c.role} ({c.category}) | jd={bool(c.jd_analysis)} | strat={bool(c.jd_strategy)}")
    for ev in events:
        print(f"    [{ev.sequence}] {ev.stage}")

print("\n=== REFRESHING MATERIALIZED VIEWS ===")
from app.services.gmail_sync import refresh_materialized_views_concurrent
refresh_materialized_views_concurrent(db)
print("  [OK] Views refreshed")

db.close()
print("\nDone!")
