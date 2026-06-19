import os
import sys
import json
from dotenv import load_dotenv

# Load env vars
load_dotenv()

# Add parent path to import app modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob
from app.services.email_parser import parse_placement_email

def main():
    db = SessionLocal()
    try:
        # Get one job with a non-empty body
        job = db.query(RawIngestionJob).filter(RawIngestionJob.status == 'pending').first()
        if not job:
            # Try completed jobs
            job = db.query(RawIngestionJob).first()
            
        if not job:
            print("No jobs found in database.")
            return
            
        print(f"Testing with Job ID: {job.id}")
        subject = job.payload.get("subject", "No Subject")
        body = job.payload.get("body", "")
        print(f"Subject: {subject}")
        print("-" * 50)
        
        print("Calling parse_placement_email...")
        parsed = parse_placement_email(body, subject)
        
        print("\nParsed Output:")
        print(json.dumps(parsed, indent=2))
        
    except Exception as e:
        print(f"Error: {str(e)}")
    finally:
        db.close()

if __name__ == '__main__':
    main()
