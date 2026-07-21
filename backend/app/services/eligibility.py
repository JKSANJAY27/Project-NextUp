import re
from typing import Optional, Tuple, Dict, Any, List

# ──────────────────────────────────────────────────────────────────────────────
# Canonical mapping: token that might appear in eligible_branches / raw text
# → normalised degree type (as stored in StudentProfile.degree_type)
# ──────────────────────────────────────────────────────────────────────────────
_DEGREE_TOKEN_MAP = {
    # B.Tech variants
    "b.tech": "BTECH", "btech": "BTECH", "b tech": "BTECH",
    "b.e": "BTECH", "be": "BTECH",
    "b.tech integrated": "BTECH", "btech integrated": "BTECH",
    # M.Tech variants
    "m.tech": "MTECH", "mtech": "MTECH", "m tech": "MTECH",
    "m.tech integrated": "MTECH", "mtech integrated": "MTECH",
    "m.e": "MTECH", "me": "MTECH",
    # MCA
    "mca": "MCA",
    # MSC
    "m.sc": "MSC", "msc": "MSC", "m sc": "MSC",
    # MBA
    "mba": "MBA",
    # PHD
    "ph.d": "PHD", "phd": "PHD",
}

# Ordered from longest to shortest so "m.tech integrated" matches before "m.tech"
_DEGREE_TOKENS_SORTED = sorted(_DEGREE_TOKEN_MAP.keys(), key=len, reverse=True)


def _extract_degree_types_from_text(text: str) -> List[str]:
    """
    Scan a raw eligibility text string and return the set of degree types
    (using canonical labels like BTECH, MTECH, MCA, MSC …) found in it.
    Returns an empty list when no degree keywords are found.
    """
    if not text:
        return []
    lower = text.lower()
    found = set()
    for token in _DEGREE_TOKENS_SORTED:
        if token in lower:
            found.add(_DEGREE_TOKEN_MAP[token])
    return list(found)


def _branch_matches(user_branch: str, user_degree: str, eligible_branches: List[str]) -> bool:
    """
    Returns True if the student's branch+degree combination is covered by
    at least one entry in the eligible_branches list.

    Each entry may be a branch code ("CSE", "IT"), a degree-prefixed label
    ("M.TECH CSE", "B.TECH CSE"), or a degree code ("MTECH", "BTECH").
    """
    ub = user_branch.strip().upper()  # e.g. "CSE"
    ud = user_degree.strip().upper()  # e.g. "BTECH"

    # Normalise common degree-label variants to canonical codes
    deg_norm = {
        "MTECH": "MTECH", "M.TECH": "MTECH", "M TECH": "MTECH", "ME": "MTECH",
        "BTECH": "BTECH", "B.TECH": "BTECH", "B TECH": "BTECH", "BE": "BTECH",
        "MCA": "MCA", "MSC": "MSC", "M.SC": "MSC",
    }

    # CS/IT branch alias group — "CS & IT related branches" is a VIT-CDC
    # shorthand covering all these branches. If ANY of them appears in the
    # eligible list, the student's CS/IT branch is considered a match.
    _CS_IT_FAMILY = {"CSE", "IT", "AIML", "AIDS", "SWE", "CS",
                     "COMPUTER SCIENCE", "INFORMATION TECHNOLOGY"}

    eligible_upper = [e.strip().upper() for e in eligible_branches]
    # If both the user's branch AND at least one listed branch are in the
    # CS/IT family, it's a match — handles the common case where the mail
    # says "CS/IT related" and the parser stored only ["IT"] or ["CSE"].
    if ub in _CS_IT_FAMILY and any(e in _CS_IT_FAMILY for e in eligible_upper):
        return True

    for entry in eligible_branches:
        e = entry.strip().upper()
        # 1. Pure degree codes stored directly ("MTECH", "BTECH")
        if e in deg_norm and deg_norm[e] == ud:
            return True
        # 2. Branch codes without degree prefix ("CSE", "IT") — match on branch only
        if e == ub:
            return True
        # 3. Compound "DEGREE BRANCH" labels ("M.TECH CSE", "B.TECH CSE")
        # Check both the degree part and branch part
        matched_deg = None
        for tok, canon in deg_norm.items():
            if e.startswith(tok):
                matched_deg = canon
                branch_part = e[len(tok):].strip()
                break
        if matched_deg is not None:
            if matched_deg == ud and (not branch_part or ub in branch_part or branch_part in ub):
                return True

    return False


