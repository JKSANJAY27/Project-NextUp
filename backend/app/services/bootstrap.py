"""
bootstrap.py — Historical Bootstrap Service
============================================
Contains:
  - update_company_historical_snapshot()   called from apply_shortlist_matches
  - create_bootstrap_job()                 called from users.py on first NEO ID save
  - run_bootstrap_tick()                   called from APScheduler every 1 minute

Architecture invariants enforced here:
  - Never writes CompanyEvent, AttachmentMetadata, Notification, NotificationJob, Application
  - Never creates Application workspaces
  - Never generates notifications
  - Never overwrites 'tracking', 'archived', or 'auto_archived' states
  - Snapshot updates happen inside the caller's transaction (no internal commit)
  - Each user job processed in an independent DB session (failures are per-user)
  - Redis cache bumped exactly once per job, at completion only
"""

import uuid
import time
import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.config import settings
from app.models.models import (
    Company,
    CompanyHistoricalSnapshot,
    BootstrapJob,
    BootstrapJobProgress,
    OpportunityState,
    StudentProfile,
)
from app.services.eligibility import check_eligibility
from app.core.redis import bump_user_version

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

# Minimum minutes a BootstrapJob can stay 'running' before being considered
# stale (e.g. worker died mid-tick). Stale jobs are reset to 'pending'.
STALE_RUNNING_MINUTES = 30

# Maps Gmail pipeline event_type_hint values to snapshot column names.
# Keys are the values apply_shortlist_matches passes as event_type_hint.
# Only event types that carry shortlist evidence are mapped; all others are ignored.
# Note: INTERVIEW_RESULT → interview_hashes is a known semantic imprecision
# (clearing interview ≠ being in interview) — deferred to future parser correction.
STAGE_TO_SNAPSHOT_COLUMN = {
    "SHORTLIST":         "oa_hashes",
    "OA":                "oa_hashes",
    "OA_RESULT":         "interview_hashes",
    "INTERVIEW":         "interview_hashes",
    "INTERVIEW_RESULT":  "interview_hashes",   # known imprecision — see note above
    "OFFER":             "offer_hashes",
    "OFFER_RELEASED":    "offer_hashes",
    "REJECTION":         "rejected_hashes",
}

# Canonical LATEST_STAGE value per column (for the informational latest_stage field)
COLUMN_TO_STAGE_LABEL = {
    "oa_hashes":        "OA",
    "interview_hashes": "Interview",
    "offer_hashes":     "Offer",
    "rejected_hashes":  "Rejected",
}

# Stage hierarchy used for "highest confirmed stage wins" logic.
# checked highest-first during bootstrap lookup.
STAGE_HIERARCHY = [
    ("offer_hashes",     "Offer"),
    ("interview_hashes", "Interview"),
    ("oa_hashes",        "OA"),
]


# ─────────────────────────────────────────────────────────────────────────────
# Integration Point 1: Snapshot Maintenance
# Called from apply_shortlist_matches in gmail_sync.py — runs inside the
# active ingestion transaction (same db session, no internal commit).
# ─────────────────────────────────────────────────────────────────────────────

