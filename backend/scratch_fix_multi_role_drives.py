"""One drive per company: migrate roles column, merge duplicate role-drives,
and assign per-role JD texts from stored JD PDF attachments.

Steps (dry-run by default; --fix to apply):
  0. ALTER TABLE companies ADD COLUMN roles (always applied — the ORM model
     now selects it, so the column must exist even for a dry-run).
  1. Backfill roles=[{role, ctc, stipend}] where empty.
  2. Merge duplicate drives (same cleaned company name): keep the oldest,
     move events/applications/states/jobs/documents/calendar/change-logs,
     union roles, delete the duplicate.
  3. For every JD_PDF attachment, derive the role from the filename
     ('ION Group_Software Developer Job Description_2027.pdf') and attach
     that PDF's text to the matching/new role entry.
  4. Drop redundant generic default-role entries once real per-JD roles exist.

Usage:
    python scratch_fix_multi_role_drives.py         # dry-run
    python scratch_fix_multi_role_drives.py --fix   # apply
"""
import re
import sys
import logging

logging.basicConfig(level=logging.WARNING)

from sqlalchemy import text as sqltext
from sqlalchemy.orm.attributes import flag_modified
from app.core.database import SessionLocal, engine
from app.models.models import (
    Company, CompanyEvent, CompanyChangeLog, Application, OpportunityState,
    AiGenerationJob, StudentDocument, CalendarEvent, PendingCompanyEvent,
    AttachmentMetadata,
)
from app.services.validator import normalize_role_name

APPLY = "--fix" in sys.argv

