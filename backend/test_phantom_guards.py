import pytest
from app.services.email_parser import is_generic_company_name
from app.services.eligibility import check_eligibility

def test_is_generic_company_name_phantom_guards():
    # 1. Neo ID Reg
    assert is_generic_company_name("NEO ID REG") is True
    assert is_generic_company_name("Neo ID Registration") is True
    assert is_generic_company_name("Neo ID") is True

    # 2. Person Name
    assert is_generic_company_name("KHUSHI AGARWAL") is True
    assert is_generic_company_name("Rahul Sharma") is True
    # Real 2-word corporate brands should pass
    assert is_generic_company_name("Fischer Jordan") is False
    assert is_generic_company_name("Morgan Stanley") is False

    # 3. Neo ID tokens as company name
    assert is_generic_company_name("F3M5W9J9 B5K6G7Q6") is True
    assert is_generic_company_name("F3M5W9J9") is True

    # 4. Academic branch names
    assert is_generic_company_name("MECHANICAL") is True
    assert is_generic_company_name("Mechanical Engineering") is True
    assert is_generic_company_name("Civil") is True
    assert is_generic_company_name("Data Science & Business Statistics") is True

    # 5. Genuine company names
    assert is_generic_company_name("Zomato") is False
    assert is_generic_company_name("ETERNAL (ZOMATO)") is False
    assert is_generic_company_name("Tekion India Pvt Ltd") is False

def test_eligibility_unknown_for_criterialess_drives():
    class DummyProfile:
        degree_type = "BTECH"
        branch = "CSE"
        specialization = "CSE_CORE"
        cgpa = 8.5
        tenth_marks = 90.0
        twelfth_marks = 90.0
        has_arrears = False
        ug_cgpa = None

    class DummyCompany:
        eligibility_rules = {}
        eligible_branches = []
        eligibility_raw_text = None

    status, reason, explanation = check_eligibility(DummyProfile(), DummyCompany())
    assert status == "UNKNOWN"
    assert "No eligibility criteria could be verified" in reason

if __name__ == "__main__":
    test_is_generic_company_name_phantom_guards()
    test_eligibility_unknown_for_criterialess_drives()
    print("ALL PHANTOM GUARD TESTS PASSED!")
