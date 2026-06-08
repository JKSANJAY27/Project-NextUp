from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from typing import List
from uuid import UUID
from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.models import User, Application, Company
from app.schemas.schemas import ApplicationCreate, ApplicationUpdate, ApplicationOut

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
    
    new_app = Application(
        user_id=current_user.id,
        company_id=app_in.company_id,
        status_enc=app_in.status_enc,
        current_round=app_in.current_round,
        notes_enc=app_in.notes_enc,
        match_score=0
    )
    db.add(new_app)
    db.commit()
    db.refresh(new_app)
    
    # Reload with company relationship loaded
    new_app_loaded = db.query(Application).options(
        joinedload(Application.company)
    ).filter(Application.id == new_app.id).first()
    
    return new_app_loaded

@router.get("", response_model=List[ApplicationOut])
def list_applications(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Fetch all applications for user with company loaded
    apps = db.query(Application).options(
        joinedload(Application.company)
    ).filter(Application.user_id == current_user.id).all()
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
    
    update_data = app_in.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(app, field, value)
        
    db.add(app)
    db.commit()
    db.refresh(app)
    
    # Reload with relationship loaded
    app_loaded = db.query(Application).options(
        joinedload(Application.company)
    ).filter(Application.id == app.id).first()
    
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
