import re
import json
import logging
from typing import Dict, Any, List, Optional
import dateparser
import requests
import spacy

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load spaCy model with auto-download fallback
try:
    nlp = spacy.load("en_core_web_sm")
except OSError:
    logger.info("spaCy model 'en_core_web_sm' not found. Downloading...")
    import subprocess
    import sys
    try:
        subprocess.run([sys.executable, "-m", "spacy", "download", "en_core_web_sm"], check=True)
        nlp = spacy.load("en_core_web_sm")
    except Exception as e:
        logger.error(f"Failed to download spaCy model: {str(e)}")
        nlp = None

def parse_with_ollama(email_body: str) -> Dict[str, Any]:
    """
    Attempts to parse email body using local Ollama model llama3.2:3b.
    Returns structured JSON or empty dictionary on failure.
    """
    prompt = f"""Extract the following fields from this university placement email as JSON:
{{
  "company": "Company Name",
  "role": "Role Name",
  "category": "Dream or Super Dream or Mass Recruiter or Internship or Regular or null",
  "ctc": "CTC like '12 LPA' or '12 Lakhs' or null",
  "stipend": "Stipend like '35,000 per month' or null",
  "deadline_iso": "Deadline date-time in ISO format or null",
  "eligible_branches": ["CSE", "IT"],
  "min_cgpa": 7.0,
  "requires_no_arrears": true/false,
  "job_location": "Location name or null",
  "registration_link": "URL near registration keyword or null"
}}

Email Body:
{email_body}

Return ONLY valid JSON. No explanations, no markdown blocks.
"""
    try:
        # User specified local model: llama3.2:3b
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
            result = response.json()
            response_text = result.get("response", "{}").strip()
            return json.loads(response_text)
    except Exception as e:
        logger.warning(f"Ollama llama3.2:3b fallback unavailable: {str(e)}")
    return {}

def extract_placements_regex(email_body: str) -> Dict[str, Any]:
    """
    Rule-based extraction using regular expressions.
    """
    data = {}
    
    # 1. Company Name
    comp_match = re.search(
        r"(?:Name of the Company|Company Name|Company|Name of the Organisation|Organisation):\s*([^\n\r]+)", 
        email_body, 
        re.IGNORECASE
    )
    if comp_match:
        data["company"] = comp_match.group(1).strip()
    else:
        # Fallback to first line if it contains bold indicator or is short
        lines = [line.strip() for line in email_body.split("\n") if line.strip()]
        if lines:
            data["company"] = lines[0].replace("**", "").strip()

    # 2. Category
    cat_match = re.search(
        r"(Dream\s*Internship|Super\s*Dream|Mass\s*Recruiter|Dream\s*Offer|Dream|Regular)",
        email_body,
        re.IGNORECASE
    )
    if cat_match:
        # Standardize category
        cat = cat_match.group(1).lower()
        if "super" in cat:
            data["category"] = "Super Dream"
        elif "mass" in cat:
            data["category"] = "Mass Recruiter"
        elif "internship" in cat:
            data["category"] = "Internship"
        else:
            data["category"] = "Dream"
    else:
        data["category"] = "Regular"

    # 3. Role
    role_match = re.search(
        r"(?:Designation|Role|Job Title|Profile):\s*([^\n\r]+)",
        email_body,
        re.IGNORECASE
    )
    if role_match:
        data["role"] = role_match.group(1).strip()

    # 4. CTC
    ctc_match = re.search(
        r"(?:CTC|Salary|Package):\s*([^\n\r]+)",
        email_body,
        re.IGNORECASE
    )
    if ctc_match:
        data["ctc"] = ctc_match.group(1).strip()
    else:
        # Try finding numeric pattern like 12 LPA
        ctc_num_match = re.search(r"(\d+(?:\.\d+)?\s*(?:LPA|Lakhs|Lakh|INR|Rs\.?))", email_body, re.IGNORECASE)
        if ctc_num_match:
            data["ctc"] = ctc_num_match.group(1).strip()

    # 5. Stipend
    stipend_match = re.search(
        r"(?:Stipend|Internship stipend):\s*([^\n\r]+)",
        email_body,
        re.IGNORECASE
    )
    if stipend_match:
        data["stipend"] = stipend_match.group(1).strip()
    else:
        stipend_num_match = re.search(r"(?:Rs\.?|INR|₹)?\s*(\d+(?:\.\d+)?\s*(?:pm|K|k|thousand|per month))", email_body, re.IGNORECASE)
        if stipend_num_match:
            data["stipend"] = stipend_num_match.group(1).strip()

    # 6. Registration Deadline
    deadline_match = re.search(
        r"(?:Last date for Registration|Last Date to Apply|Registration Deadline|Last Date|Deadline):\s*([^\n\r]+)",
        email_body,
        re.IGNORECASE
    )
    if deadline_match:
        raw_date = deadline_match.group(1).strip()
        parsed_date = dateparser.parse(raw_date)
        if parsed_date:
            data["deadline_iso"] = parsed_date.isoformat()

    # 7. Eligible Branches
    branches_match = re.search(
        r"(?:Eligible Branches|Eligibility Branches|Branches):\s*([^\n\r]+)",
        email_body,
        re.IGNORECASE
    )
    if branches_match:
        branches_raw = branches_match.group(1)
        # Find matches of CSE, IT, ECE, EEE, MECH etc.
        found = re.findall(r"(CSE|IT|ECE|EEE|MECH|CIVIL|SWE|MCA|MTECH)", branches_raw, re.IGNORECASE)
        if found:
            data["eligible_branches"] = list(set([b.upper() for b in found]))

    # 8. Min CGPA
    cgpa_match = re.search(
        r"(?:min(?:imum)?\s*CGPA\s*(?:of)?\s*(\d+(?:\.\d+)?))|(\d+(?:\.\d+)?)\s*(?:CGPA|or above CGPA|or higher CGPA)",
        email_body,
        re.IGNORECASE
    )
    if cgpa_match:
        cgpa_str = cgpa_match.group(1) or cgpa_match.group(2)
        try:
            data["min_cgpa"] = float(cgpa_str)
        except ValueError:
            pass

    # 9. Arrear condition
    arrears_match = re.search(
        r"(No\s+Standing\s+Arrears|No\s+active\s+backlogs|No\s+backlogs|No\s+standing\s+backlogs)",
        email_body,
        re.IGNORECASE
    )
    data["requires_no_arrears"] = True if arrears_match else False

    # 10. Job location
    location_match = re.search(
        r"(?:Job Location|Location|Work Location):\s*([^\n\r]+)",
        email_body,
        re.IGNORECASE
    )
    if location_match:
        data["job_location"] = location_match.group(1).strip()

    # 11. Registration Link
    link_match = re.search(
        r"(?:Register|Apply|Registration Link):\s*(https?://[^\s\)]+)",
        email_body,
        re.IGNORECASE
    )
    if link_match:
        data["registration_link"] = link_match.group(1).strip()
    else:
        # Find first URL near 'register' or 'apply' in text
        urls = re.findall(r"(https?://[^\s\)]+)", email_body)
        for url in urls:
            if any(k in url.lower() for k in ["register", "apply", "form", "google", "cdc", "vtop"]):
                data["registration_link"] = url
                break

    return data

