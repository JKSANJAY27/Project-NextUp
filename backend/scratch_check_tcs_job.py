import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob

db = SessionLocal()
job = db.query(RawIngestionJob).filter(RawIngestionJob.id == '7c4b0049-721b-4f3c-9162-2b3788ec4ddc').first()

if job:
    payload = job.payload or {}
    print(f"ID: {job.id}")
    print(f"Status: {job.status}")
    print(f"Subject: {payload.get('subject')}")
    print(f"Body: {payload.get('body')[:500]}")
else:
    print("Job not found")

db.close()
