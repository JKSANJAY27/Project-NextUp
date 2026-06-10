from typing import Optional, Tuple
from app.models.models import StudentProfile, Company

def check_eligibility(profile: StudentProfile, company: Company) -> Tuple[str, Optional[str]]:
    """
    Checks if a student is eligible for a company drive.
    Returns a tuple: (status, reason)
    Status can be: 'ELIGIBLE', 'NOT_ELIGIBLE'
    """
    # 1. Branch eligibility check
    if company.eligible_branches:
        user_branch = (profile.branch or "").strip().upper()
        eligible_branches_upper = [b.strip().upper() for b in company.eligible_branches]
        if user_branch not in eligible_branches_upper:
            return "NOT_ELIGIBLE", f"Your branch '{profile.branch}' is not in the eligible branches list: {', '.join(company.eligible_branches)}."

    # 2. Extract rules from eligibility_rules JSONB
    rules = company.eligibility_rules or {}
    
    # CGPA Check
    min_cgpa = rules.get("min_cgpa") or rules.get("cgpa")
    if min_cgpa is not None:
        if profile.cgpa is None:
            return "NOT_ELIGIBLE", "CGPA is required but not set in your profile."
        if float(profile.cgpa) < float(min_cgpa):
            return "NOT_ELIGIBLE", f"Your CGPA ({float(profile.cgpa):.2f}) is below the minimum required CGPA ({float(min_cgpa):.2f})."

    # Tenth Marks Check
    min_tenth = rules.get("min_tenth_marks") or rules.get("min_tenth")
    if min_tenth is not None:
        if profile.tenth_marks is None:
            return "NOT_ELIGIBLE", "10th marks are required but not set in your profile."
        if float(profile.tenth_marks) < float(min_tenth):
            return "NOT_ELIGIBLE", f"Your 10th marks ({float(profile.tenth_marks):.1f}%) are below the minimum required ({float(min_tenth):.1f}%)."

    # Twelfth Marks Check
    min_twelfth = rules.get("min_twelfth_marks") or rules.get("min_twelfth")
    if min_twelfth is not None:
        if profile.twelfth_marks is None:
            return "NOT_ELIGIBLE", "12th marks are required but not set in your profile."
        if float(profile.twelfth_marks) < float(min_twelfth):
            return "NOT_ELIGIBLE", f"Your 12th marks ({float(profile.twelfth_marks):.1f}%) are below the minimum required ({float(min_twelfth):.1f}%)."

    # Arrears Check
    requires_no_arrears = rules.get("requires_no_arrears")
    if requires_no_arrears is None:
        # Default fallback
        requires_no_arrears = rules.get("min_arrears") is False or rules.get("min_arrears") == 0
        
    if requires_no_arrears:
        if profile.has_arrears:
            return "NOT_ELIGIBLE", "Company requires 'No Standing Arrears', but your profile lists active arrears."

    return "ELIGIBLE", "You meet all academic criteria for this company."
