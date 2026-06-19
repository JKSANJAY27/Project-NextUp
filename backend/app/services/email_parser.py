import re
import os
import json
import logging
from typing import Dict, Any, List, Optional
import dateparser
import requests

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# spaCy is optional — only loaded if available
try:
    import spacy
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
except ImportError:
    logger.warning("spaCy not installed. NER fallback disabled.")
    nlp = None


def clean_json_string(s: str) -> str:
    s = s.strip()
    match = re.search(r"```(?:json)?\s*(.*?)\s*```", s, re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1).strip()
    # Find first { and last } to extract JSON object robustly
    start = s.find("{")
    end = s.rfind("}")
    if start != -1 and end != -1 and end > start:
        return s[start:end + 1]
    return s


def get_parser_prompt(context_text: str) -> str:
    return f"""You are a structured data extractor for university placement emails. 
Analyze the following email (subject, body, and any attachment text) and extract the required fields.
Output ONLY a valid raw JSON object — no markdown, no explanation, no code fences.

Required JSON Output Format:
{{
  "parser_metadata": {{
    "parser_version": "v3",
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
      "value": "2026-06-25T19:00:00",
      "confidence": 0.92
    }},
    "registration_link": {{
      "value": "https://forms.gle/xyz",
      "confidence": 0.99
    }},
    "date_of_visit": {{
      "value": "Will be announced later",
      "confidence": 0.85
    }},
    "roles": [
      {{
        "role": {{ "value": "Software Engineer", "confidence": 0.98 }},
        "ctc": {{ "value": "18 LPA", "confidence": 0.95 }},
        "stipend": {{ "value": null, "confidence": 0.99 }},
        "min_cgpa": {{ "value": 7.5, "confidence": 0.97 }},
        "requires_no_arrears": {{ "value": true, "confidence": 0.96 }},
        "eligible_branches": {{ "value": ["CSE", "IT"], "confidence": 0.94 }}
      }}
    ]
  }}
}}

Guidelines for event_type (choose exactly ONE):
- NEW_DRIVE: Company announces registration / opening a drive.
- DEADLINE_EXTENSION: Notice extending last date to register.
- SHORTLIST_RELEASED: Candidates shortlisted for next round.
- OA_SCHEDULED: Online Test / Assessment link or schedule.
- OA_RESULT: Result of an Online Assessment.
- INTERVIEW_SCHEDULED: Interview dates, slots, batches, venues.
- INTERVIEW_RESULT: Result of interview rounds.
- OFFER_RELEASED: Final offer/selection announcements.
- REJECTION_RELEASED: Regret / non-selected lists.
- GENERAL_UPDATE: Venue changes, corrections, general instructions.

Multi-role rules:
- If the email mentions multiple roles (e.g. Software Engineer AND Data Scientist), include EACH as a separate object in the "roles" array.
- Never merge multiple roles into one object.
- Each role object must have its own ctc, stipend, min_cgpa, eligible_branches, requires_no_arrears.

CGPA rules:
- Extract only the numeric CGPA threshold (0.0 to 10.0).
- If percentage (e.g. 60%) is given for 10th/12th only, do NOT use it as min_cgpa.
- If both percentage and CGPA are given (e.g. "60% or 6.0 CGPA"), use the CGPA value.

Deadline rules:
- Convert deadline to ISO 8601 format: YYYY-MM-DDTHH:MM:SS
- If only a date is given (no time), use T23:59:00 unless another time is stated.
- If deadline says e.g. "7.00 pm", include the time: T19:00:00

Confidence rules:
- Use 0.95+ when info is explicitly stated in the text.
- Use 0.70-0.94 when reasonably inferred.
- Use 0.50-0.69 when guessed from context.
- Use < 0.50 when very uncertain.

Content to analyze:
---
{context_text}
---

Return ONLY the raw JSON object. No markdown. No explanation.
"""


def ping_ollama(base_url: str, timeout: int = 10) -> bool:
    """
    Checks if the Ollama endpoint is alive by calling /api/tags.
    HF Spaces sleep on free tier — this acts as a wake-up ping.
    """
    try:
        resp = requests.get(f"{base_url}/api/tags", timeout=timeout)
        return resp.status_code == 200
    except Exception:
        return False


