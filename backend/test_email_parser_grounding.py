from app.services.email_parser import (
    extract_explicit_compensation,
    extract_min_cgpa,
    ground_role_facts_in_source,
)


VALUELABS = """
Eligibility Criteria
% in X and XII – 75% or 7.5 CGPA
in Pursuing Degree – 75% or 7.5 CGPA
in UG (for PGs) – 75% or 7.5 CGPA
No Standing Arrears

CTC
Year 1 (CTC: ₹22 Lakhs): ₹16 Lakhs Fixed + ₹3 Lakhs Variable
Year 2 (CTC: ₹26 Lakhs): ₹18 Lakhs Fixed + ₹4 Lakhs Variable

Stipend
50000

Last date for Registration
04th July 2026 (10.00 am)
"""

GROWW = """
Eligibility Criteria
% in X and XII – 80% or 8.0 CGPA
in Pursuing Degree – 80% or 8.0 CGPA
in UG (for PGs) – 80% or 8.0 CGPA

CTC
26,00,000 (If converted)

Stipend
1,00,000 per month

Last date for Registration
04th July 2026 (9.00 am)
"""


def test_decimal_cgpa_is_not_truncated_from_percentage_prefix():
    assert extract_min_cgpa(VALUELABS) == 7.5
    assert extract_min_cgpa(GROWW) == 8.0
    assert extract_min_cgpa(
        "X/XII: 75% or 7.5 CGPA; Pursuing Degree: 75% or 7.5 CGPA; "
        "in UG (for PGs): 80% or 8.0 CGPA"
    ) == 7.5


def test_ctc_and_stipend_are_extracted_as_separate_fields():
    ctc, stipend = extract_explicit_compensation(VALUELABS)
    assert "Year 1" in ctc and "₹22 Lakhs" in ctc
    assert "Year 2" in ctc and "₹26 Lakhs" in ctc
    assert stipend == "50000"

    assert extract_explicit_compensation(GROWW) == (
        "26,00,000 (If converted)",
        "1,00,000 per month",
    )


def test_absent_compensation_stays_null_and_model_values_are_removed():
    body = "Eligibility Criteria\nIn Pursuing Degree - 7.5 CGPA\n"
    parsed = {
        "extracted_data": {
            "roles": [{
                "ctc": {"value": "22 LPA", "confidence": 0.8},
                "stipend": {"value": "50000", "confidence": 0.8},
                "min_cgpa": {"value": 7, "confidence": 0.8},
            }]
        }
    }

    grounded = ground_role_facts_in_source(parsed, body)
    role = grounded["extracted_data"]["roles"][0]
    assert role["ctc"]["value"] is None
    assert role["stipend"]["value"] is None
    assert role["min_cgpa"]["value"] == 7.5


def test_one_compensation_field_does_not_populate_the_other():
    assert extract_explicit_compensation("Stipend:\n₹50,000 per month") == (
        None,
        "₹50,000 per month",
    )
    assert extract_explicit_compensation("Salary: 18 LPA") == ("18 LPA", None)
