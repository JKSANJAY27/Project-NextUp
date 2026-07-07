import os
import re
import logging
import hashlib
import requests
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.core.config import settings
from app.models.models import StudentProfile, Company

logger = logging.getLogger(__name__)

# Re-use normalized skills dictionary from match_scorer
from app.services.match_scorer import NORMALIZED_SKILLS_DICT, normalize_skill

AI_PHRASE_BLACKLIST = {
    "spearheaded", "orchestrated", "championed", "synergized", "leveraged",
    "revolutionized", "pioneered", "catalyzed", "operationalized", "architected",
    "envisioned", "effectuated", "endeavored", "facilitated", "utilized",
    "synergy", "synergies", "paradigm", "paradigm shift", "best-in-class",
    "world-class", "cutting-edge", "bleeding-edge", "game-changer", "game-changing",
    "disruptive", "disruptor", "holistic", "robust", "scalable", "actionable",
    "impactful", "proactive", "proactively", "stakeholder", "deliverables",
    "bandwidth", "circle back", "deep dive", "move the needle", "low-hanging fruit",
    "touch base", "value-add", "in order to", "for the purpose of", "with a view to",
    "at the end of the day", "moving forward", "going forward", "on a daily basis",
    "on a regular basis", "in a timely manner", "at this point in time",
    "due to the fact that", "in the event that", "in light of the fact that"
}

AI_PHRASE_REPLACEMENTS = {
    "spearheaded": "led",
    "orchestrated": "coordinated",
    "championed": "advocated for",
    "synergized": "collaborated",
    "leveraged": "used",
    "revolutionized": "transformed",
    "pioneered": "introduced",
    "catalyzed": "initiated",
    "operationalized": "implemented",
    "architected": "designed",
    "envisioned": "planned",
    "effectuated": "completed",
    "endeavored": "worked",
    "facilitated": "helped",
    "utilized": "used",
    "synergy": "collaboration",
    "synergies": "collaborations",
    "paradigm": "approach",
    "paradigm shift": "change",
    "best-in-class": "top-performing",
    "world-class": "high-quality",
    "cutting-edge": "advanced",
    "bleeding-edge": "modern",
    "game-changer": "key initiative",
    "game-changing": "impactful",
    "disruptive": "innovative",
    "disruptor": "innovator",
    "holistic": "comprehensive",
    "robust": "reliable",
    "scalable": "extensible",
    "actionable": "practical",
    "impactful": "significant",
    "proactive": "active",
    "proactively": "actively",
    "stakeholder": "partner",
    "deliverables": "results",
    "bandwidth": "capacity",
    "circle back": "follow up",
    "deep dive": "detailed analysis",
    "move the needle": "make progress",
    "low-hanging fruit": "quick wins",
    "touch base": "contact",
    "value-add": "benefit",
    "in order to": "to",
    "for the purpose of": "for",
    "with a view to": "to",
    "at the end of the day": "ultimately",
    "moving forward": "ahead",
    "going forward": "future",
    "on a daily basis": "daily",
    "on a regular basis": "regularly",
    "in a timely manner": "promptly",
    "at this point in time": "currently",
    "due to the fact that": "because",
    "in the event that": "if",
    "in light of the fact that": "considering"
}

def clean_ai_phrases(text_val: str) -> str:
    """
    Scrub common AI buzzwords and replace them with simpler professional alternatives.
    Uses regex word boundaries for case-insensitive replacement.
    """
    if not text_val:
        return text_val
    cleaned = text_val
    for phrase in sorted(AI_PHRASE_BLACKLIST, key=len, reverse=True):
        pattern = re.compile(rf"\b{re.escape(phrase)}\b", re.IGNORECASE)
        replacement = AI_PHRASE_REPLACEMENTS.get(phrase.lower(), "")
        cleaned = pattern.sub(replacement, cleaned)
    # Remove em-dash patterns as well
    cleaned = re.sub(r"—|---|--", "-", cleaned)
    return cleaned

