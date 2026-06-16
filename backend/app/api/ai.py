import json
import logging
from uuid import UUID
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.database import get_db
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
    current_user: User = Depends(get_current_user)
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
    
    # If using cloud AI
    if req.request_source == "cloud":
        # Check if resume JSON is set
        resume_data_str = "{}"
        if resume and resume.resume_json_enc:
            # We can't decrypt on the server if they don't send x-client-key, but we can use session cached key!
            from app.core.gmail_token_cache import get_session_key
            derived_key = get_session_key(current_user.id)
            if derived_key:
                from app.core.security import decrypt_field
                try:
                    resume_data_str = decrypt_field(resume.resume_json_enc, derived_key)
                except Exception:
                    pass
        
        prompt = f"""You are an expert ATS optimizer. Analyze the student's Resume JSON and the Job Description text.
Generate a JSON output tailoring the resume to fit the JD perfectly.

TRUTHFULNESS & GROUNDING RULES:
1. ONLY modify text phrasing to better align with the JD; NEVER invent metrics, years of experience, certifications, or achievements.
2. NEVER modify or invent candidate name, contact details, company names, job titles, institutions, degrees, or dates.
3. Keep project titles exactly as they are in the original resume.
4. Do NOT use buzzwords or fluff (e.g., spearheaded, synergized, revolutionized, best-in-class). Write simple, direct, metric-driven accomplishments.
5. Emphasize matching skills and keywords from the Job Description where supported by candidate experience.

Student Resume Data:
{resume_data_str}

Company JD Text:
{company.jd_text or ""}

Required Skills:
{", ".join(jd_skills)}

Return ONLY a valid JSON object matching this schema exactly (no markdown blocks, no prefix explanations):
{{
  "ats_score": 85,
  "missing_keywords": ["Kubernetes", "Redis"],
  "improvements": ["Highlight cloud project", "Move Python to core skills"],
  "tailored_resume": {{
    "optimized_skills": ["Python", "React", "Docker"],
    "optimized_projects": [
      {{
        "title": "Project Title",
        "description": "Optimized description highlighting matching keywords from the JD based on original text"
      }}
    ],
    "optimized_summary": "Tailored professional profile summary matching the role requirements."
  }}
}}
"""
        try:
            ai_text = call_huggingface_llm(prompt, str(current_user.id), "resume_tailor", "cloud", db)
            # Try parsing JSON
            try:
                # Strip markdown code blocks if present
                clean_text = ai_text.strip()
                if clean_text.startswith("```"):
                    clean_text = clean_text.split("```")[1]
                    if clean_text.startswith("json"):
                        clean_text = clean_text[4:]
                parsed_res = json.loads(clean_text)
                return sanitize_tailored_resume(parsed_res)
            except Exception:
                logger.warning("Failed to parse Cloud LLM response as JSON. Falling back to deterministic.")
                return fallback_response
        except Exception as e:
            logger.error(f"Cloud AI Tailor failed: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))
            
    return fallback_response

@router.post("/sop")
def generate_sop(
    req: AIRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
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
    current_user: User = Depends(get_current_user)
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
    current_user: User = Depends(get_current_user)
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
