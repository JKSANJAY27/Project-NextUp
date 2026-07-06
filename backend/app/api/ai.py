import json
import logging
from uuid import UUID
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.database import get_db
from app.core.ratelimit import rate_limit
from app.core.sanitize import sanitize_user_prompt
from app.api.auth import get_current_user
from app.models.models import User, Company, StudentProfile, Resume
from app.services.ai_service import (
    generate_sop_deterministic,
    generate_cover_letter_deterministic,
    generate_interview_prep_deterministic,
    precompute_jd_intelligence_deterministic,
    call_huggingface_llm,
    sanitize_tailored_resume
)
from app.services.match_scorer import calculate_match_score

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ai", tags=["ai"])

# Pydantic schemas
class AIRequest(BaseModel):
    company_id: UUID
    request_source: str = Field(..., pattern="^(browser|cloud|fallback)$")
    custom_prompt: Optional[str] = None

class DocumentSaveRequest(BaseModel):
    company_id: UUID
    doc_type: str = Field(..., pattern="^(sop|cover_letter)$")
    content: str

# Endpoints
@router.post("/tailor")
def tailor_resume(
    req: AIRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _rl: None = Depends(rate_limit("ai_tailor", 5, 600))
):
    profile = db.query(StudentProfile).filter(StudentProfile.user_id == current_user.id).first()
    company = db.query(Company).filter(Company.id == req.company_id).first()
    resume = db.query(Resume).filter(Resume.user_id == current_user.id).first()
    
    if not company:
        raise HTTPException(status_code=404, detail="Company drive announcement not found.")
        
    student_skills = profile.skills if profile else []
    jd_skills = company.jd_required_skills or []
    student_cgpa = float(profile.cgpa) if (profile and profile.cgpa) else None
    company_cgpa = float(company.eligibility_rules.get("min_cgpa")) if (company.eligibility_rules and company.eligibility_rules.get("min_cgpa")) else None
    
    # 1. Deterministic calculation
    ats_score = calculate_match_score(student_skills, jd_skills, student_cgpa, company_cgpa)
    
    # 2. Extract gap analysis
    from app.services.match_scorer import normalize_skill
    student_skills_normalized = [normalize_skill(s) for s in student_skills]
    missing_skills = [s for s in jd_skills if normalize_skill(s) not in student_skills_normalized]
    
    improvements = []
    for s in missing_skills:
        improvements.append(f"Add a project or highlight experience showing your capabilities with {s}.")
    if not student_skills:
        improvements.append("Complete your student profile skills list to enhance matching capability.")
    if student_cgpa and company_cgpa and student_cgpa < company_cgpa:
        improvements.append(f"Note: Your CGPA ({student_cgpa}) is below the required threshold ({company_cgpa}). Check if you can apply with exception.")

    # 3. Generate optimized resume JSON suggestions
    optimized_skills = list(student_skills)
    optimized_projects = []
    optimized_summary = f"Highly motivated Software Engineering candidate with experience in core development techniques. Eager to apply skills at {company.name}."
    
    # Standard fallback dictionary
    fallback_response = {
        "ats_score": ats_score,
        "missing_keywords": missing_skills,
        "improvements": improvements,
        "tailored_resume": {
            "optimized_skills": optimized_skills,
            "optimized_projects": optimized_projects,
            "optimized_summary": optimized_summary
        }
    }
    
    # If using cloud AI, submit background job instead of synchronous call
    if req.request_source == "cloud":
        from app.core.config import settings
        from app.models.models import AiGenerationJob
        from app.core.gmail_token_cache import get_session_key
        from datetime import datetime, timedelta

        # Check queue backlog limit
        backlog_count = db.query(AiGenerationJob).filter(AiGenerationJob.status == "queued").count()
        if backlog_count >= settings.RESUME_JOBS_MAX_BACKLOG:
            raise HTTPException(
                status_code=503,
                detail="Server busy: The resume worker queue is currently full. Please try again later."
            )

        # Check Daily Limit
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

        # Check session vault key
        derived_key = get_session_key(current_user.id)
        if not derived_key:
            raise HTTPException(
                status_code=400,
                detail="Vault session key missing. Please log in again to authorize resume access."
            )

        # Create queued job
        job = AiGenerationJob(
            user_id=current_user.id,
            company_id=req.company_id,
            job_type="resume_tailor",
            request_source="cloud",
            custom_prompt=sanitize_user_prompt(req.custom_prompt) if req.custom_prompt else None,
            status="queued"
        )
        db.add(job)
        db.commit()
        db.refresh(job)

        logger.info(f"Queued resume tailoring job {job.id} via /tailor endpoint.")
        return {"status": "queued", "job_id": job.id}
        
    return fallback_response