def sanitize_tailored_resume(tailored_data: dict) -> dict:
    """
    Clean all string fields in the AI-generated tailored resume (optimized summary and projects).
    """
    if not tailored_data:
        return tailored_data
    
    # Clean summary
    if "optimized_summary" in tailored_data:
        tailored_data["optimized_summary"] = clean_ai_phrases(tailored_data["optimized_summary"])
    elif "tailored_resume" in tailored_data and "optimized_summary" in tailored_data["tailored_resume"]:
        tailored_data["tailored_resume"]["optimized_summary"] = clean_ai_phrases(tailored_data["tailored_resume"]["optimized_summary"])
        
    # Clean projects
    if "optimized_projects" in tailored_data:
        for p in tailored_data["optimized_projects"]:
            if "description" in p:
                p["description"] = clean_ai_phrases(p["description"])
    elif "tailored_resume" in tailored_data and "optimized_projects" in tailored_data["tailored_resume"]:
        for p in tailored_data["tailored_resume"]["optimized_projects"]:
            if "description" in p:
                p["description"] = clean_ai_phrases(p["description"])
                
    return tailored_data


SKILLS_TO_QUESTIONS = {
    "sql": [
        "Explain the difference between clustered and non-clustered indexes.",
        "What are the ACID properties in database management systems, and why are they important?",
        "Write a query to find the second highest salary from an Employee table."
    ],
    "postgres": [
        "What are EXPLAIN and ANALYZE used for in PostgreSQL, and how do they help optimize queries?",
        "Explain PostgreSQL MVCC (Multi-Version Concurrency Control)."
    ],
    "python": [
        "What is the difference between a list and a tuple in Python? When would you use which?",
        "Explain decorators in Python and write a simple example showing their utility.",
        "How is memory managed in Python? What is the Global Interpreter Lock (GIL)?"
    ],
    "javascript": [
        "Explain closures in JavaScript and provide a practical use-case.",
        "What is the Event Loop, and how does asynchronous execution work in JS?",
        "What is the difference between let, const, and var declarations?"
    ],
    "typescript": [
        "What are the benefits of TypeScript over raw JavaScript, and how do interfaces differ from types?",
        "Explain generics in TypeScript and provide a brief example."
    ],
    "react": [
        "What are React Hooks? Explain the lifecycle equivalent hooks like useEffect and useState.",
        "What is the Virtual DOM, and how does React's reconciliation algorithm work?",
        "What is the difference between controlled and uncontrolled components in React forms?"
    ],
    "next": [
        "What is the difference between Server-Side Rendering (SSR) and Static Site Generation (SSG) in Next.js?",
        "Explain the App Router routing structure and how Server Components differ from Client Components."
    ],
    "docker": [
        "Explain the difference between a Docker image and a Docker container.",
        "What is multi-stage builds in Docker, and why is it useful?"
    ],
    "kubernetes": [
        "What is a Kubernetes Pod, and how does it differ from a Docker container?",
        "Describe the main components of the Kubernetes Control Plane."
    ],
    "aws": [
        "What is the difference between an IAM Role and an IAM User in AWS?",
        "Explain the concept of Auto Scaling and how ELB (Elastic Load Balancer) distributes traffic."
    ],
    "git": [
        "Explain the difference between git merge and git rebase.",
        "How do you resolve a merge conflict in Git?"
    ]
}

SKILLS_TO_TOPICS = {
    "sql": ["DBMS", "SQL Queries", "Transactions & Indexing"],
    "postgres": ["DBMS", "PostgreSQL MVCC", "Query Optimization"],
    "python": ["OOP", "Data Structures", "Python Memory Management"],
    "javascript": ["Web Fundamentals", "Asynchronous JS", "Event Loop"],
    "typescript": ["Static Typing", "Advanced Type Systems"],
    "react": ["Frontend Architectures", "React State Lifecycle"],
    "next": ["Next.js SSR/SSG", "React Server Components"],
    "docker": ["DevOps", "Containerization", "Docker Orchestration"],
    "kubernetes": ["Container Orchestration", "Microservices Architecture"],
    "aws": ["Cloud Infrastructure", "Scalable System Architecture"],
    "gcp": ["Cloud Platforms", "Serverless Architectures"],
    "git": ["Version Control", "Git Collaborative Workflows"],
    "java": ["OOP Principles", "Java Virtual Machine (JVM) GC", "Concurrency"],
    "cpp": ["Memory Management & Pointers", "Object Oriented Programming", "STL Containers"],
    "c++": ["Memory Management & Pointers", "Object Oriented Programming", "STL Containers"]
}