def update_company_historical_snapshot(
    db: Session,
    company_id,
    stage: str,
    new_hashes: set,
) -> None:
    """Maintain the running set of NEO ID hashes per stage per company.

    This is the ONLY write path for company_historical_snapshots.
    Bootstrap reads from this table; it never writes to it.

    Called from apply_shortlist_matches AFTER the is_roster and is_repeat_list
    guards pass — so rosters (enrollment lists) and duplicate re-sends are
    excluded from snapshot accumulation.

    Transaction guarantee: this function operates on the caller's `db` session
    and issues no commit. If the surrounding ingestion transaction rolls back,
    snapshot changes roll back atomically.

    Args:
        db: Active SQLAlchemy session (from the Gmail ingestion pipeline).
        company_id: UUID of the company being processed.
        stage: event_type_hint from apply_shortlist_matches (e.g. 'OA', 'OFFER').
        new_hashes: Set of blind-index hashes from the current shortlist.
    """
    column = STAGE_TO_SNAPSHOT_COLUMN.get(stage)
    if not column:
        # GENERAL_UPDATE, REGISTRATION, NEW_DRIVE etc. carry no shortlist evidence
        return

    if not new_hashes:
        return

    try:
        snapshot = db.query(CompanyHistoricalSnapshot).filter_by(
            company_id=company_id
        ).first()

        if not snapshot:
            snapshot = CompanyHistoricalSnapshot(
                id=uuid.uuid4(),
                company_id=company_id,
            )
            db.add(snapshot)
            db.flush()

        existing = set(getattr(snapshot, column) or [])
        updated = existing | new_hashes

        if updated != existing:
            from sqlalchemy.orm.attributes import flag_modified
            setattr(snapshot, column, list(updated))
            flag_modified(snapshot, column)
            snapshot.last_updated = datetime.utcnow()

            # Update the informational latest_stage field if this stage is higher
            stage_label = COLUMN_TO_STAGE_LABEL.get(column)
            stage_order = {"OA": 1, "Interview": 2, "Offer": 3, "Rejected": 0}
            current_order = stage_order.get(snapshot.latest_stage or "", -1)
            new_order = stage_order.get(stage_label or "", -1)
            if new_order > current_order:
                snapshot.latest_stage = stage_label

    except Exception as exc:
        # Snapshot failure is non-fatal: Application/Notification processing must
        # not be blocked by a snapshot write error. Log and continue.
        logger.error(
            f"[snapshot] Failed to update snapshot for company {company_id} "
            f"stage={stage}: {exc}",
            exc_info=True,
        )


# ─────────────────────────────────────────────────────────────────────────────
# Integration Point 2: Job Creation
# Called from users.py when a valid NEO ID is saved for the first time
# ─────────────────────────────────────────────────────────────────────────────

def create_bootstrap_job(
    db: Session,
    user_id,
    neo_id_hash: str,
    trigger: str = "onboarding",
) -> Optional[BootstrapJob]:
    """Queue a new BootstrapJob for user_id, if one is not already pending/running.

    Idempotent: if a pending or running job already exists for this user, returns
    that job and does not create a duplicate.

    Args:
        db: Active SQLAlchemy session (caller is responsible for commit).
        user_id: UUID of the user to bootstrap.
        neo_id_hash: The current blind-index hash for this user's NEO ID.
        trigger: 'onboarding' | 'neo_id_changed' | 'manual'

    Returns:
        The new or existing BootstrapJob, or None on error.
    """
    try:
        existing = db.query(BootstrapJob).filter(
            BootstrapJob.user_id == user_id,
            BootstrapJob.status.in_(["pending", "running"]),
        ).first()

        if existing:
            logger.info(
                f"[bootstrap] User {user_id} already has a {existing.status} "
                f"bootstrap job ({existing.id}); skipping creation."
            )
            return existing

        job = BootstrapJob(
            id=uuid.uuid4(),
            user_id=user_id,
            status="pending",
            trigger=trigger,
            neo_id_hash_at_start=neo_id_hash,
        )
        db.add(job)
        logger.info(
            f"[bootstrap] Created bootstrap job for user {user_id} "
            f"(trigger={trigger})."
        )
        return job

    except Exception as exc:
        logger.error(
            f"[bootstrap] Failed to create bootstrap job for user {user_id}: {exc}",
            exc_info=True,
        )
        return None


# ─────────────────────────────────────────────────────────────────────────────
# APScheduler Cron — called from start_scheduler() in gmail_sync.py every 1 min
# ─────────────────────────────────────────────────────────────────────────────

