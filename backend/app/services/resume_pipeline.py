import json
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.models import AiGenerationJob, StudentProfile, Company, Resume
from app.services.ai_provider import get_resume_gateway
from app.services.ai_service import sanitize_tailored_resume
from app.core.gmail_token_cache import get_session_key
from app.core.security import decrypt_field, server_decrypt_field

logger = logging.getLogger("nextup.resume_pipeline")

# Free-tier Space CPUs evaluate ~10-20 prompt tokens/sec and generate ~3-5
# tokens/sec, so BOTH input and output must stay small for jobs to finish
# in minutes. These caps keep the prompt ≈1200-1800 tokens.
MAX_PROJECTS = 6
MAX_PROJECT_DESC_CHARS = 500
MAX_EXPERIENCE = 4
MAX_SKILLS = 30
MAX_SUMMARY_CHARS = 700
MAX_OUTPUT_TOKENS = 900


class ResumeGenerationPipeline:
    def __init__(self, db: Session, job_id: str):
        self.db = db
        self.job_id = job_id
        self.job: Optional[AiGenerationJob] = None
        self.profile: Optional[StudentProfile] = None
        self.company: Optional[Company] = None
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

        # Preferred path: the submission endpoint snapshotted the decrypted
        # resume into the job row (server-key encrypted). This works even if
        # the backend restarted or the user's session key expired since.
        if self.job.input_payload_enc:
            try:
                snapshot = json.loads(server_decrypt_field(self.job.input_payload_enc))
                self.master_resume_data = snapshot.get("resume_data", {})
                if self.master_resume_data:
                    return
            except Exception as e:
                logger.warning(f"Job {self.job_id}: input snapshot unreadable ({e}); "
                               "falling back to session-key decryption.")

        # Legacy fallback: decrypt the stored resume with the cached session key.
        resume = self.db.query(Resume).filter(Resume.user_id == self.job.user_id).first()
        if not resume:
            raise ValueError(f"No resume record found for user {self.job.user_id}.")

        derived_key = get_session_key(self.job.user_id)
        if not derived_key:
            raise ValueError("Session vault key is missing. Please log in to authorize resume decryption.")

        try:
            decrypted_str = decrypt_field(resume.resume_json_enc, derived_key)
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
            # Use the resume gateway here: this code runs inside the resume
            # worker and must not compete with email parsing for the parser
            # container's CPU.
            self.jd_strategy = generate_jd_strategy(
                self.company.jd_text or "",
                gateway=get_resume_gateway(),
                role=self.company.role,
                company_name=self.company.name,
            )
            self.company.jd_strategy = self.jd_strategy
            self.db.commit()

    def _compact_resume_view(self) -> Dict[str, Any]:
        """Trim the master resume to only the sections the AI may rewrite.

        Education, personal details, certifications, links etc. are rendered
        deterministically from the master resume — the model never sees them,
        which keeps prompts small and prevents hallucinated edits.
        """
        data = self.master_resume_data or {}

        summary = (data.get("summary") or "")[:MAX_SUMMARY_CHARS]

        skills = [str(s) for s in (data.get("skills") or [])][:MAX_SKILLS]

        projects = []
        for p in (data.get("projects") or [])[:MAX_PROJECTS]:
            if isinstance(p, dict):
                projects.append({
                    "title": str(p.get("title", ""))[:120],
                    "description": str(p.get("description", ""))[:MAX_PROJECT_DESC_CHARS],
                })

        experience = []
        for e in (data.get("experience") or [])[:MAX_EXPERIENCE]:
            if isinstance(e, dict):
                experience.append({
                    "role": str(e.get("role", e.get("title", "")))[:100],
                    "company": str(e.get("company", ""))[:100],
                    "description": str(e.get("description", ""))[:300],
                })

        return {"summary": summary, "skills": skills,
                "projects": projects, "experience": experience}

    def _compact_strategy_view(self) -> Dict[str, Any]:
        s = self.jd_strategy or {}
        def _lst(key, cap):
            vals = s.get(key) or []
            return [str(v) for v in vals][:cap] if isinstance(vals, list) else []
        return {
            "required_skills": _lst("required_skills", 15),
            "preferred_skills": _lst("preferred_skills", 10),
            "ats_keywords": _lst("ats_keywords", 20),
            "resume_strategy": str(s.get("resume_strategy", "Highlight matching skills and impact."))[:400],
            "role_summary": str(s.get("role_summary", ""))[:200],
        }

    def _generate_suggestions(self) -> Dict[str, Any]:
        resume_view = self._compact_resume_view()
        strategy_view = self._compact_strategy_view()

        custom = ""
        if self.job.custom_prompt:
            custom = f"\nExtra guidance from the student: {self.job.custom_prompt[:500]}\n"

        prompt = f"""Tailor a student's resume for a specific job. Follow the RULES exactly.

RULES:
1. Only rephrase and reorder existing content. NEVER invent metrics, tools, projects, certifications, or experience the student did not list.
2. Keep every project title EXACTLY as given.
3. optimized_skills must only contain skills from the student's list (you may reorder to put JD-matching skills first, and drop irrelevant ones).
4. No buzzwords (spearheaded, synergized, leveraged, cutting-edge...). Simple, direct, impact-focused wording.
5. Weave the JD's ATS keywords into the summary and project descriptions ONLY where the student's real experience supports them.

TARGET: {self.company.role} at {self.company.name}
JD STRATEGY: {json.dumps(strategy_view, ensure_ascii=False)}

STUDENT RESUME (editable sections only):
{json.dumps(resume_view, ensure_ascii=False)}

STUDENT PROFILE: branch={self.profile.branch}, specialization={self.profile.specialization}, cgpa={float(self.profile.cgpa) if self.profile.cgpa else 0.0}
{custom}
Return ONLY this JSON (no markdown, no explanations):
{{
  "optimized_summary": "2-3 sentence professional summary tailored to the role",
  "optimized_skills": ["reordered", "subset", "of the student's skills"],
  "optimized_projects": [
    {{"title": "EXACT original title", "description": "rephrased ATS-friendly description"}}
  ]
}}"""

        gateway = get_resume_gateway()
        result = gateway.generate(
            prompt,
            system="You are an ATS resume optimizer. Output only valid JSON.",
            max_tokens=MAX_OUTPUT_TOKENS,
            temperature=0.1,
            json_mode=True,
            timeout=settings.RESUME_AI_TIMEOUT_SECONDS,
            purpose="resume_tailor",
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

        # 1. Validate project titles match original project titles exactly
        original_projects = self.master_resume_data.get("projects", [])
        original_titles = {p.get("title", "").strip().lower() for p in original_projects if isinstance(p, dict)}

        opt_projects = suggestions.get("optimized_projects", [])
        if not isinstance(opt_projects, list):
            errors.append("optimized_projects must be a list")
        else:
            valid_projects = []
            for op in opt_projects:
                if not isinstance(op, dict):
                    continue
                opt_title = op.get("title", "").strip()
                if opt_title.lower() in original_titles:
                    valid_projects.append(op)
                else:
                    # Drop the invented project instead of failing the whole
                    # job — the remaining verified suggestions are still useful.
                    logger.warning(
                        f"Dropping AI project with unknown title: '{opt_title}'."
                    )
            suggestions["optimized_projects"] = valid_projects

        # 2. Validate skills (drop skills the student never listed)
        original_skills = {s.strip().lower() for s in self.master_resume_data.get("skills", [])}
        if self.profile and self.profile.skills:
            for s in self.profile.skills:
                original_skills.add(s.strip().lower())

        opt_skills = suggestions.get("optimized_skills", [])
        if not isinstance(opt_skills, list):
            errors.append("optimized_skills must be a list")
        else:
            grounded = [s for s in opt_skills
                        if isinstance(s, str) and s.strip().lower() in original_skills]
            dropped = [s for s in opt_skills if s not in grounded]
            if dropped:
                logger.warning(f"Dropping unlisted AI skills: {dropped}")
            if not grounded:
                # A fully hallucinated skills list means the model ignored the
                # grounding rules — keep the student's original ordering.
                grounded = list(self.master_resume_data.get("skills", []))
            suggestions["optimized_skills"] = grounded

        # 3. Summary must exist and be non-trivial
        summary = suggestions.get("optimized_summary")
        if summary is not None and (not isinstance(summary, str) or len(summary.strip()) < 20):
            suggestions.pop("optimized_summary", None)

        if not suggestions.get("optimized_summary") and not suggestions.get("optimized_projects") and not suggestions.get("optimized_skills"):
            errors.append("AI returned no usable suggestions after grounding validation.")

        return errors

    def _save_suggestions(self, suggestions: Dict[str, Any]):
        self.job.status = "completed"
        self.job.result_json = suggestions
        self.job.completed_at = datetime.utcnow()
        # The snapshot served its purpose — don't keep decrypted-resume
        # ciphertext around longer than needed.
        self.job.input_payload_enc = None
        self.db.commit()
