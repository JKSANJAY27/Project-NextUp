import os
import re
import json
import logging
import requests
from typing import Dict, Any, List
import spacy

from app.services.pdf_extractor import extract_text_from_pdf, extract_skills_from_text

logger = logging.getLogger(__name__)

# Load spaCy NER
try:
    nlp = spacy.load("en_core_web_sm")
except Exception:
    nlp = None

def parse_resume_text_regex(text: str) -> Dict[str, Any]:
    """
    Parses resume text using regular expressions to extract metrics.
    """
    data = {}
    lines = [line.strip() for line in text.split("\n") if line.strip()]

    # 1. Attempt Name Extraction (first line is commonly the candidate's name)
    if lines:
        for candidate in lines[:3]:
            # Clean name (letters, spaces, and dots only)
            if re.match(r"^[a-zA-Z\s\.]+$", candidate) and len(candidate) > 2 and len(candidate) < 30:
                data["full_name"] = candidate
                break

    # 2. CGPA Extraction
    # Matches patterns like: "CGPA: 9.24", "9.24 CGPA", "9.24/10", "9.24/10.0"
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
        "CIVIL": ["civil"]
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
    # Matches percentages e.g., "94.5%", "92 %"
    marks_matches = re.findall(r"(\d{2}(?:\.\d+)?)\s*%", text)
    if len(marks_matches) >= 2:
        # Sort or assign chronologically (commonly twelfth/diploma then tenth, or vice versa)
        try:
            vals = [float(v) for v in marks_matches]
            # Map higher to 10th and lower to 12th or order of appearance
            # In resumes, education lists reverse chronological: 12th/BTech, then 10th.
            # So first percentage found is typically 12th, second is 10th.
            data["twelfth_marks"] = vals[0]
            data["tenth_marks"] = vals[1]
        except ValueError:
            pass
    elif len(marks_matches) == 1:
        try:
            data["twelfth_marks"] = float(marks_matches[0])
        except ValueError:
            pass

    return data

def parse_resume_with_ollama(text: str) -> Dict[str, Any]:
    """
    Fallback parser using local Ollama model llama3.2:3b.
    """
    prompt = f"""Extract academic credentials and profile info from this candidate resume as JSON:
{{
  "full_name": "Name or null",
  "branch": "CSE or IT or ECE or EEE or MECH or CIVIL or null",
  "cgpa": 9.15,
  "tenth_marks": 95.0,
  "twelfth_marks": 92.4,
  "skills": ["Python", "Docker"]
}}

Resume text:
{text[:4000]}

Return ONLY valid JSON. No markdown fences.
"""
    try:
        response = requests.post(
            "http://localhost:11434/api/generate",
            json={
                "model": "llama3.2:3b",
                "prompt": prompt,
                "stream": False,
                "format": "json"
            },
            timeout=10
        )
        if response.status_code == 200:
            res_text = response.json().get("response", "{}").strip()
            return json.loads(res_text)
    except Exception as e:
        logger.warning(f"Ollama llama3.2:3b resume parser fallback unavailable: {str(e)}")
    return {}

def parse_resume_pdf(file_bytes: bytes) -> Dict[str, Any]:
    """
    Complete resume parsing pipeline: text extraction -> Regex/spaCy -> Ollama fallback -> Skills.
    """
    # 1. Extract text from PDF
    text = extract_text_from_pdf(file_bytes)
    
    # 2. Extract standard fields via Regex
    parsed = parse_resume_text_regex(text)
    
    # 3. Use spaCy NER for name if missing
    if "full_name" not in parsed and nlp:
        doc = nlp(text[:1000])
        for ent in doc.ents:
            if ent.label_ == "PERSON" and len(ent.text.strip()) > 3:
                # First valid PERSON name
                parsed["full_name"] = ent.text.strip()
                break

    # 4. Fallback to Ollama if critical fields (name/cgpa) are missing
    if not parsed.get("full_name") or not parsed.get("cgpa"):
        logger.info("Regex/spaCy failed to resolve resume core metrics. Calling Ollama...")
        ollama_data = parse_resume_with_ollama(text)
        for k, v in ollama_data.items():
            if v and (k not in parsed or not parsed[k]):
                parsed[k] = v

    # 5. Extract skills from full text using skills dictionary
    parsed["skills"] = extract_skills_from_text(text)
    
    # Defaults
    if "full_name" not in parsed:
        parsed["full_name"] = "Student Candidate"
    if "branch" not in parsed:
        parsed["branch"] = "CSE"
        
    return parsed
