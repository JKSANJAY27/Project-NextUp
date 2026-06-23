import sys
import os
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob
from app.services.email_parser import extract_placements_regex

db = SessionLocal()
try:
    j = db.query(RawIngestionJob).filter(RawIngestionJob.id == "2ec64bf6-bea7-4117-a5b0-af290dcb1daf").first()
    if j:
        print("=== Murf Job ===")
        print(f"Subject: {j.payload.get('subject')!r}")
        print("Body (first 1000 chars):")
        print(repr(j.payload.get('body')[:1000]))
        print("\nRegex parser output:")
        print(extract_placements_regex(j.payload.get('body'), j.payload.get('subject')))
    else:
        print("Job not found!")
finally:
    db.close()
