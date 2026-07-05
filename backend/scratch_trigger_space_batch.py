import os
import sys
import requests
import time
from dotenv import load_dotenv
from sqlalchemy import text

# Load env vars
load_dotenv()

# Add parent path to import app modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal

def main():
    db = SessionLocal()
    try:
        print("=== STEP 1: CLEANING UP EXISTING TABLES ===")
        tables_to_clear = [
            "ingestion_execution_logs",
            "notifications",
            "notification_jobs",
            "ingestion_audit_logs",
            "attachments_metadata",
            "announcements",
            "company_events",
            "company_change_logs",
            "applications",
            "pending_company_events",
            "companies"
        ]
        
        for table in tables_to_clear:
            try:
                print(f"Clearing table '{table}'...")
                db.execute(text(f"DELETE FROM {table}"))
                db.commit()
            except Exception as ex:
                db.rollback()
                print(f"Warning / Error clearing {table}: {str(ex)}")
        
        print("\n=== STEP 2: RESETTING JOBS TO PENDING ===")
        result = db.execute(text("""
            UPDATE raw_ingestion_jobs 
            SET status = 'pending', 
                parsed_output = NULL, 
                validated_output = NULL, 
                locked_at = NULL, 
                locked_by = NULL, 
                error_message = NULL, 
                processed_at = NULL, 
                retry_count = 0
        """))
        db.commit()
        total_jobs = result.rowcount
        print(f"Successfully reset {total_jobs} raw ingestion jobs back to 'pending'.")
        
        print("\n=== STEP 3: TRIGGERING BACKGROUND BATCH REPROCESSING ===")
        reprocess_url = "https://sanjayjk-nextup.hf.space/api/v1/gmail/reprocess_all"
        
        try:
            print("Sending trigger request...")
            resp = requests.post(reprocess_url, timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                print(f"Success! Space responded: {data}")
                print("\nThe batch reprocessing is now running inside the Hugging Face Space in the background.")
                print("You can watch the logs directly on Hugging Face Spaces as it parses your emails!")
            else:
                print(f"Error triggering background run (HTTP {resp.status_code}): {resp.text}")
        except Exception as e:
            print(f"Connection failed: {e}")
            
    finally:
        db.close()

if __name__ == '__main__':
    main()