def parse_with_ollama(context_text: str) -> Dict[str, Any]:
    """
    Attempts to parse placement context using the Ollama endpoint
    (can be local or a HuggingFace Space running Ollama).
    """
    if os.getenv("DISABLE_OLLAMA", "").lower() == "true":
        logger.info("Ollama is disabled via DISABLE_OLLAMA env var. Skipping.")
        return {}

    ollama_base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
    ollama_model = os.getenv("OLLAMA_MODEL", "qwen2.5:1.5b")
    prompt = get_parser_prompt(context_text)

    # Wake-up ping — HF free-tier spaces sleep after inactivity
    if not ping_ollama(ollama_base_url, timeout=5):
        logger.warning(f"Ollama endpoint at {ollama_base_url} is not responding (sleeping or offline). Skipping.")
        return {}

    try:
        response = requests.post(
            f"{ollama_base_url}/api/generate",
            json={
                "model": ollama_model,
                "prompt": prompt,
                "stream": False,
                "format": "json",
                "options": {
                    "temperature": 0.1,
                    "num_predict": 1200
                }
            },
            timeout=10
        )
        if response.status_code == 200:
            result = response.json()
            response_text = result.get("response", "{}").strip()
            clean_str = clean_json_string(response_text)
            parsed = json.loads(clean_str)
            if "parser_metadata" in parsed:
                parsed["parser_metadata"]["model_used"] = f"ollama-{ollama_model}"
            logger.info(f"Ollama ({ollama_model}) parse succeeded.")
            return parsed
        else:
            logger.warning(f"Ollama returned HTTP {response.status_code}: {response.text[:200]}")
    except json.JSONDecodeError as e:
        logger.warning(f"Ollama response JSON decode failed: {str(e)}")
    except Exception as e:
        logger.warning(f"Ollama ({ollama_model}) parsing failed: {str(e)}")
    return {}