def check_eligibility(profile, company) -> Tuple[str, Optional[str], Dict[str, Any]]:
    """
    Checks if a student is eligible for a company drive.
    Returns a tuple: (status, reason, explanation_dict)
    Status can be: 'ELIGIBLE', 'NOT_ELIGIBLE', 'UNKNOWN'

    Degree / branch checking follows a three-tier priority:
      Tier 1 – eligibility_rules.degree_types (structured, from AI parser)
      Tier 2 – company.eligible_branches ARRAY (raw branch list from parser)
      Tier 3 – parse eligibility_raw_text for degree keywords (fallback)

    A drive is marked NOT_ELIGIBLE only when there is *positive evidence*
    that the student does not qualify; if all three tiers are empty we skip
    the branch check rather than falsely blocking anyone.
    """
    matched: List[str] = []
    failed: List[str] = []

    rules = company.eligibility_rules or {}
    user_deg = (profile.degree_type or "").strip().upper()
    user_branch = (profile.branch or "").strip().upper()

    # ── 1. DEGREE / BRANCH CHECK ──────────────────────────────────────────────
    # Tier 1: structured degree_types from eligibility_rules
    degree_types_raw: List[str] = rules.get("degree_types") or []
    # Tier 2: eligible_branches ARRAY on the Company model
    eligible_branches: List[str] = getattr(company, "eligible_branches", None) or []
    # Tier 3: raw text fallback
    eligibility_raw_text: Optional[str] = getattr(company, "eligibility_raw_text", None)

    branch_checked = False

    # Entries in eligible_branches that are pure degree codes carry no branch
    # information ("BTECH", "MTECH" tokens the parser sweeps up) — only real
    # branch names ("CSE", "Mechanical Engineering") constrain the branch.
    _PURE_DEGREE_CODES = {"BTECH", "B.TECH", "B TECH", "MTECH", "M.TECH",
                          "M TECH", "MCA", "MSC", "M.SC", "BE", "ME"}
    real_branch_entries = [
        e for e in eligible_branches
        if e.strip().upper() not in _PURE_DEGREE_CODES
    ]

    if degree_types_raw:
        # Tier 1: structured — authoritative
        branch_checked = True
        normalized = [d.strip().upper() for d in degree_types_raw]
        if user_deg not in normalized:
            # Build human-readable label set
            readable = ", ".join(degree_types_raw)
            failed.append(
                f"Required degree: {readable}. "
                f"Your degree: {profile.degree_type or 'None'}"
            )
        else:
            matched.append(f"Degree type matched: {profile.degree_type}")
            # A matching degree is NOT enough when the mail names specific
            # branches: 'B.Tech (MECH / EEE) related branches only' parsed as
            # degree_types=[BTECH] + branches=[EEE, MECHANICAL ENGINEERING],
            # and skipping the branch tier marked every B.Tech student
            # (including CSE) eligible for a MECH/EEE-only drive.
            if real_branch_entries:
                if not _branch_matches(user_branch, user_deg, real_branch_entries):
                    readable_b = ", ".join(real_branch_entries)
                    failed.append(
                        f"Required branches: {readable_b}. "
                        f"Your branch: {profile.branch or 'None'}"
                    )
                else:
                    matched.append(f"Branch matched: {profile.branch}")

    elif eligible_branches:
        # Tier 2: check each entry in the eligible_branches ARRAY
        branch_checked = True
        if not _branch_matches(user_branch, user_deg, eligible_branches):
            readable = ", ".join(eligible_branches)
            failed.append(
                f"Required branch: {readable}. "
                f"Your degree/branch: {profile.degree_type} {profile.branch}"
            )
        else:
            matched.append(f"Branch matched: {profile.degree_type} {profile.branch}")

    else:
        # Tier 3: parse raw text for degree keywords
        raw_degrees = _extract_degree_types_from_text(eligibility_raw_text)
        if raw_degrees:
            branch_checked = True
            if user_deg not in raw_degrees:
                readable = ", ".join(raw_degrees)
                failed.append(
                    f"Required degree (from eligibility text): {readable}. "
                    f"Your degree: {profile.degree_type or 'None'}"
                )
            else:
                matched.append(
                    f"Degree matched (from eligibility text): {profile.degree_type}"
                )
        # else: no data at all — skip the branch check (don't block anyone)

    # ── 2. SPECIALIZATION CHECK ───────────────────────────────────────────────
    # Only run this if the degree check PASSED (or was skipped) and we have data.
    # Don't penalise for specialization when the degree itself already failed.
    specializations: List[str] = rules.get("specializations") or []
    allow_all_specializations: bool = rules.get("allow_all_specializations", False)

    if not failed or not branch_checked:
        # Only check specialization when the student's degree matched (or no
        # degree data existed at all), so we don't pile on redundant failures.
        if allow_all_specializations or not specializations:
            matched.append("Specialization: All specializations allowed")
        else:
            user_spec = (profile.specialization or "").strip().upper()
            if user_spec not in [s.strip().upper() for s in specializations]:
                failed.append(
                    f"Required specialization: {', '.join(specializations)}. "
                    f"Your specialization: {profile.specialization or 'None'}"
                )
            else:
                matched.append(f"Specialization matched: {profile.specialization}")

    # ── 3. CGPA CHECK ─────────────────────────────────────────────────────────
    min_cgpa = rules.get("min_cgpa") or rules.get("cgpa")
    if min_cgpa is not None:
        if profile.cgpa is None:
            failed.append(f"Required CGPA: {float(min_cgpa):.2f}. Your CGPA: Not set")
        elif float(profile.cgpa) < float(min_cgpa):
            failed.append(
                f"Required CGPA: {float(min_cgpa):.2f}. "
                f"Your CGPA: {float(profile.cgpa):.2f}"
            )
        else:
            matched.append(
                f"CGPA matched: {float(profile.cgpa):.2f} >= {float(min_cgpa):.2f}"
            )

    # ── 4. TENTH MARKS CHECK ──────────────────────────────────────────────────
    min_tenth = rules.get("min_tenth_marks") or rules.get("min_tenth")
    if min_tenth is not None:
        if profile.tenth_marks is None:
            failed.append(f"Required 10th Marks: {float(min_tenth):.1f}%. Your Marks: Not set")
        elif float(profile.tenth_marks) < float(min_tenth):
            failed.append(
                f"Required 10th Marks: {float(min_tenth):.1f}%. "
                f"Your Marks: {float(profile.tenth_marks):.1f}%"
            )
        else:
            matched.append(
                f"10th Marks matched: {float(profile.tenth_marks):.1f}% >= {float(min_tenth):.1f}%"
            )

    # ── 5. TWELFTH MARKS CHECK ────────────────────────────────────────────────
    min_twelfth = rules.get("min_twelfth_marks") or rules.get("min_twelfth")
    if min_twelfth is not None:
        if profile.twelfth_marks is None:
            failed.append(f"Required 12th Marks: {float(min_twelfth):.1f}%. Your Marks: Not set")
        elif float(profile.twelfth_marks) < float(min_twelfth):
            failed.append(
                f"Required 12th Marks: {float(min_twelfth):.1f}%. "
                f"Your Marks: {float(profile.twelfth_marks):.1f}%"
            )
        else:
            matched.append(
                f"12th Marks matched: {float(profile.twelfth_marks):.1f}% >= {float(min_twelfth):.1f}%"
            )

    # ── 6. ARREARS CHECK ──────────────────────────────────────────────────────
    requires_no_arrears = rules.get("requires_no_arrears")
    if requires_no_arrears is None:
        requires_no_arrears = (
            rules.get("min_arrears") is False or rules.get("min_arrears") == 0
        )

    if requires_no_arrears:
        if profile.has_arrears:
            failed.append("No active arrears required. You have active arrears")
        else:
            matched.append("No active arrears condition met")

    # ── 7. PG UG CGPA CHECK ───────────────────────────────────────────────────
    is_pg = user_deg in ("MTECH", "MCA", "MSC")
    min_ug_cgpa = rules.get("min_ug_cgpa")
    if is_pg and min_ug_cgpa is not None:
        if profile.ug_cgpa is None:
            failed.append(
                f"Required UG CGPA: {float(min_ug_cgpa):.2f}. Your UG CGPA: Not set"
            )
        elif float(profile.ug_cgpa) < float(min_ug_cgpa):
            failed.append(
                f"Required UG CGPA: {float(min_ug_cgpa):.2f}. "
                f"Your UG CGPA: {float(profile.ug_cgpa):.2f}"
            )
        else:
            matched.append(
                f"UG CGPA matched: {float(profile.ug_cgpa):.2f} >= {float(min_ug_cgpa):.2f}"
            )

    # ── 8. RESTRICTED-AUDIENCE DRIVES (e.g. women-only events) ────────────────
    # The profile has no gender field, so this can never be auto-verified —
    # a confident ELIGIBLE here is exactly the wrong answer.
    women_only = bool(rules.get("women_only"))

    # ── RESULT ────────────────────────────────────────────────────────────────
    # Track whether ANY criterion was actually evaluated. 'No data parsed →
    # ELIGIBLE' silently marked criteria-less drives green; the honest answer
    # is UNKNOWN with a pointer to the source mail.
    criteria_checked = (
        branch_checked
        or min_cgpa is not None
        or min_tenth is not None
        or min_twelfth is not None
        or requires_no_arrears
    )

    if not failed and women_only:
        status = "UNKNOWN"
        reason = ("This drive is restricted (women-only event per the mail) — "
                  "verify your eligibility against the original email.")
        explanation = {"eligible": None, "matched": matched,
                       "failed": [], "unverified": [reason]}
        return status, reason, explanation

    if not failed and not criteria_checked:
        status = "UNKNOWN"
        reason = ("No eligibility criteria could be verified from the mail — "
                  "check the original email before registering.")
        explanation = {"eligible": None, "matched": matched,
                       "failed": [], "unverified": [reason]}
        return status, reason, explanation

    eligible = len(failed) == 0
    status = "ELIGIBLE" if eligible else "NOT_ELIGIBLE"
    reason = "You meet all academic criteria." if eligible else failed[0]

    explanation = {
        "eligible": eligible,
        "matched": matched,
        "failed": failed,
    }

    return status, reason, explanation
