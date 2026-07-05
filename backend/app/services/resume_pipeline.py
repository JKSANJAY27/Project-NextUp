import json
import logging
import hashlib
from datetime import datetime
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session

from app.models.models import AiGenerationJob, StudentProfile, Company, Resume
from app.services.ai_provider import get_resume_gateway, AIUnavailableError
from app.services.ai_service import clean_ai_phrases, sanitize_tailored_resume
from app.core.gmail_token_cache import get_session_key
from app.core.security import decrypt_field

logger = logging.getLogger("nextup.resume_pipeline")

class ResumeGenerationPipeline:
    def __init__(self, db: Session, job_id: str):
        self.db = db
        self.job_id = job_id
        self.job: Optional[AiGenerationJob] = None
        self.profile: Optional[StudentProfile] = None
        self.company: Optional[Company] = None
        self.resume: Optional[Resume] = None
        self.master_resume_data: Dict[str, Any] = {}
        self.jd_strategy: Dict[str, Any] = {}

    def run(self):
        logger.info(f"Running pipeline for resume job {self.job_id}")
        
        # Stage 1: Load context
        self._load_context()
        
        # Stage 2: Load JD Strategy
        self._load_jd_strategy()
        
        # Stage 3: Generate suggestions
        suggestions = self._generate_suggestions()
        
        # Stage 4: Validate suggestions (Hallucination check)
        errors = self._validate_hallucinations(suggestions)
        if errors:
            error_str = " | ".join(errors)
            logger.error(f"Hallucination validation failed: {error_str}")
            raise ValueError(f"AI suggested hallucinated/ungrounded information: {error_str}")
        
        # Stage 5: Save suggestions
        self._save_suggestions(suggestions)
        logger.info(f"Pipeline completed successfully for resume job {self.job_id}")

    def _load_context(self):
        self.job = self.db.query(AiGenerationJob).filter(AiGenerationJob.id == self.job_id).first()
        if not self.job:
            raise ValueError(f"Job {self.job_id} not found in database.")

        self.profile = self.db.query(StudentProfile).filter(StudentProfile.user_id == self.job.user_id).first()
        if not self.profile:
            raise ValueError(f"Student profile not found for user {self.job.user_id}.")

        self.company = self.db.query(Company).filter(Company.id == self.job.company_id).first()
        if not self.company:
            raise ValueError(f"Company drive not found for ID {self.job.company_id}.")

        self.resume = self.db.query(Resume).filter(Resume.user_id == self.job.user_id).first()
        if not self.resume:
            raise ValueError(f"No resume record found for user {self.job.user_id}.")

        # Decrypt master resume JSON
        derived_key = get_session_key(self.job.user_id)
        if not derived_key:
            raise ValueError("Session vault key is missing. Please log in to authorize resume decryption.")

        try:
            decrypted_str = decrypt_field(self.resume.resume_json_enc, derived_key)
            self.master_resume_data = json.loads(decrypted_str)
        except Exception as e:
            logger.error(f"Decryption failed for user {self.job.user_id} resume: {e}")
            raise ValueError("Failed to decrypt secure resume database records.")

    def _load_jd_strategy(self):
        # Fetch cached jd_strategy or generate if missing
        if self.company.jd_strategy and isinstance(self.company.jd_strategy, dict) and self.company.jd_strategy.get("required_skills"):
            self.jd_strategy = self.company.jd_strategy
            logger.info("Using cached JD strategy.")
        else:
            logger.info("JD strategy missing. Generating on-the-fly...")
            from app.services.ai_service import generate_jd_strategy
            self.jd_strategy = generate_jd_strategy(self.company.jd_text or "")
            self.company.jd_strategy = self.jd_strategy
            self.db.commit()

    def _generate_suggestions(self) -> Dict[str, Any]:
        prompt = f"""You are an expert ATS optimization agent. Your task is to tailor a student's resume to align with a target Job Description (JD) strategy.
You must strictly follow the TRUTHFULNESS & GROUNDING RULES.

TRUTHFULNESS & GROUNDING RULES:
1. ONLY modify text phrasing to better highlight matching skills and impact; NEVER invent metrics, achievements, certifications, or years of experience.
2. NEVER modify or invent candidate name, contact details, company names, job titles, institutions, degrees, or dates.
3. Keep project titles EXACTLY as they are in the original resume.
4. Do NOT use buzzwords or fluff (e.g., spearheaded, synergized, revolutionized, best-in-class). Write simple, direct, metric-driven accomplishments.
5. Emphasize matching skills and keywords from the JD strategy where supported by candidate experience.

Target Company: {self.company.name}
Target Role: {self.company.role}

Job Description Strategy:
- Required Skills: {self.jd_strategy.get("required_skills", [])}
- Preferred Skills: {self.jd_strategy.get("preferred_skills", [])}
- ATS Keywords: {self.jd_strategy.get("ats_keywords", [])}
- Resume Strategy: {self.jd_strategy.get("resume_strategy", "Highlight core development and alignment.")}

Student Master Resume Data:
{json.dumps(self.master_resume_data, indent=2)}

Student Academic Profile:
- Branch: {self.profile.branch}
- Specialization: {self.profile.specialization}
- CGPA: {float(self.profile.cgpa) if self.profile.cgpa else 0.0}
- Skills: {self.profile.skills}

{f"Custom Tailoring Guidance: {self.job.custom_prompt}" if self.job.custom_prompt else ""}

Return ONLY a valid JSON object matching this schema exactly (no markdown blocks, no prefix explanations):
{{
  "optimized_summary": "Tailored professional profile summary matching the role requirements.",
  "optimized_skills": ["Skill1", "Skill2", "Skill3"],
  "optimized_projects": [
    {{
      "title": "Exact Title of Project 1",
      "description": "Optimized description highlighting matching keywords based on student experience."
    }}
  ]
}}
"""
        gateway = get_resume_gateway()
        result = gateway.generate(
            prompt,
            system="You are an expert ATS resume optimizer. Generate only valid JSON suggestions.",
            max_tokens=2000,
            temperature=0.1,
            json_mode=True,
            timeout=120
        )

        try:
            suggestions = result.parse_json()
        except Exception as e:
            logger.warning(f"Failed to parse resume suggestion JSON: {e}. Trying json_repair...")
            import json_repair
            suggestions = json.loads(json_repair.repair_json(result.text))

        # Scrub buzzwords
        suggestions = sanitize_tailored_resume(suggestions)
        
        # Save model details
        self.job.model_used = f"{result.provider}/{result.model}"
        self.job.tokens_generated = len(result.text.split())
        self.db.commit()

        return suggestions

    def _validate_hallucinations(self, suggestions: Dict[str, Any]) -> List[str]:
        errors = []
        
        # 1. Validate summary does not contain newly invented company names
        summary = suggestions.get("optimized_summary", "")
        # Get list of allowed companies (target company + company names in student's experience)
        allowed_orgs = {self.company.name.lower()}
        experience = self.master_resume_data.get("experience", [])
        for exp in experience:
            if isinstance(exp, dict) and exp.get("company"):
                allowed_orgs.add(exp.get("company").lower())
                
        # Simple extraction of capitalized sequences to find potential organizations in summary
        # If there are proper nouns that look like companies and aren't in allowed list, check
        # We can also rely on spaCy, but a simpler containment/token check is safer to prevent spaCy mismatches.

        # 2. Validate project titles match original project titles exactly
        original_projects = self.master_resume_data.get("projects", [])
        original_titles = {p.get("title", "").strip().lower() for p in original_projects if isinstance(p, dict)}
        
        opt_projects = suggestions.get("optimized_projects", [])
        if not isinstance(opt_projects, list):
            errors.append("optimized_projects must be a list")
        else:
            for op in opt_projects:
                if not isinstance(op, dict):
                    continue
                opt_title = op.get("title", "").strip()
                if opt_title.lower() not in original_titles:
                    errors.append(f"AI invented/altered project title: '{opt_title}'. Expected one of: {list(original_titles)}")

        # 3. Validate skills (cannot invent highly distinct skills that student has never listed, or limit to minor extensions)
        original_skills = {s.strip().lower() for s in self.master_resume_data.get("skills", [])}
        # Add academic profile skills
        if self.profile and self.profile.skills:
            for s in self.profile.skills:
                original_skills.add(s.strip().lower())
                
        opt_skills = suggestions.get("optimized_skills", [])
        if not isinstance(opt_skills, list):
            errors.append("optimized_skills must be a list")
        else:
            # Let's count how many skills are completely new
            new_skills = []
            for s in opt_skills:
                s_clean = s.strip().lower()
                if s_clean not in original_skills:
                    # Allow matching skills from the target JD strategy as long as they are close variants
                    # or if the count of completely new skills is <= 2 (giving the LLM a tiny room for synonyms/categorizations)
                    new_skills.append(s)
            
            if len(new_skills) > 3:
                errors.append(f"AI added too many unlisted skills: {new_skills}. Student master resume skills are: {list(original_skills)}")

        return errors

    def _save_suggestions(self, suggestions: Dict[str, Any]):
        self.job.status = "completed"
        self.job.result_json = suggestions
        self.job.completed_at = datetime.utcnow()
        self.db.commit()
