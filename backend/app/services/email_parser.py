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

_nlp = None

def get_nlp():
    """Lazy-load the spaCy model only when needed to save startup memory."""
    global _nlp
    if _nlp is None:
        try:
            import spacy
            try:
                _nlp = spacy.load("en_core_web_sm")
            except OSError:
                logger.info("spaCy model 'en_core_web_sm' not found. Downloading...")
                import subprocess
                import sys
                try:
                    subprocess.run([sys.executable, "-m", "spacy", "download", "en_core_web_sm"], check=True)
                    _nlp = spacy.load("en_core_web_sm")
                except Exception as e:
                    logger.error(f"Failed to download spaCy model: {str(e)}")
                    _nlp = None
        except ImportError:
            logger.warning("spaCy not installed. NER fallback disabled.")
            _nlp = None
    return _nlp


# ---------------------------------------------------------------------------
# Generic name guard
# These strings are known bad company names that arise from email headers,
# placement category headings, or congratulatory messages.
# ---------------------------------------------------------------------------
GENERIC_COMPANY_NAMES = frozenset({
    "unknown company", "unknown", "",
    # Placement category/drive headings
    "super dream", "dream", "regular", "mass recruiter", "internship",
    "super dream internship", "dream internship", "dream placement",
    "regular internship", "summer intern", "summer internship",
    "super dream placement", "dream offer",
    # Common email intros
    "congratulations", "congrats", "dear students", "dear student",
    "kind attention", "kind attn", "hi", "hello",
    # Generic drive terminology
    "placement", "hiring", "recruitment drive", "campus recruitment",
    "campus drive", "selection process", "next round", "next round of selection process",
    # CDC headings
    "vit", "vellore", "vit vellore", "cdc", "training and placement",
    "vit placement", "vit bhopal", "vit ap", "vit chennai",
    # Registration headings
    "registration open", "registration", "apply now", "apply",
    # Year-like tokens
    "2025 batch", "2026 batch", "2027 batch", "2028 batch",
    # Blank-ish
    "n/a", "na", "nil", "-",
})

def is_generic_company_name(name: str) -> bool:
    """Returns True if name is a known bad/generic company name."""
    if not name:
        return True
    cleaned = re.sub(r'[*#_\-–—\s\t\n\r]+', ' ', name).strip().lower()
    
    # Heuristics to reject long sentences/subject-lines
    if len(cleaned) > 40:
        return True
    if len(cleaned.split()) > 5:
        return True
        
    if cleaned in GENERIC_COMPANY_NAMES:
        return True
        
    # Reject common non-company phrases in subjects
    generic_patterns = [
        r'\bcongratulations\b',
        r'\bcongrats\b',
        r'\bkind\s+attention\b',
        r'\battention\b',
        r'\bselection\s+process\b',
        r'\bonline\s+test\b',
        r'\bonline\s+assessment\b',
        r'\boa\b',
        r'\bscheduled\b',
        r'\btest\s+link\b',
        r'\bshortlist\b',
        r'\bshortlisted\b',
        r'\bselect\s+list\b',
        r'\bselected\b',
        r'\bplacement\s+officer\b',
        r'\bcdc\b',
        r'\bpat\b',
        r'\bvit\b',
        r'\bstudent\b',
        r'\bstudents\b',
        r'\bbatch\b',
        r'\bregistration\b',
        r'\bapply\b',
        r'\bplacements\b',
    ]
    for pattern in generic_patterns:
        if re.search(pattern, cleaned):
            return True
            
    # Reject if the name is entirely numeric or a year
    if re.match(r'^\d+$', cleaned):
        return True
    # Reject if it starts with placement drive category language
    if re.match(r'^(?:super\s+dream|dream|regular|mass\s+recruiter|internship)', cleaned):
        return True
    # Reject single-character names
    if len(cleaned) < 2:
        return True
    return False


DEGREE_ONTOLOGY = {
    "btech": "BTECH",
    "b.tech": "BTECH",
    "b. tech": "BTECH",
    "b_tech": "BTECH",
    "b tech": "BTECH",
    "bachelor of technology": "BTECH",
    
    "mtech": "MTECH",
    "m.tech": "MTECH",
    "m. tech": "MTECH",
    "m_tech": "MTECH",
    "m tech": "MTECH",
    "master of technology": "MTECH",
    
    "mca": "MCA",
    "m.c.a.": "MCA",
    "master of computer applications": "MCA",
    
    "msc": "MSC",
    "m.sc": "MSC",
    "m.sc.": "MSC",
    "master of science": "MSC"
}

SPECIALIZATION_ONTOLOGY = {
    "cse core": "CSE_CORE",
    "cse-core": "CSE_CORE",
    "cse_core": "CSE_CORE",
    "computer science and engineering": "CSE_CORE",
    "computer science & engineering": "CSE_CORE",
    "computer science": "CSE_CORE",
    "cse": "CSE_CORE",
    
    "information security": "CSE_INFO_SEC",
    "info sec": "CSE_INFO_SEC",
    "infosec": "CSE_INFO_SEC",
    "cse-is": "CSE_INFO_SEC",
    "cse(is)": "CSE_INFO_SEC",
    "cse (is)": "CSE_INFO_SEC",
    "cyber security": "CSE_INFO_SEC",
    "cybersecurity": "CSE_INFO_SEC",
    "information assurance": "CSE_INFO_SEC",
    
    "iot": "CSE_IOT",
    "internet of things": "CSE_IOT",
    "cse-iot": "CSE_IOT",
    "cse(iot)": "CSE_IOT",
    "cse (iot)": "CSE_IOT",
    
    "data science": "CSE_DATA_SCIENCE",
    "datascience": "CSE_DATA_SCIENCE",
    "cse-ds": "CSE_DATA_SCIENCE",
    "cse(ds)": "CSE_DATA_SCIENCE",
    "cse (ds)": "CSE_DATA_SCIENCE",
    "ds": "CSE_DATA_SCIENCE",
    
    "blockchain": "CSE_BLOCKCHAIN",
    "block chain": "CSE_BLOCKCHAIN",
    "cse-blockchain": "CSE_BLOCKCHAIN",
    "cse (blockchain)": "CSE_BLOCKCHAIN",
    "cse(blockchain)": "CSE_BLOCKCHAIN",
    
    "ai ml": "CSE_AI_ML",
    "ai/ml": "CSE_AI_ML",
    "ai & ml": "CSE_AI_ML",
    "ai and ml": "CSE_AI_ML",
    "artificial intelligence": "CSE_AI_ML",
    "machine learning": "CSE_AI_ML",
    "cse-aiml": "CSE_AI_ML",
    "cse (aiml)": "CSE_AI_ML",
    "cse(aiml)": "CSE_AI_ML",
    "cse-ai/ml": "CSE_AI_ML",
    "cse-ai & ml": "CSE_AI_ML",
    "cse (ai & ml)": "CSE_AI_ML",
    "cse(ai & ml)": "CSE_AI_ML",
    "cse-ai": "CSE_AI_ML",
    "aids": "CSE_AI_ML",
    "ai & ds": "CSE_AI_ML",
    "ai/ds": "CSE_AI_ML",
    
    "other": "OTHER"
}

def normalize_degree(raw_str: str) -> Optional[str]:
    if not raw_str:
        return None
    val = raw_str.strip().lower()
    if val in DEGREE_ONTOLOGY:
        return DEGREE_ONTOLOGY[val]
    for k, v in DEGREE_ONTOLOGY.items():
        if k in val:
            return v
    return None

def normalize_specialization(raw_str: str) -> Optional[str]:
    if not raw_str:
        return None
    val = raw_str.strip().lower()
    if val in SPECIALIZATION_ONTOLOGY:
        return SPECIALIZATION_ONTOLOGY[val]
    for k, v in SPECIALIZATION_ONTOLOGY.items():
        if k in val:
            return v
    return None

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