def bootstrap_jobs_cron() -> None:
    """Process up to BOOTSTRAP_MAX_USERS_PER_TICK pending BootstrapJobs.

    Each user job is executed in a fully independent DB session so that one
    user's failure cannot roll back another user's completed processing.
    """
    db = SessionLocal()
    try:
        # Load the oldest N pending jobs
        pending_jobs = (
            db.query(BootstrapJob)
            .filter(BootstrapJob.status.in_(["pending", "running"]))
            .order_by(BootstrapJob.created_at.asc())
            .limit(settings.BOOTSTRAP_MAX_USERS_PER_TICK)
            .all()
        )
        job_ids = [str(j.id) for j in pending_jobs]
    finally:
        db.close()

    if not job_ids:
        return

    processed = 0
    for job_id in job_ids:
        # Each user in its own session — failure is isolated
        try:
            _run_single_bootstrap_job(job_id)
            processed += 1
        except Exception as exc:
            logger.error(
                f"[bootstrap] Unhandled error in bootstrap job {job_id}: {exc}",
                exc_info=True,
            )

    if processed:
        logger.info(f"[bootstrap] Cron tick completed: {processed}/{len(job_ids)} jobs processed.")


def run_bootstrap_tick() -> None:
    """Public alias for test injection."""
    bootstrap_jobs_cron()


# ─────────────────────────────────────────────────────────────────────────────
# Core: Single-User Bootstrap
# ─────────────────────────────────────────────────────────────────────────────

