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
from app.core.redis import get_cache, set_cache, get_user_version, bump_user_version

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

    version = get_user_version(current_user.id)
    cache_key = f"nextup:cache:user:{current_user.id}:resumes_me:v{version}"
    cached = get_cache(cache_key)
    if cached is not None:
        return cached

    resume = db.query(Resume).filter(Resume.user_id == current_user.id).first()
    if not resume or not resume.resume_json_enc:
        profile = current_user.profile
        full_name = profile.full_name if profile else ""
        skills = profile.skills if profile else []
        res = {
            "template": "Classic",
            "resume_data": {
                "personal": {"name": full_name, "email": current_user.email},
                "education": [],
                "experience": [],
                "projects": [],
                "skills": skills
            }
        }
        set_cache(cache_key, res, expire_seconds=300) # 5 min TTL
        return res
        
    try:
        decrypted_json_str = decrypt_field(resume.resume_json_enc, derived_key)
        resume_data = json.loads(decrypted_json_str)
        res = {
            "template": resume.latex_template,
            "resume_data": resume_data,
            "raw_text_enc": resume.raw_text_enc,
            "pdf_file_enc": resume.pdf_file_enc,
            "pdf_filename_enc": resume.pdf_filename_enc
        }
        set_cache(cache_key, res, expire_seconds=300) # 5 min TTL
        return res
    except Exception as e:
        logger.error(f"Failed to decrypt resume for user {current_user.id}: {str(e)}")
        # Fallback to default structure so the UI does not crash, allowing user to upload a fresh PDF
        profile = current_user.profile
        full_name = profile.full_name if profile else ""
        skills = profile.skills if profile else []
        fallback_res = {
            "template": "Classic",
            "resume_data": {
                "personal": {"name": full_name, "email": current_user.email},
                "education": [],
                "experience": [],
                "projects": [],
                "skills": skills
            }
        }
        return fallback_res

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
    bump_user_version(current_user.id)
    return {"status": "success", "message": "Resume updated and encrypted successfully."}


# Asynchronous Resume Generation Endpoints

from pydantic import BaseModel
from typing import Optional
from app.models.models import AiGenerationJob, Company
from app.services.latex_renderer import render_resume_to_pdf

class ResumeGenerateRequest(BaseModel):
    company_id: UUID
    custom_prompt: Optional[str] = None
    latex_template: str = "Classic"

class AcceptChangesRequest(BaseModel):
    job_id: UUID
    accept_skills: bool = True
    accept_summary: bool = True
    accept_projects: bool = True

