from typing import Optional, Tuple, Dict, Any
from app.models.models import StudentProfile, Company

def check_eligibility(profile: StudentProfile, company: Company) -> Tuple[str, Optional[str], Dict[str, Any]]:
    """
    Checks if a student is eligible for a company drive.
    Returns a tuple: (status, reason, explanation_dict)
    Status can be: 'ELIGIBLE', 'NOT_ELIGIBLE'
    """
    matched = []
    failed = []
    
    rules = company.eligibility_rules or {}
    
    # 1. Degree Type check
    degree_types = rules.get("degree_types")
    if degree_types:
        user_deg = (profile.degree_type or "").strip().upper()
        if user_deg not in [d.strip().upper() for d in degree_types]:
            failed.append(f"Required degree: {', '.join(degree_types)}. Your degree: {profile.degree_type or 'None'}")
        else:
            matched.append(f"Degree matched: {profile.degree_type}")
    else:
        # Fallback to legacy check or match if empty
        pass

    # 2. Specialization check
    specializations = rules.get("specializations")
    allow_all_specializations = rules.get("allow_all_specializations", False)
    
    # If specializations list is empty/null, or allow_all_specializations is True:
    if allow_all_specializations or not specializations:
        matched.append("Specialization matched (All specializations under degree allowed)")
    else:
        user_spec = (profile.specialization or "").strip().upper()
        if user_spec not in [s.strip().upper() for s in specializations]:
            failed.append(f"Required specialization: {', '.join(specializations)}. Your specialization: {profile.specialization or 'None'}")
        else:
            matched.append(f"Specialization matched: {profile.specialization}")

    # 3. CGPA Check
    min_cgpa = rules.get("min_cgpa") or rules.get("cgpa")
    if min_cgpa is not None:
        if profile.cgpa is None:
            failed.append(f"Required CGPA: {float(min_cgpa):.2f}. Your CGPA: Not set")
        elif float(profile.cgpa) < float(min_cgpa):
            failed.append(f"Required CGPA: {float(min_cgpa):.2f}. Your CGPA: {float(profile.cgpa):.2f}")
        else:
            matched.append(f"CGPA matched: {float(profile.cgpa):.2f} >= {float(min_cgpa):.2f}")

    # 4. Tenth Marks Check
    min_tenth = rules.get("min_tenth_marks") or rules.get("min_tenth")
    if min_tenth is not None:
        if profile.tenth_marks is None:
            failed.append(f"Required 10th Marks: {float(min_tenth):.1f}%. Your Marks: Not set")
        elif float(profile.tenth_marks) < float(min_tenth):
            failed.append(f"Required 10th Marks: {float(min_tenth):.1f}%. Your Marks: {float(profile.tenth_marks):.1f}%")
        else:
            matched.append(f"10th Marks matched: {float(profile.tenth_marks):.1f}% >= {float(min_tenth):.1f}%")

    # 5. Twelfth Marks Check
    min_twelfth = rules.get("min_twelfth_marks") or rules.get("min_twelfth")
    if min_twelfth is not None:
        if profile.twelfth_marks is None:
            failed.append(f"Required 12th Marks: {float(min_twelfth):.1f}%. Your Marks: Not set")
        elif float(profile.twelfth_marks) < float(min_twelfth):
            failed.append(f"Required 12th Marks: {float(min_twelfth):.1f}%. Your Marks: {float(profile.twelfth_marks):.1f}%")
        else:
            matched.append(f"12th Marks matched: {float(profile.twelfth_marks):.1f}% >= {float(min_twelfth):.1f}%")

    # 6. Arrears Check
    requires_no_arrears = rules.get("requires_no_arrears")
    if requires_no_arrears is None:
        requires_no_arrears = rules.get("min_arrears") is False or rules.get("min_arrears") == 0
        
    if requires_no_arrears:
        if profile.has_arrears:
            failed.append("No active arrears required. You have active arrears")
        else:
            matched.append("No active arrears condition met")

    # 7. PG UG CGPA Check
    user_deg_upper = (profile.degree_type or "").strip().upper()
    is_pg = user_deg_upper in ("MTECH", "MCA", "MSC")
    min_ug_cgpa = rules.get("min_ug_cgpa")
    if is_pg and min_ug_cgpa is not None:
        if profile.ug_cgpa is None:
            failed.append(f"Required UG CGPA: {float(min_ug_cgpa):.2f}. Your UG CGPA: Not set")
        elif float(profile.ug_cgpa) < float(min_ug_cgpa):
            failed.append(f"Required UG CGPA: {float(min_ug_cgpa):.2f}. Your UG CGPA: {float(profile.ug_cgpa):.2f}")
        else:
            matched.append(f"UG CGPA matched: {float(profile.ug_cgpa):.2f} >= {float(min_ug_cgpa):.2f}")

    eligible = len(failed) == 0
    status = "ELIGIBLE" if eligible else "NOT_ELIGIBLE"
    reason = "You meet all academic criteria." if eligible else failed[0]
    
    explanation = {
        "eligible": eligible,
        "matched": matched,
        "failed": failed
    }
    
    return status, reason, explanation
