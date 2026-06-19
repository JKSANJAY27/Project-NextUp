import json
import logging
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.orm import Session
from uuid import UUID

from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.models import User, Resume
from app.core.security import encrypt_field, decrypt_field
from app.core.gmail_token_cache import get_session_key
from app.services.resume_parser import parse_resume_pdf

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/resumes", tags=["resumes"])

@router.post("/parse")
async def parse_uploaded_resume(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user)
):
    """
    Accepts resume PDF, extracts metrics on-the-fly, and returns structured Candidate Profile data.
    The raw PDF is discarded immediately and never saved.
    """
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF resumes are supported.")
        
    try:
        contents = await file.read()
        parsed_data = parse_resume_pdf(contents)
        return parsed_data
    except Exception as e:
        logger.error(f"Failed to parse uploaded resume: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Resume parsing failure: {str(e)}")

@router.get("/me")
def get_user_resume(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Retrieves the user's standard structured resume data.
    Decrypts the resume JSON client-side (or in-memory using session key).
    """
    derived_key = get_session_key(current_user.id)
    if not derived_key:
        raise HTTPException(status_code=400, detail="Vault session key missing. Please log in.")

    resume = db.query(Resume).filter(Resume.user_id == current_user.id).first()
    if not resume or not resume.resume_json_enc:
        profile = current_user.profile
        full_name = profile.full_name if profile else ""
        skills = profile.skills if profile else []
        return {
            "template": "Classic",
            "resume_data": {
                "personal": {"name": full_name, "email": current_user.email},
                "education": [],
                "experience": [],
                "projects": [],
                "skills": skills
            }
        }
        
    try:
        decrypted_json_str = decrypt_field(resume.resume_json_enc, derived_key)
        resume_data = json.loads(decrypted_json_str)
        return {
            "template": resume.latex_template,
            "resume_data": resume_data,
            "raw_text_enc": resume.raw_text_enc,
            "pdf_file_enc": resume.pdf_file_enc,
            "pdf_filename_enc": resume.pdf_filename_enc
        }
    except Exception as e:
        logger.error(f"Failed to decrypt resume for user {current_user.id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to decrypt secure resume database records.")

@router.put("/me")
def update_user_resume(
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Saves the user's standard structured resume data (encrypted using active session key).
    """
    derived_key = get_session_key(current_user.id)
    if not derived_key:
        raise HTTPException(status_code=400, detail="Vault session key missing. Please log in.")

    template = payload.get("template", "Classic")
    resume_data = payload.get("resume_data", {})
    raw_text_enc = payload.get("raw_text_enc", None)
    pdf_file_enc = payload.get("pdf_file_enc", None)
    pdf_filename_enc = payload.get("pdf_filename_enc", None)
    
    if not resume_data:
        raise HTTPException(status_code=400, detail="Missing resume structured details.")

    # Encrypt the resume JSON
    try:
        encrypted_str = encrypt_field(json.dumps(resume_data), derived_key)
    except Exception as e:
        logger.error(f"Encryption failed during resume update: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to encrypt resume details securely.")

    resume = db.query(Resume).filter(Resume.user_id == current_user.id).first()
    if not resume:
        resume = Resume(
            user_id=current_user.id,
            resume_json_enc=encrypted_str,
            raw_text_enc=raw_text_enc,
            pdf_file_enc=pdf_file_enc,
            pdf_filename_enc=pdf_filename_enc,
            latex_template=template
        )
        db.add(resume)
    else:
        resume.resume_json_enc = encrypted_str
        resume.latex_template = template
        if raw_text_enc is not None:
            resume.raw_text_enc = raw_text_enc
        if pdf_file_enc is not None:
            resume.pdf_file_enc = pdf_file_enc
        if pdf_filename_enc is not None:
            resume.pdf_filename_enc = pdf_filename_enc
        
    db.commit()
    return {"status": "success", "message": "Resume updated and encrypted successfully."}
