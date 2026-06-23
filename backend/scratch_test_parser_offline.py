import re
import json

ericsson_body = """*Ericsson Dream Internship Registration - 2027 Batch*

 Name of the Company
*Ericsson*

Category
*Dream Internship Registration - 2027 Batch*

Date of Visit:
*Will be announced later*

Eligible Branches
Ø  M. Tech 2 year & 5 year (CSE / IT / EEE/ECE ) related branches only

Eligibility Criteria
*% in X and XII – 75% or 7.5 CGPA*
*in Pursuing Degree – 80% or 8.0 CGPA*
*in UG (for PGs) – 80% or 8.0 CGPA   *
*No Standing Arrears*

CTC
*Will be announced later*

Stipend
*35000*

Last date for Registration
*19th June 2026 (10.00 am)*

 Website
*www.ericsson.com <http://www.ericsson.com>*

*Job location:* *Bangalore & Chennai*

*Designation : Student Interns (Software Development)*

*Job Description : Below attached*
*Opportunity  (Internship Opportunity)*
   - Role: Internship
   - Duration – 12 months
   - Location: Bangalore & Chennai
   - Eligibility: Stream – CS/IT,  ECE OR EEE and related branches, 75% - X
   & XII & >= 8 CGPA - M Tech
   - Key Skills Required-
   - programming languages – *Java/ Python programming.*
   - Selection process: The hiring process will include online test
   (aptitude test) followed by in-person interviews
   - Stipend- 35000/- per month
   - Batch: 2027
   - Onboarding: Candidates’ availability
   - JD: Attached with email.

***All the interested and eligible students should register in the NEO
PAT on or before *19th June 2026 (10.00 am)*
"""

credence_body = """Name of the Company

*Credence Automation and Control Systems Pvt. Ltd.*

Category

 *Regular Internship Registration*

Date of Visit:

Will be announced later

Eligible Branches

1
M.Tech 5 Year Integrated – Software Engineering
2
M.Tech 5 Year Integrated – Computer Science Engineering
3
M.Tech 5 Year Integrated – Computer Science Engineering with Data Science
4
M.Tech 5 Year Integrated Computer Science & Engineering – Computational and
Data Science
5
M.Tech 5 Year Integrated AI
6
M.Tech 5 Year Integrated CSE – Business Analytics
7
M.Tech Computer Science and Engineering
8
M.Tech Computer Science and Engineering – Artificial Intelligence and
Machine Learning
9
M.Tech CSE – Specialization in Artificial Intelligence & Data Science
10
MCA
11
M.Tech VLSI Design
12
M.Tech Embedded Systems
13
M.Tech Power Electronics and Drives
14
M.Tech Control and Automation
15
M.Tech CAD/CAM
16
M.Tech Mechatronics
17
M.Tech Smart Manufacturing

Eligibility Criteria
* % in X and XII – 60% or 6.0 CGPA*
*in Pursuing Degree – 60% or 6.0 CGPA*
*in UG (for PGs) – 60% or 6.0 CGPA   *
No Standing Arrears

CTC
*3 LPA*

Stipend

*15000*

Last date for Registration

*24-06-**2026** (10:00 AM)*

Website

credenceautomation.com
*Job location: Pune*
*JD: Refer Attachment *
*Registration:* All the interested and eligible students are asked to
register in the Neo PAT on or before *24-06-**2026 (10:00 AM)*
"""

def clean_val(val):
    if not val:
        return None
    val = re.sub(r'[*_#\u00d8]', '', val)  # strip markdown & bullet characters
    return val.strip()

def get_branches_from_text(text: str) -> list:
    branches = set()
    text_lower = text.lower()
    
    mapping = {
        "computer science": "CSE",
        "cse": "CSE",
        "software engineering": "SWE",
        "swe": "SWE",
        "information technology": "IT",
        "it": "IT",
        "electronics": "ECE",
        "ece": "ECE",
        "vlsi": "ECE",
        "embedded": "ECE",
        "electrical": "EEE",
        "eee": "EEE",
        "mechanical": "MECH",
        "mech": "MECH",
        "mechatronics": "MECH",
        "cad/cam": "MECH",
        "civil": "CIVIL",
        "mca": "MCA",
        "mtech": "MTECH",
        "mba": "MBA",
        "artificial intelligence": "AIML",
        "aiml": "AIML",
        "ai": "AIML",
        "data science": "AIDS",
        "datascience": "AIDS",
        "aids": "AIDS"
    }
    
    for word, branch in mapping.items():
        if re.search(r'\b' + re.escape(word) + r'\b', text_lower):
            branches.add(branch)
            
    return list(branches)

