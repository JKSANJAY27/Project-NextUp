from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.models import User, StudentProfile
from app.schemas.schemas import UserOut, UserUpdate
from app.core.security import generate_blind_index
from app.core.config import settings

router = APIRouter(prefix="/users", tags=["users"])

def get_merged_user_data(user: User, db: Session) -> dict:
    """Helper to merge User and StudentProfile data for schema response."""
    profile = db.query(StudentProfile).filter(StudentProfile.user_id == user.id).first()
    data = {
        "id": user.id,
        "email": user.email,
        "role": user.role,
        "created_at": user.created_at
    }
    
    if profile:
        profile_fields = [
            "full_name", "branch", "batch_year", "neo_id_enc", 
            "neo_id_hash", "cgpa", "tenth_marks", "twelfth_marks", 
            "has_arrears", "skills"
        ]
        for field in profile_fields:
            data[field] = getattr(profile, field)
    else:
        # Defaults
        data.update({
            "full_name": None,
            "branch": None,
            "batch_year": None,
            "neo_id_enc": None,
            "neo_id_hash": None,
            "cgpa": None,
            "tenth_marks": None,
            "twelfth_marks": None,
            "has_arrears": None,
            "skills": []
        })
    return data

@router.get("/me", response_model=UserOut)
def read_user_me(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    return get_merged_user_data(current_user, db)

@router.put("/me", response_model=UserOut)
def update_user_me(
    user_in: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    profile = db.query(StudentProfile).filter(StudentProfile.user_id == current_user.id).first()
    
    # If student profile does not exist, initialize it
    if not profile:
        # In schema.sql, full_name, branch, batch_year, neo_id_enc, and neo_id_hash are NOT NULL.
        # Thus, we assign default placeholders if they are not provided in the first request,
        # but let the client override them.
        profile = StudentProfile(
            user_id=current_user.id,
            full_name=user_in.full_name or "New Student",
            branch=user_in.branch or "Unknown",
            batch_year=user_in.batch_year or datetime.utcnow().year,
            neo_id_enc=user_in.neo_id_enc or "UNSET",
            neo_id_hash=generate_blind_index(user_in.neo_id, settings.PEPPER) if user_in.neo_id else "UNSET",
            cgpa=user_in.cgpa or 0.0,
            tenth_marks=user_in.tenth_marks or 0.0,
            twelfth_marks=user_in.twelfth_marks or 0.0,
            has_arrears=user_in.has_arrears or False,
            skills=user_in.skills or []
        )
        db.add(profile)
    else:
        # Exclude unset fields, but pop special blind index neo_id
        update_data = user_in.dict(exclude_unset=True)
        if "neo_id" in update_data:
            neo_id = update_data.pop("neo_id")
            if neo_id:
                profile.neo_id_hash = generate_blind_index(neo_id, settings.PEPPER)
                
        for field, value in update_data.items():
            if hasattr(profile, field) and value is not None:
                setattr(profile, field, value)
            
    db.commit()
    return get_merged_user_data(current_user, db)
