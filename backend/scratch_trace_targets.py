import psycopg2
from app.core.config import settings
import json

conn = psycopg2.connect(settings.DATABASE_URL)
cur = conn.cursor()

print("=================== RAW INGESTION JOBS FOR TARGETS ===================")
cur.execute("""
SELECT id, status, payload->>'email_subject', parsed_output, validated_output, error_message, created_at
FROM raw_ingestion_jobs
WHERE payload::text ILIKE '%valco%'
   OR payload::text ILIKE '%apple%'
   OR payload::text ILIKE '%colgate%'
   OR payload::text ILIKE '%tredence%'
   OR payload::text ILIKE '%major%'
   OR payload::text ILIKE '%lpa%'
ORDER BY created_at DESC;
""")

rows = cur.fetchall()
for r in rows:
    print(f"\nID: {r[0]}")
    print(f"Status: {r[1]}")
    print(f"Subject: {r[2]}")
    print(f"Error: {r[5]}")
    print(f"Created: {r[6]}")
    if r[3]:
        ext = r[3].get('extracted_data', {})
        print(f"Parsed Company: {ext.get('company')}")
        print(f"Parsed Category: {r[3].get('email_category')}")
        print(f"Parsed Event: {ext.get('event_type')}")
        print(f"Parsed Roles: {ext.get('roles')}")
    else:
        print("Parsed Output: None")
