import sys
import os
import re
import dateparser
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob

db = SessionLocal()
try:
    jobs = db.query(RawIngestionJob).all()
    for j in jobs:
        payload = j.payload or {}
        subject = payload.get("subject", "")
        body = payload.get("body", "")
        if "ericsson" in subject.lower() or "ericsson" in body.lower():
            print(f"=== JOB ID: {j.id} ===")
            print("Running regex matches:")
            
            # 1. Deadline
            deadline_match = re.search(
                r"(?:Last\s*date\s*for\s*Registration|Last\s*Date\s*to\s*Apply|Registration\s*Deadline|Last\s*Date|Deadline|Last\s*date)\s*:?\s*[\n\r]*\s*(.+)",
                body,
                re.IGNORECASE
            )
            if deadline_match:
                raw_date = deadline_match.group(1)
                print(f"Deadline match raw: {raw_date!r}")
                # Wait! Let's clean it:
                cleaned = re.sub(r'[*_#\u00d8]', '', raw_date).strip()
                print(f"Deadline match cleaned: {cleaned!r}")
                parsed = dateparser.parse(cleaned)
                print(f"Deadline parsed: {parsed}")
            else:
                print("Deadline not matched")
                
            # 2. Company
            comp_match = re.search(
                r"(?:Name of the Company|Company Name|Company|Name of the Organisation|Organisation)\s*:?\s*[\n\r]*\s*\*?([^\n\r*]+)",
                body,
                re.IGNORECASE
            )
            if comp_match:
                print(f"Company match: {comp_match.group(1)!r}")
            else:
                print("Company not matched")
                
finally:
    db.close()
