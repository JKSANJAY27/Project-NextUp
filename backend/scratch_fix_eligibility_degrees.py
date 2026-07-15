"""Repair degree_types / eligible_branches corrupted by LLM hallucination.

For every company, re-derives degree types and branches deterministically
from the drive's own announcement email text (Eligible Branches block) and
overwrites the stored eligibility_rules when they disagree.

Usage:
    python scratch_fix_eligibility_degrees.py         # dry-run
    python scratch_fix_eligibility_degrees.py --fix   # apply
"""
import sys
import logging
from datetime import datetime as _dt

logging.basicConfig(level=logging.WARNING)

from sqlalchemy.orm.attributes import flag_modified
from app.core.database import SessionLocal
from app.models.models import Company, CompanyEvent
from app.services.email_parser import (
    extract_degree_types_deterministic,
    _extract_eligible_branches_block,
    get_branches_from_text,
)

APPLY = "--fix" in sys.argv

db = SessionLocal()
try:
    changed = 0
    for company in db.query(Company).all():
        events = db.query(CompanyEvent).filter(
            CompanyEvent.company_id == company.id,
            CompanyEvent.body.isnot(None),
        ).all()

        def _ts(e):
            t = e.timestamp
            if t is None:
                return _dt.min
            return t.replace(tzinfo=None) if t.tzinfo else t

        announce = next(
            (e for e in sorted(events, key=_ts)
             if e.event_type in ("NEW_DRIVE", "REGISTRATION") and e.body),
            None,
        )
        if not announce:
            continue

        body = announce.body or ""
        det_degrees = extract_degree_types_deterministic(body)
        branch_block = _extract_eligible_branches_block(body)
        det_branches = get_branches_from_text(branch_block, strict=False) if branch_block else []

        rules = dict(company.eligibility_rules or {})
        cur_degrees = rules.get("degree_types") or []
        cur_branches = company.eligible_branches or []

        updates = []
        if det_degrees and sorted(cur_degrees) != sorted(det_degrees):
            updates.append(f"degree_types {cur_degrees} -> {det_degrees}")
            if APPLY:
                rules["degree_types"] = det_degrees
                company.eligibility_rules = rules
                flag_modified(company, "eligibility_rules")
        if det_branches and sorted(cur_branches) != sorted(det_branches):
            updates.append(f"eligible_branches {cur_branches} -> {det_branches}")
            if APPLY:
                company.eligible_branches = det_branches

        if updates:
            changed += 1
            print(f"[{company.name}]")
            for u in updates:
                print(f"    {u}")

    if APPLY:
        db.commit()
        try:
            from app.core.redis import bump_companies_list_version, bump_company_version
            bump_companies_list_version()
            for c in db.query(Company).all():
                bump_company_version(c.id)
        except Exception as err:
            print(f"(cache bump failed, non-critical: {err})")
        print(f"\nAPPLIED. {changed} companies repaired.")
    else:
        print(f"\nDRY-RUN. {changed} companies would change. Re-run with --fix.")
finally:
    db.close()
