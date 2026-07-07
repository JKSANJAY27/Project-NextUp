import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob

db = SessionLocal()
job = db.query(RawIngestionJob).filter(RawIngestionJob.id == '02f33bac-7079-4042-9f51-6e96f1f327d1').first()

if job:
    payload = job.payload or {}
    body = payload.get("body", "")
    subject = payload.get("subject", "")
    attachments = payload.get("attachments", [])
    print(f"Subject: {subject}")
    print(f"Body length: {len(body)}")
    print(f"Attachments count: {len(attachments)}")
    for i, att in enumerate(attachments):
        print(f"  Attachment {i}: name='{att.get('filename')}' size={len(att.get('base64_data', ''))}")
else:
    print("Job not found")

db.close()
