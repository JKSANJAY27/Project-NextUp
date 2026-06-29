import os
import sys
import logging
from dotenv import load_dotenv
from sqlalchemy import text

# Load env vars
load_dotenv()

# Clear HF API token to bypass slow/depleted Hugging Face calls during batch reprocessing
os.environ["HF_API_TOKEN"] = ""
os.environ["SKIP_VIEW_REFRESH"] = "true"

# Add parent path to import app modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal
from app.services.gmail_sync import process_queued_jobs, refresh_materialized_views
from app.models.models import RawIngestionJob, Company, CompanyEvent

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("reprocess_all")

def main():
    if sys.platform.startswith('win'):
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
        
    db = SessionLocal()
    try:
        print("=== STEP 1: CLEANING UP EXISTING PARSED TABLES ===")
        # We delete from child tables first to respect foreign keys, or let postgres handle cascades.
        # But we do NOT delete from users or student_profiles, to keep user logins intact.
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
                print(f"Warning / Error clearing {table} (might be empty or missing): {str(ex)}")
        
        print("\n=== STEP 2: RESETTING RAW INGESTION JOBS TO PENDING ===")
        # We keep the raw email payloads, but reset all status flags
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
        print(f"Successfully reset {result.rowcount} raw ingestion jobs back to 'pending'.")
        
        print("\n=== STEP 3: RUNNING THE PARSER CHAIN ON ALL JOBS ===")
        total_jobs = db.query(RawIngestionJob).filter(RawIngestionJob.status == 'pending').count()
        print(f"Found {total_jobs} jobs to process. Beginning LLM parsing loop...")
        
        processed_count = 0
        failed_count = 0
        
        while True:
            # Query the next pending job ID to display its subject/details
            next_job = db.query(RawIngestionJob).filter(RawIngestionJob.status == 'pending').order_by(RawIngestionJob.created_at.asc()).first()
            if not next_job:
                break
                
            job_id = next_job.id
            subject = next_job.payload.get("subject", "No Subject")
            print(f"\nProcessing Job {processed_count + 1}/{total_jobs} (ID: {job_id})")
            print(f"Subject: {subject}")
            
            # Execute processing
            success = process_queued_jobs(db)
            
            if success:
                processed_count += 1
                # Check what company / event was created
                db.expire_all()
                job_ref = db.query(RawIngestionJob).filter(RawIngestionJob.id == job_id).first()
                val_out = job_ref.validated_output if job_ref else None
                if val_out and "extracted_data" in val_out:
                    ext = val_out["extracted_data"]
                    comp_name = ext.get("company", {}).get("value", "Unknown")
                    evt_type = ext.get("event_type", {}).get("value", "Unknown")
                    print(f"  [SUCCESS] Extracted Company: {comp_name} | Event: {evt_type}")
                else:
                    print("  [SUCCESS] Job completed, no validated output found.")
            else:
                failed_count += 1
                # Get the job error message
                db.expire_all()
                job_ref = db.query(RawIngestionJob).filter(RawIngestionJob.id == job_id).first()
                err_msg = job_ref.error_message if job_ref else "Unknown execution failure"
                print(f"  [FAILED] Reason: {err_msg}")
                
        print("\n=== REPROCESSING COMPLETE ===")
        print(f"Total Jobs Found: {total_jobs}")
        print(f"Successfully Reprocessed: {processed_count}")
        print(f"Failed: {failed_count}")
        
        print("\n=== STEP 4: REFRESHING MATERIALIZED VIEWS ===")
        os.environ["SKIP_VIEW_REFRESH"] = "false"
        refresh_materialized_views(db)
        print("Materialized views refreshed successfully.")
        
    except Exception as e:
        db.rollback()
        print(f"Fatal error during reprocessing: {str(e)}")
    finally:
        db.close()

if __name__ == '__main__':
    main()
