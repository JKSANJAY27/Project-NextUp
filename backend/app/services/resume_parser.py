import os
import re
import json
import logging
import requests
from typing import Dict, Any, List
import spacy

from app.services.pdf_extractor import extract_text_from_pdf, extract_skills_from_text

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load spaCy NER (optional)
try:
    nlp = spacy.load("en_core_web_sm")
except Exception:
    nlp = None

def clean_json_string(s: str) -> str:
    s = s.strip()
    match = re.search(r"```(?:json)?\s*(.*?)\s*```", s, re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1).strip()
    start = s.find("{")
    end = s.rfind("}")
    if start != -1 and end != -1 and end > start:
        return s[start:end + 1]
    return s

def get_resume_prompt(text: str) -> str:
    return f"""You are an expert resume parser for placement cell student profiles.
Analyze the following resume text and extract all required academic credentials, profile metrics, and the entire structured contents (personal details, summary, education history, work experience, projects, skills, certifications, languages, awards).
Output ONLY a valid raw JSON object — no markdown, no explanation, no code fences.

Required JSON Output Format:
{{
  "full_name": "Sanjay J K",
  "branch": "CSE",
  "batch_year": 2027,
  "cgpa": 9.34,
  "tenth_marks": 95.0,
  "twelfth_marks": 92.4,
  "has_arrears": false,
  "skills": ["Python", "React", "Docker"],
  "resume_data": {{
    "personal": {{
      "name": "Sanjay J K",
      "email": "sanjay.jk2023@vitstudent.ac.in",
      "phone": "+91 98765 43210",
      "location": "Chennai, India",
      "title": "Software Engineer",
      "github": "github.com/sanjay",
      "linkedin": "linkedin.com/in/sanjay",
      "website": "sanjay.dev"
    }},
    "summary": "Highly motivated software engineering student with experience in web applications and cloud tools.",
    "education": [
      {{
        "degree": "B.Tech Computer Science",
        "institution": "Vellore Institute of Technology",
        "year": "2023 - 2027",
        "score": "9.34 CGPA"
      }}
    ],
    "experience": [
      {{
        "role": "Software Engineering Intern",
        "company": "Tech Solutions",
        "period": "Summer 2025",
        "description": "Collaborated on backend APIs and optimized database queries."
      }}
    ],
    "projects": [
      {{
        "title": "NextUp.ai",
        "tech": "React, FastAPI, Supabase",
        "description": "Built a zero-knowledge placement drive tracker with automated parsing."
      }}
    ],
    "skills": ["Python", "React", "Docker"],
    "certifications": ["AWS Certified Cloud Practitioner"],
    "languages": ["English", "Tamil"],
    "awards": ["First Place in Hackathon"]
  }}
}}

Guidelines:
1. full_name: The candidate's name.
2. branch: Choose from CSE, IT, ECE, EEE, MECH, CIVIL, SWE, MCA, MTECH, MBA, etc. Standardize as uppercase abbreviation.
3. batch_year: The graduation year (e.g. 2026, 2027). Look at the graduation date of the pursuing degree.
4. cgpa: Numeric value of CGPA on a 10-point scale (e.g. 9.12).
5. tenth_marks: Percentage score of 10th class (e.g. 95.0).
6. twelfth_marks: Percentage score of 12th class or equivalent diploma (e.g. 92.4).
7. has_arrears: Boolean. Default to false unless explicitly stated.
8. skills: List of tech skills, programming languages, and frameworks.
9. resume_data: Extract all sections from the resume. For experience and projects, capture the full description and tech stacks. Do not omit details.

Resume text:
---
{text[:4500]}
---

Return ONLY the raw JSON object matching the exact structure.
"""

def ping_ollama(base_url: str, timeout: int = 5) -> bool:
    try:
        resp = requests.get(f"{base_url}/api/tags", timeout=timeout)
        return resp.status_code == 200
    except Exception:
        return False

