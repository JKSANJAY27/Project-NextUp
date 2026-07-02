import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.services.email_parser import parse_placement_email
import json

email_subject = "* Super Dream Placement / Internship - 2027 Batch*"
email_body = """* Super Dream Placement / Internship - 2027 Batch*







Name of the Company




*GROWW*





Category



* Super Dream Internship/ Placement*






Date of Visit:



* Online test: 8th July 2026 ( respective CDC Labs)*


*Pre-Placement & Selection process - 9th July 2026 - 6 pm ( Physical for Vellore Campus )*


*Interview: 10th July 2026 (Physical at VIT Vellore campus for Vellore and Chennai students )*








Eligible Branches


   - B.Tech ( CSE, IT & related courses )





Eligibility Criteria

 *% in X and XII – 80% or 8.0 CGPA*

*in Pursuing Degree – 80% or 8.0 CGPA*

*in UG (for PGs) – 80% or 8.0 CGPA   *

*No Standing Arrears*





CTC



*26,00,000 (If converted)*



Stipend




*1,00,000 per month*






Last date for Registration



*04th July 2026 (9.00 am)*








Website



https://groww.in/





*Job location: *Bengaluru

*Job profile: *Software Development Engineer Intern


Compensation 26,00,000
Break-up
Fixed 18,00,000
Variable 2,00,000
JB 2,00,000
ESOPs 4,00,000


*Registration:*


*All the interested and eligible students should register in the NEOPAT portal on or before *04th July 2026 (9.00 am)*





*No manual registration or extension will be entertained.*






*Mandatory Note:*



1. Branches, eligibility, and date for the selection process are tentative and subject to change.

2. Please update your resume with all relevant details and projects done in the Neo PAT Portal, as there would be shortlisting by the company for the selection process.

3.  Appear for the selection process in formal dress.

4.  Carry your updated resume, photos, College photo ID, and all other relevant certificates before the selection process.

5. Latecomers will not be allowed to attend the selection process.






Warm regards.

*Dr.V.Samuel Rajkumar,PhD*

Director(Career Development Centre)

VIT, Vellore"""

parsed = parse_placement_email(email_body, email_subject)
print(json.dumps(parsed, indent=2))
