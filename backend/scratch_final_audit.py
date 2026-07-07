"""
Final state audit - all 5 companies and their timeline milestones
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from app.core.database import SessionLocal
from app.models.models import Company, CompanyEvent

db = SessionLocal()

print("=" * 70)
print("FINAL STATUS - ALL COMPANIES (newest first)")
print("=" * 70)
companies = db.query(Company).order_by(Company.created_at.desc()).all()
for c in companies:
    events = db.query(CompanyEvent).filter(
        CompanyEvent.company_id == c.id
    ).order_by(CompanyEvent.sequence.nulls_last(), CompanyEvent.date).all()
    print(f"\n{'=' * 50}")
    print(f"COMPANY: {c.name}")
    print(f"  Role: {c.role}")
    print(f"  Category: {c.category}")
    print(f"  Created: {c.created_at}")
    print(f"  Timeline ({len(events)} events):")
    for ev in events:
        pm = ev.parsed_metadata or {}
        date_str = ev.date.strftime('%d %b %Y %H:%M UTC') if ev.date else 'TBD'
        print(f"    [{ev.sequence}] {(ev.stage or 'UNKNOWN'):25} {date_str:25} {pm.get('label','')}")

print("\n" + "=" * 70)
db.close()