def parse_resume_with_ollama(text: str) -> Dict[str, Any]:
    ollama_base_url = os.getenv("OLLAMA_MODEL_BASE_URL", os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")).rstrip("/")
    ollama_model = os.getenv("OLLAMA_MODEL", "qwen2.5:1.5b")
    prompt = get_resume_prompt(text)

    if not ping_ollama(ollama_base_url, timeout=5):
        logger.warning(f"Ollama endpoint at {ollama_base_url} is not responding. Skipping Ollama.")
        return {}

    try:
        response = requests.post(
            f"{ollama_base_url}/api/generate",
            json={
                "model": ollama_model,
                "prompt": prompt,
                "stream": False,
                "format": "json"
            },
            timeout=40
        )
        if response.status_code == 200:
            res_text = response.json().get("response", "{}").strip()
            clean_str = clean_json_string(res_text)
            return json.loads(clean_str)
    except Exception as e:
        logger.warning(f"Ollama resume parser failed: {str(e)}")
    return {}

def parse_resume_with_huggingface(text: str) -> Dict[str, Any]:
    hf_token = os.getenv("HF_API_TOKEN", "")
    if not hf_token:
        logger.warning("HF_API_TOKEN not set. Skipping HuggingFace escalation for resume.")
        return {}

    model_id = "Qwen/Qwen2.5-72B-Instruct"
    api_url = "https://router.huggingface.co/hf-inference/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {hf_token}",
        "Content-Type": "application/json"
    }
    prompt = get_resume_prompt(text)

    try:
        response = requests.post(
            api_url,
            headers=headers,
            json={
                "model": model_id,
                "messages": [
                    {
                        "role": "system",
                        "content": "You are a structured resume parser. Output only valid JSON. No markdown."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                "max_tokens": 1500,
                "temperature": 0.1,
                "response_format": {"type": "json_object"}
            },
            timeout=40
        )
        if response.status_code == 200:
            res_json = response.json()
            generated_text = (
                res_json.get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
                .strip()
            )
            clean_str = clean_json_string(generated_text)
            return json.loads(clean_str)
        else:
            logger.warning(f"HF API returned error for resume ({response.status_code}): {response.text[:200]}")
    except Exception as e:
        logger.warning(f"HuggingFace escalation resume parsing failed: {str(e)}")
    return {}

def parse_resume_text_regex(text: str) -> Dict[str, Any]:
    data = {}
    lines = [line.strip() for line in text.split("\n") if line.strip()]

    # 1. Attempt Name Extraction (first line is commonly the candidate's name)
    if lines:
        for candidate in lines[:3]:
            if re.match(r"^[a-zA-Z\s\.]+$", candidate) and len(candidate) > 2 and len(candidate) < 30:
                data["full_name"] = candidate.strip()
                break

    # 2. CGPA Extraction
    cgpa_match = re.search(
        r"(?:cgpa|gpa|points)\s*(?:[:\-–\s])*\s*(\d\.\d{2})|(\d\.\d{2})\s*(?:/10|/10\.0)?\s*(?:cgpa|gpa)",
        text,
        re.IGNORECASE
    )
    if cgpa_match:
        val = cgpa_match.group(1) or cgpa_match.group(2)
        try:
            data["cgpa"] = float(val)
        except ValueError:
            pass

    # 3. Branch Extraction
    branch_map = {
        "CSE": ["computer science", "cse", "software engineering"],
        "IT": ["information technology", "it"],
        "ECE": ["electronics", "ece", "telecommunication"],
        "EEE": ["electrical", "eee"],
        "MECH": ["mechanical", "mech"],
        "CIVIL": ["civil"],
        "MCA": ["mca", "computer applications"]
    }
    found_branch = None
    for code, keywords in branch_map.items():
        for kw in keywords:
            if re.search(rf"\b{re.escape(kw)}\b", text, re.IGNORECASE):
                found_branch = code
                break
        if found_branch:
            break
    if found_branch:
        data["branch"] = found_branch

    # 4. Tenth & Twelfth Marks Extraction
    marks_matches = re.findall(r"(\d{2}(?:\.\d+)?)\s*%", text)
    if len(marks_matches) >= 2:
        try:
            vals = [float(v) for v in marks_matches]
            data["twelfth_marks"] = vals[0]
            data["tenth_marks"] = vals[1]
        except ValueError:
            pass
    elif len(marks_matches) == 1:
        try:
            data["twelfth_marks"] = float(marks_matches[0])
        except ValueError:
            pass

    # 5. Batch Year Extraction
    years = re.findall(r"\b(202[4-9]|2030)\b", text)
    if years:
        try:
            data["batch_year"] = int(max(years))
        except ValueError:
            pass

    return data

def parse_resume_pdf(file_bytes: bytes) -> Dict[str, Any]:
    """
    Complete resume parsing pipeline: text extraction -> LLM escalation -> Regex/spaCy fallback -> Skills.
    """
    # 1. Extract text from PDF
    text = extract_text_from_pdf(file_bytes)
    
    # 2. Try LLM parsing first
    parsed = {}
    logger.info("Attempting resume parsing with Ollama...")
    parsed = parse_resume_with_ollama(text)

    # 3. Escalate to HuggingFace if critical fields missing or parse failed
    if not parsed or not parsed.get("full_name") or not parsed.get("resume_data"):
        logger.info("Ollama failed or returned incomplete resume data. Escalating to HuggingFace...")
        parsed_hf = parse_resume_with_huggingface(text)
        if parsed_hf:
            parsed = parsed_hf

    # 4. Fallback to Regex and spaCy if LLM failed
    if not parsed or not isinstance(parsed, dict):
        logger.info("LLM parsing failed completely. Using Regex/spaCy fallback for resume...")
        parsed = parse_resume_text_regex(text)
        
        # spaCy name extraction fallback
        if "full_name" not in parsed and nlp:
            doc = nlp(text[:1000])
            for ent in doc.ents:
                if ent.label_ == "PERSON" and len(ent.text.strip()) > 3:
                    parsed["full_name"] = ent.text.strip()
                    break

    # Extract skills
    skills_extracted = extract_skills_from_text(text)
    parsed["skills"] = skills_extracted
    
    # Ensure resume_data structure is present (with fallbacks)
    if "resume_data" not in parsed or not isinstance(parsed["resume_data"], dict):
        parsed["resume_data"] = {
            "personal": {
                "name": parsed.get("full_name", "Student Candidate"),
                "email": "",
                "phone": "",
                "location": "",
                "title": "",
                "github": "",
                "linkedin": "",
                "website": ""
            },
            "summary": "",
            "education": [],
            "experience": [],
            "projects": [],
            "skills": skills_extracted,
            "certifications": [],
            "languages": [],
            "awards": []
        }
    else:
        # Guarantee sub-properties exist to prevent frontend crash
        rd = parsed["resume_data"]
        if "personal" not in rd or not isinstance(rd["personal"], dict):
            rd["personal"] = {
                "name": parsed.get("full_name", "Student Candidate"),
                "email": "",
                "phone": "",
                "location": "",
                "title": "",
                "github": "",
                "linkedin": "",
                "website": ""
            }
        if "education" not in rd or not isinstance(rd["education"], list):
            rd["education"] = []
        if "experience" not in rd or not isinstance(rd["experience"], list):
            rd["experience"] = []
        if "projects" not in rd or not isinstance(rd["projects"], list):
            rd["projects"] = []
        if "skills" not in rd or not isinstance(rd["skills"], list):
            rd["skills"] = skills_extracted
        if "certifications" not in rd or not isinstance(rd["certifications"], list):
            rd["certifications"] = []
        if "languages" not in rd or not isinstance(rd["languages"], list):
            rd["languages"] = []
        if "awards" not in rd or not isinstance(rd["awards"], list):
            rd["awards"] = []

    # Add raw text for encryption and client-side storage
    parsed["raw_text"] = text

    # Set defaults for missing fields to avoid frontend crashes
    if "full_name" not in parsed or not parsed["full_name"]:
        parsed["full_name"] = "Student Candidate"
    if "branch" not in parsed or not parsed["branch"]:
        parsed["branch"] = "CSE"
    if "batch_year" not in parsed or not parsed["batch_year"]:
        parsed["batch_year"] = 2026
    if "cgpa" not in parsed or not parsed["cgpa"]:
        parsed["cgpa"] = 0.0
    if "tenth_marks" not in parsed or not parsed["tenth_marks"]:
        parsed["tenth_marks"] = 0.0
    if "twelfth_marks" not in parsed or not parsed["twelfth_marks"]:
        parsed["twelfth_marks"] = 0.0
    if "has_arrears" not in parsed:
        parsed["has_arrears"] = False
        
    return parsed
