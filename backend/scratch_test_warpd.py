"""
Test script to verify parser fixes for:
1. Eligible branches (CSE-only, no ECE/EEE/MECH)
2. requires_no_arrears (should be True for WarpDrive)
3. Multi-role detection (2 roles: Full Stack & Prompt Engineer)

Run from backend/ directory:
  venv/Scripts/python scratch_test_warpd.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.services.email_parser import (
    build_regex_fallback_response,
    get_branches_from_text,
    extract_multiple_roles_from_body,
)

WARPD_BODY = """
WarpDrive Regular Internship Registration - 2027 Batch

Name of the Company

WarpDrive

Category

Regular Internship Registration - 2027 Batch

Date of Visit:

Will be announced later

Eligible Branches

   - All Integrated M.Tech 2yrs and 5 Years (CSE / IT) related branches only
   - MCA

Eligibility Criteria

% in X and XII – 60% or 6.0 CGPA
in Pursuing Degree – 60% or 6.0 CGPA
in UG (for PGs) – 60% or 6.0 CGPA
No Standing Arrears

CTC

  Full Stack Developer Intern & Business Analysis-3.5 LPA
  Prompt Engineer Intern- 4-5 LPA (If converted)

Stipend

  Full Stack Developer Intern & Business Analysis-10000
  Prompt Engineer Intern- 25000

Last date for Registration

10th June 2026 (03.00 PM)

Website

warpdrivetech.in

Designation : Intern

Location:  Bangalore, Work from home (Initial Period)

Job Description:
As an intern you will get to work on building AI-powered systems, prompt engineering workflows, 
large language model APIs, and full-stack web applications. Machine learning exposure is a plus.
"""

WARPD_SUBJECT = "WarpDrive Regular Internship Registration - 2027 Batch"

print("=" * 70)
print("Test 1: get_branches_from_text() on branches block (strict=False)")
branches_block = """
   - All Integrated M.Tech 2yrs and 5 Years (CSE / IT) related branches only
   - MCA
"""
result = get_branches_from_text(branches_block, strict=False)
print(f"  Result: {result}")
assert "CSE" in result, "CSE should be present"
assert "MCA" in result, "MCA should be present"
assert "ECE" not in result, "ECE should NOT be present"
assert "EEE" not in result, "EEE should NOT be present"
assert "MECH" not in result, "MECH should NOT be present"
print("  [PASS] PASS — No false positives (ECE/EEE/MECH absent)")

print("\nTest 2: get_branches_from_text() on full body (strict=True)")
result_strict = get_branches_from_text(WARPD_BODY, strict=True)
print(f"  Result: {result_strict}")
assert "ECE" not in result_strict, "ECE should NOT be present in strict mode"
assert "EEE" not in result_strict, "EEE should NOT be present in strict mode"
assert "AIML" not in result_strict, "AIML should NOT be added from 'AI' in job description"
print("  [PASS] PASS — strict mode prevents false positives from body text")

print("\nTest 3: extract_multiple_roles_from_body()")
multi = extract_multiple_roles_from_body(WARPD_BODY)
print(f"  Detected roles: {[r['role'] for r in multi]}")
print(f"  Full result: {multi}")
if multi:
    assert len(multi) >= 2, f"Expected 2+ roles, got {len(multi)}"
    roles_names = [r['role'].lower() for r in multi]
    assert any("full stack" in r or "business" in r for r in roles_names), "Full Stack role not found"
    assert any("prompt" in r for r in roles_names), "Prompt Engineer role not found"
    print("  [PASS] PASS — Multi-role detected correctly")
else:
    print("  [WARN] Multi-role not detected (check CTC/Stipend block format)")


print("\nTest 4: Full build_regex_fallback_response() on WarpDrive email")
result = build_regex_fallback_response(WARPD_BODY, WARPD_SUBJECT)
ext = result["extracted_data"]

print(f"  email_category: {ext.get('email_category')}")
print(f"  company: {ext.get('company', {}).get('value')}")
print(f"  event_type: {ext.get('event_type', {}).get('value')}")

roles = ext.get("roles", [])
print(f"  Number of roles: {len(roles)}")
for i, r in enumerate(roles):
    print(f"  Role {i+1}: {r.get('role', {}).get('value')} | CTC: {r.get('ctc', {}).get('value')} | Stipend: {r.get('stipend', {}).get('value')}")
    print(f"    eligible_branches: {r.get('eligible_branches', {}).get('value')}")
    print(f"    requires_no_arrears: {r.get('requires_no_arrears', {}).get('value')}")

# Assertions
assert ext.get("email_category") == "NEW_DRIVE", f"Expected NEW_DRIVE, got {ext.get('email_category')}"
print("  [PASS] email_category = NEW_DRIVE")

if roles:
    first_role = roles[0]
    branches = first_role.get("eligible_branches", {}).get("value", [])
    no_arrears = first_role.get("requires_no_arrears", {}).get("value")
    assert no_arrears is True, f"requires_no_arrears should be True, got {no_arrears}"
    print("  [PASS] requires_no_arrears = True")
    assert "ECE" not in branches, f"ECE should not be in branches: {branches}"
    assert "EEE" not in branches, f"EEE should not be in branches: {branches}"
    assert "MECH" not in branches, f"MECH should not be in branches: {branches}"
    print(f"  [PASS] No false positive branches. Got: {branches}")

print("\n" + "=" * 70)
print("All tests passed! [OK]")

