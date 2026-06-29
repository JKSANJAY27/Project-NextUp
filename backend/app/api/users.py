from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.models import User, StudentProfile, Resume, Application
from app.schemas.schemas import UserOut, UserUpdate
from app.core.security import generate_blind_index
from app.core.config import settings
from app.core.redis import get_cache, set_cache, get_user_version, bump_user_version, bump_companies_list_version
from pydantic import BaseModel
import uuid
from datetime import datetime

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
            "full_name", "branch", "degree_type", "specialization", "batch_year", "neo_id_enc", 
            "neo_id_hash", "cgpa", "tenth_marks", "twelfth_marks", 
            "has_arrears", "ug_cgpa", "skills"
        ]
        for field in profile_fields:
            data[field] = getattr(profile, field)
    else:
        # Defaults
        data.update({
            "full_name": None,
            "branch": None,
            "degree_type": None,
            "specialization": None,
            "batch_year": None,
            "neo_id_enc": None,
            "neo_id_hash": None,
            "cgpa": None,
            "tenth_marks": None,
            "twelfth_marks": None,
            "has_arrears": None,
            "ug_cgpa": None,
            "skills": []
        })
    return data

@router.get("/me", response_model=UserOut)
def read_user_me(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    version = get_user_version(current_user.id)
    cache_key = f"nextup:cache:user:{current_user.id}:me:v{version}"
    cached = get_cache(cache_key)
    if cached is not None:
        return cached
    data = get_merged_user_data(current_user, db)
    set_cache(cache_key, data, expire_seconds=300) # 5 min TTL
    return data

@router.put("/me", response_model=UserOut)
def update_user_me(
    user_in: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    profile = db.query(StudentProfile).filter(StudentProfile.user_id == current_user.id).first()
    
    # If student profile does not exist, initialize it
    if not profile:
        profile = StudentProfile(
            user_id=current_user.id,
            full_name=user_in.full_name or "New Student",
            branch=user_in.branch or "Unknown",
            degree_type=user_in.degree_type or "BTECH",
            specialization=user_in.specialization or "CSE_CORE",
            batch_year=user_in.batch_year or datetime.utcnow().year,
            neo_id_enc=user_in.neo_id_enc or "UNSET",
            neo_id_hash=generate_blind_index(user_in.neo_id, settings.PEPPER) if user_in.neo_id else "UNSET",
            cgpa=user_in.cgpa or 0.0,
            tenth_marks=user_in.tenth_marks or 0.0,
            twelfth_marks=user_in.twelfth_marks or 0.0,
            has_arrears=user_in.has_arrears or False,
            ug_cgpa=user_in.ug_cgpa,
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
            if hasattr(profile, field):
                setattr(profile, field, value)
            
    db.commit()
    bump_user_version(current_user.id)
    # Eligibility checks on companies could also change when user profile updates,
    # so we should bump companies list version to force recalculation.
    bump_companies_list_version()
    
    # Also invalidate cached profile
    version = get_user_version(current_user.id)
    data = get_merged_user_data(current_user, db)
    set_cache(f"nextup:cache:user:{current_user.id}:me:v{version}", data, expire_seconds=300)
    return data


class ResetVaultRequest(BaseModel):
    new_neo_id_enc: str

@router.post("/reset-vault", response_model=UserOut)
def reset_user_vault(
    payload: ResetVaultRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Clears all encrypted data for the user (resumes, application notes, tailored resumes)
    due to password reset, and sets the new encrypted Neo ID while keeping academic profile intact.
    """
    profile = db.query(StudentProfile).filter(StudentProfile.user_id == current_user.id).first()
    if profile:
        profile.neo_id_enc = payload.new_neo_id_enc
        profile.neo_id_hash = "RESET-" + uuid.uuid4().hex
        db.add(profile)
        
    # Delete Resume record (wipes resume_json_enc, raw_text_enc, pdf_file_enc, pdf_filename_enc)
    db.query(Resume).filter(Resume.user_id == current_user.id).delete(synchronize_session=False)
    
    # Clear Application encrypted fields
    applications = db.query(Application).filter(Application.user_id == current_user.id).all()
    for app in applications:
        app.notes_enc = None
        app.tailored_resume_enc = None
        db.add(app)
        
    db.commit()
    bump_user_version(current_user.id)
    bump_companies_list_version()
    
    version = get_user_version(current_user.id)
    data = get_merged_user_data(current_user, db)
    set_cache(f"nextup:cache:user:{current_user.id}:me:v{version}", data, expire_seconds=300)
    return data