def repair_and_parse_json(raw_str: str) -> Dict[str, Any]:
    """
    Attempts to parse JSON defensively. If standard json.loads fails,
    uses the json_repair library to resolve trailing commas, unclosed quotes,
    or truncated brackets.
    """
    cleaned = clean_json_string(raw_str)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        try:
            import json_repair
            repaired = json_repair.repair_json(cleaned)
            return json.loads(repaired)
        except Exception as e:
            logger.warning(f"JSON repair failed: {e}")
            raise


def get_parser_prompt(context_text: str) -> str:
    """You are a structured data extractor and classifier for university placement emails.
Analyze the following email (subject, body, and any attachment text) and extract the required fields.
Output ONLY a valid raw JSON object — no markdown, no explanation, no code fences.

CRITICAL — Company Name Rules (READ FIRST):
- The company name must be the ACTUAL, CANONICAL BRAND NAME (e.g. "Groww", "Google", "JPMorgan Chase", "Ericsson", "Schneider Electric").
- NEVER use placement categories, drive types, or subject headings as the company name. 
  BANNED values include: "Super Dream Placement", "Dream Internship", "Super Dream Internship / Placement", "Dream", "Super Dream", "Regular", "Congratulations", "Next Round of Selection", "Registration Open", "CDC Drive", "Campus Recruitment", "Unknown Company".
- Locate the company name from labels like "Name of the Company:", "Company Name:", "Organisation:", or the email's signature/branding.
- If the company name is missing, set company.value = null and company.confidence = 0.0. DO NOT guess.

Required JSON Output Format:
{{
  "parser_metadata": {{
    "parser_version": "v6",
    "model_used": "llm-extracted"
  }},
  "overall_confidence": 0.90,
  "extracted_data": {{
    "email_category": "NEW_DRIVE",
    "company": {{
      "value": "Groww",
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
      "value": "2026-07-04T09:00:00",
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
    "eligibility_raw_text": {{
      "value": "Eligible Branches: B.Tech CSE (all specializations), M.Tech CSE/DS. CGPA >= 8.0, 10th/12th >= 80%, No standing arrears.",
      "confidence": 0.95
    }},
    "events": [
      {{
        "stage": "REGISTRATION",
        "label": "Last Date for Registration",
        "date_iso": "2026-07-04T09:00:00",
        "venue": null,
        "mandatory": true,
        "round_number": null,
        "sequence": 1,
        "confidence": 0.95
      }},
      {{
        "stage": "ONLINE_ASSESSMENT",
        "label": "Online Test",
        "date_iso": "2026-07-08T00:00:00",
        "venue": "CDC Labs (Respective)",
        "mandatory": true,
        "round_number": null,
        "sequence": 2,
        "confidence": 0.92
      }},
      {{
        "stage": "PRE_PLACEMENT_TALK",
        "label": "Pre-Placement Talk",
        "date_iso": "2026-07-09T18:00:00",
        "venue": "Physical - Vellore Campus",
        "mandatory": false,
        "round_number": null,
        "sequence": 3,
        "confidence": 0.90
      }},
      {{
        "stage": "TECHNICAL_INTERVIEW",
        "label": "Technical Interview",
        "date_iso": "2026-07-10T00:00:00",
        "venue": "Physical - VIT Vellore Campus",
        "mandatory": true,
        "round_number": 1,
        "sequence": 4,
        "confidence": 0.88
      }}
    ],
    "roles": [
      {{
        "role": {{ "value": "Software Development Engineer", "confidence": 0.98 }},
        "ctc": {{ "value": "26 LPA", "confidence": 0.95 }},
        "stipend": {{ "value": "1,00,000 per month", "confidence": 0.95 }},
        "min_cgpa": {{ "value": 8.0, "confidence": 0.97 }},
        "requires_no_arrears": {{ "value": true, "confidence": 0.96 }},
        "eligible_branches": {{ "value": ["CSE", "IT"], "confidence": 0.94 }},
        "degree_types": {{ "value": ["BTECH"], "confidence": 0.95 }},
        "specializations": {{ "value": ["CSE_CORE"], "confidence": 0.95 }},
        "min_tenth_marks": {{ "value": 80.0, "confidence": 0.95 }},
        "min_twelfth_marks": {{ "value": 80.0, "confidence": 0.95 }},
        "min_ug_cgpa": {{ "value": null, "confidence": 0.95 }}
      }}
    ],
    "announcement": {{
      "title": {{ "value": "Litcoder Modules Completion Deadline", "confidence": 0.98 }},
      "announcement_type": {{ "value": "TRAINING", "confidence": 0.98 }},
      "deadline_iso": {{ "value": "2026-06-17T11:00:00", "confidence": 0.95 }},
      "body_summary": {{ "value": "CDC reminder to complete minimum 11 Litcoder modules before registration.", "confidence": 0.95 }}
    }}
  }}
}}

Guidelines for email_category (choose exactly ONE):
- NEW_DRIVE: Mails announcing a new company hiring drive, job opening, or internship registration (creates a new workspace/opportunity). Set "announcement" fields to null.
- DRIVE_UPDATE: Mails containing updates for an existing company drive (OA links, interview schedules, shortlist announcements, offer letters, rejection lists). Set "announcement" to null.
- GENERAL_ANNOUNCEMENT: Non-company specific placement announcements. This includes general university notices, Litcoder modules completion warnings, TCS NQT/CoCubes general preparation instructions (not specific company drives), mandatory placement registrations, CDC seminars, resume reviews, webinars, or training workshops. Set "company", "event_type", "roles", "events" to null.
- UNKNOWN: Mails that are irrelevant to placement, spam, personal, or cannot be categorized.

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

Guidelines for events[] array:
- Extract ALL recruitment milestones mentioned in the email — registration deadline, online test, PPT, interview rounds, etc.
- "stage" must be one of: REGISTRATION, ONLINE_ASSESSMENT, PRE_PLACEMENT_TALK, TECHNICAL_INTERVIEW, HR_INTERVIEW, OFFER, REJECTION, GENERAL_UPDATE
- "date_iso": ISO 8601 date-time string. If only a date is given (no time), use T00:00:00. If time is given, use it.
- "round_number": Integer for multi-round interviews (Round 1, Round 2). null for single or non-interview stages.
- "sequence": Order of events in the recruitment workflow (1 = first, 2 = second, etc.).
- "mandatory": true if this is a compulsory stage, false if optional (e.g. PPT).
- If no explicit timeline exists, return events: [] (empty array).

Multi-role rules — READ CAREFULLY:
- ONLY create multiple role objects when the email EXPLICITLY lists SEPARATE CTC or stipend values per distinct role name (e.g., a table or indented block like "Role A - 18 LPA / Role B - 12 LPA").
- If the email has a single "Designation", "Role", "Profile", or "Job Title" field — even if the subject line or category mentions "Dream Internship" or a programme name — output EXACTLY ONE role object using that single designation.
- The email subject line, category name (e.g., "Dream Internship Registration"), or programme title (e.g., "2027 Batch") are NOT role names. Extract the role only from the "Designation", "Role", "Profile", or "Job Title" field in the email body.
- If no explicit role field is found, use the job title from the JD or attachment text. Only default to "Software Engineer" as a last resort when no role information exists anywhere.
- Never merge multiple roles into one object when they genuinely differ.
- Each role object must have its own ctc, stipend, min_cgpa, eligible_branches, requires_no_arrears, degree_types, specializations, min_tenth_marks, min_twelfth_marks, min_ug_cgpa.

Eligibility Rules — IMPORTANT:
- This system is for a CSE-focused university placement cell. All eligible branches will be subsets of: CSE, IT, MCA, M.Tech CSE, M.Tech Data Science, M.Tech AI/ML, Integrated M.Tech (CSE/IT related), and similar CSE-family branches.
- DO NOT add branches like ECE, EEE, EIE, Mechanical, Civil, Aerospace, or any non-CSE branches unless they are EXPLICITLY named as eligible in the email's "Eligible Branches" section.
- eligible_branches: Extract ONLY the branches explicitly listed in the "Eligible Branches" or "Eligible Departments" section of the email. Do NOT infer branches from job title or role description.
- degree_types: A list of strings from: BTECH, MTECH, MCA, MSC. Parse from the Eligible Branches section only.
- specializations: A list of strings from: CSE_CORE, CSE_INFO_SEC, CSE_IOT, CSE_DATA_SCIENCE, CSE_BLOCKCHAIN, CSE_AI_ML. If the email says "B.Tech CSE (all specializations)" or just "B.Tech CSE" without listing specific specializations, use ["CSE_CORE"] and set allow_all_specializations=true. ONLY add specific specializations if they are explicitly listed.
- min_tenth_marks: Extract the minimum percentage required for Class 10 (e.g. 60.0 or 70.0). Null if not mentioned.
- min_twelfth_marks: Extract the minimum percentage required for Class 12 (e.g. 60.0 or 70.0). Null if not mentioned.
- min_ug_cgpa: Only for PG programs (e.g. M.Tech, MCA) if they mention a minimum UG CGPA (e.g. "UG CGPA >= 7.0"). Null if not mentioned.

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
            parsed = repair_and_parse_json(response_text)
            if "parser_metadata" in parsed:
                parsed["parser_metadata"]["model_used"] = f"ollama-{ollama_model}"
            logger.info(f"Ollama ({ollama_model}) parse succeeded.")
            return parsed
        else:
            logger.warning(f"Ollama returned HTTP {response.status_code}: {response.text[:200]}")
    except Exception as e:
        logger.warning(f"Ollama ({ollama_model}) parsing/repair failed: {str(e)}")
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
            generated_text = (
                res_json.get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
                .strip()
            )
            if not generated_text:
                logger.warning("HuggingFace returned empty content.")
                return {}

            parsed = repair_and_parse_json(generated_text)
            if "parser_metadata" in parsed:
                parsed["parser_metadata"]["model_used"] = f"huggingface-{model_id}"
            logger.info(f"HuggingFace ({model_id}) parse succeeded.")
            return parsed
        else:
            logger.warning(f"HuggingFace API returned error ({response.status_code}): {response.text[:300]}")
    except Exception as e:
        logger.warning(f"HuggingFace escalation parsing/repair failed: {str(e)}")
    return {}


def is_high_confidence(parsed: Dict[str, Any]) -> bool:
    """
    Checks if overall confidence and core field confidences meet quality thresholds.
    Supports either DRIVE/UPDATE or GENERAL_ANNOUNCEMENT schemas.
    """
    if not parsed or not isinstance(parsed, dict):
        return False

    ext = parsed.get("extracted_data")
    if not ext or not isinstance(ext, dict):
        return False

    overall = parsed.get("overall_confidence", 0.0)
    if overall < 0.75:
        return False

    category = ext.get("email_category")
    if not category:
        return False

    if category == "GENERAL_ANNOUNCEMENT":
        ann = ext.get("announcement")
        if not ann or not isinstance(ann, dict):
            return False
        title_data = ann.get("title")
        if not title_data or not isinstance(title_data, dict):
            return False
        if title_data.get("confidence", 0.0) < 0.80:
            return False
        return True

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
    
    # Remove zero-width spaces and clean outer whitespace
    s = subject.replace('\u200b', '').replace('\xa0', ' ').replace('_', ' ').strip()
    # Strip any leading asterisks, hashes, hyphens, and other special characters early on
    s = re.sub(r'^[*#_\s\-–—]+', '', s).strip()
    
    # Prefix patterns to completely discard at the start of subject
    # Loop to strip nested prefixes
    prev_s = None
    while s != prev_s:
        prev_s = s
        s = re.sub(
            r'^(?:congratulations|congrats|kind\s+attn|kind\s+attention|summer\s+sem|updated|update|re|fwd|urgnt|urgent|notice|report\s+immediately|reminder|gentle\s+reminder|webinar)\b[:\s!]*',
            '',
            s,
            flags=re.I
        ).strip()
        s = re.sub(r'^[:\s!]+', '', s)
        
    # Split by colon, dash, or pipe, but ignore if it's within a date/time (e.g. 10:00 AM) or a decimal (e.g. 3.0)
    # Let's split by major separators: ':', '|', '-'
    # But only split on ':' if it is not followed by digits (like 10:00)
    parts = []
    colon_parts = re.split(r':(?!\d)', s)
    if len(colon_parts) > 1:
        # Check if the first part is a generic instructions prefix, like "Updated timings & Instructions"
        p0_lower = colon_parts[0].lower()
        generic_words = ["timings", "instructions", "update", "registration form", "schedule", "scheduled", "venue", "details", "webinar"]
        is_generic = any(w in p0_lower for w in generic_words)
        if is_generic:
            s = ":".join(colon_parts[1:]).strip()
        else:
            s = colon_parts[0].strip()
            
    # Now split on other separators: '|', '-' (but only if surrounded by spaces)
    s = s.split('|')[0].strip()
    s = re.split(r'\s+[-–—]\s+', s)[0].strip()
    
    # If there is a '(' at the start of any suffix, split there
    s = s.split('(')[0].strip()

    # Clean up standard suffix keywords (e.g. "online test", "selection list", "hiring", etc.)
    suffix_pattern = r'\b(?:next\s+round|tech\s+talk|super\s+dream|dream|regular|mass|recruitment|recruiter|drive|drives|internship|placement|hiring|registration|selection|shortlist|online\s+test|online\s+coding\s+test|coding\s+test|assignment\s+round|assignment|round|oa|interview|offers?|applied|announcement|results?|list|batch|pre-placement|connect|is\s+scheduled|scheduled|ppt|presentation|talk|webinar|test)\b.*$'
    clean = re.sub(suffix_pattern, '', s, flags=re.I).strip()
    
    # Strip campus names and other VIT specific words
    campus_pattern = r'\b(?:vit\s+vellore|vit\s+vellore\s+campus|vit|vellore|chennai\s+campus|chennai|campus|engineering\s+college|college|university)\b'
    clean = re.sub(campus_pattern, '', clean, flags=re.I).strip()
    
    # Clean up trailing date or year patterns (e.g., 2027 batch)
    clean = re.sub(r'\b(?:202\d|fy2\d)\b.*$', '', clean, flags=re.I).strip()
    
    # Strip any leftover punctuation / markdown / symbols / operators (but keep &)
    clean = re.sub(r'[*_#/\-–—]', ' ', clean).strip()
    clean = re.sub(r'\s+', ' ', clean).strip()
    
    # Clean up trailing ampersands or spaces
    clean = re.sub(r'\s+[&]\s*$', '', clean).strip()
    
    if len(clean) >= 2:
        return clean
    
    # Final fallbacks
    s_clean = re.sub(r'[*_#]', '', s).strip()
    if len(s_clean) >= 2:
        return s_clean
    return "Unknown Company"

def clean_val(val: str) -> Optional[str]:
    if not val:
        return None
    val = re.sub(r'[*_#\u00d8]', '', val)  # strip markdown & bullet characters
    return val.strip()

def get_branches_from_text(text: str, strict: bool = False) -> List[str]:
    """
    Extract CSE-family eligible branches from a text block.
    
    This system is CSE-only. We never return ECE, EEE, MECH, CIVIL etc.
    
    If strict=True (used when no dedicated "Eligible Branches" block was found),
    only match unambiguous full-form names (e.g. "computer science", "information technology")
    to avoid false positives from body text like "AI model" or "it is required".
    
    If strict=False (used on the isolated branches block), broader abbreviations are accepted.
    """
    branches = set()
    text_lower = text.lower()
    
    # --- Always-on matches (safe even in full body) ---
    if re.search(r'\b(computer\s*science(?:\s*(?:and|&)\s*engineering)?|cse)\b', text_lower):
        branches.add("CSE")
    if re.search(r'\binformation\s+technology\b', text_lower):
        branches.add("IT")
    if re.search(r'\b(master\s+of\s+computer\s+app(?:lications?)?|m\.?c\.?a)\b', text_lower):
        branches.add("MCA")
    if re.search(r'\bintegrated\s+m\.?\s*tech\b', text_lower):
        branches.add("MTECH_INT")
    
    if not strict:
        # Abbreviation matches — only safe when scanning an isolated branches block
        # "it" deliberately excluded — too ambiguous (matches "it is", "submit it", etc.)
        if re.search(r'\bit\b', text_lower):
            # Only count "IT" if it appears as a branch token (preceded/followed by branch-style context)
            if re.search(r'(?:branch(?:es)?\s*[:\-]?.*?\bit\b|\bit\b.*?branch|eligible.*?\bit\b)', text_lower):
                branches.add("IT")
        if re.search(r'\bmca\b', text_lower):
            branches.add("MCA")
        if re.search(r'\bm\.?\s*tech\b', text_lower):
            branches.add("MTECH")
        if re.search(r'\b(aids|ai\s*(?:and|&|/)\s*ds)\b', text_lower):
            branches.add("AIDS")
        if re.search(r'\baiml\b', text_lower):
            branches.add("AIML")
        if re.search(r'\bswe\b', text_lower):
            branches.add("SWE")
    
    return list(branches)

def extract_multiple_roles_from_body(email_body: str) -> List[Dict[str, Any]]:
    """
    Detects and parses multi-role CTC/Stipend blocks from email bodies.
    
    Handles varied formats:
      Format 1 (indented, no spaces around dash):
          CTC
            Full Stack Developer Intern & Business Analysis-3.5 LPA
            Prompt Engineer Intern- 4-5 LPA (If converted)
      
      Format 2 (spaced dash):
          CTC:
            Software Engineer - 18 LPA
            Data Analyst - 12 LPA
      
      Format 3 (bullet points):
          CTC:
          * Role A: 10 LPA
          * Role B: 8 LPA
    
    Returns list of {role, ctc, stipend} dicts if >= 2 distinct roles found, else [].
    """
    roles: Dict[str, Dict[str, Any]] = {}

    def parse_role_value_block(block_text: str) -> Dict[str, str]:
        """
        Parse a block of text where each line is 'Role Name - Value' or 'Role Name: Value'
        or 'Role Name-Value' (no spaces). Returns {role_name: value}.
        """
        found = {}
        for line in block_text.strip().splitlines():
            # Strip leading whitespace, bullets, asterisks
            line = re.sub(r'^[\s*\-\u00d8\u2022]+', '', line).strip()
            if not line:
                continue
            # Try to find a separator: optional space, then dash/colon, then value
            # Value pattern: starts with digit (for CTC like "3.5 LPA", "4-5 LPA", "18 LPA")
            # or digit-like (for stipend like "10000", "25,000")
            sep = re.search(
                r'\s*[-\u2013\u2014:]\s*(\d[\d\s,LlPpAa\.\-/()]+(?:LPA|lpa|Lakhs?|INR|K|k)?\b.*?)$',
                line
            )
            if sep:
                val = sep.group(1).strip()
                role_name = line[:sep.start()].strip()
                # Remove trailing dash or colon from role name
                role_name = re.sub(r'[\s\-:]+$', '', role_name).strip()
                if role_name and val:
                    found[role_name] = val
        return found

    def extract_section_block(label_pattern: str, body: str) -> str:
        """
        Find a section labeled by label_pattern and extract the lines following it
        until the next section header (a line that is not indented/bulleted).
        Normalizes double CRLF (\r\r\n) and standard CRLF (\r\n) to \n first.
        """
        # Normalize all CR/CRLF variants to plain \n
        norm_body = body.replace('\r\r\n', '\n').replace('\r\n', '\n').replace('\r', '\n')
        # Collapse multiple blank lines into one so the regex can skip them
        norm_body = re.sub(r'\n{2,}', '\n', norm_body)
        # Match the label line, then capture indented/bulleted lines that follow
        m = re.search(
            r'(?:^|[\n])\s*[*\-\u00d8]?\s*' + label_pattern +
            r'\s*[:\-\u2013\u2014]?\s*[\n]((?:(?:[ \t*\-\u00d8\u2022][^\n]*|[^\n]+(?:LPA|Lpa|lpa|\d{4,})[^\n]*)[\n])+)',
            norm_body,
            re.IGNORECASE | re.MULTILINE
        )
        return m.group(1) if m else ""

    # --- Extract CTC block ---
    ctc_block = extract_section_block(r'(?:CTC|Salary|Package|Annual\s*CTC)', email_body)
    if ctc_block:
        ctc_map = parse_role_value_block(ctc_block)
        for role_name, val in ctc_map.items():
            if role_name not in roles:
                roles[role_name] = {}
            roles[role_name]['ctc'] = clean_val(val)

    # --- Extract Stipend block ---
    stipend_block = extract_section_block(r'(?:Stipend|Internship\s*Stipend|Monthly\s*Stipend)', email_body)
    if stipend_block:
        stipend_map = parse_role_value_block(stipend_block)
        for role_name, val in stipend_map.items():
            if role_name not in roles:
                roles[role_name] = {}
            roles[role_name]['stipend'] = clean_val(val)

    # Only return results if we found >= 2 distinct roles
    if len(roles) >= 2:
        result = []
        for role_name, vals in roles.items():
            result.append({
                'role': role_name,
                'ctc': vals.get('ctc'),
                'stipend': vals.get('stipend'),
            })
        logger.debug(f"Multi-role extractor found {len(result)} roles: {[r['role'] for r in result]}")
        return result
    return []


def extract_placements_regex(email_body: str, subject: str = "") -> Dict[str, Any]:
    """
    Rule-based extraction using regular expressions as a last-resort fallback.
    Supports multiline parsing, flexible colon/markdown formatting, and joint X/XII marks.
    """
    data = {}

    # 1. Company Name — use a strict extraction hierarchy:
    #    1a. Structured body label (Name of the Company: ...)
    #    1b. spaCy NER on body text (filtered to non-generic ORG entities)
    #    1c. Subject line extraction (last resort, very cleaned)
    #    1d. Unknown Company (never guess)
    comp_match = re.search(
        r"(?:^|[\n\r])\s*[\-\–\—\*\u00d8\d\.\s]*\s*(?:Name of the Company|Company Name|Name of the Organisation|Organisation|\bCompany\b(?!\s*(?:website|profile|url|link|domain|page|site|info|description|overview|logo|details)))\s*[:\-\–\—\s]\s*[\n\r]*\s*\*?([^\n\r*]+)",
        email_body,
        re.IGNORECASE
    )
    company_from_label = None
    if comp_match:
        candidate = clean_val(comp_match.group(1))
        if candidate and not is_generic_company_name(candidate):
            company_from_label = candidate

    if company_from_label:
        data["company"] = company_from_label
    else:
        # 1b. spaCy NER — only if available, filter out academic/CDC-related org names
        ner_company = None
        nlp_obj = get_nlp()
        if nlp_obj:
            doc = nlp_obj(email_body[:2000])  # Only scan first 2000 chars for speed
            for ent in doc.ents:
                if ent.label_ == "ORG":
                    ner_name = ent.text.strip()
                    if not any(k in ner_name.lower() for k in [
                        "vit", "vellore", "institute", "university", "college",
                        "cdc", "neopat", "government", "helpdesk", "placement cell"
                    ]) and not is_generic_company_name(ner_name) and len(ner_name) >= 3:
                        ner_company = ner_name
                        break

        if ner_company:
            data["company"] = ner_company
        else:
            # 1c. Subject line extraction (last resort for structured regex)
            sub_company = extract_company_from_subject(subject)
            if sub_company and sub_company != "Unknown Company" and not is_generic_company_name(sub_company):
                data["company"] = sub_company
            else:
                # 1d. Give up — return Unknown Company. Never guess.
                data["company"] = "Unknown Company"

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
        r"(?:^|[\n\r])\s*[\-\–\—\*\u00d8\d\.\s]*\s*(?:Designation|Role|Job Title|Profile|Position|Job Title/Role)\s*[:\-\–\—\s]\s*[\n\r]*\s*\*?([^\n\r*]+)",
        email_body,
        re.IGNORECASE
    )
    if role_match:
        data["role"] = clean_val(role_match.group(1))
    else:
        data["role"] = "Software Engineer"

    # 4. CTC
    ctc_match = re.search(
        r"(?:^|[\n\r])\s*[\-\–\—\*\u00d8\d\.\s]*\s*(?:CTC|Salary|Package|Annual\s*CTC)\s*[:\-\–\—\s]\s*[\n\r]*\s*\*?([^\n\r*]+)",
        email_body,
        re.IGNORECASE
    )
    if ctc_match:
        data["ctc"] = clean_val(ctc_match.group(1))
    else:
        ctc_num_match = re.search(r"(\d+(?:\.\d+)?\s*(?:LPA|Lakhs|Lakh|INR|Rs\.?))", email_body, re.IGNORECASE)
        if ctc_num_match:
            data["ctc"] = clean_val(ctc_num_match.group(1))
        else:
            data["ctc"] = "Will be announced later"

    # 5. Stipend
    stipend_match = re.search(
        r"(?:^|[\n\r])\s*[\-\–\—\*\u00d8\d\.\s]*\s*(?:Stipend|Internship\s*Stipend|Monthly\s*Stipend)\s*[:\-\–\—\s]\s*[\n\r]*\s*\*?([^\n\r*]+)",
        email_body,
        re.IGNORECASE
    )
    if stipend_match:
        data["stipend"] = clean_val(stipend_match.group(1))
    else:
        # Search for digits near "stipend" keyword (within 200 chars following it)
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
            else:
                data["stipend"] = "Will be announced later"
        else:
            data["stipend"] = "Will be announced later"

    # 6. Registration Deadline
    deadline_match = re.search(
        r"(?:^|[\n\r])\s*[\-\–\—\*\u00d8\d\.\s]*\s*(?:Last\s*date\s*for\s*Registration|Last\s*Date\s*to\s*Apply|Registration\s*Deadline|Last\s*Date|Deadline|Last\s*date)\s*[:\-\–\—\s]\s*[\n\r]*\s*([^\n\r]+)",
        email_body,
        re.IGNORECASE
    )
    if deadline_match:
        raw_date = clean_val(deadline_match.group(1))
        parsed_date = dateparser.parse(raw_date, settings={'TIMEZONE': 'Asia/Kolkata', 'TO_TIMEZONE': 'UTC', 'RETURN_AS_TIMEZONE_AWARE': True})
        if parsed_date:
            data["deadline_iso"] = parsed_date.isoformat()
    else:
        # Try inline "register on or before [date]"
        on_or_before = re.search(
            r"(?:register|apply|submission|submit)\s*(?:[^\n\r]{0,50}?)(?:on\s*or\s*before|before|by|on)\s*\*?([^\n\r]{5,40})",
            email_body,
            re.I
        )
        if on_or_before:
            raw_date = clean_val(on_or_before.group(1))
            parsed_date = dateparser.parse(raw_date, settings={'TIMEZONE': 'Asia/Kolkata', 'TO_TIMEZONE': 'UTC', 'RETURN_AS_TIMEZONE_AWARE': True})
            if parsed_date:
                data["deadline_iso"] = parsed_date.isoformat()

    # 7. Eligible Branches block extraction
    # Try to isolate the "Eligible Branches" section before scanning for branches.
    # Stop at section headers: Eligibility Criteria, CTC, Stipend, Last date, Website, Designation, etc.
    branches_block_match = re.search(
        r"(?:^|[\n\r])\s*[\-\–\—\*\u00d8\d\.\s]*\s*(?:Eligible\s*Branches|Eligibility\s*Branches|Eligible\s*Departments?|Eligible\s*Programs?)\s*[:\-\–\—\s]\s*[\n\r]*(.*?)(?=\n\s*[\-\–\—\*\u00d8\d\.\s]*\s*(?:Eligibility\s*Criteria|Eligibility|Criteria|CTC|Salary|Stipend|Last\s+date|Last\s+Date|Website|Job\s+location|Designation|Date\s+of\s+Visit)|$)",
        email_body,
        re.IGNORECASE | re.DOTALL
    )
    
    branches_block_found = branches_block_match is not None
    branches_text = branches_block_match.group(1).strip() if branches_block_found else ""
    
    # Only scan full body as strict fallback if no dedicated block was found.
    # strict=True prevents short abbreviations like 'it', 'ai', 'is' from false-matching body text.
    if branches_text:
        data["eligible_branches"] = get_branches_from_text(branches_text, strict=False)
    else:
        data["eligible_branches"] = get_branches_from_text(email_body, strict=True)

    # Degree types — search branches block first, then whole email as fallback
    degree_search_text = branches_text if branches_text else email_body
    found_degrees = []
    if re.search(r'\b(b\.?\s*tech|bachelor\s+of\s+tech)\b', degree_search_text, re.I):
        found_degrees.append("BTECH")
    if re.search(r'\b(m\.?\s*tech|master\s+of\s+tech)\b', degree_search_text, re.I):
        found_degrees.append("MTECH")
    if re.search(r'\b(m\.?\s*c\.?\s*a|master\s+of\s+computer\s+app)\b', degree_search_text, re.I):
        found_degrees.append("MCA")
    if re.search(r'\b(m\.?\s*sc|master\s+of\s+sci)\b', degree_search_text, re.I):
        found_degrees.append("MSC")
    # If still no degree types found and we searched a limited block, search full email
    if not found_degrees and branches_text:
        if re.search(r'\b(b\.?\s*tech|bachelor\s+of\s+tech)\b', email_body, re.I):
            found_degrees.append("BTECH")
        if re.search(r'\b(m\.?\s*tech|master\s+of\s+tech)\b', email_body, re.I):
            found_degrees.append("MTECH")
        if re.search(r'\b(m\.?\s*c\.?\s*a|master\s+of\s+computer\s+app)\b', email_body, re.I):
            found_degrees.append("MCA")
        if re.search(r'\b(m\.?\s*sc|master\s+of\s+sci)\b', email_body, re.I):
            found_degrees.append("MSC")
    data["degree_types"] = found_degrees

    # Specializations — only from branches block (strict), or whole body if none found
    # IMPORTANT: Never infer specializations from role names (e.g., "Prompt Engineer" ≠ AI/ML branch)
    found_specializations = []
    spec_search = branches_text if branches_text else ""
    if spec_search:
        # Explicit specialization keywords in the branches block
        if re.search(r'\b(computer\s*science(?:\s*(?:and|&)\s*engineering)?|cse)\b', spec_search, re.I):
            found_specializations.append("CSE_CORE")
        if re.search(r'\b(information?\s*sec(?:urity)?|cyber\s*sec(?:urity)?)\b', spec_search, re.I):
            found_specializations.append("CSE_INFO_SEC")
        if re.search(r'\b(iot|internet\s+of\s+things)\b', spec_search, re.I):
            found_specializations.append("CSE_IOT")
        if re.search(r'\b(data\s+science)\b', spec_search, re.I):
            found_specializations.append("CSE_DATA_SCIENCE")
        if re.search(r'\b(blockchain|block\s*chain)\b', spec_search, re.I):
            found_specializations.append("CSE_BLOCKCHAIN")
        if re.search(r'\b(artificial\s*intelligence|machine\s*learning|ai\s*(?:and|&|/)\s*ml|aiml)\b', spec_search, re.I):
            found_specializations.append("CSE_AI_ML")
    # If specializations not found in a block, default to CSE_CORE (safest assumption for CSE-only system)
    if not found_specializations:
        found_specializations.append("CSE_CORE")
    data["specializations"] = found_specializations

    # 8. Eligibility Criteria block extraction
    elig_block_match = re.search(
        r"(?:^|[\n\r])\s*[\-\–\—\*\u00d8\d\.\s]*\s*(?:Eligibility Criteria|Eligibility|Criteria)\s*[:\-\–\—\s]\s*[\n\r]*(.*?)(?:CTC|Stipend|Last date|Website|Job location|Designation|$)",
        email_body,
        re.IGNORECASE | re.DOTALL
    )
    elig_text = elig_block_match.group(1) if elig_block_match else email_body
    
    elig_lines = elig_text.strip().split("\n")
    cleaned_elig_lines = [clean_val(line) for line in elig_lines if clean_val(line)]
    data["eligibility_raw_text"] = "\n".join(cleaned_elig_lines) if cleaned_elig_lines else None

    # Min CGPA (exclusing percentage % values from matches)
    pursuing_cgpa = re.search(
        r"(?:pursuing|current|college|degree|cgpa\s*in\s*degree|graduation)\s*(?:degree)?\s*[\-–—:]?\s*(?:>=|>|:)?\s*([\d.]+)(?!\s*%)",
        elig_text,
        re.IGNORECASE
    )
    if pursuing_cgpa:
        data["min_cgpa"] = float(pursuing_cgpa.group(1))
    else:
        cgpa_patterns = [
            r"(?:min(?:imum)?\s+CGPA\s*(?:of|:)?\s*)([\d.]+)(?!\s*%)",
            r"CGPA\s*(?:>=|>|:)?\s*([\d.]+)(?!\s*%)",
            r"([\d.]+)\s*(?:CGPA|or\s+above\s+CGPA|or\s+higher\s+CGPA|cgpa)",
        ]
        data["min_cgpa"] = None
        for pattern in cgpa_patterns:
            cgpa_match = re.search(pattern, elig_text, re.IGNORECASE)
            if cgpa_match:
                try:
                    val = float(cgpa_match.group(1))
                    if 0.0 <= val <= 10.0:
                        data["min_cgpa"] = val
                        break
                except ValueError:
                    pass

    # 10th / 12th percentages
    # Joint check: e.g. "X and XII – 75%"
    joint_match = re.search(
        r"(?:10th\s*(?:and|&)\s*12th|x\s*(?:and|&)\s*xii)\s*[\-–—:]?\s*(\d{2})",
        elig_text,
        re.IGNORECASE
    )
    if joint_match:
        val = float(joint_match.group(1))
        data["min_tenth_marks"] = val
        data["min_twelfth_marks"] = val
    else:
        tenth_match = re.search(r'(?:10th|xth|class\s*10|matriculation)(?:\s*marks|\s*percentage|\s*%)?[\-–—:]?\s*(\d{2})', elig_text, re.I)
        data["min_tenth_marks"] = float(tenth_match.group(1)) if tenth_match else None
        
        twelfth_match = re.search(r'(?:12th|xiith|class\s*12|hs|higher\s*secondary)(?:\s*marks|\s*percentage|\s*%)?[\-–—:]?\s*(\d{2})', elig_text, re.I)
        data["min_twelfth_marks"] = float(twelfth_match.group(1)) if twelfth_match else None

    # PG UG CGPA
    ug_cgpa_match = re.search(
        r'(?:in\s+ug|ug\s*cgpa|undergrad\s*cgpa)[^\n\r]*?(\d+(?:\.\d+)?)\s*cgpa',
        elig_text,
        re.I
    )
    if ug_cgpa_match:
        data["min_ug_cgpa"] = float(ug_cgpa_match.group(1))
    else:
        ug_cgpa_match = re.search(r'(?:ug\s*cgpa|undergrad\s*cgpa)(?:\s*(?:>=|>|:|-|of|\b)\s*)(\d+(?:\.\d+)?)', elig_text, re.I)
        data["min_ug_cgpa"] = float(ug_cgpa_match.group(1)) if ug_cgpa_match else None

    # Arrears — search eligibility block first, then full body as fallback
    # Also handle "History of Arrears" with percentage/CGPA threshold that means the same thing
    ARREARS_PATTERN = (
        r"(No\s+Standing\s+Arrears|No\s+active\s+backlogs|No\s+backlogs|No\s+standing\s+backlogs"
        r"|No\s+History\s+of\s+Arrears|No\s+Arrears|Zero\s+Backlogs|Backlogs\s+not\s+allowed"
        r"|should\s+not\s+have\s+(?:any\s+)?(?:active\s+)?backlogs|no\s+current\s+backlogs)"
    )
    arrears_match = re.search(ARREARS_PATTERN, elig_text, re.IGNORECASE)
    if not arrears_match:
        # Fallback: search the full email body
        arrears_match = re.search(ARREARS_PATTERN, email_body, re.IGNORECASE)
    data["requires_no_arrears"] = True if arrears_match else False

    # 9. Job location
    location_match = re.search(
        r"(?:^|[\n\r])\s*[\-\–\—\*\u00d8\d\.\s]*\s*(?:Job\s*Location|Location|Work\s*Location|Place\s*of\s*Posting)\s*[:\-\–\—\s]\s*[\n\r]*\s*(.+)",
        email_body,
        re.IGNORECASE
    )
    if location_match:
        data["job_location"] = clean_val(location_match.group(1))
    else:
        # Try inline "Location - Chennai"
        loc_inline = re.search(r"Location\s*[-–]\s*([A-Za-z ,&]+)", email_body, re.IGNORECASE)
        if loc_inline:
            data["job_location"] = clean_val(loc_inline.group(1))
        else:
            data["job_location"] = "Will be announced later"

    # 10. Registration Link
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

    # 11. Date of Visit
    visit_match = re.search(
        r"(?:^|[\n\r])\s*[\-\–\—\*\u00d8\d\.\s]*\s*(?:Date of Visit|Visit Date|Date of recruitment|Recruitment Date)\s*[:\-\–\—\s]\s*[\n\r]*\s*(.+)",
        email_body,
        re.IGNORECASE
    )
    if visit_match:
        data["date_of_visit"] = clean_val(visit_match.group(1))
    else:
        data["date_of_visit"] = "Will be announced later"

    return data


# ---------------------------------------------------------------------------
# Timeline event extraction (regex-based)
# ---------------------------------------------------------------------------

# Stage keyword → canonical stage name mapping
_STAGE_KEYWORDS: List[tuple] = [
    # (regex pattern, canonical stage, sequence)
    (r"\b(?:last\s+date\s+(?:for\s+)?registration|registration\s+deadline|last\s+date\s+to\s+apply|apply\s+(?:on|before))\b", "REGISTRATION", 1),
    (r"\b(?:online\s+test|online\s+assessment|coding\s+test|written\s+test|oa|assessment)\b", "ONLINE_ASSESSMENT", 2),
    (r"\b(?:pre[-\s]?placement\s+talk|ppt|pre[-\s]?placement|company\s+talk|company\s+presentation)\b", "PRE_PLACEMENT_TALK", 3),
    (r"\b(?:technical\s+interview|tech\s+interview|coding\s+interview|technical\s+round)\b", "TECHNICAL_INTERVIEW", 4),
    (r"\b(?:hr\s+interview|hr\s+round|managerial\s+interview|managerial\s+round|final\s+interview)\b", "HR_INTERVIEW", 5),
    (r"\b(?:interview)\b", "TECHNICAL_INTERVIEW", 4),
    (r"\b(?:offer|placed|final\s+result|selected|selection\s+(?:list|status|results?|letters?))\b", "OFFER", 6),
]

# Date fragments to search near stage keywords
_DATE_PATTERN = (
    r"(?:"
    # "8th July 2026", "8 July 2026", "July 8", etc.
    r"\d{1,2}\s*(?:st|nd|rd|th)?\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s*(?:\d{2,4})?"
    r"|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:\s*,?\s*\d{4})?"
    # ISO-like: 2026-07-08, 08-07-2026
    r"|\d{4}[-/]\d{2}[-/]\d{2}"
    r"|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}"
    r")"
    # Optional time: allows separators like -, @, at, etc., and parses times with or without minutes/parentheses
    r"(?:\s*(?:-|@|at|from|,)?\s*[\(]?\s*\d{1,2}[:.\s]\d{2}\s*(?:am|pm)?[\)]?|\s*(?:-|@|at|from|,)?\s*\d{1,2}\s*(?:am|pm))?"
)


def extract_timeline_events(email_body: str, subject: str = "", email_timestamp=None) -> List[Dict[str, Any]]:
    """Extract recruitment milestone events from a placement email body.
    
    Returns a list of event dicts:
      {
        stage: str (canonical),
        label: str (human-readable from email),
        date_iso: str | None,
        venue: str | None,
        mandatory: bool,
        round_number: int | None,
        sequence: int,
        confidence: float
      }
    """
    events: List[Dict[str, Any]] = []
    seen_stages: set = set()

    dp_settings = {
        'TIMEZONE': 'Asia/Kolkata',
        'TO_TIMEZONE': 'UTC',
        'RETURN_AS_TIMEZONE_AWARE': True,
        'DATE_ORDER': 'DMY',
        'PREFER_DAY_OF_MONTH': 'first',
    }
    if email_timestamp:
        dp_settings['RELATIVE_BASE'] = (
            email_timestamp.replace(tzinfo=None)
            if hasattr(email_timestamp, 'tzinfo') else email_timestamp
        )

    # Filter out empty lines to ensure the 3-line window captures dates separated by whitespace/newlines,
    # and strip markdown markers like * or _ to prevent matching interference
    lines = [re.sub(r'[*_#]', '', line).strip() for line in email_body.split("\n")]
    lines = [line for line in lines if line]

    for stage_pattern, canonical_stage, sequence in _STAGE_KEYWORDS:
        for i, line in enumerate(lines):
            if not re.search(stage_pattern, line, re.IGNORECASE):
                continue

            # Search this line and the next 2 lines for a date
            search_window = " ".join(lines[i:i+3])
            date_match = re.search(_DATE_PATTERN, search_window, re.IGNORECASE)
            date_iso = None
            if date_match:
                raw_date = date_match.group(0).strip()
                parsed_dt = dateparser.parse(raw_date, settings=dp_settings)
                if parsed_dt:
                    date_iso = parsed_dt.isoformat()

            # Determine round_number from text like "Round 1", "Round 2"
            round_number = None
            round_m = re.search(r"round\s*(\d+)", line, re.IGNORECASE)
            if round_m:
                round_number = int(round_m.group(1))

            # Deduplicate: if same stage+round already added, skip
            dedup_key = (canonical_stage, round_number)
            if dedup_key in seen_stages:
                continue
            seen_stages.add(dedup_key)

            # Venue detection: look for city names or physical/online keywords near stage
            venue = None
            venue_m = re.search(
                r"(?:at|venue\s*[:–—]?|location\s*[:–—]?|held\s+at|conducted\s+at)\s+([A-Za-z][A-Za-z ,]{3,50})",
                search_window, re.IGNORECASE
            )
            if venue_m:
                venue = venue_m.group(1).strip()
            elif re.search(r"\b(?:online|virtual|remote)\b", search_window, re.IGNORECASE):
                venue = "Online"
            elif re.search(r"\b(?:physical|in-person|campus|vellore|chennai|vit)\b", search_window, re.IGNORECASE):
                venue = "Physical"

            mandatory = canonical_stage not in ("PRE_PLACEMENT_TALK",)

            events.append({
                "stage": canonical_stage,
                "label": line.strip()[:120],
                "date_iso": date_iso,
                "venue": venue,
                "mandatory": mandatory,
                "round_number": round_number,
                "sequence": sequence,
                "confidence": 0.70 if date_iso else 0.50
            })

    # Sort by sequence, then date
    events.sort(key=lambda e: (e["sequence"], e["date_iso"] or ""))
    return events


def build_regex_fallback_response(email_body: str, subject: str = "", force_announcement: bool = False, email_timestamp=None) -> Dict[str, Any]:
    """
    Builds a mock LLM-structure response from regex+spaCy extraction.
    Used as last resort when both Ollama and HuggingFace fail.
    """
    parsed = extract_placements_regex(email_body, subject)

    # spaCy NER as fallback for missing/generic fields
    nlp_obj = get_nlp()
    if nlp_obj and ("deadline_iso" not in parsed or "job_location" not in parsed
                or parsed.get("company") in (None, "Unknown Company")):
        doc = nlp_obj(email_body)
        orgs, dates, gpes = [], [], []
        for ent in doc.ents:
            if ent.label_ == "ORG":
                orgs.append(ent.text)
            elif ent.label_ == "DATE":
                dates.append(ent.text)
            elif ent.label_ == "GPE":
                gpes.append(ent.text)

        # Only use spaCy ORG if still unknown after label-based extraction
        if parsed.get("company") in (None, "Unknown Company") and orgs:
            for org in orgs:
                if not any(k in org.lower() for k in ["vit", "vellore", "institute", "university", "cdc"])\
                        and not is_generic_company_name(org):
                    parsed["company"] = org.strip()
                    break

        if "deadline_iso" not in parsed and dates:
            for d in dates:
                p_date = dateparser.parse(d, settings={'TIMEZONE': 'Asia/Kolkata', 'TO_TIMEZONE': 'UTC', 'RETURN_AS_TIMEZONE_AWARE': True})
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

    # Determine email category and event type from subject and body heuristics
    sub_lower = subject.lower() if subject else ""
    body_clean = email_body.lower()
    for delimiter in ["warm regards", "mandatory note", "disclaimer", "please update your resume"]:
        idx = body_clean.find(delimiter)
        if idx != -1:
            body_clean = body_clean[:idx]
            
    # Combine subject and clean body for general keywords check
    text_to_check = (sub_lower + " " + body_clean).strip()
    
    # Check for GENERAL_ANNOUNCEMENT keywords
    general_keywords = [
        r"litcoder", r"placement registration", r"cdc seminar", r"resume review",
        r"mock interview", r"seminar", r"webinar", r"workshop", r"kind attention",
        r"mandatory form", r"mandatory registration", r"mandatory submission", r"not yet completed",
        r"all interested students", r"completion of"
    ]
    
    # Only classify as general if it matches general keywords and does NOT specify standard drive terms in subject
    is_general = force_announcement or (
        any(re.search(pat, text_to_check) for pat in general_keywords) and
        not any(kw in sub_lower for kw in ["registration", "drive", "online test", "interview"])
    )
    
    if is_general:
        email_category = "GENERAL_ANNOUNCEMENT"
        # Determine announcement type
        announcement_type = "GENERAL"
        if "litcoder" in text_to_check or "module" in text_to_check:
            announcement_type = "TRAINING"
        elif "seminar" in text_to_check or "webinar" in text_to_check:
            announcement_type = "SEMINAR"
        elif "workshop" in text_to_check or "resume review" in text_to_check:
            announcement_type = "WORKSHOP"
        elif "registration" in text_to_check:
            announcement_type = "PLACEMENT_REGISTRATION"
        elif "mandatory" in text_to_check or "kind attention" in text_to_check:
            announcement_type = "MANDATORY_REQUIREMENT"
        else:
            announcement_type = "CDC_NOTICE"
            
        title = subject.strip() if subject else "General Announcement"
        title = re.sub(r'^(?:fwd|re|fw|kind attention|kind attn|attention)\b[:\s!]*', '', title, flags=re.I).strip()
        body_summary = email_body[:200] + "..." if len(email_body) > 200 else email_body
        
        return {
            "parser_metadata": {
                "parser_version": "v4-regex-fallback",
                "model_used": "regex-rules"
            },
            "overall_confidence": 0.45,
            "extracted_data": {
                "email_category": "GENERAL_ANNOUNCEMENT",
                "company": {"value": None, "confidence": 0.45},
                "event_type": {"value": None, "confidence": 0.45},
                "roles": [],
                "announcement": {
                    "title": {"value": title, "confidence": 0.45},
                    "announcement_type": {"value": announcement_type, "confidence": 0.45},
                    "deadline_iso": {"value": deadline_iso, "confidence": 0.45},
                    "body_summary": {"value": body_summary, "confidence": 0.45}
                }
            }
        }

    # Placement Drive vs Update
    event_type = "NEW_DRIVE"
    email_category = "NEW_DRIVE"
    
    # Check subject first (strongest signal)
    if re.search(r'\b(?:shortlist|short-listed|selection\s+list|selected\s+list|shortlisted)\b', sub_lower):
        event_type = "SHORTLIST_RELEASED"
        email_category = "DRIVE_UPDATE"
    elif re.search(r'\b(?:congratulations|congrats|offer|placed|selected)\b', sub_lower):
        event_type = "OFFER_RELEASED"
        email_category = "DRIVE_UPDATE"
    elif re.search(r'\b(?:oa\s+result|test\s+result|assessment\s+result)\b', sub_lower):
        event_type = "OA_RESULT"
        email_category = "DRIVE_UPDATE"
    elif re.search(r'\b(?:online\s+test|online\s+assessment|coding\s+test|\boa\b|scheduled|assessment\s+link|test\s+link|slot\s+booking)\b', sub_lower):
        event_type = "OA_SCHEDULED"
        email_category = "DRIVE_UPDATE"
    elif re.search(r'\b(?:interview\s+result|interview\s+select)\b', sub_lower):
        event_type = "INTERVIEW_RESULT"
        email_category = "DRIVE_UPDATE"
    elif re.search(r'\b(?:interview)\b', sub_lower):
        event_type = "INTERVIEW_SCHEDULED"
        email_category = "DRIVE_UPDATE"
    elif re.search(r'\b(?:extended|extension)\b', sub_lower):
        event_type = "DEADLINE_EXTENSION"
        email_category = "DRIVE_UPDATE"
    elif re.search(r'\b(?:regret|not\s+selected|rejection)\b', sub_lower):
        event_type = "REJECTION_RELEASED"
        email_category = "DRIVE_UPDATE"
    elif re.search(r'\b(?:registration|register|apply|hiring|recruitment|enrollment|drive|internship)\b', sub_lower):
        event_type = "NEW_DRIVE"
        email_category = "NEW_DRIVE"
    else:
        # Fallback to body checks on cleaned body
        if re.search(r'\b(?:deadline\s+extended|date\s+extended|last\s+date\s+extended|extended\s+the\s+deadline|extended\s+the\s+date|extension\s+of\s+deadline|extension\s+of\s+last\s+date)\b', body_clean):
            event_type = "DEADLINE_EXTENSION"
            email_category = "DRIVE_UPDATE"
        elif "shortlist" in body_clean or "short-listed" in body_clean or "shortlisted" in body_clean:
            event_type = "SHORTLIST_RELEASED"
            email_category = "DRIVE_UPDATE"
        elif "oa result" in body_clean or "online test result" in body_clean or "assessment result" in body_clean:
            event_type = "OA_RESULT"
            email_category = "DRIVE_UPDATE"
        elif "online test" in body_clean or "assessment" in body_clean or re.search(r'\boa\b', body_clean) or "online assessment" in body_clean:
            event_type = "OA_SCHEDULED"
            email_category = "DRIVE_UPDATE"
        elif "interview result" in body_clean or "interview select" in body_clean:
            event_type = "INTERVIEW_RESULT"
            email_category = "DRIVE_UPDATE"
        elif "interview" in body_clean:
            event_type = "INTERVIEW_SCHEDULED"
            email_category = "DRIVE_UPDATE"
        elif "offer" in body_clean or "congratulations" in body_clean or "selection list" in body_clean or "selected candidates" in body_clean:
            event_type = "OFFER_RELEASED"
            email_category = "DRIVE_UPDATE"
        elif "regret" in body_clean or "not selected" in body_clean or "rejection" in body_clean:
            event_type = "REJECTION_RELEASED"
            email_category = "DRIVE_UPDATE"

    # Extract timeline events from body for regex path
    extracted_events = extract_timeline_events(email_body, subject, email_timestamp=email_timestamp)

    # Build the shared eligibility data applicable to all roles
    shared_role_data = {
        "eligible_branches": {"value": eligible_branches, "confidence": 0.45},
        "degree_types": {"value": parsed.get("degree_types", []), "confidence": 0.45},
        "specializations": {"value": parsed.get("specializations", []), "confidence": 0.45},
        "min_tenth_marks": {"value": parsed.get("min_tenth_marks"), "confidence": 0.45},
        "min_twelfth_marks": {"value": parsed.get("min_twelfth_marks"), "confidence": 0.45},
        "min_ug_cgpa": {"value": parsed.get("min_ug_cgpa"), "confidence": 0.45},
        "min_cgpa": {"value": min_cgpa, "confidence": 0.45},
        "requires_no_arrears": {"value": requires_no_arrears, "confidence": 0.45},
    }

    # Attempt multi-role extraction (used when email lists multiple roles with their own CTC/Stipend)
    multi_roles = extract_multiple_roles_from_body(email_body)
    if multi_roles:
        roles_list = []
        for mr in multi_roles:
            roles_list.append({
                "role": {"value": mr["role"], "confidence": 0.45},
                "ctc": {"value": mr.get("ctc") or ctc, "confidence": 0.45},
                "stipend": {"value": mr.get("stipend") or stipend, "confidence": 0.45},
                **shared_role_data,
            })
        logger.info(f"Regex fallback detected {len(roles_list)} roles from multi-role block.")
    else:
        # Single role (standard case)
        roles_list = [{
            "role": {"value": role, "confidence": 0.45},
            "ctc": {"value": ctc, "confidence": 0.45},
            "stipend": {"value": stipend, "confidence": 0.45},
            **shared_role_data,
        }]

    return {
        "parser_metadata": {
            "parser_version": "v6-regex-fallback",
            "model_used": "regex-rules"
        },
        "overall_confidence": 0.45,
        "extracted_data": {
            "email_category": email_category,
            "company": {"value": company, "confidence": 0.45},
            "event_type": {"value": event_type, "confidence": 0.45},
            "job_location": {"value": job_location, "confidence": 0.45},
            "deadline_iso": {"value": deadline_iso, "confidence": 0.45},
            "registration_link": {"value": registration_link, "confidence": 0.45},
            "date_of_visit": {"value": date_of_visit, "confidence": 0.45},
            "eligibility_raw_text": {"value": parsed.get("eligibility_raw_text"), "confidence": 0.45},
            "events": extracted_events,
            "roles": roles_list,
            "announcement": None
        }
    }


def parse_placement_email(
    email_body: str,
    subject: str = "",
    attachment_text: str = "",
    email_timestamp=None
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
    return build_regex_fallback_response(email_body, subject, email_timestamp=email_timestamp)
