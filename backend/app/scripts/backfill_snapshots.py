"""
backfill_snapshots.py — One-Time Historical Snapshot Backfill Script
=======================================================================
Reads historical shortlist events from two sources:
  1. AttachmentMetadata records with file_type = 'SHORTLIST_EXCEL'
  2. CompanyEvent records whose parsed_metadata or body contains shortlist NEO IDs

Populates company_historical_snapshots idempotently.
Does NOT write OpportunityState, Application, or Notification tables.

Usage:
    python -m app.scripts.backfill_snapshots
"""

import sys
import time
import logging
from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.core.database import SessionLocal
from app.models.models import Company, CompanyEvent, AttachmentMetadata, CompanyHistoricalSnapshot
from app.services.bootstrap import update_company_historical_snapshot
from app.services.gmail_sync import extract_neo_ids_from_excel, generate_blind_index

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("backfill_snapshots")


def run_backfill():
    start_time = time.monotonic()
    db = SessionLocal()

    logger.info("Starting historical snapshot backfill...")

    try:
        from sqlalchemy.orm import joinedload

        # 1. Backfill from AttachmentMetadata (SHORTLIST_EXCEL files)
        excel_attachments = (
            db.query(AttachmentMetadata)
            .options(joinedload(AttachmentMetadata.company_event))
            .filter(
                AttachmentMetadata.file_type == "SHORTLIST_EXCEL",
                AttachmentMetadata.company_event_id.isnot(None),
            )
            .all()
        )

        logger.info(f"Found {len(excel_attachments)} SHORTLIST_EXCEL attachment records.")

        excel_success = 0
        excel_total_ids = 0

        for att in excel_attachments:
            event = att.company_event
            if not event or not event.company_id:
                continue

            # Load file_data (deferred column)
            if not att.file_data:
                continue

            try:
                neo_ids = extract_neo_ids_from_excel(att.file_data)
                if not neo_ids:
                    continue

                hashes = {generate_blind_index(nid, settings.PEPPER) for nid in neo_ids}
                event_type = event.event_type or "SHORTLIST"

                update_company_historical_snapshot(
                    db=db,
                    company_id=event.company_id,
                    stage=event_type,
                    new_hashes=hashes,
                )
                db.commit()

                excel_success += 1
                excel_total_ids += len(neo_ids)

            except Exception as exc:
                db.rollback()
                logger.warning(
                    f"Failed to process attachment {att.id} ({att.file_name}): {exc}"
                )

        db.commit()
        logger.info(
            f"Excel backfill complete: {excel_success}/{len(excel_attachments)} attachments "
            f"processed, {excel_total_ids} NEO ID hashes populated."
        )

        # 2. Backfill from CompanyEvent body text / parsed_metadata shortlists
        events_with_shortlists = (
            db.query(CompanyEvent)
            .filter(
                CompanyEvent.event_type.in_([
                    "SHORTLIST", "OA", "OA_RESULT", "INTERVIEW",
                    "INTERVIEW_RESULT", "OFFER", "OFFER_RELEASED", "REJECTION"
                ])
            )
            .all()
        )

        logger.info(f"Found {len(events_with_shortlists)} shortlist-bearing CompanyEvent records.")

        event_success = 0
        for evt in events_with_shortlists:
            if not evt.company_id:
                continue

            meta = evt.parsed_metadata or {}
            neo_ids = meta.get("matched_neo_ids") or meta.get("neo_ids") or []

            if not neo_ids and evt.body:
                # Scan for NEO IDs in body text
                import re
                neo_id_pattern = re.compile(r"\b[A-Za-z]\d[A-Za-z]\d[A-Za-z]\d[A-Za-z]\d\b", re.IGNORECASE)
                neo_ids = list(set(neo_id_pattern.findall(evt.body)))

            if not neo_ids:
                continue

            hashes = {generate_blind_index(nid, settings.PEPPER) for nid in neo_ids}
            update_company_historical_snapshot(
                db=db,
                company_id=evt.company_id,
                stage=evt.event_type,
                new_hashes=hashes,
            )
            event_success += 1

        db.commit()
        logger.info(f"CompanyEvent backfill complete: {event_success} events processed.")

        # Update version metadata on all created/updated snapshot records
        db.query(CompanyHistoricalSnapshot).update({
            "parser_version": settings.BOOTSTRAP_CURRENT_PARSER_VERSION,
            "snapshot_schema_version": settings.BOOTSTRAP_CURRENT_SCHEMA_VERSION,
        })
        db.commit()

        elapsed = time.monotonic() - start_time
        total_snapshots = db.query(CompanyHistoricalSnapshot).count()
        logger.info(
            f"Historical snapshot backfill FINISHED successfully in {elapsed:.2f}s. "
            f"Total company snapshots populated: {total_snapshots}"
        )

    except Exception as exc:
        db.rollback()
        logger.error(f"Backfill failed: {exc}", exc_info=True)
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    run_backfill()
