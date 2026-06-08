from typing import Optional, Tuple
from app.models.models import User, Company
from app.core.security import decrypt_field

def check_eligibility(user: User, company: Company, client_key: Optional[str]) -> Tuple[str, Optional[str]]:
    """
    Checks if a student is eligible for a company drive.
    Returns a tuple: (status, reason)
    Status can be: 'ELIGIBLE', 'NOT_ELIGIBLE', 'CONDITIONALLY_ELIGIBLE'
    """
    # 1. Plaintext check: Branch eligibility
    if company.eligible_branches:
        # Standardize branches to uppercase for comparison
        user_branch = (user.branch or "").strip().upper()
        eligible_branches_upper = [b.strip().upper() for b in company.eligible_branches]
        if user_branch not in eligible_branches_upper:
            return "NOT_ELIGIBLE", f"Your branch '{user.branch}' is not in the eligible branches list: {', '.join(company.eligible_branches)}."

    # 2. Check if decryption key is available for encrypted fields
    if not client_key:
        return "CONDITIONALLY_ELIGIBLE", "Encryption key not provided. Fill your profile and unlock to verify full eligibility."

    try:
        # Decrypt profile fields
        decrypted_cgpa_str = decrypt_field(user.cgpa_enc, client_key) if user.cgpa_enc else None
        decrypted_tenth_str = decrypt_field(user.tenth_marks_enc, client_key) if user.tenth_marks_enc else None
        decrypted_twelfth_str = decrypt_field(user.twelfth_marks_enc, client_key) if user.twelfth_marks_enc else None
        decrypted_arrears_str = decrypt_field(user.has_arrears_enc, client_key) if user.has_arrears_enc else None
    except Exception:
        return "CONDITIONALLY_ELIGIBLE", "Decryption of your academic profile failed. Please check your credentials or re-login."

    # 3. CGPA Check
    if company.min_cgpa is not None:
        if not decrypted_cgpa_str:
            return "CONDITIONALLY_ELIGIBLE", "CGPA is required but not set in your profile."
        try:
            cgpa = float(decrypted_cgpa_str)
            if cgpa < float(company.min_cgpa):
                return "NOT_ELIGIBLE", f"Your CGPA ({cgpa:.2f}) is below the minimum required CGPA ({float(company.min_cgpa):.2f})."
        except ValueError:
            return "CONDITIONALLY_ELIGIBLE", "Failed to parse CGPA as a number."

    # 4. Tenth Marks Check
    if company.min_tenth is not None:
        if not decrypted_tenth_str:
            return "CONDITIONALLY_ELIGIBLE", "10th marks are required but not set in your profile."
        try:
            tenth = float(decrypted_tenth_str)
            if tenth < float(company.min_tenth):
                return "NOT_ELIGIBLE", f"Your 10th marks ({tenth:.1f}%) are below the minimum required ({float(company.min_tenth):.1f}%)."
        except ValueError:
            return "CONDITIONALLY_ELIGIBLE", "Failed to parse 10th marks as a number."

    # 5. Twelfth Marks Check
    if company.min_twelfth is not None:
        if not decrypted_twelfth_str:
            return "CONDITIONALLY_ELIGIBLE", "12th marks are required but not set in your profile."
        try:
            twelfth = float(decrypted_twelfth_str)
            if twelfth < float(company.min_twelfth):
                return "NOT_ELIGIBLE", f"Your 12th marks ({twelfth:.1f}%) are below the minimum required ({float(company.min_twelfth):.1f}%)."
        except ValueError:
            return "CONDITIONALLY_ELIGIBLE", "Failed to parse 12th marks as a number."

    # 6. Arrears Check
    if company.requires_no_arrears:
        if not decrypted_arrears_str:
            return "CONDITIONALLY_ELIGIBLE", "Arrears status is required but not set in your profile."
        # standard true/false check
        has_arrears = decrypted_arrears_str.lower() in ("true", "yes", "1")
        if has_arrears:
            return "NOT_ELIGIBLE", "Company requires 'No Standing Arrears', but your profile lists active arrears."

    return "ELIGIBLE", "You meet all academic criteria for this company."
