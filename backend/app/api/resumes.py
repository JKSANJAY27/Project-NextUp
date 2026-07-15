import json
import logging
import base64
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.orm import Session
from uuid import UUID

from app.core.config import settings
from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.models import User, Resume
from app.core.security import encrypt_field, decrypt_field, server_encrypt_field
from app.core.gmail_token_cache import get_session_key
from app.core.ratelimit import rate_limit
from app.core.sanitize import sanitize_user_prompt
from app.services.resume_parser import parse_resume_pdf
from app.core.redis import get_cache, set_cache, get_user_version, bump_user_version
from fastapi.concurrency import run_in_threadpool

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/resumes", tags=["resumes"])

@router.post("/parse")
async def parse_uploaded_resume(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    _rl: None = Depends(rate_limit("resume_parse", 6, 3600)),
):
    """
    Accepts resume PDF, extracts metrics on-the-fly, and returns structured Candidate Profile data.
    The raw PDF is discarded immediately and never saved.
    """
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF resumes are supported.")

    try:
        contents = await file.read()
        if len(contents) > 5 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="PDF exceeds the 5MB limit.")
        # PDF extraction/OCR is CPU-heavy and the parser may call the LLM —
        # running it inline in this async endpoint froze the single-worker
        # event loop (EVERY request, all users) for the whole parse.
        parsed_data = await run_in_threadpool(parse_resume_pdf, contents)
        return parsed_data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to parse uploaded resume: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Resume parsing failure: {str(e)}")

