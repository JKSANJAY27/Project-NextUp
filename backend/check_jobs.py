import sys
import os
import json

if sys.platform.startswith('win'):
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob

db = SessionLocal()
jobs = db.query(RawIngestionJob).all()
for j in jobs:
    payload = j.payload or {}
    sender = payload.get("sender", "")
    if "helpdesk" in sender.lower() or "23bce" in sender.lower():
        print(f"ID: {j.id}")
        print("Payload JSON:")
        print(json.dumps(payload, indent=2))
        print("=" * 80)
        break
db.close()
