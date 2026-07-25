"""
patch_ctc_from_body.py
----------------------
One-off script: re-extracts complete multi-component compensation structure
from stored email bodies and updates the CTC column in companies table.
"""

import os
import sys
import json
import re
from typing import Optional

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

DATABASE_URL = os.getenv("DATABASE_URL", "")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set in .env")
    sys.exit(1)

import psycopg2
import psycopg2.extras


def parse_compensation_text(body: str) -> Optional[str]:
    if not body:
        return None
    
    pos = body.lower().rfind("below mail body")
    search_body = body[pos + 15:] if pos != -1 else body
    
    m = re.search(
        r"(?is)[\*•\-]*\s*Compensation\s*[:\-\–\—\*\s]*[\r\n]+(.*?)"
        r"(?=(?:\r?\n)\s*[\*•\-]*\s*(?:Note|Registration|Eligibility|Selection\s+Process|Job\s+Locations?|Job\s+Description|Important|Website|Company\s+link|Warm\s+regards|Disclaimer|Tentative)|$)",
        search_body
    )
    if not m:
        m = re.search(
            r"(?is)[\*•\-]*\s*(?:Compensation|CTC|Package)\s*[:\-\–\—\*\s]*[\r\n]+(.*?)"
            r"(?=(?:\r?\n)\s*[\*•\-]*\s*(?:Note|Registration|Eligibility|Selection\s+Process|Job\s+Locations?|Job\s+Description|Important|Website|Company\s+link|Warm\s+regards|Disclaimer)|$)",
            body
        )
    if not m:
        return None
    
    raw_block = m.group(1).strip()
    skip_headers = {"compensation component", "amount", "component", "particulars", "details"}
    raw_lines = [re.sub(r"<[^>]+>", " ", l).strip().strip("*_ ").strip() for l in raw_block.splitlines()]
    raw_lines = [l for l in raw_lines if l and l.lower() not in skip_headers]
    if not raw_lines:
        return None
    
    formatted = []
    i = 0
    while i < len(raw_lines):
        line = raw_lines[i]
        line = re.sub(r"^[•\-\*\s]+", "", line).strip().strip("*_ ").strip()
        if not line:
            i += 1
            continue
        if re.match(r"^(?:Job\s+Locations?|Tentative|Location|Registration|Website|Selection)\b", line, re.I):
            break
        if ":" in line or re.search(r"\b(?:₹|INR|USD|Rs\.?)\b", line):
            while i + 1 < len(raw_lines) and (raw_lines[i+1].startswith("(") or raw_lines[i+1].startswith("~")):
                line += " " + raw_lines[i+1].strip()
                i += 1
            formatted.append(line)
        elif i + 1 < len(raw_lines):
            next_l = raw_lines[i+1].strip()
            if any(k in next_l for k in ["INR", "USD", "₹", "Rs", "per", "%", "lakh"]) or (next_l and next_l[0].isdigit()):
                while i + 2 < len(raw_lines) and (raw_lines[i+2].startswith("(") or raw_lines[i+2].startswith("~")):
                    next_l += " " + raw_lines[i+2].strip()
                    i += 1
                formatted.append(f"{line}: {next_l}")
                i += 1
            else:
                formatted.append(line)
        else:
            formatted.append(line)
        i += 1
    return "\n".join(formatted) if formatted else None


TARGET_COMPANIES = ["nutanix", "lseg"]

def main():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

    for target in TARGET_COMPANIES:
        cur.execute("SELECT id, name, ctc, stipend FROM companies WHERE LOWER(name) LIKE %s", (f"%{target}%",))
        companies = cur.fetchall()
        for comp in companies:
            comp_id = comp["id"]
            comp_name = comp["name"]
            print(f"\n--- {comp_name} ---")

            cur.execute(
                """
                SELECT payload->>'body' as body FROM raw_ingestion_jobs
                WHERE payload::text ILIKE %s
                ORDER BY created_at DESC LIMIT 1
                """,
                (f"%{target}%",),
            )
            job_row = cur.fetchone()
            body = job_row["body"] if job_row else None

            if not body:
                print("  No body found.")
                continue

            extracted_ctc = parse_compensation_text(body)
            if extracted_ctc:
                print("  Extracted CTC:\n" + extracted_ctc)
                cur.execute("UPDATE companies SET ctc = %s WHERE id = %s", (extracted_ctc, str(comp_id)))
                print("  ✓ Updated in DB")

    conn.commit()
    cur.close()
    conn.close()

if __name__ == "__main__":
    main()
