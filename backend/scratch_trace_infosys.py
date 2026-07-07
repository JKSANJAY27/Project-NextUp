import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob
from app.services.email_parser import parse_with_ai_gateway, ground_company_in_source, ground_role_facts_in_source

db = SessionLocal()
all_jobs = db.query(RawIngestionJob).all()
for j in all_jobs:
    if j.payload and 'infosys' in j.payload.get('subject', '').lower():
        print(f"=== TESTING JOB {j.id} ===")
        subject = j.payload.get('subject')
        body = j.payload.get('body')
        
        # 1. AI Parse
        context_text = f"Subject: {subject}\n\nBody:\n{body}"
        parsed = parse_with_ai_gateway(context_text)
        print("AI output company:", parsed.get("extracted_data", {}).get("company", {}).get("value"))
        
        # 2. Grounding Company
        grounded_company = ground_company_in_source(parsed, subject, body)
        print("Grounded company:", grounded_company.get("extracted_data", {}).get("company", {}).get("value"))
        
        # 3. Grounding Roles
        grounded_roles = ground_role_facts_in_source(grounded_company, body)
        print("Grounded roles company:", grounded_roles.get("extracted_data", {}).get("company", {}).get("value"))
        print()
db.close()