def _run_single_bootstrap_job(job_id) -> None:
    """Process one BootstrapJob in an independent DB session.

    Processing is chunked by BOOTSTRAP_CHUNK_SIZE companies per call. A job
    may span multiple cron ticks if the user has many companies. Each call is
    idempotent — already-processed companies are skipped via bootstrap_job_progress.
    """
    tick_start = time.monotonic()
    db = SessionLocal()
    try:
        job = db.query(BootstrapJob).filter_by(id=job_id).with_for_update().first()
        if not job:
            return

        # ── Step 1: Stale-running detection ──────────────────────────────────
        if (
            job.status == "running"
            and job.started_at
            and job.started_at < datetime.utcnow() - timedelta(minutes=STALE_RUNNING_MINUTES)
        ):
            logger.warning(
                f"[bootstrap] Job {job.id} has been 'running' for "
                f">{STALE_RUNNING_MINUTES}min — resetting to 'pending' for retry."
            )
            job.status = "pending"
            job.started_at = None
            db.commit()
            # Re-fetch with a clean lock
            job = db.query(BootstrapJob).filter_by(id=job_id).with_for_update().first()

        # ── Step 2: Load student profile & validate NEO ID ────────────────────
        profile = db.query(StudentProfile).filter_by(user_id=job.user_id).first()
        if not profile:
            job.status = "failed"
            job.error_message = "StudentProfile not found"
            db.commit()
            logger.error(f"[bootstrap] Job {job.id}: StudentProfile missing for user {job.user_id}")
            return

        neo_id_hash = profile.neo_id_hash or ""
        if not neo_id_hash or neo_id_hash.startswith("RESET-") or neo_id_hash == "UNSET":
            job.status = "cancelled"
            job.cancelled_at = datetime.utcnow()
            job.error_message = "NEO ID not yet set or in RESET state"
            db.commit()
            logger.info(f"[bootstrap] Job {job.id}: NEO ID not valid — cancelled.")
            return

        # ── Step 3: NEO ID change detection ──────────────────────────────────
        if job.neo_id_hash_at_start and job.neo_id_hash_at_start != neo_id_hash:
            job.status = "cancelled"
            job.cancelled_at = datetime.utcnow()
            job.error_message = "NEO ID changed during bootstrap — new job queued"
            # Queue a fresh job with the new hash
            new_job = BootstrapJob(
                id=uuid.uuid4(),
                user_id=job.user_id,
                status="pending",
                trigger="neo_id_changed",
                neo_id_hash_at_start=neo_id_hash,
            )
            db.add(new_job)
            db.commit()
            logger.info(
                f"[bootstrap] Job {job.id}: NEO ID changed — cancelled, "
                f"queued new job {new_job.id}."
            )
            return

        # ── Step 4: Mark as running ───────────────────────────────────────────
        if job.status == "pending":
            job.status = "running"
            job.started_at = datetime.utcnow()
            # Seed neo_id_hash_at_start if not set (e.g. job created before this field existed)
            if not job.neo_id_hash_at_start:
                job.neo_id_hash_at_start = neo_id_hash
            db.commit()

        logger.info(
            f"[bootstrap] Processing job {job.id} for user {job.user_id} "
            f"(trigger={job.trigger})."
        )

        # ── Step 5: Load companies in scope ───────────────────────────────────
        # Only non-manual companies whose registration deadline has already passed.
        all_companies = (
            db.query(Company)
            .filter(
                Company.is_manual.is_(False),
                Company.registration_deadline_db.isnot(None),
                Company.registration_deadline_db < datetime.utcnow(),
            )
            .all()
        )

        if job.total_companies == 0:
            job.total_companies = len(all_companies)
            db.commit()

        # Load already-processed companies for this job
        done_company_ids = set(
            row.company_id
            for row in db.query(BootstrapJobProgress).filter(
                BootstrapJobProgress.bootstrap_job_id == job.id,
                BootstrapJobProgress.status.in_(["done", "skipped"]),
            ).all()
        )

        pending_companies = [c for c in all_companies if c.id not in done_company_ids]

        # ── Step 6: Process chunk ─────────────────────────────────────────────
        chunk = pending_companies[: settings.BOOTSTRAP_CHUNK_SIZE]

        archived_this_tick = 0
        suggested_this_tick = 0
        failed_this_tick = 0

        for company in chunk:
            outcome, inferred_stage = _process_single_company(
                db=db,
                job=job,
                profile=profile,
                company=company,
                neo_id_hash=neo_id_hash,
            )
            if outcome == "failed":
                failed_this_tick += 1
            elif outcome in ("archived_not_eligible", "archived_rejected"):
                archived_this_tick += 1
            elif outcome == "suggested_tracking":
                suggested_this_tick += 1

        # ── Step 7: Update counters ───────────────────────────────────────────
        job.processed_count += len(chunk)
        job.archived_count  += archived_this_tick
        job.suggested_count += suggested_this_tick
        job.failed_count    += failed_this_tick
        db.commit()

        # ── Step 8: Check completion ──────────────────────────────────────────
        remaining = len(pending_companies) - len(chunk)
        if remaining <= 0:
            # All companies processed — finalize
            if job.failed_count > 0:
                job.status = "completed_with_errors"
                logger.warning(
                    f"[bootstrap] Job {job.id} completed with {job.failed_count} "
                    f"company failures. Admin retry available via POST /bootstrap/retry."
                )
            else:
                job.status = "completed"

            job.completed_at = datetime.utcnow()
            db.commit()

            # Bump Redis cache exactly once, only at completion
            try:
                bump_user_version(job.user_id)
            except Exception as exc:
                logger.warning(f"[bootstrap] Redis bump failed for user {job.user_id}: {exc}")

            elapsed = time.monotonic() - tick_start
            logger.info(
                f"[bootstrap] Job {job.id} {job.status}: "
                f"{job.suggested_count} suggested, {job.archived_count} archived, "
                f"{job.failed_count} failed | {elapsed:.2f}s"
            )
        else:
            logger.info(
                f"[bootstrap] Job {job.id}: {len(chunk)} companies processed this tick, "
                f"{remaining} remaining."
            )

    except Exception as exc:
        try:
            if db:
                db.rollback()
                job_rec = db.query(BootstrapJob).filter_by(id=job_id).first()
                if job_rec:
                    job_rec.status = "failed"
                    job_rec.error_message = str(exc)[:500]
                    db.commit()
        except Exception:
            pass
        logger.error(
            f"[bootstrap] Fatal error in job {job_id}: {exc}",
            exc_info=True,
        )
    finally:
        db.close()


