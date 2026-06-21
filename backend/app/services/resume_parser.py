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

    model_id = "meta-llama/Llama-3.3-70B-Instruct"
    api_url = "https://router.huggingface.co/v1/chat/completions"
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
    full_name = "Student Candidate"
    if lines:
        for candidate in lines[:3]:
            if re.match(r"^[a-zA-Z\s\.]+$", candidate) and len(candidate) > 2 and len(candidate) < 30:
                full_name = candidate.strip()
                break
    data["full_name"] = full_name

    # 2. CGPA Extraction
    cgpa_val = 0.0
    cgpa_match = re.search(
        r"(?:cgpa|gpa|points)\s*(?:[:\-–\s])*\s*(\d\.\d{2})|(\d\.\d{2})\s*(?:/10|/10\.0)?\s*(?:cgpa|gpa)",
        text,
        re.IGNORECASE
    )
    if cgpa_match:
        val = cgpa_match.group(1) or cgpa_match.group(2)
        try:
            cgpa_val = float(val)
        except ValueError:
            pass
    data["cgpa"] = cgpa_val

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
    found_branch = "CSE"
    for code, keywords in branch_map.items():
        for kw in keywords:
            if re.search(rf"\b{re.escape(kw)}\b", text, re.IGNORECASE):
                found_branch = code
                break
        if found_branch != "CSE":
            break
    data["branch"] = found_branch

    # 4. Tenth & Twelfth Marks Extraction
    tenth_marks = 0.0
    twelfth_marks = 0.0
    marks_matches = re.findall(r"(\d{2}(?:\.\d+)?)\s*%", text)
    if len(marks_matches) >= 2:
        try:
            vals = [float(v) for v in marks_matches]
            twelfth_marks = vals[0]
            tenth_marks = vals[1]
        except ValueError:
            pass
    elif len(marks_matches) == 1:
        try:
            twelfth_marks = float(marks_matches[0])
        except ValueError:
            pass
    data["tenth_marks"] = tenth_marks
    data["twelfth_marks"] = twelfth_marks

    # 5. Batch Year Extraction
    batch_year = 2026
    years = re.findall(r"\b(202[4-9]|2030)\b", text)
    if years:
        try:
            batch_year = int(max(years))
        except ValueError:
            pass
    data["batch_year"] = batch_year

    # 6. Advanced Section Segmentation & Extraction
    email = ""
    phone = ""
    location = ""
    
    # Simple basic info scans from first 5 lines
    for line in lines[:5]:
        email_match = re.search(r'[\w\.-]+@[\w\.-]+\.\w+', line)
        if email_match:
            email = email_match.group(0)
        phone_match = re.search(r'\+?\d[\d\s\(\)-]{8,14}\d', line)
        if phone_match:
            phone = phone_match.group(0)

    # Segment text by headings
    sections = {}
    current_section = "personal"
    sections[current_section] = []
    
    headings = {
        'SUMMARY': 'summary',
        'PROFESSIONAL SUMMARY': 'summary',
        'PROFILE': 'summary',
        'SKILLS': 'skills',
        'TECHNICAL SKILLS': 'skills',
        'CORE SKILLS': 'skills',
        'EXPERIENCE': 'experience',
        'WORK EXPERIENCE': 'experience',
        'PROFESSIONAL EXPERIENCE': 'experience',
        'PROJECTS': 'projects',
        'ACADEMIC PROJECTS': 'projects',
        'KEY PROJECTS': 'projects',
        'EDUCATION': 'education',
        'EDUCATION BACKGROUND': 'education',
        'ACADEMIC BACKGROUND': 'education',
        'PATENTS': 'patents',
        'ACHIEVEMENTS': 'achievements',
        'ACHIEVEMENTS & LEADERSHIP': 'achievements',
        'AWARDS': 'achievements',
    }
    
    for line in lines:
        line_strip = line.strip()
        if not line_strip:
            continue
        line_upper = line_strip.upper().rstrip(':').strip()
        if line_upper in headings:
            current_section = headings[line_upper]
            sections[current_section] = []
            continue
        sections[current_section].append(line_strip)
        
    summary = " ".join(sections.get('summary', []))
    
    # Process Education
    education_entries = []
    edu_lines = sections.get('education', [])
    current_edu = None
    
    for line in edu_lines:
        is_new_edu = any(x in line.lower() for x in ['university', 'college', 'school', 'institute', 'vit', 'cbse', 'board', 'b.tech', 'm.tech', 'degree', 'intermediate', 'diploma'])
        year_match = re.search(r'\b(20\d{2})\b', line)
        
        if is_new_edu or (year_match and not current_edu):
            if current_edu:
                education_entries.append(current_edu)
            
            # Extract score first if present in the same line
            score_val = ""
            score_match = re.search(r'(?:cgpa|gpa|score|percentage|marks|%)\s*[:\-–\s]*\s*(\d+(?:\.\d+)?%?|\d+\.\d+)', line, re.IGNORECASE)
            if score_match:
                score_val = score_match.group(0).strip()
                line_no_score = line.replace(score_match.group(0), "")
            else:
                line_no_score = line

            # Extract year range first to avoid splitting on year hyphen
            year_val = ""
            year_range_match = re.search(r'\b(19\d{2}|20\d{2})\s*[-–—to/]+\s*(19\d{2}|20\d{2})\b', line_no_score)
            if year_range_match:
                year_val = year_range_match.group(0)
                clean_line = line_no_score.replace(year_val, "")
            else:
                single_year_match = re.search(r'\b(19\d{2}|20\d{2})\b', line_no_score)
                if single_year_match:
                    year_val = single_year_match.group(0)
                    clean_line = line_no_score.replace(year_val, "")
                else:
                    clean_line = line_no_score

            # Clean clean_line from double separators/commas
            clean_line = re.sub(r'\s+', ' ', clean_line)
            clean_line = re.sub(r',\s*,', ',', clean_line).strip(' ,-–—|')

            # Split clean_line by comma, en-dash, em-dash, pipe
            parts = [p.strip() for p in re.split(r'\s*[\u2014\u2013|,\t]\s*|\s+-\s+', clean_line) if p.strip()]

            # Determine degree and institution from parts
            degree = "Degree / Course"
            institution = clean_line

            if len(parts) >= 2:
                filtered_parts = []
                for p in parts:
                    if any(x in p.lower() for x in ['cgpa', 'gpa', 'marks', '%']):
                        if not score_val:
                            score_val = p
                    else:
                        filtered_parts.append(p)

                if len(filtered_parts) >= 2:
                    p0, p1 = filtered_parts[0], filtered_parts[1]
                    
                    deg_keywords = ['b.tech', 'm.tech', 'b.e', 'mca', 'mba', 'ph.d', 'b.sc', 'm.sc', 'bachelor', 'master', 'degree', 'course', 'schooling', 'high school', 'cbse', 'icse', 'intermediate', 'diploma', 'hsc', 'sslc']
                    inst_keywords = ['institute', 'university', 'college', 'school', 'vit', 'iit', 'nit', 'academy', 'vidyalaya']

                    p0_has_inst = any(x in p0.lower() for x in inst_keywords)
                    p1_has_deg = any(x in p1.lower() for x in deg_keywords)
                    p0_has_deg = any(x in p0.lower() for x in deg_keywords)
                    p1_has_inst = any(x in p1.lower() for x in inst_keywords)

                    if p0_has_inst or p1_has_deg:
                        institution = p0
                        degree = p1
                    elif p0_has_deg or p1_has_inst:
                        degree = p0
                        institution = p1
                    else:
                        degree = p0
                        institution = p1
                elif len(filtered_parts) == 1:
                    institution = filtered_parts[0]

            current_edu = {
                "degree": degree.strip(),
                "institution": institution.strip(),
                "year": year_val.strip(),
                "score": score_val.strip()
            }
        elif current_edu:
            score_match = re.search(r'(?:cgpa|gpa|score|percentage|marks|%)\s*[:\-–\s]*\s*(\d+(?:\.\d+)?%?|\d+\.\d+)', line, re.IGNORECASE)
            if score_match:
                current_edu["score"] = score_match.group(0).strip()
            elif not current_edu["score"] and any(x in line.lower() for x in ['cgpa', 'gpa', '%', 'marks']):
                current_edu["score"] = line
                
    if current_edu:
        education_entries.append(current_edu)
        
    # Process Experience
    experience_entries = []
    exp_lines = sections.get('experience', [])
    current_exp = None
    
    for line in exp_lines:
        is_bullet = line.startswith(('•', '*', '-', 'o ', '▪'))
        has_date = re.search(r'\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\b|\bPresent\b|\b20\d{2}\b', line, re.IGNORECASE)
        
        if not is_bullet and (has_date or (not current_exp and not is_bullet)):
            if current_exp:
                experience_entries.append(current_exp)
                
            # Extract date range first to avoid splitting on hyphen
            period_val = ""
            date_range_match = re.search(r'\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\s*[-–—to]+\s*(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}|\bPresent\b)\b', line, re.IGNORECASE)
            if date_range_match:
                period_val = date_range_match.group(0)
                clean_line = line.replace(period_val, "")
            else:
                single_date_match = re.search(r'\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\b|\bPresent\b|\bSummer\s+\d{4}\b|\b20\d{2}\s*[-–—to]+\s*20\d{2}\b|\b20\d{2}\b', line, re.IGNORECASE)
                if single_date_match:
                    period_val = single_date_match.group(0)
                    clean_line = line.replace(period_val, "")
                else:
                    clean_line = line

            clean_line = re.sub(r'\s+', ' ', clean_line)
            clean_line = re.sub(r',\s*,', ',', clean_line).strip(' ,-–—|()')

            parts = [p.strip() for p in re.split(r'\s*[\u2014\u2013|,\t]\s*|\s+-\s+', clean_line) if p.strip()]
            role = "Software Engineer Intern"
            company = clean_line
            
            if len(parts) >= 2:
                p0, p1 = parts[0], parts[1]
                role_keywords = ['intern', 'developer', 'engineer', 'consultant', 'analyst', 'lead', 'manager', 'specialist', 'designer', 'programmer', 'architect', 'member', 'officer', 'scholar']
                comp_keywords = ['solutions', 'technologies', 'technology', 'inc', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'labs', 'systems', 'valsco', 'university', 'institute']

                p0_has_role = any(x in p0.lower() for x in role_keywords)
                p1_has_comp = any(x in p1.lower() for x in comp_keywords)
                p0_has_comp = any(x in p0.lower() for x in comp_keywords)
                p1_has_role = any(x in p1.lower() for x in role_keywords)

                if p0_has_role or p1_has_comp:
                    role = p0
                    company = p1
                elif p0_has_comp or p1_has_role:
                    company = p0
                    role = p1
                else:
                    role = p0
                    company = p1
                    
            role = re.sub(r'\s*[-–—|()]\s*$', '', role).strip()
            company = re.sub(r'\s*[-–—|()]\s*$', '', company).strip()
            company = re.sub(r'\s*\([^)]*\)\s*$', '', company).strip()
            
            current_exp = {
                "role": role,
                "company": company,
                "period": period_val,
                "description": ""
            }
        elif is_bullet and current_exp:
            bullet_text = re.sub(r'^[•\*\-\s▪]+', '', line).strip()
            if current_exp["description"]:
                current_exp["description"] += "\n• " + bullet_text
            else:
                current_exp["description"] = "• " + bullet_text
        elif current_exp:
            if current_exp["description"]:
                current_exp["description"] += "\n" + line
            else:
                current_exp["description"] = line
                
    if current_exp:
        experience_entries.append(current_exp)
        
    # Process Projects
    project_entries = []
    proj_lines = sections.get('projects', [])
    current_proj = None
    
    for line in proj_lines:
        is_bullet = line.startswith(('•', '*', '-', 'o ', '▪'))
        
        is_header = False
        if not is_bullet and len(line) > 0 and (line[0].isupper() or line[0].isdigit()):
            has_separator = re.search(r'[\u2014\u2013|]|\s+-\s+', line)
            has_tech = any(x in line.lower() for x in ['python', 'react', 'nodejs', 'fastapi', 'javascript', 'c++', 'java', 'mongodb', 'sql', 'chromadb', 'ollama', 'websockets', 'langchain'])
            if has_separator or (has_tech and len(line) < 100):
                is_header = True
        
        if is_header:
            if current_proj:
                project_entries.append(current_proj)
                
            parts = re.split(r'\s*[\u2014\u2013|]\s*|\s+-\s+', line)
            title = line
            tech = ""
            
            if len(parts) >= 2:
                title = parts[0].strip()
                tech = ", ".join(p.strip() for p in parts[1:])
            else:
                # Check for comma separation
                comma_parts = [p.strip() for p in line.split(',') if p.strip()]
                if len(comma_parts) >= 2:
                    tech_words = ['python', 'react', 'fastapi', 'supabase', 'nodejs', 'javascript', 'c++', 'java', 'mongodb', 'sql', 'chromadb', 'ollama', 'websockets', 'langchain', 'html', 'css', 'tailwind', 'typescript', 'langgraph', 'langfuse']
                    p1_has_tech = any(x in comma_parts[1].lower() for x in tech_words)
                    if p1_has_tech:
                        title = comma_parts[0]
                        tech = ", ".join(comma_parts[1:])
                        
                        # See if title ends with a tech keyword like Python
                        for tw in tech_words:
                            pattern = rf'\b{re.escape(tw)}\b$'
                            match = re.search(pattern, title, re.IGNORECASE)
                            if match:
                                tech = title[match.start():].strip() + ", " + tech
                                title = title[:match.start()].strip()
                                break
            
            title = re.sub(r'\s*[-–—|()]\s*$', '', title).strip()
            title = re.sub(r'\s*\([^)]*\)\s*$', '', title).strip()
            tech = re.sub(r'\s*[-–—|()]\s*$', '', tech).strip()
            
            current_proj = {
                "title": title,
                "tech": tech,
                "description": ""
            }
        elif is_bullet and current_proj:
            bullet_text = re.sub(r'^[•\*\-\s▪]+', '', line).strip()
            if current_proj["description"]:
                current_proj["description"] += "\n• " + bullet_text
            else:
                current_proj["description"] = "• " + bullet_text
        elif current_proj:
            if current_proj["description"]:
                current_proj["description"] += "\n" + line
            else:
                current_proj["description"] = line
                
    if current_proj:
        project_entries.append(current_proj)
        
    # Process Patents
    patents = []
    patent_lines = sections.get('patents', [])
    for line in patent_lines:
        line_strip = line.strip()
        if not line_strip:
            continue
        is_bullet = line_strip.startswith(('•', '*', '-', 'o ', '▪'))
        clean_text = re.sub(r'^[•\*\-\s▪]+', '', line_strip).strip()
        if is_bullet or not patents:
            patents.append(clean_text)
        else:
            patents[-1] += " " + clean_text
            
    # Process Achievements
    achievements = []
    ach_lines = sections.get('achievements', [])
    for line in ach_lines:
        line_strip = line.strip()
        if not line_strip:
            continue
        is_bullet = line_strip.startswith(('•', '*', '-', 'o ', '▪'))
        clean_text = re.sub(r'^[•\*\-\s▪]+', '', line_strip).strip()
        if is_bullet or not achievements:
            achievements.append(clean_text)
        else:
            achievements[-1] += " " + clean_text

    # Extract personal links
    github_link = ""
    linkedin_link = ""
    website_link = ""
    
    github_match = re.search(r'(https?://)?(www\.)?github\.com/[\w\.-]+(/?[\w\.-]+)*', text, re.IGNORECASE)
    if github_match:
        github_link = github_match.group(0).strip()
        
    linkedin_match = re.search(r'(https?://)?(www\.)?linkedin\.com/in/[\w\.-]+', text, re.IGNORECASE)
    if linkedin_match:
        linkedin_link = linkedin_match.group(0).strip()
        
    portfolio_match = re.search(r'portfolio\s*(?:\([^)]*\))?\s*[:\-–\s]*\s*(https?://[^\s|()]+)', text, re.IGNORECASE)
    if portfolio_match:
        website_link = portfolio_match.group(1).strip()
    else:
        urls = re.findall(r'https?://[^\s|()]+', text)
        for u in urls:
            if "github.com" not in u and "linkedin.com" not in u:
                website_link = u
                break

    # Build resume_data structure
    data["resume_data"] = {
        "personal": {
            "name": full_name,
            "email": email,
            "phone": phone,
            "location": location,
            "title": "",
            "github": github_link,
            "linkedin": linkedin_link,
            "website": website_link
        },
        "summary": summary,
        "education": education_entries,
        "experience": experience_entries,
        "projects": project_entries,
        "skills": extract_skills_from_text(text),
        "certifications": [],
        "languages": [],
        "awards": patents + achievements
    }
    
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
        
    # Post-process parsed links (e.g. project repository URLs)
    parsed = post_process_parsed_links(parsed, text)
        
    return parsed

