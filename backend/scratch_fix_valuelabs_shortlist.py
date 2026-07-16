"""Re-apply the Valuelabs 16-Jul in-body shortlist with the fixed logic.

The mail was classified INTERVIEW, which the body-shortlist scanner used to
skip entirely — students not on that list (e.g. Neo IDs eliminated after the
OA) were never moved to 'Likely Rejected'.

Usage:
    python scratch_fix_valuelabs_shortlist.py         # dry-run
    python scratch_fix_valuelabs_shortlist.py --fix   # apply
"""
import sys
import logging

logging.basicConfig(level=logging.INFO,
                    format="%(levelname)s %(message)s")
logging.getLogger("nextup.gmail_sync").setLevel(logging.INFO)

from app.core.database import SessionLocal
from app.models.models import Company, CompanyEvent, Application
from app.services.gmail_sync import apply_shortlist_matches, extract_neo_ids_from_text

APPLY = "--fix" in sys.argv

db = SessionLocal()
try:
    company = db.query(Company).filter(Company.name.ilike("%valuelabs%")).first()
    if not company:
        raise SystemExit("Valuelabs drive not found.")

    events = db.query(CompanyEvent).filter(
        CompanyEvent.company_id == company.id,
        CompanyEvent.body.isnot(None),
    ).order_by(CompanyEvent.timestamp.desc()).all()

    target_event, ids = None, []
    for e in events:
        found = extract_neo_ids_from_text(e.body or "")
        if len(found) >= 5:
            target_event, ids = e, found
            break

    if not target_event:
        raise SystemExit("No in-body shortlist (>=5 Neo IDs) found on any Valuelabs event.")

    print(f"Using event {target_event.timestamp} [{target_event.event_type}] "
          f"{(target_event.subject or '')[:70]!r} — {len(ids)} Neo IDs.")

    before = {str(a.user_id): a.status for a in db.query(Application).filter(
        Application.company_id == company.id).all()}

    if APPLY:
        apply_shortlist_matches(db, company, target_event, ids,
                                source="repair-16jul-body-list",
                                event_type_hint=target_event.event_type or "INTERVIEW")
        db.commit()
        after = {str(a.user_id): a.status for a in db.query(Application).filter(
            Application.company_id == company.id).all()}
        for uid in sorted(set(before) | set(after)):
            if before.get(uid) != after.get(uid):
                print(f"  user {uid[:8]}…: {before.get(uid)} -> {after.get(uid)}")
            else:
                print(f"  user {uid[:8]}…: {after.get(uid)} (unchanged)")
        try:
            from app.core.redis import bump_companies_list_version, bump_company_version, bump_user_version
            bump_companies_list_version()
            bump_company_version(company.id)
            for a in db.query(Application).filter(Application.company_id == company.id).all():
                bump_user_version(a.user_id)
        except Exception as err:
            print(f"(cache bump failed, non-critical: {err})")
        print("APPLIED.")
    else:
        print(f"DRY-RUN: would re-apply this list to {len(before)} application(s): "
              f"{list(before.values())}. Run with --fix.")
finally:
    db.close()
