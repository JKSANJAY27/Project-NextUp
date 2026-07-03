import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()

db_url = os.getenv("DATABASE_URL")
if not db_url:
    print("DATABASE_URL not found in .env")
    exit(1)

try:
    print("Attempting to connect to Supabase database...")
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    cur.execute("SELECT 1;")
    res = cur.fetchone()[0]
    print(f"Connection Successful! Test query returned: {res}")
    cur.close()
    conn.close()
except Exception as e:
    print(f"Connection failed: {e}")