def parse_with_huggingface(context_text: str) -> Dict[str, Any]:
    """
    Escalates parsing to Hugging Face Inference API (OpenAI-compatible Messages format).
    Uses Qwen2.5-72B-Instruct via the router endpoint.
    """
    hf_token = os.getenv("HF_API_TOKEN", "")
    if not hf_token:
        logger.warning("HF_API_TOKEN not set. Skipping HuggingFace escalation.")
        return {}

    model_id = "meta-llama/Llama-3.3-70B-Instruct"
    # Use OpenAI-compatible Messages API (correct format for instruction models)
    api_url = "https://router.huggingface.co/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {hf_token}",
        "Content-Type": "application/json"
    }
    prompt = get_parser_prompt(context_text)

    try:
        response = requests.post(
            api_url,
            headers=headers,
            json={
                "model": model_id,
                "messages": [
                    {
                        "role": "system",
                        "content": "You are a structured data extractor. Output only valid JSON. No markdown."
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
            timeout=120
        )
        if response.status_code == 200:
            res_json = response.json()
            # OpenAI-compatible response format
            generated_text = (
                res_json.get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
                .strip()
            )
            if not generated_text:
                logger.warning("HuggingFace returned empty content.")
                return {}

            clean_str = clean_json_string(generated_text)
            parsed = json.loads(clean_str)
            if "parser_metadata" in parsed:
                parsed["parser_metadata"]["model_used"] = f"huggingface-{model_id}"
            logger.info(f"HuggingFace ({model_id}) parse succeeded.")
            return parsed
        else:
            logger.warning(f"HuggingFace API returned error ({response.status_code}): {response.text[:300]}")
    except json.JSONDecodeError as e:
        logger.warning(f"HuggingFace response JSON decode failed: {str(e)}")
    except Exception as e:
        logger.warning(f"HuggingFace escalation parsing failed: {str(e)}")
    return {}


def is_high_confidence(parsed: Dict[str, Any]) -> bool:
    """
    Checks if overall confidence and core field confidences meet quality thresholds:
      - Overall >= 0.75
      - company confidence >= 0.80
      - event_type confidence >= 0.80
      - deadline_iso confidence >= 0.80 (if present and non-null)
    """
    if not parsed or not isinstance(parsed, dict):
        return False

    ext = parsed.get("extracted_data")
    if not ext or not isinstance(ext, dict):
        return False

    overall = parsed.get("overall_confidence", 0.0)
    if overall < 0.75:
        return False

    for field in ["company", "event_type"]:
        field_data = ext.get(field)
        if not field_data or not isinstance(field_data, dict):
            return False
        if field_data.get("confidence", 0.0) < 0.80:
            return False

    deadline = ext.get("deadline_iso")
    if deadline and isinstance(deadline, dict) and deadline.get("value"):
        if deadline.get("confidence", 0.0) < 0.80:
            return False

    return True


def extract_company_from_subject(subject: str) -> str:
    if not subject:
        return "Unknown Company"
    s = subject.replace('\u200b', '').strip()
    prev_s = None
    while s != prev_s:
        prev_s = s
        s = re.sub(
            r'^(?:congratulations|congrats|kind\s+attn|kind\s+attention|summer\s+sem|updated|update|re|fwd|urgnt|urgent|notice|report\s+immediately)\b[:\s!]*',
            '',
            s,
            flags=re.I
        ).strip()
        s = re.sub(r'^[:\s!]+', '', s)
    parts = re.split(r'[-–—|:(]', s)
    first_part = parts[0].strip()
    clean = re.sub(
        r'\b(?:next\s+round|tech\s+talk|super\s+dream|dream|regular|mass|recruiter|internship|placement|hiring|registration|selection|shortlist|online\s+test|oa|interview|offers?|applied|announcement|results?|list|batch|\d{4})\b.*$',
        '',
        first_part,
        flags=re.I
    ).strip()
    clean = re.sub(r'[*_#]', '', clean).strip()
    if len(clean) >= 2:
        return clean
    if len(first_part) >= 2:
        return first_part
    return "Unknown Company"


def extract_placements_regex(email_body: str, subject: str = "") -> Dict[str, Any]:
    """
    Rule-based extraction using regular expressions as a last-resort fallback.
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
        sub_company = extract_company_from_subject(subject)
        if sub_company and sub_company != "Unknown Company":
            data["company"] = sub_company
        else:
            lines = [line.strip() for line in email_body.split("\n") if line.strip()]
            if lines:
                data["company"] = lines[0].replace("**", "").strip()

    # 2. Category — check internship FIRST before dream/regular
    cat_match = re.search(
        r"(Dream\s*Internship|Regular\s*Internship|Summer\s*Intern(?:ship)?|Super\s*Dream|Mass\s*Recruiter|Dream\s*Offer|Dream|Regular)",
        email_body,
        re.IGNORECASE
    )
    if cat_match:
        cat = cat_match.group(1).lower()
        if "super" in cat:
            data["category"] = "Super Dream"
        elif "mass" in cat:
            data["category"] = "Mass Recruiter"
        elif "internship" in cat or "intern" in cat:
            data["category"] = "Internship"
        elif "dream" in cat:
            data["category"] = "Dream"
        else:
            data["category"] = "Regular"
    else:
        data["category"] = "Regular"

    # 3. Role
    role_match = re.search(
        r"(?:Designation|Role|Job Title|Profile|Position):\s*([^\n\r]+)",
        email_body,
        re.IGNORECASE
    )
    if role_match:
        data["role"] = role_match.group(1).strip()

    # 4. CTC
    ctc_match = re.search(
        r"(?:CTC|Salary|Package|Annual CTC):\s*([^\n\r]+)",
        email_body,
        re.IGNORECASE
    )
    if ctc_match:
        data["ctc"] = ctc_match.group(1).strip()
    else:
        ctc_num_match = re.search(r"(\d+(?:\.\d+)?\s*(?:LPA|Lakhs|Lakh|INR|Rs\.?))", email_body, re.IGNORECASE)
        if ctc_num_match:
            data["ctc"] = ctc_num_match.group(1).strip()

    # 5. Stipend
    stipend_match = re.search(
        r"(?:Stipend|Internship\s*[Ss]tipend):\s*([^\n\r]+)",
        email_body,
        re.IGNORECASE
    )
    if stipend_match:
        data["stipend"] = stipend_match.group(1).strip()
    else:
        # Look for standalone amounts near "stipend" keyword (within 200 chars following it)
        idx = email_body.lower().find("stipend")
        if idx != -1:
            stipend_sub = email_body[idx:]
            stipend_num_match = re.search(
                r"(?:Rs\.?|INR|₹)?\s*([\d,]+(?:\.\d+)?)\s*(?:pm|per\s*month|/month|K|k|thousand)?",
                stipend_sub[:200],
                re.IGNORECASE
            )
            if stipend_num_match:
                data["stipend"] = stipend_num_match.group(1).replace(",", "").strip()

    # 6. Registration Deadline
    deadline_match = re.search(
        r"(?:Last\s*date\s*for\s*Registration|Last\s*Date\s*to\s*Apply|Registration\s*Deadline|Last\s*Date|Deadline|Last\s*date):\s*([^\n\r]+)",
        email_body,
        re.IGNORECASE
    )
    if deadline_match:
        raw_date = deadline_match.group(1).strip()
        parsed_date = dateparser.parse(raw_date)
        if parsed_date:
            data["deadline_iso"] = parsed_date.isoformat()

    # 7. Eligible Branches — extended list
    branches_match = re.search(
        r"(?:Eligible\s*Branches|Eligibility\s*Branches|Branches|Eligible\s*Departments?):\s*([^\n]{1,300})",
        email_body,
        re.IGNORECASE
    )
    if branches_match:
        branches_raw = branches_match.group(1)
        found = re.findall(
            r"\b(CSE|IT|ECE|EEE|MECH|CIVIL|SWE|MCA|MTECH|MBA|AIDS|AIML|CSD|IOT|CSBS|VLSI|BME|AERO)\b",
            branches_raw,
            re.IGNORECASE
        )
        if found:
            data["eligible_branches"] = list(set([b.upper() for b in found]))

    # 8. Min CGPA — handles both "6.0 CGPA", "CGPA >= 7.5", "min CGPA 8", "60% or 6.0 CGPA"
    cgpa_patterns = [
        r"(?:min(?:imum)?\s+CGPA\s*(?:of|:)?\s*)([\d.]+)",
        r"CGPA\s*(?:>=|>|≥|of)\s*([\d.]+)",
        r"([\d.]+)\s*(?:CGPA|or\s+above\s+CGPA|or\s+higher\s+CGPA|cgpa)",
        r"in\s+Pursuing\s+Degree\s*[–—-]\s*([\d.]+)\s*(?:CGPA|or)",
    ]
    for pattern in cgpa_patterns:
        cgpa_match = re.search(pattern, email_body, re.IGNORECASE)
        if cgpa_match:
            try:
                val = float(cgpa_match.group(1))
                if 0.0 <= val <= 10.0:
                    data["min_cgpa"] = val
                    break
            except ValueError:
                pass

    # 9. Arrear condition
    arrears_match = re.search(
        r"(No\s+Standing\s+Arrears|No\s+active\s+backlogs|No\s+backlogs|No\s+standing\s+backlogs|No\s+History\s+of\s+Arrears)",
        email_body,
        re.IGNORECASE
    )
    data["requires_no_arrears"] = True if arrears_match else False

    # 10. Job location
    location_match = re.search(
        r"(?:Job\s*Location|Location|Work\s*Location|Place\s*of\s*Posting):\s*([^\n\r]+)",
        email_body,
        re.IGNORECASE
    )
    if location_match:
        data["job_location"] = location_match.group(1).strip()
    else:
        # Try inline: "Location - Chennai"
        loc_inline = re.search(r"Location\s*[-–]\s*([A-Za-z ,]+)", email_body, re.IGNORECASE)
        if loc_inline:
            data["job_location"] = loc_inline.group(1).strip()

    # 11. Registration Link
    link_match = re.search(
        r"(?:Register|Apply|Registration\s*Link|NEOPAT|portal).*?(https?://[^\s\)\"'<>]+)",
        email_body,
        re.IGNORECASE
    )
    if link_match:
        data["registration_link"] = link_match.group(1).strip()
    else:
        urls = re.findall(r"(https?://[^\s\)\"'<>]+)", email_body)
        for url in urls:
            if any(k in url.lower() for k in ["register", "apply", "form", "google", "cdc", "vtop", "neopat"]):
                data["registration_link"] = url
                break

    # 12. Date of Visit
    visit_match = re.search(
        r"(?:Date of Visit|Visit Date|Date of recruitment|Recruitment Date):\s*([^\n\r]+)",
        email_body,
        re.IGNORECASE
    )
    if visit_match:
        data["date_of_visit"] = visit_match.group(1).strip()
    else:
        data["date_of_visit"] = "Will be announced later"

    return data


def build_regex_fallback_response(email_body: str, subject: str = "") -> Dict[str, Any]:
    """
    Builds a mock LLM-structure response from regex+spaCy extraction.
    Used as last resort when both Ollama and HuggingFace fail.
    """
    parsed = extract_placements_regex(email_body, subject)

    # spaCy NER as fallback for missing fields
    if nlp and ("deadline_iso" not in parsed or "job_location" not in parsed or "company" not in parsed):
        doc = nlp(email_body)
        orgs, dates, gpes = [], [], []
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
                p_date = dateparser.parse(d)
                if p_date:
                    parsed["deadline_iso"] = p_date.isoformat()
                    break

        if "job_location" not in parsed and gpes:
            parsed["job_location"] = gpes[0].strip()

    company = parsed.get("company", "Unknown Company").strip()
    role = parsed.get("role", "Software Engineer").strip()
    category = parsed.get("category", "Regular").strip()
    ctc = parsed.get("ctc")
    stipend = parsed.get("stipend")
    eligible_branches = parsed.get("eligible_branches", [])
    min_cgpa = parsed.get("min_cgpa")
    requires_no_arrears = parsed.get("requires_no_arrears", False)
    deadline_iso = parsed.get("deadline_iso")
    job_location = parsed.get("job_location")
    registration_link = parsed.get("registration_link")
    date_of_visit = parsed.get("date_of_visit", "Will be announced later")

    # Determine event type from body and subject heuristics
    event_type = "NEW_DRIVE"
    text_to_check = (subject + " " + email_body).lower()
    if "deadline extended" in text_to_check or "extension" in text_to_check:
        event_type = "DEADLINE_EXTENSION"
    elif "shortlist" in text_to_check or "short-listed" in text_to_check:
        event_type = "SHORTLIST_RELEASED"
    elif "oa result" in text_to_check or "online test result" in text_to_check or "assessment result" in text_to_check:
        event_type = "OA_RESULT"
    elif "online test" in text_to_check or "assessment" in text_to_check or " oa " in (" " + text_to_check + " ") or "online assessment" in text_to_check:
        event_type = "OA_SCHEDULED"
    elif "interview result" in text_to_check or "interview select" in text_to_check:
        event_type = "INTERVIEW_RESULT"
    elif "interview" in text_to_check:
        event_type = "INTERVIEW_SCHEDULED"
    elif "offer" in text_to_check or "congratulations" in text_to_check or "selection list" in text_to_check or "selected candidates" in text_to_check:
        event_type = "OFFER_RELEASED"
    elif "regret" in text_to_check or "not selected" in text_to_check or "rejection" in text_to_check:
        event_type = "REJECTION_RELEASED"

    return {
        "parser_metadata": {
            "parser_version": "v3-regex-fallback",
            "model_used": "regex-rules"
        },
        "overall_confidence": 0.45,
        "extracted_data": {
            "company": {"value": company, "confidence": 0.45},
            "event_type": {"value": event_type, "confidence": 0.45},
            "job_location": {"value": job_location, "confidence": 0.45},
            "deadline_iso": {"value": deadline_iso, "confidence": 0.45},
            "registration_link": {"value": registration_link, "confidence": 0.45},
            "date_of_visit": {"value": date_of_visit, "confidence": 0.45},
            "roles": [
                {
                    "role": {"value": role, "confidence": 0.45},
                    "ctc": {"value": ctc, "confidence": 0.45},
                    "stipend": {"value": stipend, "confidence": 0.45},
                    "eligible_branches": {"value": eligible_branches, "confidence": 0.45},
                    "min_cgpa": {"value": min_cgpa, "confidence": 0.45},
                    "requires_no_arrears": {"value": requires_no_arrears, "confidence": 0.45}
                }
            ]
        }
    }


def parse_placement_email(
    email_body: str,
    subject: str = "",
    attachment_text: str = ""
) -> Dict[str, Any]:
    """
    Main entry point. Escalating LLM chain:
      1. Ollama (HF Space or local) — primary
      2. HuggingFace Serverless API (Qwen2.5-72B-Instruct) — if Ollama low/fails
      3. Regex + spaCy fallback — if both fail

    Attachments (PDF text, Excel preview) should already be extracted and
    passed in as `attachment_text` before calling this function.
    """
    # Build combined context
    context_text = f"Subject: {subject}\n\nBody:\n{email_body}"
    if attachment_text:
        context_text += f"\n\nAttachment Content:\n{attachment_text}"

    logger.info("Starting email parsing — attempting Ollama...")
    parsed = parse_with_ollama(context_text)

    if is_high_confidence(parsed):
        logger.info("Ollama returned HIGH confidence. Using Ollama result.")
        return parsed

    logger.info("Ollama low confidence or failed. Escalating to HuggingFace...")
    parsed_hf = parse_with_huggingface(context_text)

    if parsed_hf and parsed_hf.get("extracted_data"):
        logger.info("HuggingFace parse succeeded. Using HF result.")
        return parsed_hf

    logger.warning("Both LLM attempts failed. Falling back to Regex parser.")
    return build_regex_fallback_response(email_body, subject)
