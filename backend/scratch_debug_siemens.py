import sys
import os
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob

db = SessionLocal()
try:
    j = db.query(RawIngestionJob).filter(RawIngestionJob.id == "1d1ce441-863a-4f59-9786-dd1a50d97a82").first()
    if j:
        print("=== Siemens Job ===")
        print(f"Subject: {j.payload.get('subject')!r}")
        print("Body (first 500 chars):")
        print(repr(j.payload.get('body')[:500]))
    else:
        print("Job not found!")
finally:
    db.close()
