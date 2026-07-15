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

    # Strip markdown/special chars including ! which breaks \b word boundary
    # e.g. "Congratulations!!" → "congratulations" must be caught
    cleaned = re.sub(r'[*#_\-–—!?\s\t\n\r]+', ' ', name).strip().lower()

    # Heuristics to reject long sentences/subject-lines
    if len(cleaned) > 40:
        return True
    if len(cleaned.split()) > 5:
        return True

    if cleaned in GENERIC_COMPANY_NAMES:
        return True

    # Also check the stripped-only version (removes ! but keeps spaces)
    cleaned_punct = re.sub(r'[^a-z0-9\s]', '', cleaned).strip()
    if cleaned_punct in GENERIC_COMPANY_NAMES:
        return True

    # Reject common non-company phrases in subjects.
    # Use prefix/contains patterns (not just \b...\b) so that punctuation
    # variants like "congratulations!!" are also caught.
    generic_patterns = [
        r'congratulat',         # catches congratulations, congratulations!!, congrats
        r'\bcongrats\b',
        r'\bkind\s+attention\b',
        r'\battention\b',
        r'\bselection\s+process\b',
        r'\bonline\s+test\b',
        r'\bonline\s+assessment\b',
        r'\bscheduled\b',
        r'\btest\s+link\b',
        r'\bshortlist',          # shortlist, shortlisted, shortlisting
        r'\bselect\s+list\b',
        r'\bselected\b',
        r'\bplacement\s+officer\b',
        r'\bcdc\b',
        r'\bvit\b',
        r'\bstudents?\b',
        r'\bbatch\b',
        r'\bregistration\b',
        r'\bapply\b',
        r'\bplacements\b',
        r'\binternship\s+registration\b',
        r'\bsuper\s+dream\s+internship\b',
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
    
    "other": "OTHER",

    # Non-CS Specializations
    "electronics and computer engineering": "ELECTRONICS_COMPUTER",
    "electronics & computer engineering": "ELECTRONICS_COMPUTER",
    "electronics and computer": "ELECTRONICS_COMPUTER",
    "electronics & computer": "ELECTRONICS_COMPUTER",
    "ece": "ECE",
    "electronics and communication": "ECE",
    "electronics & communication": "ECE",
    "electronics and communication engineering": "ECE",
    "electronics & communication engineering": "ECE",
    "eee": "EEE",
    "electrical and electronics": "EEE",
    "electrical & electronics": "EEE",
    "electrical and electronics engineering": "EEE",
    "electrical & electronics engineering": "EEE",
    "electrical": "ELECTRICAL",
    "electrical engineering": "ELECTRICAL",
    "mechanical": "MECH",
    "mechanical engineering": "MECH",
    "mech": "MECH",
    "civil": "CIVIL",
    "civil engineering": "CIVIL",
    "chemical": "CHEM",
    "chemical engineering": "CHEM",
    "chem": "CHEM",
    "biotechnology": "BIOTECH",
    "biotech": "BIOTECH",
    "mechatronics": "MECHATRONICS",
    "mechatronics and automation": "MECHATRONICS",
    "robotics": "ROBOTICS",
    "automation": "AUTOMATION",
    "manufacturing": "MANUFACTURING",
    "manufacturing engineering": "MANUFACTURING",
    "aerospace": "AEROSPACE",
    "aerospace engineering": "AEROSPACE",
    "automobile": "AUTOMOBILE",
    "automobile engineering": "AUTOMOBILE"
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
    # Fallback for other non-CS branches: return uppercase clean string if it has non-CS keywords
    non_cs_terms = ["ece", "eee", "mech", "civil", "chem", "biotech", "mechatronics", "robotics", "automation", "manufacturing", "aerospace", "automobile", "electronics", "electrical", "telecom"]
    if any(term in val for term in non_cs_terms):
        return raw_str.strip().upper()
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
    return f"""You are a structured data extractor and classifier for university placement emails.
Analyze the following email (subject, body, and any attachment text) and extract the required fields.
Output ONLY a valid raw JSON object — no markdown, no explanation, no code fences.

CRITICAL — Company Name Rules (READ FIRST):
- The company name must be the ACTUAL, CANONICAL BRAND NAME (e.g. "Google", "JPMorgan Chase", "Ericsson", "Schneider Electric").
- Extract values ONLY from the email content below. NEVER copy any value from the example JSON in this prompt — the example is fake. If a field is not present in the email, use null.
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
      "value": "ExampleCorp Fintech",
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
- Preserve decimal CGPA values exactly. For "75% or 7.5 CGPA", min_cgpa is 7.5, never 7 or 75.
- Prefer the CGPA on the "Pursuing Degree", "Current Degree", or equivalent line. Do not use the "in UG (for PGs)" value as min_cgpa.

Compensation rules:
- ctc and stipend are different fields. CTC/package is full-time annual compensation; stipend is internship pay.
- Extract ctc only when the source explicitly labels or describes CTC, package, salary, annual compensation, or a full-time compensation breakdown.
- Extract stipend only when the source explicitly labels or describes an internship stipend.
- If one is not explicitly stated, set that field's value to null. Never copy stipend into ctc, copy ctc into stipend, infer one from the other, or invent "will be announced".
- Preserve multiple explicitly stated CTC periods concisely (for example, "Year 1: 22 LPA; Year 2: 26 LPA").

Deadline rules:
- Convert deadline to ISO 8601 format: YYYY-MM-DDTHH:MM:SS
- deadline_iso is ONLY the REGISTRATION deadline (the "Last date for Registration" value). NEVER use the Date of Visit, drive date, test date, or interview date as deadline_iso.
- If only a date is given (no time), use T00:00:00. NEVER invent a time that is not written in the email.
- If deadline says e.g. "7.00 pm", include the time exactly as written: T19:00:00. Copy the written time verbatim — do not round, shift, or guess.
- If the email has no explicit registration deadline, set deadline_iso.value = null. Do NOT guess one from other dates in the email.

Date/time grounding rules (CRITICAL — applies to deadline_iso, date_of_visit, and every events[].date_iso):
- Every date and time you output MUST be literally written in the email text. If you cannot point to the exact words in the email that state a date/time, output null for it.
- If the email gives only a vague window (e.g. "16th & 17th July 2026 by 9.00 am") without saying which activity happens when, put that text in date_of_visit and do NOT fabricate per-stage dates or times.
- venue: if the email states a place for a test/PPT/interview (e.g. "@ Pearl Research Park (PRP) - VIT Vellore campus", "at their office location", "Virtual mode"), copy it into that event's venue field. Otherwise null.

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


def parse_with_ai_gateway(context_text: str) -> Dict[str, Any]:
    """
    Route email parsing through the centralized AIGateway.

    The gateway owns provider ordering, per-provider retries with exponential
    backoff, circuit breakers, and concurrency control.  The parser gateway
    always includes the HuggingFace Router (Llama-3.3-70B-Instruct) as the
    mandatory provider and optionally Ollama as a faster primary tier when
    DISABLE_OLLAMA is not set.

    Returns parsed dict on success.
    Raises AIUnavailableError when all providers are exhausted so the
    ingestion job can be retried rather than silently falling back to
    low-quality regex output.
    """
    from app.services.ai_provider import get_parser_gateway

    prompt = get_parser_prompt(context_text)
    gateway = get_parser_gateway()

    result = gateway.generate(
        prompt,
        system="You are a structured data extractor. Output only valid JSON. No markdown.",
        max_tokens=800,
        temperature=0.1,
        json_mode=True,
        purpose="email_parser",
    )

    try:
        parsed = result.parse_json()
    except Exception as e:
        logger.warning(
            "[email_parser] gateway response not valid JSON (provider=%s, err=%s). "
            "Attempting json_repair...",
            result.provider, str(e)[:200],
        )
        parsed = repair_and_parse_json(result.text)

    if "parser_metadata" not in parsed:
        parsed["parser_metadata"] = {}
    parsed["parser_metadata"]["model_used"] = f"{result.provider}/{result.model}"
    parsed["parser_metadata"]["latency_ms"] = result.latency_ms
    parsed["parser_metadata"]["attempts"] = result.attempts

    logger.info(
        "[email_parser] gateway parse succeeded provider=%s latency_ms=%d attempts=%d",
        result.provider, result.latency_ms, result.attempts,
    )
    return parsed


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

    def get_conf(d, key, default=1.0):
        if not isinstance(d, dict):
            return 0.0
        v = d.get(key)
        if v is None:
            return default
        try:
            return float(v)
        except:
            return default

    overall = get_conf(parsed, "overall_confidence", default=0.8)
    if overall < 0.50:
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
        if get_conf(title_data, "confidence", default=0.8) < 0.50:
            return False
        return True

    for field in ["company", "event_type"]:
        field_data = ext.get(field)
        if not field_data or not isinstance(field_data, dict):
            return False
        if get_conf(field_data, "confidence", default=0.8) < 0.50:
            return False

    deadline = ext.get("deadline_iso")
    if deadline and isinstance(deadline, dict) and deadline.get("value"):
        if get_conf(deadline, "confidence", default=0.8) < 0.50:
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
    
    # Exact target company overrides
    clean_lower = clean.lower()
    if "project44" in clean_lower:
        return "Project44"
    if "valuelabs" in clean_lower or "value labs" in clean_lower:
        return "Valuelabs LLP"
    if "groww" in clean_lower:
        return "GROWW"
    if "infosys" in clean_lower:
        return "Infosys"
        
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
    Extract eligible branches (both CS and non-CS) from a text block.
    """
    branches = set()
    text_lower = text.lower()
    
    # 1. CS / IT / Allied Branches
    if re.search(r'\b(computer\s*science(?:\s*(?:and|&)\s*engineering)?|cse)\b', text_lower):
        branches.add("CSE")
    if re.search(r'\binformation\s+technology\b', text_lower):
        branches.add("IT")
    if re.search(r'\b(master\s+of\s+computer\s+app(?:lications?)?|m\.?c\.?a)\b', text_lower):
        branches.add("MCA")
    if re.search(r'\bintegrated\s+m\.?\s*tech\b', text_lower):
        branches.add("MTECH_INT")
        
    # 2. Non-CS Branches (extracted on isolated block, or with strict keyword matching in full body)
    if re.search(r'\b(electronics\s*(?:and|&)\s*computer|electronics\s*&\s*computer)\b', text_lower):
        branches.add("Electronics & Computer Engineering")
    if re.search(r'\b(electronics\s*(?:and|&)\s*communication|electronics\s*&\s*communication|ece)\b', text_lower):
        branches.add("ECE")
        
    if re.search(r'\b(electrical\s*(?:and|&)\s*electronics|electrical\s*&\s*electronics|eee)\b', text_lower):
        branches.add("EEE")
    if re.search(r'\belectrical\b', text_lower) and not re.search(r'\b(electrical\s*(?:and|&)\s*electronics|electrical\s*&\s*electronics|eee)\b', text_lower):
        branches.add("Electrical Engineering")
        
    if re.search(r'\b(mechanical|mech)\b', text_lower):
        branches.add("Mechanical Engineering")
    if re.search(r'\b(civil)\b', text_lower):
        branches.add("Civil Engineering")
    if re.search(r'\b(chemical|chem)\b', text_lower):
        branches.add("Chemical Engineering")
    if re.search(r'\b(biotechnology|biotech)\b', text_lower):
        branches.add("Biotechnology")
    if re.search(r'\b(mechatronics)\b', text_lower):
        branches.add("Mechatronics")
    if re.search(r'\b(robotics)\b', text_lower):
        branches.add("Robotics")
    if re.search(r'\b(automation)\b', text_lower):
        branches.add("Automation")
    if re.search(r'\b(manufacturing)\b', text_lower):
        branches.add("Manufacturing Engineering")
    if re.search(r'\b(aerospace|aeronautical)\b', text_lower):
        branches.add("Aerospace Engineering")
    if re.search(r'\b(automobile)\b', text_lower):
        branches.add("Automobile Engineering")
    
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

def extract_degree_types_deterministic(email_body: str) -> List[str]:
    """Degree types (BTECH/MTECH/MCA/MSC) actually written in the mail.

    Prefers the isolated 'Eligible Branches' block — degree mentions
    elsewhere in a CDC mail (e.g. the boilerplate 'in UG (for PGs)'
    eligibility line) do NOT mean the drive accepts PG students.
    Shared by parse-time grounding and the DB repair script.
    """
    block = _extract_eligible_branches_block(email_body)
    if block:
        found = _extract_degree_types_from_block(block)
        if found:
            return found
    return _extract_degree_types_from_block(email_body or "")


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


_SECTION_HEADERS = {
    "name of the company", "category", "date of visit", "eligible branches",
    "eligibility criteria", "ctc", "package", "ctc / package", "salary",
    "annual ctc", "compensation",
    "stipend", "internship stipend", "monthly stipend",
    "last date for registration", "registration deadline", "website",
    "designation", "location", "job location", "work location",
}


def _plain_line(line: str) -> str:
    """Remove mail/markdown decoration while retaining the field value."""
    return re.sub(
        r"\s+", " ",
        re.sub(r"^[\s*#>Ø•\-\u2013\u2014]+|[\s*#]+$", "", line),
    ).strip()


def _section_value(email_body: str, labels: set[str]) -> Optional[str]:
    """Read an explicit field whose value may start several blank lines later."""
    lines = email_body.splitlines()
    for index, raw_line in enumerate(lines):
        line = _plain_line(raw_line)
        label_match = re.match(r"^([A-Za-z /]+?)\s*:\s*(.*)$", line)
        line_label = (label_match.group(1) if label_match else line).strip().lower()
        line_label = re.sub(r"\s*\([^)]*\)\s*$", "", line_label).strip()
        if line_label not in labels:
            continue

        inline_value = label_match.group(2).strip() if label_match else ""
        values = [inline_value] if inline_value else []
        
        # Limit to at most 3 non-empty lines for values like CTC/Stipend
        non_empty_count = 0
        for following in lines[index + 1:]:
            cleaned = _plain_line(following)
            if not cleaned:
                continue
            
            # Check for a new section label like "Selection Process:", "Note:"
            # Ignore matches that look like URLs (http://) or timestamps (10:00 AM)
            if re.match(r"^[A-Z][A-Za-z\s&/]{2,25}\s*:\s*(?!https?:|am|pm|\d{1,2}:|\d{1,2}\.\d{1,2})", cleaned):
                break
                
            possible_header = re.sub(r":\s*$", "", cleaned).strip().lower()
            if possible_header in _SECTION_HEADERS:
                break
                
            values.append(cleaned)
            non_empty_count += 1
            if non_empty_count >= 3:
                break
                
        value = " ".join(values).strip()
        if value and len(value) > 100:
            value = value[:97] + "..."
        return value or None
    return None


def extract_explicit_compensation(email_body: str) -> tuple[Optional[str], Optional[str]]:
    """
    Extract independently source-grounded CTC and stipend values.

    Unlabelled currency amounts are intentionally ignored: an absent field is
    None, so internship pay cannot silently become a full-time package.
    """
    ctc = _section_value(
        email_body,
        {"ctc", "package", "ctc / package", "salary", "annual ctc", "compensation"},
    )
    stipend = _section_value(
        email_body, {"stipend", "internship stipend", "monthly stipend"}
    )

    if not ctc:
        match = re.search(
            r"(?im)^\s*[*#>\-Ø•\s]*(?:CTC|Package|Salary|Annual\s+CTC|Compensation)"
            r"\s*[:\-–—]\s*\*?([^\r\n*]+)",
            email_body,
        )
        if match:
            ctc = _plain_line(match.group(1))
    if not stipend:
        match = re.search(
            r"(?im)^\s*[*#>\-Ø•\s]*(?:Internship\s+Stipend|Monthly\s+Stipend|Stipend)"
            r"\s*[:\-–—]\s*\*?([^\r\n*]+)",
            email_body,
        )
        if match:
            stipend = _plain_line(match.group(1))

    return ctc, stipend


def extract_min_cgpa(email_body: str) -> Optional[float]:
    """Extract a complete number only when it is explicitly tied to CGPA."""
    candidates: list[tuple[int, float]] = []
    for raw_line in re.split(r"[\r\n;]+", email_body):
        line = _plain_line(raw_line)
        if not line or "cgpa" not in line.lower():
            continue

        lower = line.lower()
        patterns = (
            r"(?<![\d.])(?P<value>\d+(?:\.\d+)?)(?![\d.])\s*CGPA\b",
            r"\bCGPA\s*(?:of|is|:|>=|=>|>|=|-|–|—)?\s*"
            r"(?<![\d.])(?P<value>\d+(?:\.\d+)?)(?![\d.])",
        )
        for pattern in patterns:
            for match in re.finditer(pattern, line, re.I):
                context = lower[max(0, match.start() - 50):match.end()]
                if re.search(r"\b(?:in\s+ug|ug\s*(?:\(|cgpa)|undergrad)", context):
                    continue
                priority = (
                    2
                    if re.search(
                        r"\b(?:pursuing|current|degree|graduation|b\.?\s*tech)\b",
                        context,
                    )
                    else 1
                )
                value = float(match.group("value"))
                if 0.0 <= value <= 10.0:
                    candidates.append((priority, value))

    return max(candidates, key=lambda item: item[0])[1] if candidates else None


def ground_role_facts_in_source(
    parsed: Dict[str, Any], email_body: str
) -> Dict[str, Any]:
    """Replace fragile model outputs with deterministic facts from the mail."""
    ext = parsed.get("extracted_data") if isinstance(parsed, dict) else None
    roles = ext.get("roles") if isinstance(ext, dict) else None
    if not isinstance(roles, list) or not roles:
        return parsed

    ctc, stipend = extract_explicit_compensation(email_body)
    min_cgpa = extract_min_cgpa(email_body)

    def role_key(value: Any) -> str:
        return re.sub(r"[^a-z0-9]+", " ", str(value).lower()).strip()

    multi_role_values = extract_multiple_roles_from_body(email_body)
    by_role = {
        role_key(item["role"]): item for item in multi_role_values
    }

    for role in roles:
        if not isinstance(role, dict):
            continue
        role_obj = role.get("role", {})
        role_name = role_obj.get("value", "") if isinstance(role_obj, dict) else role_obj
        explicit_role = by_role.get(role_key(role_name))
        if explicit_role:
            role_ctc = explicit_role.get("ctc")
            role_stipend = explicit_role.get("stipend")
        elif by_role:
            role_ctc = None
            role_stipend = None
        else:
            role_ctc = ctc
            role_stipend = stipend
        role["ctc"] = {
            "value": role_ctc,
            "confidence": 0.99 if role_ctc else 0.95,
        }
        role["stipend"] = {
            "value": role_stipend,
            "confidence": 0.99 if role_stipend else 0.95,
        }
        role["min_cgpa"] = {
            "value": min_cgpa,
            "confidence": 0.99 if min_cgpa is not None else 0.95,
        }
    return parsed


def _extract_degree_types_from_block(text: str) -> List[str]:
    """
    Deterministically scan a text block for degree type keywords.
    Handles variants like 'M. Tech', 'M.Tech', 'M Tech', 'MTech',
    'B. Tech', 'B.Tech', 'B Tech', 'BTech', 'MCA', 'M.Sc' etc.
    Returns a list of canonical degree codes e.g. ['MTECH', 'BTECH'].
    """
    found = []
    # Use a single flexible pattern for each degree that accepts an optional
    # space or dot between the letter and "Tech".
    if re.search(r'\bm\.?\s*tech\b|\bmtech\b|\bmaster\s+of\s+tech', text, re.I):
        found.append("MTECH")
    if re.search(r'\bb\.?\s*tech\b|\bbtech\b|\bbachelor\s+of\s+tech', text, re.I):
        found.append("BTECH")
    if re.search(r'\bm\.?\s*c\.?\s*a\b|\bmca\b|\bmaster\s+of\s+comp', text, re.I):
        found.append("MCA")
    if re.search(r'\bm\.?\s*sc\.?\b|\bmsc\b|\bmaster\s+of\s+sci', text, re.I):
        found.append("MSC")
    return found


def _extract_eligible_branches_block(email_body: str) -> Optional[str]:
    """
    Extract the raw text of the 'Eligible Branches' section from the email body.
    Returns the block text or None if not found.
    """
    m = re.search(
        r"(?:^|[\n\r])\s*[\-\–\—\*\u00d8\d\.\s]*\s*"
        r"(?:Eligible\s*Branches|Eligibility\s*Branches|"
        r"Eligible\s*Departments?|Eligible\s*Programs?)"
        r"\s*[\*_]*\s*[:\-\–\—\s][:\-\–\—\s\*_]*\s*[\n\r]*"
        r"(.*?)"
        r"(?=\n\s*[\-\–\—\*\u00d8\d\.\s]*\s*"
        r"(?:Eligibility\s*Criteria|Eligibility|Criteria|CTC|Salary|"
        r"Stipend|Last\s+date|Last\s+Date|Website|Job\s+location|"
        r"Designation|Date\s+of\s+Visit)|$)",
        email_body,
        re.IGNORECASE | re.DOTALL,
    )
    return m.group(1).strip() if m else None


def _extract_eligibility_raw_text_block(email_body: str) -> Optional[str]:
    """
    Extract the raw text of the 'Eligibility Criteria' section.
    Returns a cleaned multi-line string or None.
    """
    m = re.search(
        r"(?:^|[\n\r])\s*[\-\–\—\*\u00d8\d\.\s]*\s*"
        r"(?:Eligibility\s*Criteria|Eligibility|Criteria)"
        r"\s*[\*_]*\s*[:\-\–\—\s]\s*[\n\r]*"
        r"(.*?)"
        r"(?:CTC|Stipend|Last\s+date|Website|Job\s+location|Designation|$)",
        email_body,
        re.IGNORECASE | re.DOTALL,
    )
    if not m:
        return None
    lines = [clean_val(l) for l in m.group(1).strip().split("\n") if clean_val(l)]
    return "\n".join(lines) if lines else None


def ground_eligibility_in_source(
    parsed: Dict[str, Any], email_body: str
) -> Dict[str, Any]:
    """
    Deterministic post-processing step: re-extract degree_types, eligible_branches
    and eligibility_raw_text directly from the email body and use them to OVERRIDE
    the AI output whenever the AI returned null / empty for those fields.

    This is the same principle as ground_role_facts_in_source() for CGPA/CTC:
    regex rules on the structured CDC email format are MORE reliable than a
    small LLM for these particular fields.

    Specifically corrects:
    - AI returns degree_types: [] / null  →  fill from branch block
    - AI returns eligible_branches: [] / null  →  fill from branch block
    - AI returns eligibility_raw_text: null  →  fill from eligibility criteria block
    """
    ext = parsed.get("extracted_data") if isinstance(parsed, dict) else None
    if not isinstance(ext, dict):
        return parsed

    roles = ext.get("roles")
    if not isinstance(roles, list) or not roles:
        return parsed

    # Deterministically extract the branch block from the email body.
    branch_block = _extract_eligible_branches_block(email_body)
    det_degrees: List[str] = []
    det_branches: List[str] = []

    if branch_block:
        det_degrees = _extract_degree_types_from_block(branch_block)
        det_branches = get_branches_from_text(branch_block, strict=False)
        # If still no degrees found in the branch block text, fall back to full email
        if not det_degrees:
            det_degrees = _extract_degree_types_from_block(email_body)
    else:
        # No dedicated branch block found — scan the whole email (strict mode).
        det_degrees = _extract_degree_types_from_block(email_body)
        det_branches = get_branches_from_text(email_body, strict=True)

    # Deterministically extract eligibility raw text.
    det_raw_text = _extract_eligibility_raw_text_block(email_body)

    # Also try to capture the branch block as part of the raw text.
    if branch_block and det_raw_text:
        det_raw_text = f"Eligible Branches: {branch_block}\n{det_raw_text}"
    elif branch_block:
        det_raw_text = f"Eligible Branches: {branch_block}"

    # Update eligibility_raw_text at the top-level extracted_data if AI left it empty
    current_raw = ext.get("eligibility_raw_text", {})
    current_raw_val = current_raw.get("value") if isinstance(current_raw, dict) else None
    if not current_raw_val and det_raw_text:
        ext["eligibility_raw_text"] = {"value": det_raw_text, "confidence": 0.80}
        logger.info(
            "[eligibility_grounding] eligibility_raw_text was empty — filled from regex: %r",
            det_raw_text[:120],
        )

    for role in roles:
        if not isinstance(role, dict):
            continue

        # --- degree_types ---
        # The deterministic extraction ALWAYS wins when it found evidence.
        # Only-fill-when-empty was not enough: the model returned
        # ["MSC","MTECH"] for ION's B.Tech-only drive (misreading the
        # boilerplate 'in UG (for PGs)' line), which flipped eligibility
        # for every student. When there is no deterministic evidence,
        # keep only AI degrees whose token is actually written in the mail.
        dt_field = role.get("degree_types", {})
        dt_val = dt_field.get("value") if isinstance(dt_field, dict) else dt_field
        if det_degrees:
            if sorted(dt_val or []) != sorted(det_degrees):
                logger.info(
                    "[eligibility_grounding] degree_types %s overridden with grounded %s",
                    dt_val, det_degrees,
                )
            role["degree_types"] = {"value": list(det_degrees), "confidence": 0.95}
        elif isinstance(dt_val, list) and dt_val:
            _DEGREE_TOKENS = {
                "BTECH": r'\bb\.?\s*tech\b|\bbachelor\s+of\s+tech',
                "MTECH": r'\bm\.?\s*tech\b|\bmaster\s+of\s+tech',
                "MCA": r'\bm\.?\s*c\.?\s*a\b|\bmaster\s+of\s+computer\s+app',
                "MSC": r'\bm\.?\s*sc\b|\bmaster\s+of\s+sci',
            }
            _body_l = (email_body or "").lower()
            kept = [d for d in dt_val if isinstance(d, str) and re.search(
                _DEGREE_TOKENS.get(d.strip().upper(), r'(?!x)x'), _body_l)]
            if kept != dt_val:
                logger.warning(
                    "[eligibility_grounding] dropping ungrounded degree_types %s -> %s",
                    dt_val, kept,
                )
                role["degree_types"] = {"value": kept, "confidence": 0.85}

        # --- eligible_branches ---
        # When the mail has an explicit 'Eligible Branches' block, the
        # deterministic scan of that block beats the model (which emitted
        # junk entries like 'MTECH' as a branch). Without a block, only
        # fill when the model returned nothing.
        eb_field = role.get("eligible_branches", {})
        eb_val = eb_field.get("value") if isinstance(eb_field, dict) else eb_field
        if branch_block and det_branches:
            if sorted(eb_val or []) != sorted(det_branches):
                logger.info(
                    "[eligibility_grounding] eligible_branches %s overridden with grounded %s",
                    eb_val, det_branches,
                )
            role["eligible_branches"] = {"value": det_branches, "confidence": 0.90}
        elif not eb_val and det_branches:
            role["eligible_branches"] = {"value": det_branches, "confidence": 0.85}
            logger.info(
                "[eligibility_grounding] eligible_branches overridden with regex result: %s",
                det_branches,
            )

    return parsed


def extract_explicit_deadline(email_body: str, subject: str = "") -> Optional[str]:
    """
    Deterministically scan the email body for standard registration deadline patterns.
    Converts to ISO date format. Returns None if not found or unparseable.
    """
    deadline_match = re.search(
        r"(?:^|[\n\r])\s*[\-\–\—\*\u00d8\d\.\s]*\s*(?:Last\s*date\s*for\s*Registration|Last\s*Date\s*to\s*Apply|Registration\s*Deadline|Last\s*Date|Deadline|Last\s*date)\s*[\*_]*\s*[:\-\–\—\s][:\-\–\—\s\*_]*\s*([^\n\r]+)",
        email_body,
        re.IGNORECASE
    )
    raw_date = None
    if deadline_match:
        raw_date = clean_val(deadline_match.group(1))
    else:
        # Try inline "register on or before [date]"
        on_or_before = re.search(
            r"(?:register|apply|submission|submit)\s*(?:[^\n\r]{0,50}?)(?:on\s*or\s*before|before|by|on)\s*\*?([^\n\r]{5,40})",
            email_body,
            re.I
        )
        if on_or_before:
            raw_date = clean_val(on_or_before.group(1))
            
    if raw_date:
        # Strip trailing punctuation/periods/spaces
        raw_date = re.sub(r'[\.\s]+$', '', raw_date).strip()
        parsed_date = dateparser.parse(raw_date, settings={'TIMEZONE': 'Asia/Kolkata', 'TO_TIMEZONE': 'UTC', 'RETURN_AS_TIMEZONE_AWARE': True})
        if parsed_date:
            return parsed_date.isoformat()
            
    return None


def ground_deadline_in_source(
    parsed: Dict[str, Any], email_body: str, subject: str = ""
) -> Dict[str, Any]:
    """
    Deterministic post-processing step: Override fragile or hallucinated AI deadline
    outputs using the REGISTRATION milestone event date (if present) or via a robust
    fallback regex scan of the email body.
    """
    ext = parsed.get("extracted_data") if isinstance(parsed, dict) else None
    if not isinstance(ext, dict):
        return parsed

    # 1. First priority: look for a REGISTRATION event milestone in the events list.
    registration_date = None
    events = ext.get("events") or []
    for evt in events:
        if isinstance(evt, dict) and evt.get("stage") == "REGISTRATION":
            date_iso = evt.get("date_iso")
            if date_iso:
                registration_date = date_iso
                break

    # 2. Second priority: fall back to a regex scan of the email body.
    if not registration_date:
        registration_date = extract_explicit_deadline(email_body, subject)

    # If we successfully matched a deterministic registration date, override the AI's deadline_iso.
    if registration_date:
        current_deadline = ext.get("deadline_iso") or {}
        if isinstance(current_deadline, dict):
            ext["deadline_iso"] = {"value": registration_date, "confidence": 0.99}
        else:
            ext["deadline_iso"] = {"value": registration_date, "confidence": 0.99}
        logger.info("[deadline_grounding] deadline_iso grounded and overridden with %s", registration_date)

    return parsed


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
        r"(?:^|[\n\r])\s*[\-\–\—\*\u00d8\d\.\s]*\s*(?:Name of the Company|Company Name|Name of the Organisation|Organisation|\bCompany\b(?!\s*(?:website|profile|url|link|domain|page|site|info|description|overview|logo|details)))\s*[\*_]*\s*[:\-\–\—\s][:\-\–\—\s\*_]*\s*\*?([^\n\r*]+)",
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
        r"(?:^|[\n\r])\s*[\-\–\—\*\u00d8\d\.\s]*\s*(?:Designation|Role|Job Title|Profile|Position|Job Title/Role)\s*[\*_]*\s*[:\-\–\—\s][:\-\–\—\s\*_]*\s*\*?([^\n\r*]+)",
        email_body,
        re.IGNORECASE
    )
    if role_match:
        data["role"] = clean_val(role_match.group(1))
    else:
        data["role"] = "Software Engineer"

    # 4/5. Keep full-time CTC and internship stipend independent.
    data["ctc"], data["stipend"] = extract_explicit_compensation(email_body)

    # 6. Registration Deadline
    deadline_match = re.search(
        r"(?:^|[\n\r])\s*[\-\–\—\*\u00d8\d\.\s]*\s*(?:Last\s*date\s*for\s*Registration|Last\s*Date\s*to\s*Apply|Registration\s*Deadline|Last\s*Date|Deadline|Last\s*date)\s*[\*_]*\s*[:\-\–\—\s][:\-\–\—\s\*_]*\s*([^\n\r]+)",
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
            r"(?:register|apply|submission|submit)\s*(?:[^\n\r{0,50}?)(?:on\s*or\s*before|before|by|on)\s*\*?([^\n\r]{5,40})",
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
        r"(?:^|[\n\r])\s*[\-\–\—\*\u00d8\d\.\s]*\s*(?:Eligible\s*Branches|Eligibility\s*Branches|Eligible\s*Departments?|Eligible\s*Programs?)\s*[\*_]*\s*[:\-\–\—\s][:\-\–\—\s\*_]*\s*[\n\r]*(.*?)(?=\n\s*[\-\–\—\*\u00d8\d\.\s]*\s*(?:Eligibility\s*Criteria|Eligibility|Criteria|CTC|Salary|Stipend|Last\s+date|Last\s+Date|Website|Job\s+location|Designation|Date\s+of\s+Visit)|$)",
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

    # Degree types — use the shared helper (handles 'M. Tech', 'M.Tech', 'MTech' variants).
    # Search branches block first; fall back to full email if nothing found.
    degree_search_text = branches_text if branches_text else email_body
    found_degrees = _extract_degree_types_from_block(degree_search_text)
    if not found_degrees and branches_text:
        found_degrees = _extract_degree_types_from_block(email_body)
    data["degree_types"] = found_degrees

    # Specializations — only from branches block (strict), or whole body if none found
    # IMPORTANT: Never infer specializations from role names (e.g., "Prompt Engineer" ≠ AI/ML branch)
    found_specializations = []
    spec_search = branches_text if branches_text else ""
    if spec_search:
        # Join lines that are wrapped/broken (replace \n with space if the next line does not start with a bullet/star)
        spec_clean = ""
        lines = spec_search.split("\n")
        for i, line in enumerate(lines):
            line_strip = line.strip()
            if not line_strip:
                continue
            if line_strip.startswith(('*', '-', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'Ø')):
                spec_clean += "\n" + line_strip
            else:
                spec_clean += " " + line_strip
                
        # Explicit specialization keywords in the branches block
        for line in spec_clean.split("\n"):
            line_lower = line.lower()
            if not line_lower.strip():
                continue
            # If the line contains non-CS keywords, skip extracting CS specializations from it
            if any(w in line_lower for w in ["electronics", "ece", "electrical", "eee", "mechanical", "mech", "civil", "chemical", "chem", "biotech", "mechatronics", "robotics", "automation", "manufacturing", "aerospace", "automobile"]):
                continue
            if re.search(r'\b(computer\s*science(?:\s*(?:and|&)\s*engineering)?|cse)\b', line_lower, re.I):
                found_specializations.append("CSE_CORE")
            if re.search(r'\b(information?\s*sec(?:urity)?|cyber\s*sec(?:urity)?)\b', line_lower, re.I):
                found_specializations.append("CSE_INFO_SEC")
            if re.search(r'\b(iot|internet\s+of\s+things)\b', line_lower, re.I):
                found_specializations.append("CSE_IOT")
            if re.search(r'\b(data\s+science)\b', line_lower, re.I):
                found_specializations.append("CSE_DATA_SCIENCE")
            if re.search(r'\b(blockchain|block\s*chain)\b', line_lower, re.I):
                found_specializations.append("CSE_BLOCKCHAIN")
            if re.search(r'\b(artificial\s*intelligence|machine\s*learning|ai\s*(?:and|&|/)\s*ml|aiml)\b', line_lower, re.I):
                found_specializations.append("CSE_AI_ML")

    # Also, add all non-CS branch names/tokens that were found in get_branches_from_text to found_specializations
    for br in data.get("eligible_branches", []):
        if br not in ["CSE", "IT", "MCA", "MTECH_INT", "MTECH", "AIDS", "AIML", "SWE"]:
            found_specializations.append(br)

    # If specializations not found in a block, default to CSE_CORE (safest assumption for CSE-only system)
    if not found_specializations:
        found_specializations.append("CSE_CORE")
    data["specializations"] = found_specializations

    # 8. Eligibility Criteria block extraction
    elig_block_match = re.search(
        r"(?:^|[\n\r])\s*[\-\–\—\*\u00d8\d\.\s]*\s*(?:Eligibility Criteria|Eligibility|Criteria)\s*[\*_]*\s*[:\-\–\—\s]\s*[\n\r]*(.*?)(?:CTC|Stipend|Last date|Website|Job location|Designation|$)",
        email_body,
        re.IGNORECASE | re.DOTALL
    )
    elig_text = elig_block_match.group(1) if elig_block_match else email_body
    
    elig_lines = elig_text.strip().split("\n")
    cleaned_elig_lines = [clean_val(line) for line in elig_lines if clean_val(line)]
    data["eligibility_raw_text"] = "\n".join(cleaned_elig_lines) if cleaned_elig_lines else None

    # Require a complete numeric token explicitly tied to the word "CGPA".
    data["min_cgpa"] = extract_min_cgpa(elig_text)

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
        r"(?:^|[\n\r])\s*[\-\–\—\*\u00d8\d\.\s]*\s*(?:Job\s*Location|Location|Work\s*Location|Place\s*of\s*Posting)\s*[\*_]*\s*[:\-\–\—\s][:\-\–\—\s\*_]*\s*(.+)",
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
        r"(?:^|[\n\r])\s*[\-\–\—\*\u00d8\d\.\s]*\s*(?:Date of Visit|Visit Date|Date of recruitment|Recruitment Date)\s*[\*_]*\s*[:\-\–\—\s][:\-\–\—\s\*_]*\s*(.+)",
        email_body,
        re.IGNORECASE
    )
    if visit_match:
        val = clean_val(visit_match.group(1))
        data["date_of_visit"] = val if val else "Will be announced later"
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
    Main entry point for placement email parsing.

    Delegates to the centralized AIGateway (HuggingFace Router — mandatory,
    Ollama — optional faster tier) which owns retries, circuit breaking,
    concurrency control, and structured logging.

    After a successful AI parse, deterministic fact-grounding is applied
    (ground_role_facts_in_source) to override fragile model outputs for
    CTC, Stipend, and CGPA with values extracted directly from the email text.

    Raises:
        AIUnavailableError: when ALL providers exhaust their retries.
            The ingestion job is then marked failed and retried on the next
            cron cycle rather than silently producing low-quality regex output.
    """
    from app.services.ai_provider import AIUnavailableError

    # Build combined context for the model
    context_text = f"Subject: {subject}\n\nBody:\n{email_body}"
    if attachment_text:
        context_text += f"\n\nAttachment Content:\n{attachment_text}"

    logger.info("[email_parser] Starting AI parse via gateway...")
    parsed = parse_with_ai_gateway(context_text)

    if not parsed or not isinstance(parsed, dict) or not parsed.get("extracted_data"):
        # Gateway returned something but the JSON structure is unusable.
        # Raise so the ingestion job is retried later.
        raise AIUnavailableError(
            "email_parser: gateway returned an empty or malformed result structure."
        )

    # Deterministic grounding: the company name must actually appear in the
    # email. Small models copy the few-shot example values when the real
    # value is absent — a company-less "test link" thread reply was once
    # parsed as company="Groww" (the old prompt example) with the example's
    # registration deadline, creating a fake drive.
    parsed = ground_company_in_source(parsed, subject, email_body, attachment_text)

    # Deterministic post-processing: override fragile model fields with
    # source-grounded values (CTC, Stipend, CGPA) extracted directly from email.
    parsed = ground_role_facts_in_source(parsed, email_body)
    # Ground eligibility fields (degree_types, eligible_branches, eligibility_raw_text)
    # using deterministic regex — more reliable than small LLMs for these structured fields.
    parsed = ground_eligibility_in_source(parsed, email_body)
    # Ground registration deadline_iso using REGISTRATION milestone or fallback regex.
    parsed = ground_deadline_in_source(parsed, email_body, subject)
    return parsed


def _company_appears_in_text(company_name: str, haystack_lower: str) -> bool:
    """True when at least one significant token of the name occurs in the text."""
    if not company_name:
        return False
    GENERIC_TOKENS = {
        "technologies", "technology", "solutions", "systems", "software",
        "services", "labs", "ltd", "limited", "pvt", "private", "inc", "llp",
        "corp", "corporation", "company", "group", "india", "global", "the",
    }
    tokens = [t for t in re.split(r"[^a-z0-9]+", company_name.lower())
              if len(t) >= 3 and t not in GENERIC_TOKENS]
    if not tokens:
        # Name made only of generic/short tokens — fall back to full-phrase check
        return company_name.lower() in haystack_lower
    return any(t in haystack_lower for t in tokens)


def ground_company_in_source(
    parsed: Dict[str, Any], subject: str, email_body: str, attachment_text: str = ""
) -> Dict[str, Any]:
    """Reject hallucinated company names that don't occur anywhere in the email.

    If the model's company is ungrounded, retry with the deterministic
    subject-line extraction; if that is also ungrounded, null the company so
    the pipeline routes the job to UNKNOWN_COMPANY handling instead of
    creating a fake drive.
    """
    ext = parsed.get("extracted_data") if isinstance(parsed, dict) else None
    if not isinstance(ext, dict):
        return parsed
    company_field = ext.get("company")
    company_name = None
    if isinstance(company_field, dict):
        company_name = company_field.get("value")

    # Check if we have a valid, grounded company name
    if company_name:
        haystack = f"{subject}\n{email_body}\n{attachment_text}".lower()
        if _company_appears_in_text(str(company_name), haystack):
            return parsed

    logger.warning(
        "[email_parser] Model company %r not found or missing — attempting "
        "recovery from subject. Subject: %r", company_name, subject[:80],
    )
    # The fallback comes FROM the subject, so grounding against the haystack
    # is trivially true — the generic-name filter is the real gate here
    # (rejects phrases like "Final Year Students" or "Kind Attention").
    fallback_name = extract_company_from_subject(subject)
    _STUDENT_PHRASES = re.compile(
        r"\b(students?|batch|final\s+year|placement|registration|all\s+the\s+best)\b",
        re.IGNORECASE,
    )
    if (fallback_name and fallback_name != "Unknown Company"
            and not is_generic_company_name(fallback_name)
            and not _STUDENT_PHRASES.search(fallback_name)):
        ext["company"] = {"value": fallback_name, "confidence": 0.5}
        logger.info("[email_parser] Recovered company from subject: %r", fallback_name)
    else:
        ext["company"] = {"value": None, "confidence": 0.0}
    return parsed

