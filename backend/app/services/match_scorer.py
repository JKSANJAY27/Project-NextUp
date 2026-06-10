import logging
from typing import List, Optional
from rapidfuzz import fuzz

logger = logging.getLogger(__name__)

NORMALIZED_SKILLS_DICT = {
    "reactjs": "react",
    "react.js": "react",
    "react js": "react",
    "nodejs": "node",
    "node.js": "node",
    "node js": "node",
    "javascript": "js",
    "typescript": "ts",
    "mongodb": "mongo",
    "postgresql": "postgres",
    "sqlite3": "sqlite",
    "docker": "docker",
    "kubernetes": "k8s",
    "k8s": "k8s",
    "aws": "aws",
    "amazon web services": "aws",
    "gcp": "gcp",
    "google cloud platform": "gcp",
    "vuejs": "vue",
    "vue.js": "vue",
    "nextjs": "next",
    "next.js": "next",
    "nestjs": "nest",
    "nest.js": "nest",
    "golang": "go",
    "python3": "python",
    "cpp": "c++",
    "c plus plus": "c++"
}

def normalize_skill(skill: str) -> str:
    s = skill.strip().lower()
    return NORMALIZED_SKILLS_DICT.get(s, s)

def calculate_match_score(
    student_skills: List[str],
    jd_required_skills: List[str],
    student_cgpa: Optional[float] = None,
    company_min_cgpa: Optional[float] = None
) -> int:
    """
    Computes a match score from 0 to 100 between a student's profile and a job description.
    Rules:
    - Exact match: skill in student_skills AND in jd_required_skills -> +10 points each
    - Fuzzy match (rapidfuzz score > 85) -> +6 points each
    - CGPA bonus: if student.cgpa >= company.min_cgpa + 0.5 -> +5 points
    """
    if not jd_required_skills:
        # If no skills specified in JD, default to a high base score
        cgpa_bonus = 5 if (student_cgpa and company_min_cgpa and student_cgpa >= company_min_cgpa + 0.5) else 0
        return min(75 + cgpa_bonus, 100)

    # Standardize and normalize inputs to lowercase
    student_skills_clean = [normalize_skill(s) for s in (student_skills or []) if s.strip()]
    jd_skills_clean = [normalize_skill(s) for s in jd_required_skills if s.strip()]

    matched_points = 0
    max_skills_points = len(jd_skills_clean) * 10

    for jd_skill in jd_skills_clean:
        # Check exact match
        if jd_skill in student_skills_clean:
            matched_points += 10
            continue

        # Check fuzzy match using rapidfuzz
        max_fuzzy_score = 0
        for s_skill in student_skills_clean:
            # Calculate similarity ratio
            score = fuzz.ratio(jd_skill, s_skill)
            if score > max_fuzzy_score:
                max_fuzzy_score = score
                
        if max_fuzzy_score > 85:
            matched_points += 6

    # Calculate skills score base (normalized out of 95)
    skills_percentage = (matched_points / max_skills_points) * 95

    # Calculate CGPA bonus
    cgpa_bonus = 0
    if student_cgpa is not None and company_min_cgpa is not None:
        if student_cgpa >= (company_min_cgpa + 0.5):
            cgpa_bonus = 5

    # Total score capped at 100
    total_score = int(round(skills_percentage + cgpa_bonus))
    return min(max(total_score, 0), 100)
