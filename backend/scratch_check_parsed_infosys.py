import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob
import json

db = SessionLocal()
job = db.query(RawIngestionJob).filter(RawIngestionJob.id == 'b70a501a-34f4-4404-acdf-67d5b739e697').first()

if job:
    print("=== job.parsed_output ===")
    print(json.dumps(job.parsed_output, indent=2))
    print("=========================")
else:
    print("Job not found")

db.close()
