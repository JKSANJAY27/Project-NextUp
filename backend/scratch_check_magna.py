import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob

db = SessionLocal()
all_jobs = db.query(RawIngestionJob).all()
for j in all_jobs:
    if j.payload and 'magna' in str(j.payload).lower():
        print(f"[{j.created_at}] status={j.status} | subject={j.payload.get('subject')}")
db.close()