def precompute_jd_intelligence_deterministic(jd_text: str, required_skills: List[str]) -> Dict[str, List[str]]:
    """
    Extracts preferred skills and interview topics from JD text deterministically.
    """
    preferred_skills = []
    interview_topics = set()
    
    # 1. Deduce preferred skills
    # Scrape for skills mentioned in JD but NOT explicitly in the required_skills list
    # Use simple paragraph splitting to find sentences talking about "plus", "preferred", "bonus", "nice"
    sentences = re.split(r'[.!?\n]', jd_text or "")
    preferred_patterns = [r"\bplus\b", r"\bpreferred\b", r"\bbonus\b", r"\bnice\s+to\s+have\b", r"\bdesired\b", r"\badvantage\b"]
    
    for sentence in sentences:
        if any(re.search(pat, sentence, re.IGNORECASE) for pat in preferred_patterns):
            # Check for skills in this sentence
            for skill in NORMALIZED_SKILLS_DICT.keys():
                norm = normalize_skill(skill)
                if norm not in required_skills and norm not in preferred_skills:
                    escaped = re.escape(skill)
                    if re.search(rf"\b{escaped}\b", sentence, re.IGNORECASE):
                        preferred_skills.append(norm)
                        
    # 2. Derive interview topics based on matched skills (required + preferred)
    all_matched_skills = list(required_skills) + preferred_skills
    for skill in all_matched_skills:
        topics = SKILLS_TO_TOPICS.get(skill)
        if topics:
            for t in topics:
                interview_topics.add(t)
                
    # Default fallback topics
    if not interview_topics:
        interview_topics.add("Data Structures & Algorithms")
        interview_topics.add("Core Computer Science Fundamentals")
        
    return {
        "preferred_skills": preferred_skills,
        "interview_topics": list(interview_topics)
    }

def generate_sop_deterministic(profile: StudentProfile, company: Company) -> str:
    """
    Generates a professional SOP template populated with student profile details.
    """
    name = profile.full_name if profile else "Student"
    branch = profile.branch if profile else "Engineering"
    cgpa = float(profile.cgpa) if profile and profile.cgpa else 0.0
    skills_str = ", ".join(profile.skills) if (profile and profile.skills) else "Software Engineering methodologies"
    company_name = company.name
    role = company.role
    
    sop = f"""STATEMENT OF PURPOSE

To the Graduate Recruitment Team,

I am writing to express my enthusiastic interest in the {role} position at {company_name}. As a final-year student pursuing a Bachelor of Technology in {branch} at Vellore Institute of Technology, graduating with a CGPA of {cgpa:.2f}, I have dedicated my academic career to mastering software engineering principles and building scalable software solutions.

Throughout my undergraduate studies, I have developed strong competencies in {skills_str}. My practical experiences—ranging from academic projects to self-directed engineering tasks—have honed my ability to analyze complex system requirements, write clean, modular code, and collaborate in agile workspaces.

{company_name} stands out to me due to its commitment to technology innovation and operational scale. The opportunity to work on your {role} team represents the perfect environment to leverage my developer skillset while actively contributing to your production systems. 

I am confident that my academic record, hands-on programming experiences, and structured problem-solving approach align closely with the engineering requirements at {company_name}. Thank you for your time and consideration of my application.

Sincerely,
{name}"""
    return sop

def generate_cover_letter_deterministic(profile: StudentProfile, company: Company) -> str:
    """
    Generates a professional cover letter template populated with student profile details.
    """
    name = profile.full_name if profile else "Student"
    branch = profile.branch if profile else "Engineering"
    cgpa = float(profile.cgpa) if profile and profile.cgpa else 0.0
    skills_str = ", ".join(profile.skills) if (profile and profile.skills) else "Software Engineering"
    company_name = company.name
    role = company.role
    date_str = datetime.utcnow().strftime("%B %d, %Y")
    
    cover_letter = f"""Date: {date_str}

Hiring Committee
{company_name} Recruitment Team

Subject: Application for {role} Position

Dear Hiring Manager,

I am writing to submit my application for the {role} position currently open at {company_name}. Having followed your company's growth and technological achievements, I am excited about the opportunity to bring my academic knowledge, engineering skills, and passion for product development to your team.

I am currently in my final year of B.Tech in {branch} at Vellore Institute of Technology, maintaining a CGPA of {cgpa:.2f}. My coursework and engineering projects have allowed me to build hands-on expertise in {skills_str}. Through designing and debugging complex software architectures, I have developed a deep appreciation for system efficiency, clean code, and database optimizations.

I am particularly drawn to {company_name} because of your focus on building high-performance, developer-centric systems. I am eager to apply my skills to your projects, collaborate with your engineering leads, and help drive your platform roadmap forward.

Thank you for reviewing my application materials. I look forward to the possibility of discussing how my technical background and developer skillset can add value to the {role} team at {company_name}.

Sincerely,
{name}"""
    return cover_letter