@router.post("/sop")
def generate_sop(
    req: AIRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _rl: None = Depends(rate_limit("ai_sop", 5, 600))
):
    profile = db.query(StudentProfile).filter(StudentProfile.user_id == current_user.id).first()
    company = db.query(Company).filter(Company.id == req.company_id).first()
    
    if not company:
        raise HTTPException(status_code=404, detail="Company drive announcement not found.")
        
    if req.request_source == "cloud":
        skills_str = ", ".join(profile.skills) if (profile and profile.skills) else "Software Engineering"
        prompt = f"""Write a professional, ATS-friendly Statement of Purpose (SOP) for an application to:
Company: {company.name}
Role: {company.role}

Student Academic Background:
Branch: {profile.branch if profile else "Engineering"}
CGPA: {float(profile.cgpa) if (profile and profile.cgpa) else 0.0}
Skills: {skills_str}

Job Description context:
{company.jd_text or ""}

The SOP should be professional, company-aware, and tell a compelling story. Return ONLY the raw Statement of Purpose text (no JSON, no intro conversational chat, just the SOP)."""
        try:
            ai_text = call_huggingface_llm(prompt, str(current_user.id), "sop", "cloud", db)
            return {"sop": ai_text}
        except Exception as e:
            logger.error(f"Cloud SOP failed: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))
            
    # Deterministic fallback
    sop = generate_sop_deterministic(profile, company)
    return {"sop": sop}

@router.post("/cover-letter")
def generate_cover_letter(
    req: AIRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _rl: None = Depends(rate_limit("ai_cover", 5, 600))
):
    profile = db.query(StudentProfile).filter(StudentProfile.user_id == current_user.id).first()
    company = db.query(Company).filter(Company.id == req.company_id).first()
    
    if not company:
        raise HTTPException(status_code=404, detail="Company drive announcement not found.")
        
    if req.request_source == "cloud":
        skills_str = ", ".join(profile.skills) if (profile and profile.skills) else "Software Engineering"
        prompt = f"""Write a professional Cover Letter applying for the following role:
Company: {company.name}
Role: {company.role}

Student Profile:
Name: {profile.full_name if profile else "Student"}
Branch: {profile.branch if profile else "Engineering"}
Skills: {skills_str}

Job Description context:
{company.jd_text or ""}

Return ONLY the raw Cover Letter text (no intro, no explanations, no JSON, just the document)."""
        try:
            ai_text = call_huggingface_llm(prompt, str(current_user.id), "cover_letter", "cloud", db)
            return {"cover_letter": ai_text}
        except Exception as e:
            logger.error(f"Cloud Cover Letter failed: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))
            
    # Deterministic fallback
    cl = generate_cover_letter_deterministic(profile, company)
    return {"cover_letter": cl}

@router.post("/interview-prep")
def generate_interview_prep(
    req: AIRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _rl: None = Depends(rate_limit("ai_prep", 5, 600))
):
    profile = db.query(StudentProfile).filter(StudentProfile.user_id == current_user.id).first()
    company = db.query(Company).filter(Company.id == req.company_id).first()
    
    if not company:
        raise HTTPException(status_code=404, detail="Company drive announcement not found.")
        
    # Get base deterministic questions (Technical and HR are always deterministic)
    prep = generate_interview_prep_deterministic(profile, company)
    
    if req.request_source == "cloud":
        prompt = f"""Based on this company and role, generate 3 highly targeted company-specific/behavioral interview preparation questions.
Company: {company.name}
Role: {company.role}
Job Description:
{company.jd_text or ""}

Candidate Skills:
{", ".join(profile.skills if profile else [])}

Return the questions as a JSON array of strings (no other text, no code blocks):
["Question 1", "Question 2", "Question 3"]"""
        try:
            ai_text = call_huggingface_llm(prompt, str(current_user.id), "interview_prep", "cloud", db)
            try:
                clean_text = ai_text.strip()
                if clean_text.startswith("```"):
                    clean_text = clean_text.split("```")[1]
                    if clean_text.startswith("json"):
                        clean_text = clean_text[4:]
                questions = json.loads(clean_text)
                prep["company_specific"] = questions
            except Exception:
                logger.warning("Failed to parse Cloud LLM interview questions as JSON array.")
        except Exception as e:
            logger.error(f"Cloud Interview Prep failed: {str(e)}")
            
    return prep

# Document drafts saving and versioning endpoints
@router.post("/documents/save")
def save_document_version(
    req: DocumentSaveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Verify company exists
    company = db.query(Company).filter(Company.id == req.company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found.")
        
    # Get latest version number
    version_row = db.execute(text("""
        SELECT COALESCE(MAX(version), 0) FROM student_documents 
        WHERE user_id = :user_id 
          AND company_id = :company_id 
          AND doc_type = :doc_type
    """), {
        "user_id": current_user.id,
        "company_id": req.company_id,
        "doc_type": req.doc_type
    }).fetchone()
    
    next_version = (version_row[0] if version_row else 0) + 1
    
    # Insert new versioned draft
    db.execute(text("""
        INSERT INTO student_documents (user_id, company_id, doc_type, version, content)
        VALUES (:user_id, :company_id, :doc_type, :version, :content)
    """), {
        "user_id": current_user.id,
        "company_id": req.company_id,
        "doc_type": req.doc_type,
        "version": next_version,
        "content": req.content
    })
    db.commit()
    
    return {
        "status": "success",
        "message": f"Saved {req.doc_type.upper()} Draft version {next_version}.",
        "version": next_version
    }

@router.get("/documents")
def list_document_versions(
    company_id: UUID,
    doc_type: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if doc_type not in ('sop', 'cover_letter'):
        raise HTTPException(status_code=400, detail="Invalid doc_type. Must be 'sop' or 'cover_letter'.")
        
    versions = db.execute(text("""
        SELECT version, content, created_at FROM student_documents 
        WHERE user_id = :user_id 
          AND company_id = :company_id 
          AND doc_type = :doc_type
        ORDER BY version DESC
    """), {
        "user_id": current_user.id,
        "company_id": company_id,
        "doc_type": doc_type
    }).fetchall()
    
    result = []
    for v in versions:
        result.append({
            "version": v[0],
            "content": v[1],
            "created_at": v[2]
        })
    return result

@router.get("/documents/latest")
def get_latest_document(
    company_id: UUID,
    doc_type: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if doc_type not in ('sop', 'cover_letter'):
        raise HTTPException(status_code=400, detail="Invalid doc_type. Must be 'sop' or 'cover_letter'.")
        
    latest = db.execute(text("""
        SELECT version, content, created_at FROM student_documents 
        WHERE user_id = :user_id 
          AND company_id = :company_id 
          AND doc_type = :doc_type
        ORDER BY version DESC LIMIT 1
    """), {
        "user_id": current_user.id,
        "company_id": company_id,
        "doc_type": doc_type
    }).fetchone()
    
    if not latest:
        return {"version": 0, "content": ""}
        
    return {
        "version": latest[0],
        "content": latest[1],
        "created_at": latest[2]
    }


@router.get("/jd-strategy/{company_id}")
def get_company_jd_strategy(
    company_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    from app.core.redis import get_jd_strategy_cache, set_jd_strategy_cache
    
    # Try Redis cache first
    cached = get_jd_strategy_cache(company_id)
    if cached is not None:
        logger.info(f"Loaded JD Strategy for company {company_id} from Redis cache.")
        return cached

    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company drive not found.")

    strategy = company.jd_strategy
    if not strategy or not isinstance(strategy, dict) or not strategy.get("required_skills"):
        from app.services.ai_service import generate_jd_strategy
        strategy = generate_jd_strategy(company.jd_text or "")
        company.jd_strategy = strategy
        db.commit()

    # Save to Redis
    set_jd_strategy_cache(company_id, strategy)
    return strategy

