import psycopg2
from app.core.config import settings

conn = psycopg2.connect(settings.DATABASE_URL)
cur = conn.cursor()

cur.execute("SELECT id, name, created_at FROM companies WHERE name ILIKE '%tredence%';")
print("Tredence companies:", cur.fetchall())

cur.execute("SELECT id, subject, company_id FROM company_events WHERE subject ILIKE '%tredence%';")
print("Tredence events:", cur.fetchall())
cur.execute("SELECT id, name FROM companies WHERE id='414e1900-0a51-4158-aa00-372450fa4ffb';")
print("Company 414e...:", cur.fetchall())



for cid in target_ids:
    cur.execute("SELECT id, name, role, ctc, stipend, created_at FROM companies WHERE id = %s;", (cid,))
    comp = cur.fetchone()
    print("\n==========================================")
    print("COMPANY:", comp)
    
    cur.execute("SELECT * FROM company_events WHERE company_id = %s;", (cid,))
    print("EVENTS:")
    for ev in cur.fetchall():
        print("  ", ev)
        
    cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'raw_ingestion_jobs';")
    cols = [c[0] for c in cur.fetchall()]
    print("Raw ingestion jobs columns:", cols)
    
    cur.execute("SELECT id, status, payload->>'email_subject', parsed_output->'extracted_data'->'company', final_classification, created_at FROM raw_ingestion_jobs WHERE payload::text ILIKE %s ORDER BY created_at ASC;", (f'%{cid}%',))
    print("RAW INGESTION JOBS:")
    for rj in cur.fetchall():
        print("  ", rj)





