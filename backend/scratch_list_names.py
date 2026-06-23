import sys
import os
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal
from app.models.models import Company

db = SessionLocal()
try:
    companies = db.query(Company).all()
    print(f"Found {len(companies)} companies:")
    for c in companies:
        print(f"- {c.name!r} (ID: {c.id})")
finally:
    db.close()
