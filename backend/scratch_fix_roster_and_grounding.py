"""One-time repair for the 16-Jul issues:

1. Infosys: the 'Applied Students list' roster mail advanced everyone
   Applied -> OA. Revert to Applied.
2. Juspay: strip the phantom OA milestone date (18 Jul was never written in
   the mail); fix eligible_branches ['MTECH','CSE'] -> ['CSE']; replace the
   fabricated eligibility_raw_text with the grounded block from the mail.
3. All companies: remove pure degree codes from eligible_branches (they live
   in eligibility_rules.degree_types) and backfill 10th/12th cutoffs via the
   new deterministic X/XII extractor where a source mail is stored.

Usage:  python scratch_fix_roster_and_grounding.py [--fix]
"""
import sys

from sqlalchemy.orm.attributes import flag_modified

from app.core.database import SessionLocal
from app.models.models import Company, CompanyEvent, Application
from app.services.gmail_sync import event_date_is_grounded, IST_OFFSET
from app.services.email_parser import extract_x_xii_marks

APPLY = "--fix" in sys.argv
DEG_CODES = {"BTECH", "B.TECH", "MTECH", "M.TECH", "MTECH_INT",
             "MCA", "MSC", "M.SC", "BE", "ME", "MBA", "PHD"}

db = SessionLocal()
touched_companies = set()
try:
    # ── 1. Infosys roster rollback ─────────────────────────────────────────
    infosys = db.query(Company).filter(Company.name == "Infosys").first()
    if infosys:
        apps = db.query(Application).filter(
            Application.company_id == infosys.id,
            Application.status == "OA",
        ).all()
        for a in apps:
            print(f"Infosys app {str(a.user_id)[:8]}…: OA -> Applied")
            if APPLY:
                # recruitment_state CHECK constraint has no 'Applied' value
                a.status = "Applied"
                a.recruitment_state = "Registration"
                a.current_round = "Applied"
                touched_companies.add(infosys.id)

    # ── 2. Ungrounded milestone dates (all companies, incl. Juspay) ────────
    events = db.query(CompanyEvent).filter(CompanyEvent.date.isnot(None)).all()
    for e in events:
        src = db.query(CompanyEvent).filter(
            CompanyEvent.company_id == e.company_id,
            CompanyEvent.body.isnot(None),
        ).all()
        ground_text = " ".join(f"{s.subject or ''} {s.body or ''}" for s in src)
        ist = e.date + IST_OFFSET
        if not event_date_is_grounded(ist, ground_text):
            comp = db.query(Company).get(e.company_id)
            print(f"{comp.name}: {e.event_type}/{e.stage} date {ist.date()} IST "
                  f"not written in any mail -> dropping date")
            if APPLY:
                e.date = None
                touched_companies.add(e.company_id)

    # ── 3. Branch lists + raw text + marks for every company ──────────────
    for c in db.query(Company).all():
        # 3a. strip degree codes from eligible_branches
        br = c.eligible_branches or []
        cleaned = [b for b in br if str(b).strip().upper() not in DEG_CODES]
        if cleaned != br:
            print(f"{c.name}: branches {br} -> {cleaned}")
            if APPLY:
                c.eligible_branches = cleaned
                touched_companies.add(c.id)

        # 3b. deterministic X/XII cutoffs from stored mail bodies
        bodies = " \n".join((e.body or "") for e in db.query(CompanyEvent).filter(
            CompanyEvent.company_id == c.id, CompanyEvent.body.isnot(None)).all())
        marks = extract_x_xii_marks(bodies)
        rules = dict(c.eligibility_rules or {})
        if marks is not None and (rules.get("min_tenth_marks") != marks
                                  or rules.get("min_twelfth_marks") != marks):
            print(f"{c.name}: X/XII cutoff -> {marks}% "
                  f"(was {rules.get('min_tenth_marks')}/{rules.get('min_twelfth_marks')})")
            if APPLY:
                rules["min_tenth_marks"] = marks
                rules["min_twelfth_marks"] = marks
                c.eligibility_rules = rules
                flag_modified(c, "eligibility_rules")
                touched_companies.add(c.id)

        # 3c. Juspay's fabricated raw text -> grounded quote from the mail
        if c.name == "Juspay" and bodies:
            from app.services.email_parser import (
                _extract_eligible_branches_block, _extract_eligibility_raw_text_block)
            block = _extract_eligible_branches_block(bodies)
            raw = _extract_eligibility_raw_text_block(bodies)
            det = (f"Eligible Branches: {block}\n{raw}" if block and raw
                   else (f"Eligible Branches: {block}" if block else raw))
            if det and det.strip() != (c.eligibility_raw_text or "").strip():
                print(f"Juspay raw text -> grounded block: {det[:100]!r}")
                if APPLY:
                    c.eligibility_raw_text = det
                    touched_companies.add(c.id)

    if APPLY:
        db.commit()
        try:
            from app.core.redis import (bump_companies_list_version,
                                        bump_company_version)
            bump_companies_list_version()
            for cid in touched_companies:
                bump_company_version(cid)
        except Exception as err:
            print(f"(cache bump failed, non-critical: {err})")
        print(f"APPLIED — {len(touched_companies)} companies touched.")
    else:
        print("DRY-RUN. Run with --fix to apply.")
finally:
    db.close()