def generate_interview_prep_deterministic(profile: StudentProfile, company: Company) -> Dict[str, List[str]]:
    """
    Generates technical, HR, and company-specific interview questions deterministically.
    """
    # 1. Technical Questions based on company required/preferred skills
    tech_questions = []
    company_skills = list(company.jd_required_skills or []) + list(company.jd_preferred_skills or [])
    
    for skill in company_skills:
        norm = normalize_skill(skill)
        questions = SKILLS_TO_QUESTIONS.get(norm)
        if questions:
            for q in questions:
                if q not in tech_questions:
                    tech_questions.append(q)
                    
    # Fallback to standard CS questions if no skill questions matched
    if not tech_questions:
        tech_questions = [
            "Explain the difference between a process and a thread. How do they share memory?",
            "What is Object-Oriented Programming? Describe its four pillars with simple real-world examples.",
            "Explain the concepts of Time and Space Complexity. What is Big O notation?"
        ]
        
    # 2. Standard HR Questions
    hr_questions = [
        "Tell me about yourself.",
        "What are your greatest strengths, and what is one area of improvement (weakness) you are working on?",
        "Describe a challenging project you worked on. What difficulties did you encounter and how did you resolve them?",
        f"Why do you want to join {company.name} for the {company.role} role?",
        "Describe a time you had a conflict in a group project. How did you handle the situation?"
    ]
    
    # 3. Company-Specific Questions (Behavioral/culture matching)
    skills_list = ", ".join(profile.skills[:3]) if (profile and profile.skills) else "your core development stack"
    company_specific = [
        f"Based on {company.name}'s engineering architecture, how would you design a scalable microservice that integrates with {skills_list}?",
        f"How would you approach handling system latencies or connection timeouts inside {company.name}'s core user products?",
        f"What aspects of {company.name}'s technology stack or core business operations interest you the most?"
    ]
    
    return {
        "technical": tech_questions[:5], # limit to 5
        "hr": hr_questions,
        "company_specific": company_specific
    }