def _process_single_company(
    db: Session,
    job: BootstrapJob,
    profile: StudentProfile,
    company: Company,
    neo_id_hash: str,
) -> tuple:
    """Process one company for a bootstrap run.

    Returns (outcome, inferred_stage | None).
    Uses per-company savepoints so a single failure doesn't abort the whole job.
    """
    outcome = "failed"
    inferred_stage = None

    try:
        nested = db.begin_nested()  # SAVEPOINT

        # a) Skip if manual drive
        if company.is_manual:
            _record_progress(db, job.id, company.id, "skipped", "skipped_manual_drive")
            nested.commit()
            return "skipped_manual_drive", None

        # b) Skip if OpportunityState already exists in a meaningful state
        existing_state = db.query(OpportunityState).filter_by(
            user_id=job.user_id, company_id=company.id
        ).first()

        if existing_state and existing_state.state in (
            "tracking", "archived", "auto_archived", "suggested_tracking"
        ):
            _record_progress(db, job.id, company.id, "skipped", "skipped_existing")
            nested.commit()
            return "skipped_existing", None

        # c) Eligibility check
        status_elig, _, _ = check_eligibility(profile, company)
        if status_elig == "NOT_ELIGIBLE":
            _upsert_opportunity_state(
                db, job.user_id, company.id,
                state="archived",
                archive_reason="NOT_ELIGIBLE",
                state_source="BOOTSTRAP",
            )
            _record_progress(db, job.id, company.id, "done", "archived_not_eligible")
            nested.commit()
            return "archived_not_eligible", None

        # d) Load snapshot (fallback: treat as no evidence if missing)
        snapshot = db.query(CompanyHistoricalSnapshot).filter_by(
            company_id=company.id
        ).first()

        if not snapshot:
            _ensure_decision_pending(db, job.user_id, company.id)
            _record_progress(db, job.id, company.id, "done", "decision_pending_no_evidence")
            nested.commit()
            return "decision_pending_no_evidence", None

        rejected_hashes  = set(snapshot.rejected_hashes  or [])
        offer_hashes     = set(snapshot.offer_hashes     or [])
        interview_hashes = set(snapshot.interview_hashes or [])
        oa_hashes        = set(snapshot.oa_hashes        or [])

        # e) Rejection check first (takes priority over stage evidence)
        if neo_id_hash in rejected_hashes:
            _upsert_opportunity_state(
                db, job.user_id, company.id,
                state="archived",
                archive_reason="BOOTSTRAP_REJECTED",
                state_source="BOOTSTRAP",
            )
            _record_progress(db, job.id, company.id, "done", "archived_rejected")
            nested.commit()
            return "archived_rejected", None

        # f) Highest confirmed stage wins
        if neo_id_hash in offer_hashes:
            outcome, inferred_stage = "suggested_tracking", "Offer"
        elif neo_id_hash in interview_hashes:
            outcome, inferred_stage = "suggested_tracking", "Interview"
        elif neo_id_hash in oa_hashes:
            outcome, inferred_stage = "suggested_tracking", "OA"
        else:
            outcome = "decision_pending_no_evidence"
            inferred_stage = None

        if outcome == "suggested_tracking":
            _upsert_opportunity_state(
                db, job.user_id, company.id,
                state="suggested_tracking",
                bootstrap_inferred_stage=inferred_stage,
                state_source="BOOTSTRAP",
                # Reset decision_pending_since so the 90-day auto-archive clock
                # starts from when the user first sees the suggestion
                reset_decision_pending_since=True,
            )
            _record_progress(db, job.id, company.id, "done", "suggested_tracking", inferred_stage)
        else:
            _ensure_decision_pending(db, job.user_id, company.id)
            _record_progress(db, job.id, company.id, "done", "decision_pending_no_evidence")

        nested.commit()
        return outcome, inferred_stage

    except Exception as exc:
        try:
            nested.rollback()
        except Exception:
            pass
        logger.error(
            f"[bootstrap] Error processing company {company.id} "
            f"({company.name}) for job {job.id}: {exc}",
            exc_info=True,
        )
        _record_progress(db, job.id, company.id, "failed", "failed")
        return "failed", None


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _upsert_opportunity_state(
    db: Session,
    user_id,
    company_id,
    state: str,
    archive_reason: Optional[str] = None,
    bootstrap_inferred_stage: Optional[str] = None,
    state_source: str = "BOOTSTRAP",
    reset_decision_pending_since: bool = False,
) -> OpportunityState:
    """Create or update an OpportunityState row for bootstrap.

    Safety: never overwrites rows that are already in 'tracking', 'archived',
    or 'auto_archived' states (those represent explicit user decisions).

    Uses SELECT FOR UPDATE to prevent races with lifecycle cron on PostgreSQL.
    SQLite falls back gracefully (no FOR UPDATE support).
    """
    from app.core.database import DATABASE_URL_IS_SQLITE

    try:
        query = db.query(OpportunityState).filter_by(
            user_id=user_id, company_id=company_id
        )
        if not DATABASE_URL_IS_SQLITE:
            query = query.with_for_update()

        row = query.first()

        if row:
            # Never overwrite states that represent explicit user decisions
            if row.state in ("tracking", "archived", "auto_archived"):
                return row
            # Don't overwrite a bootstrap_inferred_stage that is already set
            if row.bootstrap_inferred_stage and bootstrap_inferred_stage:
                return row

            row.state = state
            row.state_source = state_source
            if archive_reason:
                row.archive_reason = archive_reason
                row.archived_at = datetime.utcnow()
                # When archiving from suggested_tracking, previous_state must be
                # decision_pending (not suggested_tracking) so Restore works correctly
                row.previous_state = (
                    "decision_pending"
                    if row.state == "suggested_tracking"
                    else (row.state or "decision_pending")
                )
            if bootstrap_inferred_stage is not None:
                row.bootstrap_inferred_stage = bootstrap_inferred_stage
            if reset_decision_pending_since:
                row.decision_pending_since = datetime.utcnow()
        else:
            row = OpportunityState(
                id=uuid.uuid4(),
                user_id=user_id,
                company_id=company_id,
                state=state,
                state_source=state_source,
                archive_reason=archive_reason,
                archived_at=datetime.utcnow() if archive_reason else None,
                bootstrap_inferred_stage=bootstrap_inferred_stage,
                decision_pending_since=(
                    datetime.utcnow()
                    if state in ("decision_pending", "suggested_tracking")
                    else None
                ),
            )
            db.add(row)

        return row

    except Exception as exc:
        logger.error(
            f"[bootstrap] _upsert_opportunity_state failed for user={user_id} "
            f"company={company_id}: {exc}",
            exc_info=True,
        )
        raise


