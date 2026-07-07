import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from app.core.database import SessionLocal
from app.models.models import Company

db = SessionLocal()
companies = db.query(Company).order_by(Company.name).all()
print(f"\n=== ALL COMPANIES IN DB ({len(companies)}) ===")
for c in companies:
    print(f"  [{c.name}]")
    print(f"    Role:     {c.role}")
    print(f"    Category: {c.category}")
    print(f"    JD:       {bool(c.jd_analysis)}")
    print(f"    Strategy: {bool(c.jd_strategy)}")
    print(f"    Events:   {len(c.events)} timeline entries")
    print()
db.close()
