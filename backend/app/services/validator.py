import logging
import re
import dateparser
from typing import Dict, Any, List
from sqlalchemy.orm import Session
from app.models.models import Company
from app.services.email_parser import normalize_degree, normalize_specialization

logger = logging.getLogger(__name__)

# Canonical Event Translation Map
# Preserves specific result/extension types for richer timeline tracking
CANONICAL_EVENT_MAP = {
    # Registration
    "NEW_DRIVE": "REGISTRATION",
    "REGISTRATION": "REGISTRATION",
    "REGISTRATION_OPEN": "REGISTRATION",
    # Deadline Extension (kept distinct for deadline tracking)
    "DEADLINE_EXTENSION": "DEADLINE_EXTENSION",
    # Shortlist
    "SHORTLIST": "SHORTLIST",
    "SHORTLIST_RELEASED": "SHORTLIST",
    # Online Assessment
    "OA": "OA",
    "OA_SCHEDULED": "OA",
    "ONLINE_TEST": "OA",
    "ASSESSMENT": "OA",
    "ASSESSMENT_SCHEDULED": "OA",
    # OA Result (distinct — triggers 'Awaiting OA Result' state)
    "OA_RESULT": "OA_RESULT",
    # Interview
    "INTERVIEW": "INTERVIEW",
    "INTERVIEW_SCHEDULED": "INTERVIEW",
    "INTERVIEW_ROUND": "INTERVIEW",
    # Interview Result (distinct — triggers 'Awaiting Interview Result' state)
    "INTERVIEW_RESULT": "INTERVIEW_RESULT",
    # Offer
    "OFFER": "OFFER",
    "OFFER_RELEASED": "OFFER",
    # Rejection
    "REJECTION": "REJECTION",
    "REJECTION_RELEASED": "REJECTION",
    # General
    "GENERAL_UPDATE": "GENERAL_UPDATE",
    "VENUE_CHANGE": "GENERAL_UPDATE"
}

# Role Normalization Map
ROLE_NORMALIZATION_MAP = {
    "sde": "Software Engineer",
    "swe": "Software Engineer",
    "software developer": "Software Engineer",
    "software engineer": "Software Engineer",
    "software development engineer": "Software Engineer",
    "get": "Graduate Engineer Trainee",
    "graduate engineer trainee": "Graduate Engineer Trainee",
    "pet": "Project Engineer Trainee",
    "data scientist": "Data Scientist",
    "data analyst": "Data Analyst",
    "data engineer": "Data Engineer",
    "business analyst": "Business Analyst",
    "product manager": "Product Manager",
    "program manager": "Program Manager",
    "qa engineer": "QA Engineer",
    "quality assurance engineer": "QA Engineer",
    "quality engineer": "QA Engineer",
    "system engineer": "Systems Engineer",
    "systems engineer": "Systems Engineer",
    "devops engineer": "DevOps Engineer",
    "cloud engineer": "Cloud Engineer",
    "consultant": "Consultant",
    "management trainee": "Management Trainee",
    "associate engineer": "Associate Engineer",
    "associate software engineer": "Associate Software Engineer",
    "ml engineer": "ML Engineer",
    "machine learning engineer": "ML Engineer",
    "ai engineer": "AI Engineer",
    "network engineer": "Network Engineer",
    "embedded engineer": "Embedded Engineer",
    "vlsi engineer": "VLSI Engineer",
    "full stack developer": "Full Stack Developer",
    "frontend developer": "Frontend Developer",
    "backend developer": "Backend Developer"
}