def _ensure_decision_pending(db: Session, user_id, company_id) -> None:
    """If no OpportunityState exists, create one in decision_pending.
    If one exists in a safe state, leave it unchanged.
    """
    existing = db.query(OpportunityState).filter_by(
        user_id=user_id, company_id=company_id
    ).first()
    if not existing:
        db.add(OpportunityState(
            id=uuid.uuid4(),
            user_id=user_id,
            company_id=company_id,
            state="decision_pending",
            state_source="BOOTSTRAP",
            decision_pending_since=datetime.utcnow(),
        ))


def _record_progress(
    db: Session,
    job_id,
    company_id,
    status: str,
    outcome: str,
    inferred_stage: Optional[str] = None,
) -> None:
    """Insert or update a BootstrapJobProgress record."""
    existing = db.query(BootstrapJobProgress).filter_by(
        bootstrap_job_id=job_id,
        company_id=company_id,
    ).first()

    if existing:
        existing.status = status
        existing.outcome = outcome
        existing.inferred_stage = inferred_stage
        existing.processed_at = datetime.utcnow()
    else:
        db.add(BootstrapJobProgress(
            id=uuid.uuid4(),
            bootstrap_job_id=job_id,
            company_id=company_id,
            status=status,
            outcome=outcome,
            inferred_stage=inferred_stage,
            processed_at=datetime.utcnow(),
        ))
