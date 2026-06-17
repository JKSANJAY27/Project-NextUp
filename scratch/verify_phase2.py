import os
import sys
import shutil
from datetime import datetime, timedelta

# Add backend directory to sys.path so we can import app modules
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, backend_dir)

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.database import Base
from app.models.models import (
    User, StudentProfile, Company, CompanyEvent, Application, IngestionSource, RawIngestionJob
)
from app.services.gmail_sync import process_queued_jobs
from app.core.security import generate_blind_index
from app.schemas.schemas import ApplicationCreate, ApplicationUpdate
from app.api.applications import create_application, update_application

import sqlite3
import json
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.dialects.postgresql import ARRAY

# Register adapter for lists to support ARRAY column binding in SQLite tests
sqlite3.register_adapter(list, lambda l: json.dumps(l))

@compiles(ARRAY, "sqlite")
def compile_array_sqlite(element, compiler, **kw):
    return "TEXT"

# Initialize a clean test SQLite database
TEST_DB_URL = "sqlite:///./test_phase2.db"
if os.path.exists("./test_phase2.db"):
    os.remove("./test_phase2.db")

engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create tables
Base.metadata.create_all(bind=engine)

def run_tests():
    db = TestingSessionLocal()
    try:
        print("--- Start Phase 2 Ingestion & State Logic Verification ---")
        
        # 1. Setup mock user and student profile
        pepper = "testpepper123"
        user = User(email="sanjay@vit.edu", role="student")
        db.add(user)
        db.flush()
        
        # Neo ID: S1D2F3G4
        neo_id = "S1D2F3G4"
        neo_id_hash = generate_blind_index(neo_id, pepper)
        
        profile = StudentProfile(
            user_id=user.id,
            full_name="Sanjay",
            branch="CSE",
            batch_year=2026,
            neo_id_enc="encrypted_neo_id",
            neo_id_hash=neo_id_hash,
            cgpa=9.1,
            tenth_marks=95.0,
            twelfth_marks=94.0,
            has_arrears=False,
            skills=["Python", "React", "FastAPI"]
        )
        db.add(profile)
        db.commit()
        print(f"1. Created test student. Neo ID Hash: {neo_id_hash[:10]}...")
        
        # 2. Setup ingestion source
        source = IngestionSource(
            source_name="CDC Mail",
            department="Placement Office",
            email="cdc@vit.ac.in"
        )
        db.add(source)
        db.commit()
        
        # 3. Simulate first email ingestion: REGISTRATION event
        # This will create the Company: NOKIA
        email1_payload = {
            "message_id": "msg1",
            "sender": "cdc@vit.ac.in",
            "subject": "Nokia Registration Open for 2026 Batch",
            "body": "Company Name: Nokia Solutions\nRole: Software Engineer\nCategory: Dream\nCTC: 12 LPA\nLast Date to Apply: 2026-06-30\nEligible Branches: CSE, IT\nmin CGPA of 8.0\nNo Standing Arrears",
            "timestamp": datetime.utcnow().isoformat(),
            "attachments": []
        }
        
        job1 = RawIngestionJob(
            source_id=source.id,
            status="pending",
            payload=email1_payload
        )
        db.add(job1)
        db.commit()
        
        # Process jobs
        print("2. Processing REGISTRATION email job...")
        # Override pepper settings for testing
        from app.core.config import settings
        settings.PEPPER = pepper
        settings.DATABASE_URL = TEST_DB_URL # make sure settings points to test db
        
        process_queued_jobs(db, job_id=str(job1.id))
        
        # Verify Nokia company was created
        company = db.query(Company).filter(Company.name.ilike("%Nokia%")).first()
        assert company is not None, "Company Nokia not created!"
        print(f"   Success: Company created. Name={company.name}, Role={company.role}, Cycle={company.recruitment_cycle}")
        
        # Check event
        event1 = db.query(CompanyEvent).filter(CompanyEvent.company_id == company.id).first()
        assert event1 is not None and event1.event_type == 'REGISTRATION'
        print("   Success: REGISTRATION event inserted.")
        
        # 4. Student tracks company: Create Application
        # Simulate create_application endpoint logic
        app_create = ApplicationCreate(
            company_id=company.id,
            status="Applied",
            current_round="Registration"
        )
        
        app = create_application(app_create, db, user)
        assert app.recruitment_state == "Awaiting Shortlist", "Recruitment state should default to Awaiting Shortlist for status Applied!"
        assert app.user_decision == "tracking", "User decision should default to tracking when creating tracker!"
        print(f"3. Student created tracker. Status={app.status}, recruitment_state={app.recruitment_state}, user_decision={app.user_decision}")
        
        # 5. Ingest follow-up email: OA scheduled
        # Test fuzzy matching: company_name in email is "Nokia" (without Solutions), role is SW Engineer.
        email2_payload = {
            "message_id": "msg2",
            "sender": "cdc@vit.ac.in",
            "subject": "Nokia OA Schedule Update",
            "body": "Hi students, Nokia online test is scheduled for tomorrow at 7 PM.",
            "timestamp": (datetime.utcnow() + timedelta(days=1)).isoformat(), # Future event
            "attachments": []
        }
        
        job2 = RawIngestionJob(
            source_id=source.id,
            status="pending",
            payload=email2_payload
        )
        db.add(job2)
        db.commit()
        
        print("4. Ingesting OA update email (testing fuzzy company match & state transitions)...")
        process_queued_jobs(db, job_id=str(job2.id))
        
        # Verify event was mapped to the SAME Nokia company
        events = db.query(CompanyEvent).filter(CompanyEvent.company_id == company.id).all()
        assert len(events) == 2, f"Should have 2 events mapped to company. Found: {len(events)}"
        print("   Success: Fuzzy company match works. Follow-up email mapped to same workspace timeline.")
        
        # Verify student application recruitment_state transitioned to OA
        db.refresh(app)
        assert app.recruitment_state == "OA", f"Recruitment state should transition to OA, got: {app.recruitment_state}"
        print(f"   Success: Application recruitment_state transitioned: {app.recruitment_state}, status={app.status}")
        
        # 6. Test Rule of State Isolation: Student archives application
        # When user_decision is archived, recruitment_state must remain OA!
        print("5. Testing State Isolation: Student archives application...")
        app_update = ApplicationUpdate(user_decision="archived")
        app = update_application(app.id, app_update, db, user)
        assert app.user_decision == "archived", "User decision should be archived"
        assert app.recruitment_state == "OA", f"Recruitment state should still be OA! got: {app.recruitment_state}"
        print(f"   Success: State Isolation holds. user_decision={app.user_decision}, recruitment_state={app.recruitment_state}")
        
        # 7. Ingest shortlist email with EXCEL attachment including student's Neo ID
        # Since Excel parsing relies on openpyxl, let's mock/simulate the Excel attachment.
        # Wait, the gmail_sync parses filename.endswith(".xls", ".xlsx") by calling extract_neo_ids_from_excel.
        # Let's mock extract_neo_ids_from_excel to return our student's Neo ID.
        import app.services.gmail_sync as gs
        original_extract = gs.extract_neo_ids_from_excel
        gs.extract_neo_ids_from_excel = lambda content: [neo_id]
        
        # Make user active again for test
        app.status = "Applied"
        app.recruitment_state = "Awaiting Shortlist"
        db.add(app)
        db.commit()
        
        email3_payload = {
            "message_id": "msg3",
            "sender": "cdc@vit.ac.in",
            "subject": "Nokia Shortlist Released",
            "body": "Nokia has released shortlist for the next round. See attached file.",
            "timestamp": datetime.utcnow().isoformat(),
            "attachments": [
                {
                    "filename": "nokia_shortlist.xlsx",
                    "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "base64_data": "ZHVtbXk=" # Base64 for "dummy"
                }
            ]
        }
        
        job3 = RawIngestionJob(
            source_id=source.id,
            status="pending",
            payload=email3_payload
        )
        db.add(job3)
        db.commit()
        
        print("6. Ingesting Shortlist Excel containing student Neo ID...")
        process_queued_jobs(db, job_id=str(job3.id))
        
        db.refresh(app)
        assert app.status == "Shortlisted", f"Student status should be Shortlisted, got: {app.status}"
        assert app.recruitment_state == "Shortlisted", f"recruitment_state should be Shortlisted, got: {app.recruitment_state}"
        print(f"   Success: Student is shortlisted. Status={app.status}, recruitment_state={app.recruitment_state}")
        
        # 8. Ingest shortlist email WITHOUT student's Neo ID (Auto Off-ramp / Likely Rejected logic)
        # Mock extract_neo_ids_from_excel to NOT return student's Neo ID (e.g. returns other ID)
        gs.extract_neo_ids_from_excel = lambda content: ["OTHER123"]
        
        # Reset student status to Applied/OA for test
        app.status = "Applied"
        app.recruitment_state = "Awaiting Shortlist"
        db.add(app)
        db.commit()
        
        email4_payload = {
            "message_id": "msg4",
            "sender": "cdc@vit.ac.in",
            "subject": "Nokia Second Shortlist Released",
            "body": "Second shortlist for interview. See attached.",
            "timestamp": datetime.utcnow().isoformat(),
            "attachments": [
                {
                    "filename": "nokia_interview_shortlist.xlsx",
                    "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "base64_data": "ZHVtbXk="
                }
            ]
        }
        
        job4 = RawIngestionJob(
            source_id=source.id,
            status="pending",
            payload=email4_payload
        )
        db.add(job4)
        db.commit()
        
        print("7. Ingesting Shortlist Excel NOT containing student Neo ID (Likely Rejected test)...")
        process_queued_jobs(db, job_id=str(job4.id))
        
        db.refresh(app)
        assert app.status == "Likely Rejected", f"Student status should be Likely Rejected, got: {app.status}"
        # recruitment_state should NOT be rejected, since it's just 'Likely' Rejected, it should remain Awaiting Shortlist / Shortlisted
        # Let's verify State Isolation: user_decision should still be archived
        assert app.user_decision == "archived", f"user_decision should remain archived, got: {app.user_decision}"
        print(f"   Success: Mismatched student marked as Likely Rejected. Status={app.status}, user_decision={app.user_decision}")
        
        # Cleanup mock
        gs.extract_neo_ids_from_excel = original_extract
        
        print("--- All Phase 2 Ingestion & State Logic Tests Passed! ---")
        
    finally:
        db.close()
        # Dispose engine to close all active connections/locks on the database file
        engine.dispose()
        # Clean up database file
        if os.path.exists("./test_phase2.db"):
            try:
                os.remove("./test_phase2.db")
            except Exception as e:
                print(f"Warning: could not remove test DB file: {e}")

if __name__ == "__main__":
    run_tests()