def normalize_company_name(name: str, db: Session) -> str:
    """
    Fuzzy matches and normalizes the company name against existing companies in the database.
    """
    if not name:
        return "Unknown Company"
        
    company_name = name.strip()
    
    # Fetch all unique company names in database
    existing_companies = db.query(Company.name).distinct().all()
    existing_names = [c[0] for c in existing_companies]
    
    clean_incoming = re.sub(r'\b(solutions|technologies|pvt|ltd|inc|co|india|corporation|group)\b', '', company_name, flags=re.I).strip().lower()
    clean_incoming = re.sub(r'\s+', ' ', clean_incoming)
    
    best_match = company_name
    best_score = -1
    
    for ext_name in existing_names:
        clean_ext = re.sub(r'\b(solutions|technologies|pvt|ltd|inc|co|india|corporation|group)\b', '', ext_name, flags=re.I).strip().lower()
        clean_ext = re.sub(r'\s+', ' ', clean_ext)
        
        score = 0
        if clean_ext == clean_incoming:
            score = 100
        elif (len(clean_ext) >= 3 and clean_ext in clean_incoming) or (len(clean_incoming) >= 3 and clean_incoming in clean_ext):
            overlap_ratio = len(clean_ext) / len(clean_incoming) if len(clean_incoming) > 0 else 0
            if overlap_ratio > 1:
                overlap_ratio = 1 / overlap_ratio
            score = int(70 * overlap_ratio) + 20
            
        if score > best_score and score >= 60:
            best_score = score
            best_match = ext_name
            
    if best_score >= 60:
        logger.info(f"Fuzzy normalized company name from '{company_name}' to '{best_match}' (Score: {best_score})")
        return best_match
        
    return company_name

def normalize_role_name(role: str) -> str:
    """
    Standardizes role names using standard keyword mapping.
    """
    if not role:
        return "Software Engineer"
        
    role_lower = role.strip().lower()
    
    # Try exact or substring matches in map
    for kw, normalized in ROLE_NORMALIZATION_MAP.items():
        if kw in role_lower:
            return normalized
            
    # Capitalize each word if no standard match
    return " ".join(word.capitalize() for word in role.split())