def call_huggingface_llm(
    prompt: str,
    user_id: str,
    job_type: str,
    request_source: str,
    db: Session
) -> str:
    """
    Calls Hugging Face Serverless Inference API for generative AI outputs.
    Enforces server-side limits: 5 completions/day per user and 10 concurrent requests globally.
    Logs transaction metadata on success.
    """
    # 1. Enforce payload size limit (50KB)
    if len(prompt.encode('utf-8')) > 50 * 1024:
        raise ValueError("Payload too large: Prompt exceeds 50KB limit.")
        
    # 2. Check Global Concurrency limit (10 concurrent jobs)
    concurrent_query = db.execute(text("""
        SELECT COUNT(*) FROM ai_generation_jobs WHERE status = 'processing'
    """)).fetchone()
    if concurrent_query and concurrent_query[0] >= 10:
        raise ConnectionError("Server busy: Max concurrent global AI generations reached. Please try again in a moment.")
        
    # 3. Check User Daily limit (5 completions per 24 hours)
    day_ago = datetime.utcnow() - timedelta(days=1)
    daily_query = db.execute(text("""
        SELECT COUNT(*) FROM ai_generation_jobs 
        WHERE user_id = :user_id 
          AND status = 'completed' 
          AND created_at >= :day_ago
    """), {"user_id": user_id, "day_ago": day_ago}).fetchone()
    
    if daily_query and daily_query[0] >= 5:
        raise PermissionError("Rate limit exceeded: You have reached your limit of 5 Cloud AI generations per day.")
        
    # Calculate input hash for auditing
    input_hash = hashlib.sha256(prompt.encode('utf-8')).hexdigest()
    
    # 4. Create Pending In-Progress Audit Log
    job_id_row = db.execute(text("""
        INSERT INTO ai_generation_jobs (user_id, job_type, request_source, model_used, input_hash, status)
        VALUES (:user_id, :job_type, :request_source, :model_used, :input_hash, 'processing')
        RETURNING id
    """), {
        "user_id": user_id,
        "job_type": job_type,
        "request_source": request_source,
        "model_used": "Qwen/Qwen2.5-72B-Instruct",
        "input_hash": input_hash
    }).fetchone()
    db.commit()
    
    job_id = job_id_row[0] if job_id_row else None
    
    # Check HF Token
    hf_token = getattr(settings, "HF_API_TOKEN", os.getenv("HF_API_TOKEN", ""))
    if not hf_token:
        # Update job to failed
        if job_id:
            db.execute(text("UPDATE ai_generation_jobs SET status = 'failed', error_message = 'Hugging Face API token missing' WHERE id = :id"), {"id": job_id})
            db.commit()
        raise EnvironmentError("Hugging Face API token is missing on the server.")
        
    # 5. Call Hugging Face Serverless Inference API
    # We use Qwen2.5-72B-Instruct for high-quality English completions
    model_id = "Qwen/Qwen2.5-72B-Instruct"
    api_url = f"https://api-inference.huggingface.co/models/{model_id}"
    headers = {"Authorization": f"Bearer {hf_token}"}
    
    try:
        response = requests.post(
            api_url,
            headers=headers,
            json={
                "inputs": prompt,
                "parameters": {
                    "max_new_tokens": 1024,
                    "temperature": 0.7,
                    "return_full_text": False
                }
            },
            timeout=25 # generous timeout for cold starts
        )
        
        if response.status_code != 200:
            error_data = response.text
            raise RuntimeError(f"Hugging Face API Error ({response.status_code}): {error_data}")
            
        res_json = response.json()
        
        # Parse result
        if isinstance(res_json, list) and len(res_json) > 0:
            generated_text = res_json[0].get("generated_text", "").strip()
        elif isinstance(res_json, dict):
            generated_text = res_json.get("generated_text", "").strip()
        else:
            generated_text = str(res_json).strip()
            
        if not generated_text:
            raise ValueError("Empty completion returned from AI model.")
            
        # Update audit log to completed
        tokens_est = len(generated_text.split()) # rough token estimate
        if job_id:
            db.execute(text("""
                UPDATE ai_generation_jobs 
                SET status = 'completed', tokens_generated = :tokens, completed_at = NOW() 
                WHERE id = :id
            """), {"tokens": tokens_est, "id": job_id})
            db.commit()
            
        return generated_text
        
    except Exception as e:
        db.rollback()
        # Update audit log to failed
        if job_id:
            db.execute(text("""
                UPDATE ai_generation_jobs 
                SET status = 'failed', error_message = :err, completed_at = NOW() 
                WHERE id = :id
            """), {"err": str(e), "id": job_id})
            db.commit()
        raise e


_JD_STRATEGY_LIST_KEYS = [
    "required_skills", "preferred_skills", "ats_keywords",
    "programming_languages", "frameworks", "tools", "certifications",
    "interview_topics",
]
_JD_STRATEGY_TEXT_KEYS = [
    "experience_expectations", "project_preferences", "resume_strategy",
    "role_summary",
]

# Cap JD text fed to the model: free-tier CPUs evaluate ~10-20 prompt
# tokens/sec, so a full 10-page JD would take minutes before generating.
_JD_PROMPT_CHAR_CAP = 6000


def extract_jd_keywords_deterministic(jd_text: str) -> Dict[str, List[str]]:
    """Regex/dictionary keyword extraction from JD text — no AI involved.

    Scans the 130-skill vocabulary (skills_dictionary.json, same source the
    JD-PDF parser uses) plus the alias map. Used to (a) seed the strategy when
    the LLM is unavailable and (b) merge into the LLM output so ATS keywords
    are never empty or hallucinated-only.
    """
    from app.services.pdf_extractor import SKILLS_LIST

    found_skills: List[str] = []
    seen = set()
    lowered = (jd_text or "").lower()

    def _scan(term: str, canonical: str):
        if len(term) < 2:
            return
        # Dedup on the normalized form so 'PostgreSQL' and its alias
        # 'postgres' don't both end up in the keyword list.
        if canonical.lower() in seen or normalize_skill(canonical) in seen:
            return
        # 'C' and similar single-letter names need exact word boundaries;
        # the lookarounds also stop 'go' matching inside 'google'.
        if re.search(rf"(?<![a-z0-9+#.]){re.escape(term.lower())}(?![a-z0-9+#])", lowered):
            found_skills.append(canonical)
            seen.add(canonical.lower())
            seen.add(normalize_skill(canonical))

    for skill in SKILLS_LIST:            # canonical vocabulary (Python, SQL, ...)
        _scan(str(skill), str(skill))
    for alias in NORMALIZED_SKILLS_DICT: # alias forms (react.js -> react, ...)
        _scan(alias, normalize_skill(alias))

    intel = precompute_jd_intelligence_deterministic(jd_text or "", [s.lower() for s in found_skills])
    return {
        "skills": found_skills,
        "preferred_skills": intel.get("preferred_skills", []),
        "interview_topics": intel.get("interview_topics", []),
    }


