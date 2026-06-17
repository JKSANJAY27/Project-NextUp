from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from typing import List
from uuid import UUID
from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.models import User, Application, Company
from app.schemas.schemas import ApplicationCreate, ApplicationUpdate, ApplicationOut
from app.services.priority_scorer import calculate_priority_score
from app.services.stale_detector import is_application_stale

router = APIRouter(prefix="/applications", tags=["applications"])

@router.post("", response_model=ApplicationOut)
def create_application(
    app_in: ApplicationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Verify company exists
    company = db.query(Company).filter(Company.id == app_in.company_id).first()
    if not company:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Company not found."
        )
    
    # Check if application already exists
    existing_app = db.query(Application).filter(
        Application.user_id == current_user.id,
        Application.company_id == app_in.company_id
    ).first()
    if existing_app:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You have already applied/created an application tracker for this company."
        )
    
    # Determine default states
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
        match_score=0,
        user_decision=user_dec,
        recruitment_state=rec_state,
        workspace_priority_override=app_in.workspace_priority_override,
        snoozed_until=app_in.snoozed_until
    )
    db.add(new_app)
    db.commit()
    db.refresh(new_app)
    
    # Reload with company and events loaded for score computations
    new_app_loaded = db.query(Application).options(
        joinedload(Application.company).joinedload(Company.events)
    ).filter(Application.id == new_app.id).first()
    
    # Populate computed fields
    new_app_loaded.priority_score = calculate_priority_score(new_app_loaded, new_app_loaded.company, new_app_loaded.company.events)
    new_app_loaded.is_stale = is_application_stale(new_app_loaded)
    
    return new_app_loaded

@router.get("", response_model=List[ApplicationOut])
def list_applications(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Fetch all applications for user with company and events loaded
    apps = db.query(Application).options(
        joinedload(Application.company).joinedload(Company.events)
    ).filter(Application.user_id == current_user.id).all()
    
    # Calculate computed fields and sort by priority score descending
    for app in apps:
        app.priority_score = calculate_priority_score(app, app.company, app.company.events)
        app.is_stale = is_application_stale(app)
        
    apps.sort(key=lambda x: x.priority_score, reverse=True)
    return apps

@router.patch("/{id}", response_model=ApplicationOut)
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application tracker not found."
        )
    
    # Sub-state transitions based on student status changes
    if app_in.status is not None:
        if app_in.status == 'Applied' and app.recruitment_state in (None, 'Registration'):
            app.recruitment_state = 'Awaiting Shortlist'
        elif app_in.status == 'OA' and app.recruitment_state in (None, 'Registration', 'Shortlisted', 'Awaiting Shortlist'):
            app.recruitment_state = 'Awaiting OA Result'
        elif app_in.status == 'Interview' and app.recruitment_state in (None, 'Registration', 'Shortlisted', 'OA', 'Awaiting OA Result'):
            app.recruitment_state = 'Awaiting Interview Result'

    update_data = app_in.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(app, field, value)
        
    # Enforce Rule of State Isolation: changing user_decision does not modify recruitment_state and vice versa
    # This is naturally preserved since fields are updated explicitly from app_in schema.
    
    from datetime import datetime
    app.last_user_activity_at = datetime.utcnow()
        
    db.add(app)
    db.commit()
    db.refresh(app)
    
    # Reload with company and events loaded for score computations
    app_loaded = db.query(Application).options(
        joinedload(Application.company).joinedload(Company.events)
    ).filter(Application.id == app.id).first()
    
    # Populate computed fields
    app_loaded.priority_score = calculate_priority_score(app_loaded, app_loaded.company, app_loaded.company.events)
    app_loaded.is_stale = is_application_stale(app_loaded)
    
    return app_loaded

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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application tracker not found."
        )
    db.delete(app)
    db.commit()
    return None