def validate_and_normalize_parsed_data(parsed_data: Dict[str, Any], db: Session) -> Dict[str, Any]:
    """
    Performs field validations and value normalizations on the raw LLM parser JSON output.
    """
    if not parsed_data or not isinstance(parsed_data, dict):
        parsed_data = {}
        
    ext = parsed_data.get("extracted_data")
    if not ext or not isinstance(ext, dict):
        ext = {}
        parsed_data["extracted_data"] = ext
        
    # Check overall confidence
    overall_conf = parsed_data.get("overall_confidence", 0.50)
    requires_review = False
    
    if overall_conf < 0.75:
        requires_review = True
        
    # Check category
    category = ext.get("email_category", "UNKNOWN")
    
    # If GENERAL_ANNOUNCEMENT, we only validate the announcement block and bypass company/roles
    if category == "GENERAL_ANNOUNCEMENT":
        ann = ext.get("announcement", {})
        if not isinstance(ann, dict):
            ann = {}
            ext["announcement"] = ann
            
        title_obj = ann.get("title", {})
        if not isinstance(title_obj, dict):
            title_obj = {"value": str(title_obj) if title_obj else "General Announcement", "confidence": 0.50}
        title_val = title_obj.get("value") or "General Announcement"
        title_conf = title_obj.get("confidence", 0.50)
        if title_conf < 0.80:
            requires_review = True
            
        ann["title"] = {"value": title_val, "confidence": title_conf}
        
        type_obj = ann.get("announcement_type", {})
        if not isinstance(type_obj, dict):
            type_obj = {"value": str(type_obj) if type_obj else "GENERAL", "confidence": 0.50}
        type_val = type_obj.get("value") or "GENERAL"
        valid_types = ['MANDATORY_REQUIREMENT', 'TRAINING', 'WORKSHOP', 'SEMINAR', 'PLACEMENT_REGISTRATION', 'CDC_NOTICE', 'GENERAL']
        if type_val not in valid_types:
            type_val = "GENERAL"
        ann["announcement_type"] = {"value": type_val, "confidence": type_obj.get("confidence", 0.50)}
        
        deadline_obj = ann.get("deadline_iso", {})
        if not isinstance(deadline_obj, dict):
            deadline_obj = {"value": str(deadline_obj) if deadline_obj else None, "confidence": 0.50}
        deadline_val = deadline_obj.get("value")
        deadline_conf = deadline_obj.get("confidence", 0.50)
        formatted_deadline = None
        if deadline_val:
            parsed_date = dateparser.parse(deadline_val, settings={'TIMEZONE': 'Asia/Kolkata', 'TO_TIMEZONE': 'UTC', 'RETURN_AS_TIMEZONE_AWARE': True})
            if parsed_date:
                formatted_deadline = parsed_date.isoformat()
            else:
                deadline_conf = min(deadline_conf, 0.40)
                requires_review = True
        ann["deadline_iso"] = {"value": formatted_deadline, "confidence": deadline_conf}
        
        body_obj = ann.get("body_summary", {})
        if not isinstance(body_obj, dict):
            body_obj = {"value": str(body_obj) if body_obj else "", "confidence": 0.50}
        ann["body_summary"] = {"value": body_obj.get("value"), "confidence": body_obj.get("confidence", 0.50)}
        
        if "parser_metadata" not in parsed_data:
            parsed_data["parser_metadata"] = {}
        parsed_data["parser_metadata"]["requires_review"] = requires_review
        return parsed_data
        
    # 1. Company Name Normalization & Confidence Check
    company_obj = ext.get("company", {})
    if not isinstance(company_obj, dict):
        company_obj = {"value": str(company_obj), "confidence": 0.50}
    comp_val = company_obj.get("value") or "Unknown Company"
    comp_conf = company_obj.get("confidence", 0.50)
    
    if comp_conf < 0.80 or comp_val == "Unknown Company":
        requires_review = True
        
    norm_company = normalize_company_name(comp_val, db)
    ext["company"] = {
        "value": norm_company,
        "confidence": comp_conf
    }
    
    # 2. Event Type Normalization
    event_obj = ext.get("event_type", {})
    if not isinstance(event_obj, dict):
        event_obj = {"value": str(event_obj), "confidence": 0.50}
    event_val = event_obj.get("value") or "NEW_DRIVE"
    event_conf = event_obj.get("confidence", 0.50)
    
    canonical_event = CANONICAL_EVENT_MAP.get(event_val.upper(), "GENERAL_UPDATE")
    ext["event_type"] = {
        "value": canonical_event,
        "confidence": event_conf
    }
    
    # 3. Deadline ISO Validation & Formatting
    deadline_obj = ext.get("deadline_iso", {})
    if not isinstance(deadline_obj, dict):
        deadline_obj = {"value": str(deadline_obj) if deadline_obj else None, "confidence": 0.50}
    deadline_val = deadline_obj.get("value")
    deadline_conf = deadline_obj.get("confidence", 0.50)
    
    formatted_deadline = None
    if deadline_val:
        parsed_date = dateparser.parse(deadline_val, settings={'TIMEZONE': 'Asia/Kolkata', 'TO_TIMEZONE': 'UTC', 'RETURN_AS_TIMEZONE_AWARE': True})
        if parsed_date:
            formatted_deadline = parsed_date.isoformat()
        else:
            # Parse failed
            deadline_conf = min(deadline_conf, 0.40)
            requires_review = True
            
    if deadline_conf < 0.80 and deadline_val:
        requires_review = True
        
    ext["deadline_iso"] = {
        "value": formatted_deadline,
        "confidence": deadline_conf
    }
    
    # 4. Job Location
    loc_obj = ext.get("job_location", {})
    if not isinstance(loc_obj, dict):
        loc_obj = {"value": str(loc_obj) if loc_obj else None, "confidence": 0.50}
    ext["job_location"] = {
        "value": loc_obj.get("value").strip() if loc_obj.get("value") else None,
        "confidence": loc_obj.get("confidence", 0.50)
    }
    # 5. Registration Link
    link_obj = ext.get("registration_link", {})
    if not isinstance(link_obj, dict):
        link_obj = {"value": str(link_obj) if link_obj else None, "confidence": 0.50}
    ext["registration_link"] = {
        "value": link_obj.get("value").strip() if link_obj.get("value") else None,
        "confidence": link_obj.get("confidence", 0.50)
    }

    # 5.5 Date of Visit
    visit_obj = ext.get("date_of_visit", {})
    if not isinstance(visit_obj, dict):
        visit_obj = {"value": str(visit_obj) if visit_obj else "Will be announced later", "confidence": 0.50}
    ext["date_of_visit"] = {
        "value": visit_obj.get("value").strip() if visit_obj.get("value") else "Will be announced later",
        "confidence": visit_obj.get("confidence", 0.50)
    }

    # 5.6 Eligibility Raw Text
    raw_text_obj = ext.get("eligibility_raw_text", {})
    if not isinstance(raw_text_obj, dict):
        raw_text_obj = {"value": str(raw_text_obj) if raw_text_obj else None, "confidence": 0.50}
    ext["eligibility_raw_text"] = {
        "value": raw_text_obj.get("value").strip() if raw_text_obj.get("value") else None,
        "confidence": raw_text_obj.get("confidence", 0.50)
    }

    # 6. Roles Array Processing
    roles_list = ext.get("roles", [])
    if not isinstance(roles_list, list) or len(roles_list) == 0:
        roles_list = [{
            "role": {"value": "Software Engineer", "confidence": 0.50},
            "ctc": {"value": None, "confidence": 0.50},
            "stipend": {"value": None, "confidence": 0.50},
            "eligible_branches": {"value": [], "confidence": 0.50},
            "degree_types": {"value": [], "confidence": 0.50},
            "specializations": {"value": [], "confidence": 0.50},
            "min_tenth_marks": {"value": None, "confidence": 0.50},
            "min_twelfth_marks": {"value": None, "confidence": 0.50},
            "min_ug_cgpa": {"value": None, "confidence": 0.50},
            "min_cgpa": {"value": None, "confidence": 0.50},
            "requires_no_arrears": {"value": False, "confidence": 0.50}
        }]
        
    validated_roles = []
    for r in roles_list:
        if not isinstance(r, dict):
            continue
            
        # Role name normalization
        r_obj = r.get("role", {})
        if not isinstance(r_obj, dict):
            r_obj = {"value": str(r_obj), "confidence": 0.50}
        r_val = r_obj.get("value") or "Software Engineer"
        r_conf = r_obj.get("confidence", 0.50)
        norm_role = normalize_role_name(r_val)
        
        # CTC
        ctc_obj = r.get("ctc", {})
        if not isinstance(ctc_obj, dict):
            ctc_obj = {"value": str(ctc_obj) if ctc_obj else None, "confidence": 0.50}
            
        # Stipend
        stipend_obj = r.get("stipend", {})
        if not isinstance(stipend_obj, dict):
            stipend_obj = {"value": str(stipend_obj) if stipend_obj else None, "confidence": 0.50}
            
        # Eligible Branches
        branches_obj = r.get("eligible_branches", {})
        if not isinstance(branches_obj, dict):
            branches_obj = {"value": list(branches_obj) if isinstance(branches_obj, (list, set)) else [], "confidence": 0.50}
        branches_val = branches_obj.get("value") or []
        branches_val = [b.strip().upper() for b in branches_val if isinstance(b, str)]
        
        # Degree Types
        degree_types_obj = r.get("degree_types", {})
        if not isinstance(degree_types_obj, dict):
            degree_types_obj = {"value": list(degree_types_obj) if isinstance(degree_types_obj, (list, set)) else [], "confidence": 0.50}
        degree_types_raw = degree_types_obj.get("value") or []
        degree_types_val = []
        for d in degree_types_raw:
            if isinstance(d, str):
                norm_d = normalize_degree(d)
                if norm_d:
                    degree_types_val.append(norm_d)
        degree_types_val = sorted(list(set(degree_types_val)))

        # Specializations
        specializations_obj = r.get("specializations", {})
        if not isinstance(specializations_obj, dict):
            specializations_obj = {"value": list(specializations_obj) if isinstance(specializations_obj, (list, set)) else [], "confidence": 0.50}
        specializations_raw = specializations_obj.get("value") or []
        specializations_val = []
        for s in specializations_raw:
            if isinstance(s, str):
                norm_s = normalize_specialization(s)
                if norm_s:
                    specializations_val.append(norm_s)
        specializations_val = sorted(list(set(specializations_val)))

        # Tenth Marks
        tenth_marks_obj = r.get("min_tenth_marks", {})
        if not isinstance(tenth_marks_obj, dict):
            tenth_marks_obj = {"value": tenth_marks_obj, "confidence": 0.50}
        tenth_marks_val = tenth_marks_obj.get("value")
        if tenth_marks_val is not None:
            try:
                tenth_marks_val = float(tenth_marks_val)
                if not (0.0 <= tenth_marks_val <= 100.0):
                    tenth_marks_val = None
            except ValueError:
                tenth_marks_val = None

        # Twelfth Marks
        twelfth_marks_obj = r.get("min_twelfth_marks", {})
        if not isinstance(twelfth_marks_obj, dict):
            twelfth_marks_obj = {"value": twelfth_marks_obj, "confidence": 0.50}
        twelfth_marks_val = twelfth_marks_obj.get("value")
        if twelfth_marks_val is not None:
            try:
                twelfth_marks_val = float(twelfth_marks_val)
                if not (0.0 <= twelfth_marks_val <= 100.0):
                    twelfth_marks_val = None
            except ValueError:
                twelfth_marks_val = None

        # UG CGPA
        ug_cgpa_obj = r.get("min_ug_cgpa", {})
        if not isinstance(ug_cgpa_obj, dict):
            ug_cgpa_obj = {"value": ug_cgpa_obj, "confidence": 0.50}
        ug_cgpa_val = ug_cgpa_obj.get("value")
        if ug_cgpa_val is not None:
            try:
                ug_cgpa_val = float(ug_cgpa_val)
                if not (0.0 <= ug_cgpa_val <= 10.0):
                    ug_cgpa_val = None
            except ValueError:
                ug_cgpa_val = None

        # Min CGPA
        cgpa_obj = r.get("min_cgpa", {})
        if not isinstance(cgpa_obj, dict):
            cgpa_obj = {"value": cgpa_obj, "confidence": 0.50}
        cgpa_val = cgpa_obj.get("value")
        if cgpa_val is not None:
            try:
                cgpa_val = float(cgpa_val)
                if not (0.0 <= cgpa_val <= 10.0):
                    cgpa_val = None
            except ValueError:
                cgpa_val = None
                
        # Requires No Arrears
        arrears_obj = r.get("requires_no_arrears", {})
        if not isinstance(arrears_obj, dict):
            arrears_obj = {"value": bool(arrears_obj), "confidence": 0.50}
            
        validated_roles.append({
            "role": {"value": norm_role, "confidence": r_conf},
            "ctc": {"value": ctc_obj.get("value"), "confidence": ctc_obj.get("confidence", 0.50)},
            "stipend": {"value": stipend_obj.get("value"), "confidence": stipend_obj.get("confidence", 0.50)},
            "eligible_branches": {"value": branches_val, "confidence": branches_obj.get("confidence", 0.50)},
            "degree_types": {"value": degree_types_val, "confidence": degree_types_obj.get("confidence", 0.50)},
            "specializations": {"value": specializations_val, "confidence": specializations_obj.get("confidence", 0.50)},
            "min_tenth_marks": {"value": tenth_marks_val, "confidence": tenth_marks_obj.get("confidence", 0.50)},
            "min_twelfth_marks": {"value": twelfth_marks_val, "confidence": twelfth_marks_obj.get("confidence", 0.50)},
            "min_ug_cgpa": {"value": ug_cgpa_val, "confidence": ug_cgpa_obj.get("confidence", 0.50)},
            "min_cgpa": {"value": cgpa_val, "confidence": cgpa_obj.get("confidence", 0.50)},
            "requires_no_arrears": {"value": arrears_obj.get("value"), "confidence": arrears_obj.get("confidence", 0.50)}
        })
        
    ext["roles"] = validated_roles
    
    # Store the requires_review indicator in the metadata
    if "parser_metadata" not in parsed_data:
        parsed_data["parser_metadata"] = {}
    parsed_data["parser_metadata"]["requires_review"] = requires_review
    
    return parsed_data
