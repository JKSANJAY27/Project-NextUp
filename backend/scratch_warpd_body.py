import os, sys
from dotenv import load_dotenv
load_dotenv()
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
if sys.platform.startswith('win'):
    sys.stdout.reconfigure(encoding='utf-8')

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob

db = SessionLocal()

# Get the WarpDrive registration job
job = db.query(RawIngestionJob).filter(
    RawIngestionJob.id == '0e35a1a6-74f3-43c8-b7f1-6b33cf33a7b0'
).first()

if job:
    body = job.payload.get('body', '')
    print("=== EMAIL BODY ===")
    print(body[:5000])
    print("\n=== PARSED OUTPUT (raw) ===")
    import json
    if job.parsed_output:
        print(json.dumps(job.parsed_output, indent=2)[:3000])

db.close()