# Generic role-family defaults used when a drive email carries no real JD
# (no PDF attachment and no requirements in the body). Keyed by keywords
# matched against the role name; first match wins. Keeps resume tailoring
# functional instead of breaking on an empty skill list.
_ROLE_DEFAULT_SKILLS = [
    (("data", "analytics", "analyst", "intelligence"),
     ["Python", "SQL", "Pandas", "Excel", "Statistics", "Data Visualization", "Machine Learning"]),
    (("machine learning", "ml", "ai "),
     ["Python", "Machine Learning", "Deep Learning", "SQL", "TensorFlow", "PyTorch", "Statistics"]),
    (("frontend", "front-end", "ui", "web"),
     ["JavaScript", "TypeScript", "React", "HTML", "CSS", "Git", "REST APIs"]),
    (("backend", "back-end", "api"),
     ["Python", "Java", "SQL", "REST APIs", "Git", "Docker", "System Design"]),
    (("devops", "cloud", "sre", "infrastructure"),
     ["Linux", "Docker", "Kubernetes", "AWS", "CI/CD", "Git", "Python"]),
    (("qa", "test", "quality", "sdet"),
     ["Java", "Python", "Selenium", "SQL", "Test Automation", "Git", "APIs"]),
    (("embedded", "firmware", "hardware", "vlsi", "electronics"),
     ["C", "C++", "Embedded Systems", "Microcontrollers", "RTOS", "Debugging"]),
    (("support", "consultant", "functional"),
     ["SQL", "Communication", "Debugging", "Linux", "Scripting", "APIs"]),
]
_GENERIC_DEFAULT_SKILLS = ["Data Structures", "Algorithms", "Python", "Java",
                           "SQL", "OOP", "Git", "Problem Solving"]

# Below this many characters the "JD" is really just a registration blurb —
# treat it as having no JD and build a generic role-based strategy instead.
_JD_MIN_MEANINGFUL_CHARS = 150


def _default_skills_for_role(role: str) -> List[str]:
    role_lower = f" {(role or '').lower()} "
    for keywords, skills in _ROLE_DEFAULT_SKILLS:
        if any(kw in role_lower for kw in keywords):
            return list(skills)
    return list(_GENERIC_DEFAULT_SKILLS)


def _deterministic_jd_strategy(jd_text: str, role: str = "", company_name: str = "") -> dict:
    kw = extract_jd_keywords_deterministic(jd_text)
    # Sparse/absent JD: seed with typical skills for the role family so the
    # strategy (and downstream resume tailoring / ATS matching) never runs
    # on an empty skill list.
    if len(kw["skills"]) < 3:
        role_skills = _default_skills_for_role(role)
        seen = {s.lower() for s in kw["skills"]}
        for s in role_skills:
            if s.lower() not in seen:
                kw["skills"].append(s)
                seen.add(s.lower())
    return {
        "required_skills": kw["skills"][:20],
        "preferred_skills": kw["preferred_skills"][:10],
        "ats_keywords": kw["skills"][:25],
        "programming_languages": [],
        "frameworks": [],
        "tools": [],
        "certifications": [],
        "experience_expectations": "Not specified.",
        "project_preferences": "Projects demonstrating the required skills.",
        "resume_strategy": "Front-load the JD-matching skills and quantify project impact.",
        "interview_topics": kw["interview_topics"][:8],
        "role_summary": f"{role or 'Software Engineering'} role"
                        + (f" at {company_name}" if company_name else "") + ".",
        "strategy_source": "deterministic",
    }