def parse_placement_email(email_body: str) -> Dict[str, Any]:
    """
    Main entry point to parse a placement email.
    Attempts Regex extraction, uses spaCy NER for fillers, and falls back to Ollama.
    """
    # Step 1: Run regex
    parsed = extract_placements_regex(email_body)

    # Step 2: Use spaCy NER as fallback for missing fields (dates/locations/orgs)
    if nlp and ("deadline_iso" not in parsed or "job_location" not in parsed or "company" not in parsed):
        doc = nlp(email_body)
        orgs = []
        dates = []
        gpes = []
        for ent in doc.ents:
            if ent.label_ == "ORG":
                orgs.append(ent.text)
            elif ent.label_ == "DATE":
                dates.append(ent.text)
            elif ent.label_ == "GPE":
                gpes.append(ent.text)

        if "company" not in parsed and orgs:
            # First organization that isn't VIT
            for org in orgs:
                if not any(k in org.lower() for k in ["vit", "vellore", "institute", "university", "cdc"]):
                    parsed["company"] = org.strip()
                    break

        if "deadline_iso" not in parsed and dates:
            for d in dates:
                if any(k in d.lower() for k in ["deadline", "last date", "register"]):
                    p_date = dateparser.parse(d)
                    if p_date:
                        parsed["deadline_iso"] = p_date.isoformat()
                        break

        if "job_location" not in parsed and gpes:
            parsed["job_location"] = gpes[0].strip()

    # Step 3: Ollama fallback if core fields (company/role) are missing
    if not parsed.get("company") or not parsed.get("role"):
        logger.info("Regex + spaCy extraction failed to find core fields. Querying Ollama...")
        ollama_data = parse_with_ollama(email_body)
        
        # Merge Ollama results for missing fields only
        for k, v in ollama_data.items():
            if v and (k not in parsed or not parsed[k]):
                parsed[k] = v

    # Final defaults/sanitizations
    if "company" not in parsed:
        parsed["company"] = "Unknown Company"
    if "role" not in parsed:
        parsed["role"] = "Software Engineer"
    if "category" not in parsed:
        parsed["category"] = "Dream"
    if "requires_no_arrears" not in parsed:
        parsed["requires_no_arrears"] = False

    return parsed
