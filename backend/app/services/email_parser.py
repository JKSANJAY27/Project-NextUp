import re
import os
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

def clean_json_string(s: str) -> str:
    s = s.strip()
    match = re.search(r"```(?:json)?\s*(.*?)\s*```", s, re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return s

def get_parser_prompt(context_text: str) -> str:
    return f"""Analyze the following university placement email subject, body, and attachment content.
Extract the required fields and output them EXACTLY in the JSON format specified below.
Evaluate your confidence (between 0.00 and 1.00) for each field extraction based on evidence in the text.

Required JSON Output Format:
{{
  "parser_metadata": {{
    "parser_version": "v2",
    "model_used": "llm-extracted"
  }},
  "overall_confidence": 0.90,
  "extracted_data": {{
    "company": {{
      "value": "Google",
      "confidence": 0.99
    }},
    "event_type": {{
      "value": "NEW_DRIVE",
      "confidence": 0.98
    }},
    "job_location": {{
      "value": "Bangalore",
      "confidence": 0.90
    }},
    "deadline_iso": {{
      "value": "2026-06-25T23:59:00",
      "confidence": 0.92
    }},
    "registration_link": {{
      "value": "https://forms.gle/xyz",
      "confidence": 0.99
    }},
    "roles": [
      {{
        "role": {{ "value": "Software Engineer", "confidence": 0.98 }},
        "ctc": {{ "value": "18 LPA", "confidence": 0.95 }},
        "stipend": {{ "value": null, "confidence": 0.99 }},
        "min_cgpa": {{ "value": 8.0, "confidence": 0.97 }},
        "requires_no_arrears": {{ "value": true, "confidence": 0.96 }},
        "eligible_branches": {{ "value": ["CSE", "IT"], "confidence": 0.94 }}
      }}
    ]
  }}
}}

Guidelines for event_type value (choose the single best matching type):
- NEW_DRIVE: Company registration announcements or opening drives.
- DEADLINE_EXTENSION: Notices extending the last date to register.
- SHORTLIST_RELEASED: List of candidates shortlisted for OA or interviews.
- OA_SCHEDULED: Online Test/Assessment schedules, test links, instructions.
- OA_RESULT: Results of the Online Assessment.
- INTERVIEW_SCHEDULED: Interview dates, batches, slots, venues.
- INTERVIEW_RESULT: Results of the interview rounds.
- OFFER_RELEASED: Announcements of selectees receiving offers.
- REJECTION_RELEASED: Regrets/non-selected candidates lists.
- GENERAL_UPDATE: Venue changes, list corrections, general instructions.

Content to analyze:
{context_text}

Return ONLY the raw JSON block. Do not wrap it in markdown code fences. No conversational text.
"""

def parse_with_ollama(context_text: str) -> Dict[str, Any]:
    """
    Attempts to parse placement context using local Ollama endpoint.
    """
    ollama_base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip('/')
    ollama_model = os.getenv("OLLAMA_MODEL", "qwen2.5:1.5b")
    prompt = get_parser_prompt(context_text)
    
    try:
        response = requests.post(
            f"{ollama_base_url}/api/generate",
            json={
                "model": ollama_model,
                "prompt": prompt,
                "stream": False,
                "format": "json",
                "options": {
                    "temperature": 0.1
                }
            },
            timeout=25
        )
        if response.status_code == 200:
            result = response.json()
            response_text = result.get("response", "{}").strip()
            clean_str = clean_json_string(response_text)
            parsed = json.loads(clean_str)
            if "parser_metadata" in parsed:
                parsed["parser_metadata"]["model_used"] = f"ollama-{ollama_model}"
            return parsed
    except Exception as e:
        logger.warning(f"Ollama ({ollama_model}) parsing failed: {str(e)}")
    return {}

def parse_with_huggingface(context_text: str) -> Dict[str, Any]:
    """
    Escalates parsing to Hugging Face Serverless Inference API (Qwen2.5-72B-Instruct).
    """
    hf_token = os.getenv("HF_API_TOKEN", "")
    if not hf_token:
        logger.warning("HF_API_TOKEN not found in environment. Skipping Hugging Face escalation.")
        return {}
        
    model_id = "Qwen/Qwen2.5-72B-Instruct"
    api_url = f"https://api-inference.huggingface.co/models/{model_id}"
    headers = {"Authorization": f"Bearer {hf_token}"}
    prompt = get_parser_prompt(context_text)
    
    try:
        response = requests.post(
            api_url,
            headers=headers,
            json={
                "inputs": prompt,
                "parameters": {
                    "max_new_tokens": 1024,
                    "temperature": 0.1,
                    "return_full_text": False
                }
            },
            timeout=25
        )
        if response.status_code == 200:
            res_json = response.json()
            if isinstance(res_json, list) and len(res_json) > 0:
                generated_text = res_json[0].get("generated_text", "").strip()
            elif isinstance(res_json, dict):
                generated_text = res_json.get("generated_text", "").strip()
            else:
                generated_text = str(res_json).strip()
                
            clean_str = clean_json_string(generated_text)
            parsed = json.loads(clean_str)
            if "parser_metadata" in parsed:
                parsed["parser_metadata"]["model_used"] = f"huggingface-{model_id}"
            return parsed
        else:
            logger.warning(f"Hugging Face API returned error ({response.status_code}): {response.text}")
    except Exception as e:
        logger.warning(f"Hugging Face escalation parsing failed: {str(e)}")
    return {}

def is_high_confidence(parsed: Dict[str, Any]) -> bool:
    """
    Checks if the overall confidence and core field confidences meet the quality thresholds.
    Thresholds:
      - Overall Confidence >= 0.75
      - Core fields (company, event_type) >= 0.80
      - deadline_iso >= 0.80 (if present)
    """
    if not parsed or not isinstance(parsed, dict):
        return False
        
    ext = parsed.get("extracted_data")
    if not ext or not isinstance(ext, dict):
        return False
        
    overall = parsed.get("overall_confidence", 0.0)
    if overall < 0.75:
        return False
        
    # Check core fields
    for field in ["company", "event_type"]:
        field_data = ext.get(field)
        if not field_data or not isinstance(field_data, dict):
            return False
        if field_data.get("confidence", 0.0) < 0.80:
            return False
            
    # Check deadline if present
    deadline = ext.get("deadline_iso")
    if deadline and isinstance(deadline, dict) and deadline.get("value"):
        if deadline.get("confidence", 0.0) < 0.80:
            return False
            
    return True

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

def build_regex_fallback_response(email_body: str) -> Dict[str, Any]:
    """
    Builds a mock LLM structure response from the legacy regex+spaCy output.
    """
    parsed = extract_placements_regex(email_body)

    # Use spaCy NER as fallback for missing fields (dates/locations/orgs)
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

    # Final defaults
    company = parsed.get("company", "Unknown Company").strip()
    role = parsed.get("role", "Software Engineer").strip()
    category = parsed.get("category", "Dream").strip()
    ctc = parsed.get("ctc")
    stipend = parsed.get("stipend")
    eligible_branches = parsed.get("eligible_branches", [])
    min_cgpa = parsed.get("min_cgpa")
    requires_no_arrears = parsed.get("requires_no_arrears", False)
    deadline_iso = parsed.get("deadline_iso")
    job_location = parsed.get("job_location")
    registration_link = parsed.get("registration_link")

    # Determine event type based on subject/body heuristics
    event_type = "NEW_DRIVE"
    body_lower = email_body.lower()
    if 'shortlist' in body_lower:
        event_type = "SHORTLIST_RELEASED"
    elif 'online test' in body_lower or 'assessment' in body_lower or ' oa ' in (' ' + body_lower + ' '):
        event_type = "OA_SCHEDULED"
    elif 'interview' in body_lower:
        event_type = "INTERVIEW_SCHEDULED"
    elif 'offer' in body_lower or 'congratulations' in body_lower:
        event_type = "OFFER_RELEASED"
    elif 'regret' in body_lower or 'not selected' in body_lower or 'rejection' in body_lower or 'reject' in body_lower:
        event_type = "REJECTION_RELEASED"

    return {
        "parser_metadata": {
            "parser_version": "v2-regex-fallback",
            "model_used": "regex-rules"
        },
        "overall_confidence": 0.50,
        "extracted_data": {
            "company": {
                "value": company,
                "confidence": 0.50
            },
            "event_type": {
                "value": event_type,
                "confidence": 0.50
            },
            "job_location": {
                "value": job_location,
                "confidence": 0.50
            },
            "deadline_iso": {
                "value": deadline_iso,
                "confidence": 0.50
            },
            "registration_link": {
                "value": registration_link,
                "confidence": 0.50
            },
            "roles": [
                {
                    "role": { "value": role, "confidence": 0.50 },
                    "ctc": { "value": ctc, "confidence": 0.50 },
                    "stipend": { "value": stipend, "confidence": 0.50 },
                    "eligible_branches": { "value": eligible_branches, "confidence": 0.50 },
                    "min_cgpa": { "value": min_cgpa, "confidence": 0.50 },
                    "requires_no_arrears": { "value": requires_no_arrears, "confidence": 0.50 }
                }
            ]
        }
    }

def parse_placement_email(email_body: str, subject: str = "", attachment_text: str = "") -> Dict[str, Any]:
    """
    Main entry point to parse a placement email using the escalate-on-threshold chain:
    Ollama -> Validate -> If low confidence/offline -> HF Serverless API -> Regex Fallback.
    """
    # 1. Prepare context text
    context_text = f"Subject: {subject}\n\nBody:\n{email_body}"
    if attachment_text:
        context_text += f"\n\nAttachment Content:\n{attachment_text}"
        
    logger.info("Attempting local Ollama parser...")
    parsed = parse_with_ollama(context_text)
    
    if is_high_confidence(parsed):
        logger.info("Local Ollama parser returned HIGH confidence output. Proceeding.")
        return parsed
        
    logger.info("Local Ollama parser output is low confidence or failed. Escalating to Hugging Face...")
    parsed_hf = parse_with_huggingface(context_text)
    
    if parsed_hf and parsed_hf.get("extracted_data"):
        logger.info("Hugging Face parser returned structured output. Proceeding.")
        return parsed_hf
        
    logger.warning("Hugging Face escalation failed or returned empty. Falling back to Regex parser.")
    return build_regex_fallback_response(email_body)
