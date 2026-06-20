import sys
sys.stdout.reconfigure(encoding='utf-8')

from app.core.database import SessionLocal
from app.models.models import NotificationJob

db = SessionLocal()
try:
    print("--- Notification Jobs ---")
    jobs = db.query(NotificationJob).all()
    for j in jobs:
        print(f"Job ID: {j.id}, Event ID: {j.company_event_id}, Status: {j.status}, Created: {j.created_at}, Processed: {j.processed_at}")
finally:
    db.close()
