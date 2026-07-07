import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob
from app.services.ai_provider import get_parser_gateway
from app.services.email_parser import get_parser_prompt

db = SessionLocal()
job = db.query(RawIngestionJob).filter(RawIngestionJob.id == 'b70a501a-34f4-4404-acdf-67d5b739e697').first()

if job:
    subject = job.payload.get('subject')
    body = job.payload.get('body')
    context_text = f"Subject: {subject}\n\nBody:\n{body}"
    prompt = get_parser_prompt(context_text)
    
    gateway = get_parser_gateway()
    result = gateway.generate(
        prompt,
        system="You are a structured data extractor. Output only valid JSON. No markdown.",
        max_tokens=800,
        temperature=0.1,
        json_mode=True,
        purpose="email_parser",
    )
    print("=== RAW MODEL RESPONSE ===")
    print(result.text)
    print("==========================")
else:
    print("Job not found")

db.close()
