"""
Opportunity Lifecycle Service

Manages the state transitions for OpportunityState records.
These are intended to run as background/scheduled jobs (NOT inside GET /applications).

States:
  unseen          — New company arrived, user has never interacted.
  tracking        — User has created an Application workspace.
  decision_pending — Registration deadline expired, user hasn't decided.
  archived        — User decided not to apply or explicitly archived.
  auto_archived   — System auto-archived after 90 days of no response.
"""

import logging
from datetime import datetime, timedelta
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_

from app.models.models import Company, OpportunityState, Application, User
from app.core.redis import bump_user_version

logger = logging.getLogger(__name__)

# How long before decision_pending → auto_archived
AUTO_ARCHIVE_DAYS = 90
# How long to snooze when user clicks "Remind Me Later"
REMIND_SNOOZE_DAYS = 7


def _upsert_opportunity_state(
    db: Session,
    user_id: UUID,
    company_id: UUID,
    new_state: str,
    archive_reason: str = None,
    decision_pending_since: datetime = None,
    previous_state: str = None,
) -> OpportunityState:
    """Create or update an OpportunityState record."""
    now = datetime.utcnow()
    os_record = db.query(OpportunityState).filter(
        OpportunityState.user_id == user_id,
        OpportunityState.company_id == company_id,
    ).first()

    if not os_record:
        os_record = OpportunityState(
            user_id=user_id,
            company_id=company_id,
            state=new_state,
        )
        db.add(os_record)
    else:
        # Only track previous_state if changing to a different state
        if os_record.state != new_state and previous_state is None:
            previous_state = os_record.state
        os_record.state = new_state

    if archive_reason is not None:
        os_record.archive_reason = archive_reason
        os_record.archived_at = now

    if decision_pending_since is not None:
        # Only set decision_pending_since once — never overwrite it
        if os_record.decision_pending_since is None:
            os_record.decision_pending_since = decision_pending_since

    if previous_state is not None:
        os_record.previous_state = previous_state

    os_record.updated_at = now
    return os_record


def update_expired_opportunities(db: Session, user_id: UUID):
    """
    Find all companies whose registration_deadline has passed and the user hasn't 
    made a decision. Transition them from 'unseen' → 'decision_pending'.
    
    Should be called from a scheduled background job, NOT from GET /applications.
    """
    now = datetime.utcnow()
    
    # Find all expired companies
    expired_companies = db.query(Company).filter(
        Company.registration_deadline_db != None,
        Company.registration_deadline_db < now,
    ).all()
    
    moved_count = 0
    for company in expired_companies:
        # Check current opportunity state for this user
        os_record = db.query(OpportunityState).filter(
            OpportunityState.user_id == user_id,
            OpportunityState.company_id == company.id,
        ).first()
        
        current_state = os_record.state if os_record else "unseen"
        
        # Only move unseen → decision_pending
        if current_state == "unseen":
            _upsert_opportunity_state(
                db=db,
                user_id=user_id,
                company_id=company.id,
                new_state="decision_pending",
                archive_reason=None,
                decision_pending_since=now,
                previous_state="unseen",
            )
            moved_count += 1

    if moved_count > 0:
        db.commit()
        bump_user_version(user_id)
        logger.info(f"Moved {moved_count} opportunities to 'decision_pending' for user {user_id}")


def auto_archive_expired_decisions(db: Session, user_id: UUID):
    """
    Find all decision_pending opportunities that have been pending for > 90 days
    (measured from decision_pending_since) and auto-archive them.
    
    Should be called from a scheduled background job, NOT from GET /applications.
    """
    cutoff = datetime.utcnow() - timedelta(days=AUTO_ARCHIVE_DAYS)
    
    expired_decisions = db.query(OpportunityState).filter(
        OpportunityState.user_id == user_id,
        OpportunityState.state == "decision_pending",
        OpportunityState.decision_pending_since != None,
        OpportunityState.decision_pending_since < cutoff,
    ).all()
    
    archived_count = 0
    for os_record in expired_decisions:
        os_record.previous_state = os_record.state
        os_record.state = "auto_archived"
        os_record.archive_reason = "AUTO_ARCHIVED"
        os_record.archived_at = datetime.utcnow()
        os_record.updated_at = datetime.utcnow()
        archived_count += 1

    if archived_count > 0:
        db.commit()
        bump_user_version(user_id)
        logger.info(f"Auto-archived {archived_count} expired decisions for user {user_id}")


def run_lifecycle_for_all_users(db: Session):
    """
    Scheduled job: run update_expired_opportunities and auto_archive_expired_decisions 
    for all users.
    
    This should be called from the APScheduler background scheduler, 
    registered in gmail_sync.start_scheduler().
    """
    users = db.query(User).all()
    logger.info(f"Running opportunity lifecycle for {len(users)} users...")
    for user in users:
        try:
            update_expired_opportunities(db, user.id)
            auto_archive_expired_decisions(db, user.id)
        except Exception as e:
            logger.error(f"Lifecycle job failed for user {user.id}: {e}", exc_info=True)


def set_tracking(db: Session, user_id: UUID, company_id: UUID) -> OpportunityState:
    """Transition to 'tracking' state, remembering the previous state."""
    return _upsert_opportunity_state(
        db=db,
        user_id=user_id,
        company_id=company_id,
        new_state="tracking",
    )


def set_archived(db: Session, user_id: UUID, company_id: UUID, reason: str = "MANUAL") -> OpportunityState:
    """Transition to 'archived' state."""
    return _upsert_opportunity_state(
        db=db,
        user_id=user_id,
        company_id=company_id,
        new_state="archived",
        archive_reason=reason,
    )


def set_snooze(db: Session, user_id: UUID, company_id: UUID, snooze_days: int = REMIND_SNOOZE_DAYS) -> OpportunityState:
    """Snooze a decision_pending opportunity for N days (Remind Me Later)."""
    os_record = db.query(OpportunityState).filter(
        OpportunityState.user_id == user_id,
        OpportunityState.company_id == company_id,
    ).first()
    if os_record:
        os_record.snoozed_until = datetime.utcnow() + timedelta(days=snooze_days)
        os_record.updated_at = datetime.utcnow()
    else:
        os_record = OpportunityState(
            user_id=user_id,
            company_id=company_id,
            state="decision_pending",
            snoozed_until=datetime.utcnow() + timedelta(days=snooze_days),
            decision_pending_since=datetime.utcnow(),
        )
        db.add(os_record)
    return os_record


def restore_state(db: Session, user_id: UUID, company_id: UUID) -> OpportunityState:
    """
    Restore an archived/auto_archived opportunity to its previous state.
    Defaults to 'decision_pending' if previous_state is unknown.
    """
    os_record = db.query(OpportunityState).filter(
        OpportunityState.user_id == user_id,
        OpportunityState.company_id == company_id,
    ).first()
    if not os_record:
        return None

    # Determine restore target
    restore_target = os_record.previous_state or "decision_pending"
    
    # If previous was tracking, we restore fully to tracking
    os_record.state = restore_target
    os_record.archive_reason = None
    os_record.archived_at = None
    os_record.previous_state = None
    os_record.updated_at = datetime.utcnow()
    return os_record
