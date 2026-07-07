import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from app.core.database import SessionLocal
from sqlalchemy import text

db = SessionLocal()
res = db.execute(text("""
    SELECT column_name, data_type, character_maximum_length 
    FROM information_schema.columns 
    WHERE table_name = 'companies';
""")).fetchall()

print("=== companies columns ===")
for r in res:
    print(r)

res2 = db.execute(text("""
    SELECT column_name, data_type, character_maximum_length 
    FROM information_schema.columns 
    WHERE table_name = 'company_events';
""")).fetchall()

print("\n=== company_events columns ===")
for r in res2:
    print(r)

db.close()