def slugify(s: str) -> str:
    return re.sub(r'[^a-z0-9]', '', s.lower())

def post_process_parsed_links(parsed: Dict[str, Any], text: str) -> Dict[str, Any]:
    if not parsed or "resume_data" not in parsed:
        return parsed
        
    rd = parsed["resume_data"]
    pers = rd.get("personal", {})
    
    # 1. Fill in personal links from text if missing
    if not pers.get("github"):
        github_match = re.search(r'(https?://)?(www\.)?github\.com/[\w\.-]+(/?[\w\.-]+)*', text, re.IGNORECASE)
        if github_match:
            pers["github"] = github_match.group(0).strip()
            
    if not pers.get("linkedin"):
        linkedin_match = re.search(r'(https?://)?(www\.)?linkedin\.com/in/[\w\.-]+', text, re.IGNORECASE)
        if linkedin_match:
            pers["linkedin"] = linkedin_match.group(0).strip()
            
    if not pers.get("website"):
        portfolio_match = re.search(r'portfolio\s*(?:\([^)]*\))?\s*[:\-–\s]*\s*(https?://[^\s|()]+)', text, re.IGNORECASE)
        if portfolio_match:
            pers["website"] = portfolio_match.group(1).strip()
        else:
            urls = re.findall(r'https?://[^\s|()]+', text)
            for u in urls:
                if "github.com" not in u and "linkedin.com" not in u:
                    pers["website"] = u
                    break

    # 2. Match GitHub project repository URLs
    all_github_urls = list(set(re.findall(r'https?://github\.com/[^\s|()]+', text)))
    clean_github_urls = []
    for u in all_github_urls:
        clean_github_urls.append(u.rstrip('.,;:)'))
        
    for proj in rd.get("projects", []):
        title = proj.get("title", "")
        desc = proj.get("description", "")
        
        # Check if title has a URL in it (due to link inlining)
        url_match = re.search(r'(https?://[^\s|()]+)', title)
        if url_match:
            url = url_match.group(1).rstrip('.,;:)')
            new_title = title.replace(url_match.group(1), "").strip("() ")
            proj["title"] = new_title
            # Add to description if not already there
            if url not in desc:
                separator = "\n" if desc else ""
                proj["description"] = f"{desc}{separator}GitHub Repository: {url}"
                desc = proj["description"]
                
        # Fuzzy match project title with github repository urls
        proj_title = proj.get("title", "")
        proj_slug = slugify(proj_title)
        if proj_title and proj_slug and "github.com" not in desc.lower():
            for url in clean_github_urls:
                parts = url.rstrip('/').split('/')
                if len(parts) >= 5:
                    repo_name = parts[-1]
                    repo_slug = slugify(repo_name)
                    if (proj_slug in repo_slug) or (repo_slug in proj_slug) or (len(proj_slug) > 3 and proj_slug[:5] in repo_slug):
                        separator = "\n" if desc else ""
                        proj["description"] = f"{desc}{separator}GitHub Repository: {url}"
                        break
                        
    return parsed