def extract_placements_regex_improved(email_body: str, subject: str = "") -> dict:
    data = {}

    # 1. Company Name
    comp_match = re.search(
        r"(?:Name of the Company|Company Name|Company|Name of the Organisation|Organisation)\s*:?\s*[\n\r]*\s*\*?([^\n\r*]+)",
        email_body,
        re.IGNORECASE
    )
    if comp_match:
        data["company"] = clean_val(comp_match.group(1))
    else:
        # Fallback to subject line parsing
        parts = re.split(r'[-–—|:(]', subject)
        first_part = parts[0].strip()
        clean = re.sub(
            r'\b(?:next\s+round|tech\s+talk|super\s+dream|dream|regular|mass|recruitment|recruiter|drive|drives|internship|placement|hiring|registration|selection|shortlist|online\s+test|oa|interview|offers?|applied|announcement|results?|list|batch|\d{4})\b.*$',
            '',
            first_part,
            flags=re.I
        ).strip()
        clean = clean_val(clean)
        if clean and len(clean) >= 2:
            data["company"] = clean
        else:
            data["company"] = "Unknown Company"

    # 2. Category
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

    # 3. Designation / Role
    role_match = re.search(
        r"(?:Designation|Role|Job Title|Profile|Position|Job Title/Role)\s*:?\s*[\n\r]*\s*\*?([^\n\r*]+)",
        email_body,
        re.IGNORECASE
    )
    if role_match:
        data["role"] = clean_val(role_match.group(1))
    else:
        data["role"] = "Software Engineer"

    # 4. CTC
    ctc_match = re.search(
        r"(?:CTC|Salary|Package|Annual\s*CTC)\s*:?\s*[\n\r]*\s*\*?([^\n\r*]+)",
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
        r"(?:Stipend|Internship\s*Stipend|Monthly\s*Stipend)\s*:?\s*[\n\r]*\s*\*?([^\n\r*]+)",
        email_body,
        re.IGNORECASE
    )
    if stipend_match:
        data["stipend"] = clean_val(stipend_match.group(1))
    else:
        # Search for digits near "stipend" keyword
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
        r"(?:Last\s*date\s*for\s*Registration|Last\s*Date\s*to\s*Apply|Registration\s*Deadline|Last\s*Date|Deadline|Last\s*date)\s*:?\s*[\n\r]*\s*(.+)",
        email_body,
        re.IGNORECASE
    )
    if deadline_match:
        data["deadline_raw"] = clean_val(deadline_match.group(1))
    else:
        # Try to search for "register... on or before... [date]"
        on_or_before = re.search(r"(?:register|apply|submission)\s*(?:on\s*or\s*before)?\s*\*?([^\n\r*]{5,50})", email_body, re.I)
        if on_or_before:
            data["deadline_raw"] = clean_val(on_or_before.group(1))
        else:
            data["deadline_raw"] = "Will be announced later"

    # 7. Eligible Branches block extraction
    branches_block_match = re.search(
        r"(?:Eligible\s*Branches|Eligibility\s*Branches|Branches|Eligible\s*Departments?)\s*:?\s*[\n\r]*(.*?)(?:Eligibility Criteria|Eligibility|Criteria|CTC|Stipend|Last date|Website|Job location|Designation|$)",
        email_body,
        re.IGNORECASE | re.DOTALL
    )
    branches_text = branches_block_match.group(1) if branches_block_match else email_body
    data["eligible_branches"] = get_branches_from_text(branches_text)

    # Degree types
    found_degrees = []
    if re.search(r'\b(b\.?\s*tech|bachelor\s+of\s+tech)\b', branches_text, re.I):
        found_degrees.append("BTECH")
    if re.search(r'\b(m\.?\s*tech|master\s+of\s+tech)\b', branches_text, re.I):
        found_degrees.append("MTECH")
    if re.search(r'\b(m\.?\s*c\.?\s*a|master\s+of\s+computer\s+app)\b', branches_text, re.I):
        found_degrees.append("MCA")
    if re.search(r'\b(m\.?\s*sc|master\s+of\s+sci)\b', branches_text, re.I):
        found_degrees.append("MSC")
    # If no degree types found in branches block, search whole email
    if not found_degrees:
        if re.search(r'\b(b\.?\s*tech|bachelor\s+of\s+tech)\b', email_body, re.I):
            found_degrees.append("BTECH")
        if re.search(r'\b(m\.?\s*tech|master\s+of\s+tech)\b', email_body, re.I):
            found_degrees.append("MTECH")
        if re.search(r'\b(m\.?\s*c\.?\s*a|master\s+of\s+computer\s+app)\b', email_body, re.I):
            found_degrees.append("MCA")
        if re.search(r'\b(m\.?\s*sc|master\s+of\s+sci)\b', email_body, re.I):
            found_degrees.append("MSC")
    data["degree_types"] = found_degrees

    # Specializations
    found_specializations = []
    if re.search(r'\b(core|computer\s*science|cse)\b', branches_text, re.I):
        found_specializations.append("CSE_CORE")
    if re.search(r'\b(info(rmation)?\s*sec(urity)?|cyber\s*sec(urity)?|is)\b', branches_text, re.I):
        found_specializations.append("CSE_INFO_SEC")
    if re.search(r'\b(iot|internet\s+of\s+things)\b', branches_text, re.I):
        found_specializations.append("CSE_IOT")
    if re.search(r'\b(data\s*science|ds)\b', branches_text, re.I):
        found_specializations.append("CSE_DATA_SCIENCE")
    if re.search(r'\b(blockchain|block\s*chain)\b', branches_text, re.I):
        found_specializations.append("CSE_BLOCKCHAIN")
    if re.search(r'\b(ai|ml|artificial\s*intel|machine\s*learn)\b', branches_text, re.I):
        found_specializations.append("CSE_AI_ML")
    # If no specializations found in branches block, search whole email
    if not found_specializations:
        if re.search(r'\b(core|computer\s*science|cse)\b', email_body, re.I):
            found_specializations.append("CSE_CORE")
        if re.search(r'\b(info(rmation)?\s*sec(urity)?|cyber\s*sec(urity)?|is)\b', email_body, re.I):
            found_specializations.append("CSE_INFO_SEC")
        if re.search(r'\b(iot|internet\s+of\s+things)\b', email_body, re.I):
            found_specializations.append("CSE_IOT")
        if re.search(r'\b(data\s*science|ds)\b', email_body, re.I):
            found_specializations.append("CSE_DATA_SCIENCE")
        if re.search(r'\b(blockchain|block\s*chain)\b', email_body, re.I):
            found_specializations.append("CSE_BLOCKCHAIN")
        if re.search(r'\b(ai|ml|artificial\s*intel|machine\s*learn)\b', email_body, re.I):
            found_specializations.append("CSE_AI_ML")
    data["specializations"] = found_specializations

    # 8. Eligibility criteria block extraction
    elig_block_match = re.search(
        r"(?:Eligibility Criteria|Eligibility|Criteria)\s*:?\s*[\n\r]*(.*?)(?:CTC|Stipend|Last date|Website|Job location|Designation|$)",
        email_body,
        re.IGNORECASE | re.DOTALL
    )
    elig_text = elig_block_match.group(1) if elig_block_match else email_body
    
    # Clean the eligibility raw text
    elig_lines = elig_text.strip().split("\n")
    cleaned_elig_lines = [clean_val(line) for line in elig_lines if clean_val(line)]
    data["eligibility_raw_text"] = "\n".join(cleaned_elig_lines) if cleaned_elig_lines else None

    # Min CGPA
    # Try pursuing degree CGPA specifically first, and avoid matching percentages (by checking that it is not followed by %)
    pursuing_cgpa = re.search(
        r"(?:pursuing|current|college|degree|cgpa\s*in\s*degree|graduation)\s*(?:degree)?\s*[\-–—:]?\s*(?:>=|>|:)?\s*([\d.]+)(?!\s*%)",
        elig_text,
        re.IGNORECASE
    )
    if pursuing_cgpa:
        data["min_cgpa"] = float(pursuing_cgpa.group(1))
    else:
        # Fallback to general CGPA match
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
    # Look for joint 10th & 12th marks first, e.g. "X and XII – 75%", "10th and 12th - 60%"
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
    ug_cgpa_match = re.search(r'(?:ug\s*cgpa|undergrad\s*cgpa)(?:\s*(?:>=|>|:|-|of|\b)\s*)(\d+(?:\.\d+)?)', elig_text, re.I)
    data["min_ug_cgpa"] = float(ug_cgpa_match.group(1)) if ug_cgpa_match else None

    # Arrears
    arrears_match = re.search(
        r"(No\s+Standing\s+Arrears|No\s+active\s+backlogs|No\s+backlogs|No\s+standing\s+backlogs|No\s+History\s+of\s+Arrears)",
        elig_text,
        re.IGNORECASE
    )
    data["requires_no_arrears"] = True if arrears_match else False

    # 9. Job Location
    location_match = re.search(
        r"(?:Job\s*Location|Location|Work\s*Location|Place\s*of\s*Posting)\s*:?\s*[\n\r]*\s*(.+)",
        email_body,
        re.IGNORECASE
    )
    if location_match:
        data["job_location"] = clean_val(location_match.group(1))
    else:
        # Try inline match
        loc_inline = re.search(r"Location\s*[-–]\s*([A-Za-z ,&]+)", email_body, re.IGNORECASE)
        if loc_inline:
            data["job_location"] = clean_val(loc_inline.group(1))
        else:
            data["job_location"] = "Will be announced later"

    # 10. Date of Visit
    visit_match = re.search(
        r"(?:Date of Visit|Visit Date|Date of recruitment|Recruitment Date)\s*:?\s*[\n\r]*\s*(.+)",
        email_body,
        re.IGNORECASE
    )
    if visit_match:
        data["date_of_visit"] = clean_val(visit_match.group(1))
    else:
        data["date_of_visit"] = "Will be announced later"

    # 11. Registration Link
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
        else:
            data["registration_link"] = None

    return data


print("=== NEW IMPROVED PARSING ERICSSON ===")
ericsson_res = extract_placements_regex_improved(ericsson_body, "Ericsson Dream Internship Registration - 2027 Batch")
print(json.dumps(ericsson_res, indent=2))

print("\n=== NEW IMPROVED PARSING CREDENCE ===")
credence_res = extract_placements_regex_improved(credence_body, "Name of the Company")
print(json.dumps(credence_res, indent=2))
