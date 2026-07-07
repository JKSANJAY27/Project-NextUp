import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from app.services.email_parser import is_generic_company_name, GENERIC_COMPANY_NAMES
import re

name = "Infosys HackwithInfy Digital Specialist Engineer"
print("Length:", len(name))
cleaned = re.sub(r'[*#_\-–—!?\s\t\n\r]+', ' ', name).strip().lower()
print("Cleaned:", cleaned)
print("Words count:", len(cleaned.split()))

if len(cleaned) > 40:
    print("Blocked by: len > 40")
if len(cleaned.split()) > 5:
    print("Blocked by: words > 5")
if cleaned in GENERIC_COMPANY_NAMES:
    print("Blocked by: in GENERIC_COMPANY_NAMES")

cleaned_punct = re.sub(r'[^a-z0-9\s]', '', cleaned).strip()
if cleaned_punct in GENERIC_COMPANY_NAMES:
    print("Blocked by: cleaned_punct in GENERIC_COMPANY_NAMES")

generic_patterns = [
    r'congratulat',
    r'\bcongrats\b',
    r'\bkind\s+attention\b',
    r'\battention\b',
    r'\bselection\s+process\b',
    r'\bonline\s+test\b',
    r'\bonline\s+assessment\b',
    r'\bscheduled\b',
    r'\btest\s+link\b',
    r'\bshortlist',
    r'\bselect\s+list\b',
    r'\bselected\b',
    r'\bplacement\s+officer\b',
    r'\bcdc\b',
    r'\bvit\b',
    r'\bstudents?\b',
    r'\bbatch\b',
    r'\bregistration\b',
    r'\bapply\b',
    r'\bplacements\b',
    r'\binternship\s+registration\b',
    r'\bsuper\s+dream\s+internship\b',
]
for pattern in generic_patterns:
    if re.search(pattern, cleaned):
        print(f"Blocked by generic pattern: {pattern}")
