import psycopg2
from app.core.config import settings
from app.services.email_parser import extract_placements_regex, extract_company_from_subject, _authoritative_company_from_subject, is_generic_company_name, get_nlp

conn = psycopg2.connect(settings.DATABASE_URL)
cur = conn.cursor()

cur.execute("""
SELECT id, payload->>'subject', payload->>'body', parsed_output
FROM raw_ingestion_jobs
WHERE id IN (
    '854372f0-ab23-471f-81fd-6a40f212a395',
    '2cb23896-5f34-4f81-8572-6fd2a5a1b21c',
    'c7003589-8fb0-41e5-b13f-1f948a68a395',
    'e629ff67-1435-490c-af2e-c5cd1c51dd3a',
    'ec3ae49a-aae3-4bf4-83c7-82c5767559d1',
    '03ff3575-dc90-4ebe-84b5-7df78f67c4d9',
    '1cfa16d7-414f-40e5-a9e9-43dcb8e61262'
);
""")

rows = cur.fetchall()

for r in rows:
    job_id, subject, body, parsed_out = r
    print(f"\n====================== Job {job_id} ======================", flush=True)
    print(f"Subject: {subject}", flush=True)
    print("Subject auth extraction:", _authoritative_company_from_subject(subject), flush=True)
    print("Subject general extraction:", extract_company_from_subject(subject), flush=True)
    print("is_generic on subject extraction:", is_generic_company_name(extract_company_from_subject(subject)), flush=True)
    
    parsed_comp = parsed_out.get("extracted_data", {}).get("company") if parsed_out else None
    print(f"Stored Parsed Company: {parsed_comp}", flush=True)
    
    regex_res = extract_placements_regex(body or "", subject or "")
    print("extract_placements_regex result company:", regex_res.get("company"), flush=True)



