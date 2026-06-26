from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from typing import List, Any, Dict, Optional
from uuid import UUID
from datetime import datetime
from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.models import User, Application, Company, OpportunityState
from app.schemas.schemas import ApplicationCreate, ApplicationUpdate, ApplicationOut, OpportunityStateOut, CompanyOut
from app.services.priority_scorer import calculate_priority_score
from app.services.stale_detector import is_application_stale
from app.services.opportunity_lifecycle import (
    set_tracking, set_archived, set_snooze, restore_state, _upsert_opportunity_state
)
from app.core.redis import get_cache, set_cache, get_user_version, bump_user_version

router = APIRouter(prefix="/applications", tags=["applications"])


def _load_application_with_score(db: Session, app: Application) -> Application:
    """Reload application with all relationships and computed fields."""
    loaded = db.query(Application).options(
        joinedload(Application.company).joinedload(Company.events)
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
    cache_key = f"nextup:cache:user:{current_user.id}:applications:v{version}"
    cached = get_cache(cache_key)
    if cached is not None:
        return cached

    # Fetch all real applications for this user
    apps = db.query(Application).options(
        joinedload(Application.company).joinedload(Company.events)
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
            "updated_at": opp.updated_at.isoformat() if opp.updated_at else None,
            "company": company_out,
        })

    set_cache(cache_key, result, expire_seconds=30)
    return result


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
    action: str,  # "track" | "archive" | "snooze" | "restore"
    reason: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Lightweight endpoint for decision_pending / unseen → state transitions
    that don't require a full Application workspace yet.
    
    action:
      - "track"   → Create Application + set state to 'tracking'
      - "archive" → Set state to 'archived' (keeps Application if exists)
      - "snooze"  → Remind me later (7-day snooze on decision_pending)
      - "restore" → Restore from archived to previous_state
    """
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found.")

    if action == "track":
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

        set_tracking(db=db, user_id=current_user.id, company_id=company_id)
        db.commit()
        bump_user_version(current_user.id)
        return {"status": "tracking", "company_id": str(company_id)}

    elif action == "archive":
        # Set archived state on OpportunityState (and Application if exists)
        existing_app = db.query(Application).filter(
            Application.user_id == current_user.id,
            Application.company_id == company_id
        ).first()
        if existing_app:
            existing_app.user_decision = 'archived'

        archive_reason = reason or "MANUAL_NOT_INTERESTED"
        set_archived(db=db, user_id=current_user.id, company_id=company_id, reason=archive_reason)
        db.commit()
        bump_user_version(current_user.id)
        return {"status": "archived", "company_id": str(company_id), "archive_reason": archive_reason}

    elif action == "snooze":
        set_snooze(db=db, user_id=current_user.id, company_id=company_id)
        db.commit()
        bump_user_version(current_user.id)
        return {"status": "snoozed", "company_id": str(company_id)}

    elif action == "restore":
        opp_state = restore_state(db=db, user_id=current_user.id, company_id=company_id)
        if not opp_state:
            raise HTTPException(status_code=404, detail="No opportunity state found to restore.")
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
        bump_user_version(current_user.id)
        return {"status": opp_state.state, "company_id": str(company_id)}

    else:
        raise HTTPException(status_code=400, detail=f"Unknown action '{action}'. Must be track, archive, snooze, or restore.")
