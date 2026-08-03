from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload, defer
from typing import List, Any, Dict, Optional
from uuid import UUID
from datetime import datetime
from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.models import User, Application, Company, OpportunityState, CompanyEvent, CompanyHistoricalSnapshot
from app.core.config import settings


def _company_with_light_events(rel):
    """Eager-load a company relationship + its events WITHOUT email bodies.

    joinedload(...).joinedload(Company.events) exploded into
    (applications x events) rows each carrying the FULL email body — the
    priority scorer and deadline properties only need timestamps/stages.
    selectinload batches events into one extra query; defer skips the
    heavyweight columns entirely.
    """
    return rel.selectinload(Company.events).options(
        defer(CompanyEvent.body),
        defer(CompanyEvent.source_email),
    )
from app.schemas.schemas import ApplicationCreate, ApplicationUpdate, ApplicationOut, OpportunityStateOut, CompanyOut
from app.services.priority_scorer import calculate_priority_score
from app.services.stale_detector import is_application_stale
from app.services.opportunity_lifecycle import (
    set_tracking, set_archived, set_snooze, restore_state, _upsert_opportunity_state,
    update_expired_opportunities
)
from app.core.redis import get_cache, set_cache, get_user_version, bump_user_version

router = APIRouter(prefix="/applications", tags=["applications"])


def _load_application_with_score(db: Session, app: Application) -> Application:
    """Reload application with all relationships and computed fields."""
    loaded = db.query(Application).options(
        _company_with_light_events(joinedload(Application.company))
    ).filter(Application.id == app.id).first()
    loaded.priority_score = calculate_priority_score(loaded, loaded.company, loaded.company.events)
    loaded.is_stale = is_application_stale(loaded)
    return loaded


@router.post("", response_model=ApplicationOut)
def create_application(
    app_in: ApplicationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Verify company exists
    company = db.query(Company).filter(Company.id == app_in.company_id).first()
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found.")

    # Check if application already exists
    existing_app = db.query(Application).filter(
        Application.user_id == current_user.id,
        Application.company_id == app_in.company_id
    ).first()
    if existing_app:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You have already created an application tracker for this company."
        )

    user_dec = app_in.user_decision or "tracking"
    rec_state = app_in.recruitment_state or "Registration"
    if app_in.status == 'Applied' and rec_state == 'Registration':
        rec_state = 'Awaiting Shortlist'

    new_app = Application(
        user_id=current_user.id,
        company_id=app_in.company_id,
        status=app_in.status,
        current_round=app_in.current_round,
        notes_enc=app_in.notes_enc,
        tailored_resume_enc=app_in.tailored_resume_enc,
        match_score=0,
        user_decision=user_dec,
        recruitment_state=rec_state,
        workspace_priority_override=app_in.workspace_priority_override,
        snoozed_until=app_in.snoozed_until
    )
    db.add(new_app)

    # Sync OpportunityState table
    _upsert_opportunity_state(
        db=db,
        user_id=current_user.id,
        company_id=app_in.company_id,
        new_state=user_dec,
    )

    db.commit()
    db.refresh(new_app)
    # Sync calendar events for the newly tracked workspace
    from app.services.calendar_sync import sync_user_calendar_events
    sync_user_calendar_events(db, current_user.id, app_in.company_id)
    
    bump_user_version(current_user.id)
    return _load_application_with_score(db, new_app)


