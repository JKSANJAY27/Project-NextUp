import re
import dateparser

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
"""

credence_body = """Name of the Company
*Credence Automation and Control Systems Pvt. Ltd.*

Category
 *Regular Internship Registration*

Date of Visit:
Will be announced later

Eligible Branches
1 M.Tech 5 Year Integrated – Software Engineering
2 M.Tech 5 Year Integrated – Computer Science Engineering

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
"""

def clean_val(val: str):
    if not val:
        return None
    val = re.sub(r'[*_#\u00d8]', '', val)  # strip markdown & bullet characters
    return val.strip()

def test_on(body):
    print("-----------------------------------")
    # Deadline match
    deadline_match = re.search(
        r"(?:Last\s*date\s*for\s*Registration|Last\s*Date\s*to\s*Apply|Registration\s*Deadline|Last\s*Date|Deadline|Last\s*date)\s*:?\s*[\n\r]*\s*(.+)",
        body,
        re.IGNORECASE
    )
    if deadline_match:
        raw = deadline_match.group(1)
        cleaned = clean_val(raw)
        parsed = dateparser.parse(cleaned) if cleaned else None
        print(f"Deadline Raw: {raw!r}")
        print(f"Deadline Cleaned: {cleaned!r}")
        print(f"Deadline Parsed: {parsed}")
    else:
        print("Deadline NOT matched")

    # Company match
    comp_match = re.search(
        r"(?:Name of the Company|Company Name|Company|Name of the Organisation|Organisation)\s*:?\s*[\n\r]*\s*\*?([^\n\r*]+)",
        body,
        re.IGNORECASE
    )
    if comp_match:
        raw = comp_match.group(1)
        cleaned = clean_val(raw)
        print(f"Company Raw: {raw!r}")
        print(f"Company Cleaned: {cleaned!r}")
    else:
        print("Company NOT matched")

test_on(ericsson_body)
test_on(credence_body)
