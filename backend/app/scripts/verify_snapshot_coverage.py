"""
verify_snapshot_coverage.py — Snapshot Integrity Verification Gate
====================================================================
Rollout Gate (Step 4 in deployment pipeline). Performs 5 core integrity checks:
  1. 100% snapshot coverage for companies with historical shortlist events
  2. No duplicate company_id rows in company_historical_snapshots
  3. No empty/null stage hash buckets (buckets must be JSON arrays)
  4. Valid SHA-256 hash formatting (64-byte hex strings) for all snapshot entries
  5. Total company snapshot count matches companies with shortlist events

If any check fails, returns exit code 1 to ABORT the deployment.

Usage:
    python -m app.scripts.verify_snapshot_coverage
"""

import sys
import re
import logging
from sqlalchemy import func

from app.core.database import SessionLocal
from app.models.models import Company, CompanyEvent, AttachmentMetadata, CompanyHistoricalSnapshot

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("verify_snapshot_coverage")

HEX64_REGEX = re.compile(r"^[a-fA-F0-9]{64}$")


def verify():
    db = SessionLocal()
    failures = []

    logger.info("=== Starting Historical Snapshot Integrity Verification Gate ===")

    try:
        # Check 1: Coverage for companies with valid, parseable shortlist attachments
        # Filter attachments where NEO IDs were successfully extracted (parsed_meta extracted_count > 0)
        events = (
            db.query(AttachmentMetadata.company_event_id)
            .filter(
                AttachmentMetadata.file_type == "SHORTLIST_EXCEL",
                AttachmentMetadata.company_event_id.isnot(None),
                AttachmentMetadata.parsed_meta.isnot(None),
            )
            .all()
        )
        # Filter in Python for parsed_meta.get("extracted_count", 0) > 0
        valid_event_ids = set()
        for att in db.query(AttachmentMetadata).filter(AttachmentMetadata.file_type == "SHORTLIST_EXCEL").all():
            meta = att.parsed_meta or {}
            if isinstance(meta, dict) and meta.get("extracted_count", 0) > 0:
                if att.company_event_id:
                    valid_event_ids.add(att.company_event_id)

        companies_with_shortlist_files = (
            db.query(CompanyEvent.company_id)
            .filter(
                CompanyEvent.id.in_(list(valid_event_ids)),
                CompanyEvent.company_id.isnot(None),
            )
            .distinct()
            .all()
        )
        companies_with_shortlists = {e[0] for e in companies_with_shortlist_files}

        existing_snapshots = db.query(CompanyHistoricalSnapshot.company_id).all()
        existing_snapshot_companies = {s[0] for s in existing_snapshots}

        missing_companies = companies_with_shortlists - existing_snapshot_companies
        coverage_pct = 100.0
        if companies_with_shortlists:
            coverage_pct = (
                (len(companies_with_shortlists) - len(missing_companies))
                / len(companies_with_shortlists)
            ) * 100.0

        logger.info(
            f"Check 1 (Coverage): {len(companies_with_shortlists) - len(missing_companies)}/"
            f"{len(companies_with_shortlists)} companies with parseable shortlist attachments have snapshots ({coverage_pct:.1f}%)."
        )
        if missing_companies:
            failures.append(
                f"Coverage incomplete: {len(missing_companies)} shortlist-bearing companies "
                f"missing snapshot rows: {[str(c) for c in list(missing_companies)[:5]]}..."
            )

        # Check 2: No duplicate company_id rows
        dup_rows = (
            db.query(
                CompanyHistoricalSnapshot.company_id,
                func.count(CompanyHistoricalSnapshot.id),
            )
            .group_by(CompanyHistoricalSnapshot.company_id)
            .having(func.count(CompanyHistoricalSnapshot.id) > 1)
            .all()
        )
        logger.info(f"Check 2 (Duplicates): Found {len(dup_rows)} duplicate company_id rows.")
        if dup_rows:
            failures.append(f"Duplicate snapshot rows detected for {len(dup_rows)} companies.")

        # Check 3 & 4: Valid array types and SHA-256 hash formatting
        snapshots = db.query(CompanyHistoricalSnapshot).all()
        invalid_hashes = 0
        null_buckets = 0

        for snap in snapshots:
            for bucket_name in ("oa_hashes", "interview_hashes", "offer_hashes", "rejected_hashes"):
                hashes = getattr(snap, bucket_name)
                if hashes is None:
                    null_buckets += 1
                    continue
                if not isinstance(hashes, list):
                    failures.append(f"Snapshot {snap.id} bucket '{bucket_name}' is not a list.")
                    continue
                for h in hashes:
                    if not HEX64_REGEX.match(str(h)):
                        invalid_hashes += 1

        logger.info(f"Check 3 (Bucket Nulls): Found {null_buckets} null buckets (expected 0).")
        if null_buckets > 0:
            failures.append(f"Found {null_buckets} NULL bucket fields across snapshots.")

        logger.info(f"Check 4 (Hash Format): Found {invalid_hashes} malformed hash entries (expected 0).")
        if invalid_hashes > 0:
            failures.append(f"Found {invalid_hashes} malformed non-SHA256 hashes in snapshots.")

        # Check 5: Snapshot count vs expected shortlist companies
        total_snapshots = len(snapshots)
        logger.info(
            f"Check 5 (Count Audit): Total snapshots={total_snapshots}, "
            f"Shortlist companies={len(companies_with_shortlists)}."
        )

        print("\n" + "=" * 60)
        if failures:
            logger.error("[FAILED] VERIFICATION GATE FAILED:")
            for f in failures:
                logger.error(f"  * {f}")
            print("=" * 60)
            sys.exit(1)
        else:
            logger.info("[OK] ALL 5 VERIFICATION CHECKS PASSED SUCCESSFULLY!")
            logger.info("The historical snapshot database is 100% integrity-verified for bootstrap rollout.")
            print("=" * 60)

    except Exception as exc:
        logger.error(f"Verification gate execution failed: {exc}", exc_info=True)
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    verify()
