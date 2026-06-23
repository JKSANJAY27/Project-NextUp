import re

body_siemens = """ Siemens Healthineers online test is scheduled on 10th June 2026 by 7.00 pm\r
- own location\r
\r
Please find the students list\r
\r
students will receive the link directly from the company\r
\r
\r
Warm regards.\r
\r
*Dr.V.Samuel Rajkumar,PhD*"""

body_credence = """Name of the Company
*Credence Automation and Control Systems Pvt. Ltd.*

Category
 *Regular Internship Registration*"""

def clean_val(val: str):
    if not val:
        return None
    val = re.sub(r'[*_#\u00d8]', '', val)
    return val.strip()

def run_test(name, text):
    comp_match = re.search(
        r"(?:^|[\n\r])\s*[\-\–\—\*\u00d8\d\.\s]*\s*(?:Name of the Company|Company Name|Company|Name of the Organisation|Organisation)\s*[:\-\–\—\s]\s*[\n\r]*\s*\*?([^\n\r*]+)",
        text,
        re.IGNORECASE
    )
    if comp_match:
        print(f"{name} Company Matched (Body): {clean_val(comp_match.group(1))!r}")
    else:
        print(f"{name} Company NOT Matched (Body)")

run_test("Siemens", body_siemens)
run_test("Credence", body_credence)