@router.post("/generate")
def start_resume_tailoring_job(
    req: ResumeGenerateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # 1. Enforce queue backlog limit
    backlog_count = db.query(AiGenerationJob).filter(AiGenerationJob.status == "queued").count()
    if backlog_count >= settings.RESUME_JOBS_MAX_BACKLOG:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Server busy: The resume worker queue is currently full. Please try again later."
        )

    # 2. Check Daily Limit
    day_ago = datetime.utcnow() - timedelta(days=1)
    daily_count = db.query(AiGenerationJob).filter(
        AiGenerationJob.user_id == current_user.id,
        AiGenerationJob.job_type == "resume_tailor",
        AiGenerationJob.status == "completed",
        AiGenerationJob.created_at >= day_ago
    ).count()

    if daily_count >= settings.RESUME_JOBS_DAILY_LIMIT_PER_USER:
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded: You have reached your daily limit of {settings.RESUME_JOBS_DAILY_LIMIT_PER_USER} tailored resumes per day."
        )

    # 3. Verify company drive exists
    company = db.query(Company).filter(Company.id == req.company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company drive not found.")

    # 4. Check if student has a vault session key (required to decrypt resume on worker)
    derived_key = get_session_key(current_user.id)
    if not derived_key:
        raise HTTPException(
            status_code=400,
            detail="Vault session key missing. Please log in again to authorize resume access."
        )

    # 5. Create queued job
    job = AiGenerationJob(
        user_id=current_user.id,
        company_id=req.company_id,
        job_type="resume_tailor",
        request_source="cloud",
        custom_prompt=req.custom_prompt,
        status="queued"
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    logger.info(f"Queued resume tailoring job {job.id} for user {current_user.id} targeting company {req.company_id}.")
    return {"status": "success", "job_id": job.id}

@router.get("/jobs/{job_id}")
def get_resume_job_status(
    job_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    job = db.query(AiGenerationJob).filter(
        AiGenerationJob.id == job_id,
        AiGenerationJob.user_id == current_user.id
    ).first()
    
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    return {
        "job_id": job.id,
        "status": job.status,
        "error_message": job.error_message,
        "created_at": job.created_at,
        "completed_at": job.completed_at,
        "model_used": job.model_used,
        "result": job.result_json if job.status == "completed" else None
    }

@router.post("/jobs/{job_id}/cancel")
def cancel_queued_job(
    job_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    job = db.query(AiGenerationJob).filter(
        AiGenerationJob.id == job_id,
        AiGenerationJob.user_id == current_user.id
    ).first()

    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    if job.status != "queued":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel a job that is already in '{job.status}' status."
        )

    job.status = "cancelled"
    job.completed_at = datetime.utcnow()
    db.commit()
    
    return {"status": "success", "message": "Job cancelled successfully."}

@router.post("/accept-changes")
def accept_resume_changes(
    req: AcceptChangesRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # 1. Fetch job and verify ownership
    job = db.query(AiGenerationJob).filter(
        AiGenerationJob.id == req.job_id,
        AiGenerationJob.user_id == current_user.id
    ).first()

    if not job or job.status != "completed" or not job.result_json:
        raise HTTPException(status_code=400, detail="Completed generation job result not found.")

    # 2. Get vault key
    derived_key = get_session_key(current_user.id)
    if not derived_key:
        raise HTTPException(status_code=400, detail="Vault session key missing. Please log in.")

    # 3. Load current resume
    resume = db.query(Resume).filter(Resume.user_id == current_user.id).first()
    if not resume:
        raise HTTPException(status_code=404, detail="Student resume not found.")

    try:
        current_data = json.loads(decrypt_field(resume.resume_json_enc, derived_key))
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to decrypt secure resume database records.")

    # 4. Apply accepted changes to resume JSON
    result = job.result_json
    
    if req.accept_summary and "optimized_summary" in result:
        current_data["summary"] = result["optimized_summary"]
        
    if req.accept_skills and "optimized_skills" in result:
        # Merge skills or replace
        current_data["skills"] = result["optimized_skills"]

    if req.accept_projects and "optimized_projects" in result:
        # Match projects by title and update descriptions
        opt_projects = result["optimized_projects"]
        master_projects = current_data.get("projects", [])
        
        for op in opt_projects:
            title = op.get("title", "").strip().lower()
            desc = op.get("description", "")
            for mp in master_projects:
                if mp.get("title", "").strip().lower() == title:
                    mp["description"] = desc
                    break

    # 5. Encrypt and save updated resume JSON
    try:
        encrypted_json = encrypt_field(json.dumps(current_data), derived_key)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to encrypt secure resume database records.")
    
    resume.resume_json_enc = encrypted_json

    # 6. Pre-render LaTeX/PDF and encrypt pdf_file_enc
    try:
        pdf_bytes = render_resume_to_pdf(resume.latex_template or "Classic", current_data)
        # Encrypt the PDF bytes (convert to base64 string first to fit in text field)
        pdf_base64 = base64.b64encode(pdf_bytes).decode("utf-8")
        encrypted_pdf = encrypt_field(pdf_base64, derived_key)
        resume.pdf_file_enc = encrypted_pdf
        resume.pdf_filename_enc = encrypt_field("tailored_resume.pdf", derived_key)
    except Exception as pdf_err:
        logger.error(f"Failed to compile and cache PDF during accept-changes: {pdf_err}")
        # Non-blocking: we still want to save the JSON changes even if PDF rendering had a glitch

    db.commit()
    bump_user_version(current_user.id)

    return {"status": "success", "message": "Resume updated and compiled successfully."}

