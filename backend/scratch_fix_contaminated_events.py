"""Audit & repair script for cross-company email contamination.

Finds CompanyEvents whose source email never mentions the workspace's
company name (the 'ion' ⊂ 'selection'/'attention' fuzzy-match bug), and
re-grounds each company's registration deadline against the original
NEW_DRIVE email text.

Usage:
    python scratch_fix_contaminated_events.py            # dry-run (read-only)
    python scratch_fix_contaminated_events.py --fix      # apply deletions/repairs

--fix will:
  1. Delete ungrounded email-trail events AND milestone events that came
     from the same foreign email (matched by subject+timestamp), including
     their notification jobs / attachments (DB cascade).
  2. Recompute registration_deadline from the drive's own NEW_DRIVE email
     via the deterministic extractor (fixes 7pm → 1:30pm style corruption).
  3. Bump cache versions so the UI refreshes.
"""
import sys
import logging

logging.basicConfig(level=logging.WARNING)

from app.core.database import SessionLocal
from app.models.models import Company, CompanyEvent
from app.services.gmail_sync import (
    company_grounded_in_email,
    extract_registration_deadline_ist,
    IST_OFFSET,
)

APPLY = "--fix" in sys.argv

db = SessionLocal()
try:
    companies = db.query(Company).all()
    total_bad = 0
    for company in companies:
        events = db.query(CompanyEvent).filter(
            CompanyEvent.company_id == company.id
        ).all()

        # 1. Find ungrounded source emails (subject+timestamp keys)
        bad_keys = set()
        for e in events:
            if not e.subject:
                continue
            haystack = f"{e.subject}\n{e.body or ''}".lower()
            if not company_grounded_in_email(company.name, haystack):
                bad_keys.add((e.subject, e.timestamp))

        bad_events = [e for e in events
                      if (e.subject, e.timestamp) in bad_keys]
        if bad_events:
            total_bad += len(bad_events)
            print(f"\n[{company.name}] {len(bad_events)} contaminated event(s):")
            for e in bad_events:
                print(f"  - {e.timestamp}  {e.event_type:<18} stage={e.stage or '-':<20} {e.subject[:70]!r}")
                if APPLY:
                    db.delete(e)

        # 2. Re-ground the registration deadline from the drive's own announcement email
        good_events = [e for e in events if (e.subject, e.timestamp) not in bad_keys]
        from datetime import datetime as _dt

        def _ts(e):
            t = e.timestamp
            if t is None:
                return _dt.min
            return t.replace(tzinfo=None) if t.tzinfo else t

        announce = next(
            (e for e in sorted(good_events, key=_ts)
             if e.event_type in ("NEW_DRIVE", "REGISTRATION") and e.body),
            None,
        )
        if announce:
            det = extract_registration_deadline_ist(announce.subject or "", announce.body or "")

            # Normalize the stored value to naive IST for comparison (legacy
            # rows are tz-aware UTC; new convention is naive IST).
            from datetime import timezone as _tz
            cur = company.registration_deadline_db
            cur_ist = None
            if cur is not None:
                cur_ist = (cur.astimezone(_tz.utc).replace(tzinfo=None) + IST_OFFSET
                           if cur.tzinfo else cur)
            if det and cur_ist is not None:
                if det == cur_ist:
                    det = None  # already correct — no change
                elif (det.hour, det.minute) == (0, 0) and det.date() == cur_ist.date():
                    # Extractor found no written time; keep the existing
                    # same-day deadline rather than truncating it to midnight.
                    det = None

            if det and det != company.registration_deadline_db:
                print(f"[{company.name}] deadline {company.registration_deadline_db} -> {det} (IST, from email text)")
                if APPLY:
                    # Column is timestamptz: store as UTC-aware
                    det_utc = (det - IST_OFFSET).replace(tzinfo=_tz.utc)
                    company.registration_deadline_db = det_utc
                    # Also repair the REGISTRATION milestone date (stored UTC)
                    for e in good_events:
                        if e.stage == "REGISTRATION":
                            e.date = det_utc

    if APPLY:
        db.commit()
        try:
            from app.core.redis import bump_companies_list_version, bump_company_version
            bump_companies_list_version()
            for c in companies:
                bump_company_version(c.id)
        except Exception as err:
            print(f"(cache bump failed, non-critical: {err})")
        print(f"\nAPPLIED. Deleted {total_bad} contaminated events.")
    else:
        print(f"\nDRY-RUN. {total_bad} contaminated events found. Re-run with --fix to repair.")
finally:
    db.close()