@router.get("", response_model=List[Any])
def list_applications(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Returns a polymorphic list of:
      - {"record_type": "application", ...full tracker data}  — for tracking/snoozed states
      - {"record_type": "opportunity_state", ...}             — for unseen/decision_pending/archived/auto_archived

    Lifecycle jobs (expiry detection, auto-archive) run in the background scheduler, NOT here.
    """
    version = get_user_version(current_user.id)
    cache_key = f"nextup:cache:user:{current_user.id}:applications:v{version}:s{skip}:l{limit}"
    cached = get_cache(cache_key)
    if cached is not None:
        return cached

    # Ensure expired opportunities are moved to decision_pending state for the user
    update_expired_opportunities(db, current_user.id)

    # Fetch all real applications for this user
    apps = db.query(Application).options(
        _company_with_light_events(joinedload(Application.company))
    ).filter(Application.user_id == current_user.id).all()

    # Build a map of company_id → Application
    app_map: Dict[str, Application] = {str(a.company_id): a for a in apps}

    for app in apps:
        app.priority_score = calculate_priority_score(app, app.company, app.company.events)
        app.is_stale = is_application_stale(app)

    # Fetch all opportunity states for this user
    opp_states = db.query(OpportunityState).options(
        joinedload(OpportunityState.company)
    ).filter(OpportunityState.user_id == current_user.id).all()

    result: List[Any] = []
    seen_company_ids = set()

    # First pass: emit real application records for tracked states
    for app in sorted(apps, key=lambda x: x.priority_score, reverse=True):
        company_id_str = str(app.company_id)
        seen_company_ids.add(company_id_str)
        app_dict = ApplicationOut.from_orm(app).dict()
        app_dict["record_type"] = "application"
        result.append(app_dict)

    # Second pass: emit opportunity_state records for non-tracked companies
    for opp in opp_states:
        company_id_str = str(opp.company_id)
        if company_id_str in seen_company_ids:
            # Already emitted as a real application
            continue
        # Skip unseen states — they are the default, no need to emit
        if opp.state == "unseen":
            continue
        company_out = CompanyOut.from_orm(opp.company).dict() if opp.company else None
        result.append({
            "record_type": "opportunity_state",
            "company_id": str(opp.company_id),
            "state": opp.state,
            "archive_reason": opp.archive_reason,
            "archived_at": opp.archived_at.isoformat() if opp.archived_at else None,
            "decision_pending_since": opp.decision_pending_since.isoformat() if opp.decision_pending_since else None,
            "snoozed_until": opp.snoozed_until.isoformat() if opp.snoozed_until else None,
            "previous_state": opp.previous_state,
            "bootstrap_inferred_stage": opp.bootstrap_inferred_stage,
            "state_source": opp.state_source or "MANUAL",
            "updated_at": opp.updated_at.isoformat() if opp.updated_at else None,
            "company": company_out,
        })

    paginated_result = result[skip : skip + limit]
    set_cache(cache_key, paginated_result, expire_seconds=30)
    return paginated_result


@router.patch("/{id}", response_model=Any)
def update_application(
    id: UUID,
    app_in: ApplicationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    app = db.query(Application).filter(
        Application.id == id,
        Application.user_id == current_user.id
    ).first()
    if not app:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application tracker not found.")

    # Sub-state transitions based on student status changes
    if app_in.status is not None:
        if app_in.status == 'Applied' and app.recruitment_state in (None, 'Registration'):
            app.recruitment_state = 'Awaiting Shortlist'
        elif app_in.status == 'OA' and app.recruitment_state in (None, 'Registration', 'Shortlisted', 'Awaiting Shortlist'):
            app.recruitment_state = 'Awaiting OA Result'
        elif app_in.status == 'Interview' and app.recruitment_state in (None, 'Registration', 'Shortlisted', 'OA', 'Awaiting OA Result'):
            app.recruitment_state = 'Awaiting Interview Result'

    update_data = app_in.dict(exclude_unset=True)
    new_decision = update_data.get("user_decision")

    for field, value in update_data.items():
        if field != "user_decision":  # Handle separately below
            setattr(app, field, value)

    # Sync OpportunityState when user_decision changes
    if new_decision is not None:
        app.user_decision = new_decision
        _upsert_opportunity_state(
            db=db,
            user_id=current_user.id,
            company_id=app.company_id,
            new_state=new_decision,
            archive_reason="MANUAL" if new_decision == "archived" else None,
        )

    app.last_user_activity_at = datetime.utcnow()
    db.add(app)
    db.commit()
    db.refresh(app)
    # Sync calendar events for the modified application workspace
    from app.services.calendar_sync import sync_user_calendar_events
    sync_user_calendar_events(db, current_user.id, app.company_id)
    
    bump_user_version(current_user.id)
    
    loaded = _load_application_with_score(db, app)
    result = ApplicationOut.from_orm(loaded).dict()
    result["record_type"] = "application"
    return result

@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_application(
    id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    app = db.query(Application).filter(
        Application.id == id,
        Application.user_id == current_user.id
    ).first()
    if not app:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application tracker not found.")
    company_id = app.company_id
    db.delete(app)
    db.commit()
    
    # Clean up associated calendar events from application timeline
    from app.models.models import CalendarEvent
    db.query(CalendarEvent).filter(
        CalendarEvent.user_id == current_user.id,
        CalendarEvent.company_id == company_id,
        CalendarEvent.source == 'application_timeline'
    ).delete(synchronize_session=False)
    db.commit()
    bump_user_version(current_user.id)
    return None


@router.post("/opportunity-state")
def upsert_opportunity_state(
    company_id: UUID,
    action: str,  # "track" | "accept_suggestion" | "decline_suggestion" | "archive" | "snooze" | "restore"
    reason: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Lightweight endpoint for decision_pending / suggested_tracking / unseen → state transitions
    that don't require a full Application workspace yet.
    
    action:
      - "track" / "accept_suggestion" → Create Application + set state to 'tracking'
      - "decline_suggestion"          → Archive suggestion (previous_state=decision_pending)
      - "archive"                     → Set state to 'archived' (keeps Application if exists)
      - "snooze"                      → Remind me later (7-day snooze on decision_pending)
      - "restore"                     → Restore from archived to previous_state
    """
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found.")

    if action in ("track", "accept_suggestion"):
        # Create Application workspace if not exists
        existing_app = db.query(Application).filter(
            Application.user_id == current_user.id,
            Application.company_id == company_id
        ).first()
        if not existing_app:
            new_app = Application(
                user_id=current_user.id,
                company_id=company_id,
                status='Applied',
                current_round='Applied',
                match_score=0,
                user_decision='tracking',
                recruitment_state='Registration',
            )
            db.add(new_app)
        else:
            existing_app.user_decision = 'tracking'

        opp_state = set_tracking(db=db, user_id=current_user.id, company_id=company_id)
        if opp_state:
            opp_state.bootstrap_inferred_stage = None
            opp_state.state_source = "MANUAL"
        db.commit()
        from app.services.calendar_sync import sync_user_calendar_events
        sync_user_calendar_events(db, current_user.id, company_id)
        bump_user_version(current_user.id)
        return {"status": "tracking", "company_id": str(company_id)}

    elif action == "decline_suggestion":
        # Decline a bootstrap suggestion: move to archived, but explicitly set previous_state
        # to 'decision_pending' so if restored later, it doesn't return to suggested_tracking.
        opp_state = db.query(OpportunityState).filter(
            OpportunityState.user_id == current_user.id,
            OpportunityState.company_id == company_id
        ).first()
        if not opp_state:
            opp_state = OpportunityState(
                id=uuid.uuid4(),
                user_id=current_user.id,
                company_id=company_id,
            )
            db.add(opp_state)
        
        opp_state.previous_state = "decision_pending"
        opp_state.state = "archived"
        opp_state.archive_reason = "BOOTSTRAP_DECLINED"
        opp_state.archived_at = datetime.utcnow()
        opp_state.bootstrap_inferred_stage = None
        opp_state.state_source = "MANUAL"
        db.commit()
        from app.services.calendar_sync import sync_user_calendar_events
        sync_user_calendar_events(db, current_user.id, company_id)
        bump_user_version(current_user.id)
        return {"status": "archived", "company_id": str(company_id), "archive_reason": "BOOTSTRAP_DECLINED"}

    elif action == "archive":
        # Set archived state on OpportunityState (and Application if exists)
        existing_app = db.query(Application).filter(
            Application.user_id == current_user.id,
            Application.company_id == company_id
        ).first()
        if existing_app:
            existing_app.user_decision = 'archived'

        archive_reason = reason or "MANUAL_NOT_INTERESTED"
        opp_state = set_archived(db=db, user_id=current_user.id, company_id=company_id, reason=archive_reason)
        if opp_state:
            opp_state.state_source = "MANUAL"
        db.commit()
        from app.services.calendar_sync import sync_user_calendar_events
        sync_user_calendar_events(db, current_user.id, company_id)
        bump_user_version(current_user.id)
        return {"status": "archived", "company_id": str(company_id), "archive_reason": archive_reason}

    elif action == "snooze":
        opp_state = set_snooze(db=db, user_id=current_user.id, company_id=company_id)
        if opp_state:
            opp_state.state_source = "MANUAL"
        db.commit()
        from app.services.calendar_sync import sync_user_calendar_events
        sync_user_calendar_events(db, current_user.id, company_id)
        bump_user_version(current_user.id)
        return {"status": "snoozed", "company_id": str(company_id)}

    elif action == "restore":
        opp_state = restore_state(db=db, user_id=current_user.id, company_id=company_id)
        if not opp_state:
            raise HTTPException(status_code=404, detail="No opportunity state found to restore.")
        opp_state.state_source = "MANUAL"
        # If restoring to 'tracking', ensure Application workspace exists
        if opp_state.state == "tracking":
            existing_app = db.query(Application).filter(
                Application.user_id == current_user.id,
                Application.company_id == company_id
            ).first()
            if existing_app:
                existing_app.user_decision = 'tracking'
            else:
                new_app = Application(
                    user_id=current_user.id,
                    company_id=company_id,
                    status='Applied',
                    current_round='Applied',
                    match_score=0,
                    user_decision='tracking',
                    recruitment_state='Registration',
                )
                db.add(new_app)
        db.commit()
        from app.services.calendar_sync import sync_user_calendar_events
        sync_user_calendar_events(db, current_user.id, company_id)
        bump_user_version(current_user.id)
        return {"status": opp_state.state, "company_id": str(company_id)}

    else:
        raise HTTPException(status_code=400, detail=f"Unknown action '{action}'. Must be track, accept_suggestion, decline_suggestion, archive, snooze, or restore.")


class AutoFilterRequest(BaseModel):
    company_ids: Optional[List[UUID]] = None


@router.post("/auto-filter")
def auto_filter_decision_pending(
    body: AutoFilterRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Bulk processes decision-pending drives for the user based on eligibility and historical shortlist snapshots.
    
    Rules per drive:
    1. If user is NOT_ELIGIBLE for the drive -> move to archived (reason: INELIGIBLE)
    2. If drive has NO shortlist snapshot (no shortlist email received yet) -> leave in decision_pending untouched.
    3. If drive HAS shortlist snapshot:
       - Check if user's neo_id_hash is present in offer_hashes, interview_hashes, or oa_hashes:
           - In offer_hashes -> track with status 'Offer'
           - In interview_hashes -> track with status 'Interview'
           - In oa_hashes -> track with status 'OA'
       - In rejected_hashes or NOT present in any list -> move to archived (reason: LIKELY_REJECTED)
    """
    from app.services.eligibility import check_eligibility
    from app.services.calendar_sync import sync_user_calendar_events

    user_neo_hash = current_user.profile.neo_id_hash if current_user.profile else None

    # Query target companies
    query = db.query(Company)
    if body.company_ids:
        query = query.filter(Company.id.in_(body.company_ids))
    companies = query.all()

    # Get user's current opportunity states and applications
    opp_states = db.query(OpportunityState).filter(OpportunityState.user_id == current_user.id).all()
    opp_map = {opp.company_id: opp for opp in opp_states}

    apps = db.query(Application).filter(Application.user_id == current_user.id).all()
    app_map = {app.company_id: app for app in apps}

    # Fetch all historical snapshots for these companies
    snapshots = db.query(CompanyHistoricalSnapshot).filter(
        CompanyHistoricalSnapshot.company_id.in_([c.id for c in companies])
    ).all()
    snapshot_map = {snap.company_id: snap for snap in snapshots}

    processed_count = 0
    tracked_count = 0
    archived_count = 0
    skipped_count = 0
    details = []

    for comp in companies:
        opp = opp_map.get(comp.id)

        # Check eligibility
        if current_user.profile:
            elig_status, elig_reason, _ = check_eligibility(current_user.profile, comp)
        else:
            elig_status = "UNKNOWN"

        # 1. Ineligible -> Archive regardless of shortlists
        if elig_status == "NOT_ELIGIBLE":
            existing_app = app_map.get(comp.id)
            if existing_app:
                existing_app.user_decision = 'archived'

            archive_reason = "INELIGIBLE"
            set_archived(db=db, user_id=current_user.id, company_id=comp.id, reason=archive_reason)
            processed_count += 1
            archived_count += 1
            details.append({"company": comp.name, "action": "archived", "reason": "Ineligible for drive"})
            continue

        # 2. Check if shortlist snapshot exists for this company
        snap = snapshot_map.get(comp.id)
        if not snap or (not snap.oa_hashes and not snap.interview_hashes and not snap.offer_hashes and not snap.rejected_hashes):
            # No shortlist email / data ingested for this company -> Leave in Decision Required
            skipped_count += 1
            details.append({"company": comp.name, "action": "skipped", "reason": "No shortlist data ingested yet"})
            continue

        # 3. Drive HAS shortlist snapshot data -> Check NEO ID match
        has_hash = bool(user_neo_hash and user_neo_hash != "UNSET")

        target_stage = None
        if has_hash:
            if user_neo_hash in (snap.offer_hashes or []):
                target_stage = "Offer"
            elif user_neo_hash in (snap.interview_hashes or []):
                target_stage = "Interview"
            elif user_neo_hash in (snap.oa_hashes or []):
                target_stage = "OA"

        if target_stage:
            # User selected / shortlisted -> Track in workspace
            existing_app = app_map.get(comp.id)
            rec_state = "Awaiting Shortlist"
            if target_stage == "OA":
                rec_state = "Awaiting OA Result"
            elif target_stage == "Interview":
                rec_state = "Awaiting Interview Result"
            elif target_stage == "Offer":
                rec_state = "Selected"

            if not existing_app:
                new_app = Application(
                    user_id=current_user.id,
                    company_id=comp.id,
                    status=target_stage,
                    current_round=target_stage,
                    match_score=0,
                    user_decision='tracking',
                    recruitment_state=rec_state,
                )
                db.add(new_app)
            else:
                existing_app.user_decision = 'tracking'
                existing_app.status = target_stage
                existing_app.recruitment_state = rec_state

            opp_state = set_tracking(db=db, user_id=current_user.id, company_id=comp.id)
            if opp_state:
                opp_state.bootstrap_inferred_stage = target_stage
                opp_state.state_source = "AUTO_FILTER"

            processed_count += 1
            tracked_count += 1
            details.append({"company": comp.name, "action": "tracked", "stage": target_stage})
        else:
            # Shortlist exists but user NEO ID was not found -> Likely Rejected / Archive
            existing_app = app_map.get(comp.id)
            if existing_app:
                existing_app.user_decision = 'archived'

            set_archived(db=db, user_id=current_user.id, company_id=comp.id, reason="LIKELY_REJECTED")
            processed_count += 1
            archived_count += 1
            details.append({"company": comp.name, "action": "archived", "reason": "Not found in shortlist"})

    db.commit()
    bump_user_version(current_user.id)

    # Single bulk calendar sync after all state changes are committed —
    # replaces the previous per-company calls that caused 200+ DB round-trips and timed out.
    try:
        sync_user_calendar_events(db, current_user.id, company_id=None)
    except Exception as e:
        logger.warning(f"Calendar sync after auto-filter failed (non-fatal): {e}")

    return {
        "status": "success",
        "processed_count": processed_count,
        "tracked_count": tracked_count,
        "archived_count": archived_count,
        "skipped_count": skipped_count,
        "details": details
    }
