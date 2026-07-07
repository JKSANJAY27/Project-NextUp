import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from app.core.database import SessionLocal
from app.models.models import Company, CompanyEvent

db = SessionLocal()
companies = db.query(Company).order_by(Company.name).all()

for c in companies:
    print(f"\n[{c.name}] - {c.role} ({c.category})")
    print(f"  ID: {c.id}")
    events = db.query(CompanyEvent).filter(CompanyEvent.company_id == c.id).order_by(CompanyEvent.sequence).all()
    for ev in events:
        print(f"  Event: [{ev.stage}] {ev.label} | seq={ev.sequence}")
db.close()