def generate_jd_strategy(jd_text: str, gateway=None, role: str = "",
                         company_name: str = "") -> dict:
    """
    Extract a reusable JD Strategy JSON from job description text.

    Runs the LLM once per drive (results are cached on companies.jd_strategy)
    and merges deterministic keyword extraction into the output so the
    strategy is grounded in the actual JD text and never empty. Falls back to
    the pure-deterministic strategy when no AI provider is reachable.
    """
    jd_hash = hashlib.sha256((jd_text or "").encode("utf-8")).hexdigest()[:16]
    deterministic = _deterministic_jd_strategy(jd_text or "", role, company_name)
    deterministic["jd_hash"] = jd_hash
    deterministic["generated_at"] = datetime.utcnow().isoformat()

    if gateway is None:
        from app.services.ai_provider import get_parser_gateway
        gateway = get_parser_gateway()

    # No meaningful JD in the email (common: registration mails with just a
    # form link). Ask the model for a TYPICAL strategy for this role instead
    # of analyzing a near-empty text, so resume tailoring still has substance.
    has_meaningful_jd = bool(jd_text and len(jd_text.strip()) >= _JD_MIN_MEANINGFUL_CHARS)
    if has_meaningful_jd:
        task_block = f"""Analyze this Job Description and produce a resume-tailoring strategy.
{f"Role: {role}" if role else ""}{f" | Company: {company_name}" if company_name else ""}

Job Description:
{jd_text[:_JD_PROMPT_CHAR_CAP]}"""
        grounding_rule = "Only list skills/keywords that actually appear in or are directly implied by the JD text."
    else:
        task_block = f"""No job description was provided for this campus placement drive.
Produce a resume-tailoring strategy for what is TYPICALLY expected for this role:
Role: {role or "Software Engineer"}{f" | Company: {company_name}" if company_name else ""} (fresh graduate / campus hire)"""
        grounding_rule = "List the skills/keywords most commonly required for this role for entry-level candidates."

    prompt = f"""{task_block}

Return ONLY a valid JSON object matching this schema exactly (no markdown, no explanations):
{{
  "required_skills": ["skill1", "skill2"],
  "preferred_skills": ["skillA", "skillB"],
  "ats_keywords": ["keyword1", "keyword2"],
  "programming_languages": ["Python"],
  "frameworks": ["React"],
  "tools": ["Git", "Docker"],
  "certifications": [],
  "experience_expectations": "Experience level or expectations mentioned.",
  "project_preferences": "What kinds of projects are most relevant.",
  "resume_strategy": "Actionable advice on what to highlight.",
  "interview_topics": ["Topic 1", "Topic 2"],
  "role_summary": "One sentence summary of the role."
}}
{grounding_rule}"""

    try:
        result = gateway.generate(
            prompt,
            system="You are an expert recruitment strategist. Extract the JD strategy JSON.",
            max_tokens=900,
            temperature=0.1,
            json_mode=True,
            purpose="jd_strategy",
        )
        parsed = result.parse_json()
        if not isinstance(parsed, dict):
            raise ValueError("JD strategy result is not a JSON object")

        # Normalize shapes
        for key in _JD_STRATEGY_LIST_KEYS:
            val = parsed.get(key)
            parsed[key] = [str(v) for v in val if v] if isinstance(val, list) else []
        for key in _JD_STRATEGY_TEXT_KEYS:
            val = parsed.get(key)
            parsed[key] = str(val) if val else deterministic[key]

        # Merge deterministic keywords so grounded JD terms are never lost —
        # union preserving LLM ordering first.
        for key, det_vals in (
            ("required_skills", deterministic["required_skills"]),
            ("ats_keywords", deterministic["ats_keywords"]),
            ("preferred_skills", deterministic["preferred_skills"]),
            ("interview_topics", deterministic["interview_topics"]),
        ):
            seen = {v.strip().lower() for v in parsed[key]}
            for v in det_vals:
                if v.strip().lower() not in seen:
                    parsed[key].append(v)
                    seen.add(v.strip().lower())

        parsed["strategy_source"] = f"{result.provider}/{result.model}"
        parsed["generated_at"] = datetime.utcnow().isoformat()
        parsed["jd_hash"] = jd_hash
        return parsed
    except Exception as e:
        logger.error(f"Failed to generate JD strategy via AI, using deterministic fallback: {str(e)}")
        return deterministic

