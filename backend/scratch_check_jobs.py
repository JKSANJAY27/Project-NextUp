import os
import sys
from dotenv import load_dotenv

# Load env vars
load_dotenv()

# Add parent path to import app modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal
from app.models.models import RawIngestionJob, Company, CompanyEvent

def main():
    db = SessionLocal()
    try:
        job_count = db.query(RawIngestionJob).count()
        pending_count = db.query(RawIngestionJob).filter(RawIngestionJob.status == 'pending').count()
        processing_count = db.query(RawIngestionJob).filter(RawIngestionJob.status == 'processing').count()
        completed_count = db.query(RawIngestionJob).filter(RawIngestionJob.status == 'completed').count()
        failed_count = db.query(RawIngestionJob).filter(RawIngestionJob.status == 'failed').count()
        
        company_count = db.query(Company).count()
        event_count = db.query(CompanyEvent).count()
        
        print("=== DATABASE STATUS ===")
        print(f"Total Raw Ingestion Jobs: {job_count}")
        print(f" - Pending: {pending_count}")
        print(f" - Processing: {processing_count}")
        print(f" - Completed: {completed_count}")
        print(f" - Failed: {failed_count}")
        print(f"Total Companies: {company_count}")
        print(f"Total Company Events: {event_count}")
        
    except Exception as e:
        print(f"Error querying database: {str(e)}")
    finally:
        db.close()

if __name__ == '__main__':
    main()
