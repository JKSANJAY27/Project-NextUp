import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.services.email_parser import extract_company_from_subject

subjects = [
    "* Super Dream Placement / Internship - 2027 Batch*",
    "FLENDER NEXT ROUND OF SELECTION PROCESS IS SCHEDULED ON *08TH & 9TH JULY",
    "*UBS NEXT ROUND OF SELECTION PROCESS IS SCHEDULED ON 10-07-2026 BY 09:00"
]

for s in subjects:
    res = extract_company_from_subject(s)
    print(f"Subject: {s!r}\nExtracted: {res!r}\n")
