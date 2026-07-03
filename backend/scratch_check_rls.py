import os
import sys
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()
db_url = os.getenv("DATABASE_URL")
if not db_url:
    print("No DATABASE_URL")
    sys.exit(1)

engine = create_engine(db_url)
try:
    with engine.connect() as conn:
        result = conn.execute(text("SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;"))
        for row in result:
            print(f"Table: {row[0]}, RLS Enabled: {row[1]}")
except Exception as e:
    print("Error:", e)