# ── 0. Schema migration (idempotent, required even for dry-run) ────────────
with engine.connect() as conn:
    conn.execute(sqltext(
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS roles JSON DEFAULT '[]'"))
    conn.commit()
print("Schema: companies.roles ensured.")

from app.services.gmail_sync import clean_company_name_key, upsert_company_role

# NOTE: '_' is a regex word character, so \b fails before 'Description_2027'
# — use (?![a-z]) instead.
ROLE_FROM_FILENAME_RE = re.compile(
    r"[_\-]\s*([A-Za-z][A-Za-z &/]+?)\s*[_\-]?\s*(?:job\s*description|jd)(?![a-z])", re.I)


def role_from_filename(filename: str):
    m = ROLE_FROM_FILENAME_RE.search(filename or "")
    return m.group(1).strip() if m else None


db = SessionLocal()
try:
    companies = db.query(Company).order_by(Company.created_at.asc()).all()

    # ── 1. Backfill roles list from the legacy role column ────────────────
    for c in companies:
        if not c.roles and c.role:
            print(f"[backfill] {c.name}: roles <- [{c.role!r}]")
            if APPLY:
                c.roles = [{"role": c.role, "ctc": c.ctc, "stipend": c.stipend}]
                flag_modified(c, "roles")

    # ── 2. Merge duplicate drives (same cleaned company name) ─────────────
    by_key = {}
    for c in companies:
        by_key.setdefault(clean_company_name_key(c.name), []).append(c)

    for key, group in by_key.items():
        if len(group) < 2:
            continue
        primary, dups = group[0], group[1:]
        print(f"\n[merge] '{key}': keeping '{primary.name}' ({primary.id}), "
              f"merging {len(dups)} duplicate(s)")
        for dup in dups:
            print(f"  - {dup.name} | role={dup.role!r} | id={dup.id}")
            if not APPLY:
                continue

            # Move the duplicate's role(s) onto the primary drive
            for r in (dup.roles or [{"role": dup.role, "ctc": dup.ctc,
                                     "stipend": dup.stipend}]):
                if isinstance(r, dict) and r.get("role"):
                    upsert_company_role(primary, r["role"], ctc=r.get("ctc"),
                                        stipend=r.get("stipend"),
                                        jd_text=r.get("jd_text"),
                                        jd_strategy=r.get("jd_strategy"))
            # Keep the richer drive-level JD
            if dup.jd_text and len(dup.jd_text) > len(primary.jd_text or ""):
                primary.jd_text = dup.jd_text
            # Merge scalar fields the primary is missing
            for attr in ("ctc", "stipend", "job_location", "registration_link",
                         "eligibility_raw_text"):
                if not getattr(primary, attr) and getattr(dup, attr):
                    setattr(primary, attr, getattr(dup, attr))
            if not primary.registration_deadline_db and dup.registration_deadline_db:
                primary.registration_deadline_db = dup.registration_deadline_db

            # Re-point simple FKs
            for model in (CompanyEvent, CompanyChangeLog, AiGenerationJob,
                          CalendarEvent):
                db.query(model).filter(model.company_id == dup.id).update(
                    {model.company_id: primary.id}, synchronize_session=False)
            db.query(PendingCompanyEvent).filter(
                PendingCompanyEvent.matched_company_id == dup.id).update(
                {PendingCompanyEvent.matched_company_id: primary.id},
                synchronize_session=False)

            # Unique-per-user FKs: move only when the user has no row on the
            # primary; otherwise the duplicate's row is dropped.
            for model in (Application, OpportunityState, StudentDocument):
                for row in db.query(model).filter(model.company_id == dup.id).all():
                    clash = db.query(model).filter(
                        model.company_id == primary.id,
                        model.user_id == row.user_id).first()
                    if clash:
                        db.delete(row)
                    else:
                        row.company_id = primary.id
            db.flush()
            db.delete(dup)

    # ── 3. Per-role JD from stored JD PDF attachments ──────────────────────
    from app.services.pdf_extractor import parse_job_description

    remaining = [c for c in db.query(Company).all()]
    for c in remaining:
        atts = (db.query(AttachmentMetadata)
                .join(CompanyEvent, AttachmentMetadata.company_event_id == CompanyEvent.id)
                .filter(CompanyEvent.company_id == c.id,
                        AttachmentMetadata.file_type == "JD_PDF").all())
        for att in atts:
            if not att.file_data:
                continue
            role_name = role_from_filename(att.file_name)
            if not role_name:
                continue
            try:
                jd_info = parse_job_description(att.file_data)
            except Exception as e:
                print(f"[jd] {c.name}: failed to parse {att.file_name}: {e}")
                continue
            jd_text = jd_info.get("jd_text", "")
            if not jd_text:
                continue
            print(f"[jd] {c.name}: '{role_name}' <- {att.file_name} "
                  f"({len(jd_text)} chars)")
            if APPLY:
                upsert_company_role(c, role_name, jd_text=jd_text)
                if len(jd_text) > len(c.jd_text or ""):
                    c.jd_text = jd_text

        # ── 4. Drop redundant generic default entry (no JD of its own) ────
        if APPLY and c.roles and len(c.roles) > 1:
            roles = list(c.roles)
            with_jd = [r for r in roles if r.get("jd_text")]
            generic = [r for r in roles
                       if not r.get("jd_text")
                       and normalize_role_name(r.get("role", "")) ==
                       normalize_role_name("Software Engineer")]
            if with_jd and generic and len(roles) - len(generic) >= 1:
                roles = [r for r in roles if r not in generic]
                c.roles = roles
                flag_modified(c, "roles")
                display = " / ".join(r.get("role", "") for r in roles if r.get("role"))
                if display:
                    c.role = display[:255]
                print(f"[cleanup] {c.name}: dropped generic default role; "
                      f"display -> {c.role!r}")

    if APPLY:
        db.commit()
        try:
            from app.core.redis import bump_companies_list_version, bump_company_version
            bump_companies_list_version()
            for c in db.query(Company).all():
                bump_company_version(c.id)
        except Exception as err:
            print(f"(cache bump failed, non-critical: {err})")
        print("\nAPPLIED.")
    else:
        print("\nDRY-RUN complete. Re-run with --fix to apply.")
finally:
    db.close()