@router.get("/me")
def get_user_resume(
    include_files: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Retrieves the user's standard structured resume data.
    Decrypts the resume JSON client-side (or in-memory using session key).

    The encrypted PDF/raw-text blobs (100KB+ each) are only included with
    ?include_files=1 — shipping them on every fetch multiplied DB egress
    for data most screens never use.
    """
    derived_key = get_session_key(current_user.id)
    if not derived_key:
        raise HTTPException(status_code=400, detail="Vault session key missing. Please log in.")

    version = get_user_version(current_user.id)
    cache_key = f"nextup:cache:user:{current_user.id}:resumes_me:v{version}:files{int(include_files)}"
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
            "has_pdf": bool(resume.pdf_file_enc),
            "pdf_filename_enc": resume.pdf_filename_enc,
        }
        if include_files:
            res["raw_text_enc"] = resume.raw_text_enc
            res["pdf_file_enc"] = resume.pdf_file_enc
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
from app.models.models import AiGenerationJob, Company, Application
from app.services.latex_renderer import render_resume_to_pdf

class ResumeGenerateRequest(BaseModel):
    company_id: UUID
    custom_prompt: Optional[str] = None
    latex_template: str = "Classic"
    # Which of the drive's roles to tailor for (multi-role drives like ION
    # announce several roles, each with its own JD PDF). None = primary role.
    target_role: Optional[str] = None

class AcceptChangesRequest(BaseModel):
    job_id: UUID
    accept_skills: bool = True
    accept_summary: bool = True
    accept_projects: bool = True

@router.post("/generate")
def start_resume_tailoring_job(
    req: ResumeGenerateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _rl: None = Depends(rate_limit("resume_generate", 3, 600)),
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

    # 4. Decrypt the master resume NOW, while the session key is guaranteed
    # present, and snapshot it into the job (re-encrypted with a server-derived
    # key). The background worker then never depends on the in-memory session
    # cache — this was the cause of "Session vault key is missing" failures
    # whenever the backend restarted between submission and processing.
    derived_key = get_session_key(current_user.id)
    if not derived_key:
        raise HTTPException(
            status_code=400,
            detail="Vault session key missing. Please log in again to authorize resume access."
        )

    resume = db.query(Resume).filter(Resume.user_id == current_user.id).first()
    if not resume or not resume.resume_json_enc:
        raise HTTPException(status_code=400, detail="Upload your master resume before tailoring.")

    try:
        resume_data = json.loads(decrypt_field(resume.resume_json_enc, derived_key))
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to decrypt your master resume.")

    # target_role rides in the snapshot (no schema change needed): the
    # pipeline reads it to pick the role-specific JD on multi-role drives.
    target_role = (req.target_role or "").strip()[:255] or None
    input_payload_enc = server_encrypt_field(json.dumps({
        "resume_data": resume_data,
        "target_role": target_role,
    }))

    # 5. Create queued job. custom_prompt is user free-text destined for the
    # LLM prompt — sanitize against prompt injection before persisting.
    job = AiGenerationJob(
        user_id=current_user.id,
        company_id=req.company_id,
        job_type="resume_tailor",
        request_source="cloud",
        custom_prompt=sanitize_user_prompt(req.custom_prompt) if req.custom_prompt else None,
        status="queued",
        input_payload_enc=input_payload_enc
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    logger.info(f"Queued resume tailoring job {job.id} for user {current_user.id} targeting company {req.company_id}.")
    return {"status": "success", "job_id": job.id}

@router.get("/jobs-latest")
def get_latest_resume_job(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """The user's most recent tailoring job — lets the resume page re-attach
    to an in-flight generation after navigating away (the job runs server-side
    and its suggestions persist in result_json, so nothing is lost)."""
    job = db.query(AiGenerationJob).filter(
        AiGenerationJob.user_id == current_user.id,
        AiGenerationJob.job_type == "resume_tailor",
    ).order_by(AiGenerationJob.created_at.desc()).first()

    if not job:
        return {"job": None}

    return {
        "job": {
            "job_id": str(job.id),
            "company_id": str(job.company_id) if job.company_id else None,
            "status": job.status,
            "created_at": job.created_at,
            "completed_at": job.completed_at,
            "result": job.result_json if job.status == "completed" else None,
        }
    }


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
    current_user: User = Depends(get_current_user),
    _rl: None = Depends(rate_limit("resume_accept", 12, 600)),
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

    # 4. Build the TAILORED copy by applying accepted changes.
    # IMPORTANT: the master resume is never modified — tailoring is
    # company-specific and overwriting the master would corrupt the source
    # used for every future drive (and previously also destroyed the
    # student's original uploaded PDF).
    tailored_data = json.loads(json.dumps(current_data))  # deep copy
    result = job.result_json

    if req.accept_summary and result.get("optimized_summary"):
        tailored_data["summary"] = result["optimized_summary"]

    if req.accept_skills and result.get("optimized_skills"):
        tailored_data["skills"] = result["optimized_skills"]

    if req.accept_projects and result.get("optimized_projects"):
        # Match projects by title and update descriptions
        opt_projects = result["optimized_projects"]
        master_projects = tailored_data.get("projects", [])

        for op in opt_projects:
            title = op.get("title", "").strip().lower()
            desc = op.get("description", "")
            for mp in master_projects:
                if mp.get("title", "").strip().lower() == title:
                    mp["description"] = desc
                    break

    # 5. Render the tailored PDF
    company = db.query(Company).filter(Company.id == job.company_id).first() if job.company_id else None
    company_slug = (company.name if company else "company").strip().replace(" ", "_")[:40]
    pdf_filename = f"resume_{company_slug}.pdf"

    pdf_base64 = None
    try:
        pdf_bytes = render_resume_to_pdf(resume.latex_template or "Classic", tailored_data)
        pdf_base64 = base64.b64encode(pdf_bytes).decode("utf-8")
    except Exception as pdf_err:
        logger.error(f"Failed to compile PDF during accept-changes: {pdf_err}")
        # Non-blocking: the tailored JSON is still stored below

    # 6. Persist the tailored copy on the student's application for this drive
    # (encrypted with the session key, like other per-user documents).
    if job.company_id:
        application = db.query(Application).filter(
            Application.user_id == current_user.id,
            Application.company_id == job.company_id
        ).first()
        if not application:
            # user_decision MUST stay 'unseen': tailoring a resume is not
            # applying. Creating this row as 'tracking' silently moved the
            # drive out of Opportunities into Active Tracking even though
            # the student never registered.
            application = Application(
                user_id=current_user.id,
                company_id=job.company_id,
                status="Applied",
                user_decision="unseen"
            )
            db.add(application)
        try:
            tailored_blob = json.dumps({
                "resume_data": tailored_data,
                "pdf_base64": pdf_base64,
                "pdf_filename": pdf_filename,
                "job_id": str(job.id),
                "generated_at": datetime.utcnow().isoformat()
            })
            application.tailored_resume_enc = encrypt_field(tailored_blob, derived_key)
        except Exception as enc_err:
            logger.error(f"Failed to encrypt tailored resume copy: {enc_err}")

    db.commit()
    bump_user_version(current_user.id)

    return {
        "status": "success",
        "message": "Tailored resume generated. Your master resume is unchanged.",
        "pdf_base64": pdf_base64,
        "pdf_filename": pdf_filename,
        "tailored_resume": tailored_data
    }

