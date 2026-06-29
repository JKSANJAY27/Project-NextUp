import pytest
import json
import sqlite3
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from datetime import datetime
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.types import ARRAY as GENERIC_ARRAY
from sqlalchemy.dialects.postgresql import ARRAY as PG_ARRAY

# Register sqlite list adapter so lists can be bound to TEXT columns in SQLite
sqlite3.register_adapter(list, json.dumps)

@compiles(GENERIC_ARRAY, "sqlite")
@compiles(PG_ARRAY, "sqlite")
def compile_array_sqlite(type_, compiler, **kw):
    return "TEXT"

from app.models.models import Base, Company, CompanyEvent, RawIngestionJob, PendingCompanyEvent, IngestionExecutionLog
from app.services.gmail_sync import log_execution_stage, extract_event_metadata, clean_company_name_key
from app.services.validator import normalize_role_name

# Setup in-memory SQLite database for testing
TEST_DATABASE_URL = "sqlite:///:memory:"

@pytest.fixture(name="db_session")
def fixture_db_session():
    engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)

def test_company_jd_analysis_properties(db_session):
    # Test that the properties jd_required_skills, jd_preferred_skills, etc.
    # seamlessly read and write to the jd_analysis JSON column.
    company = Company(
        name="Test Corp",
        role="Frontend Engineer",
        category="Super Dream",
        fingerprint="test-fingerprint"
    )
    db_session.add(company)
    db_session.commit()

    # Initially empty/none
    assert company.jd_analysis == {} or company.jd_analysis is None
    assert company.jd_required_skills == []
    assert company.jd_preferred_skills == []
    assert company.jd_ats_keywords == []
    assert company.interview_topics == []

    # Assign values via setters
    company.jd_required_skills = ["React", "TypeScript"]
    company.jd_preferred_skills = ["GraphQL", "Next.js"]
    company.jd_ats_keywords = ["Frontend", "Engineer"]
    company.interview_topics = ["React Hooks", "CSS Flexbox"]

    db_session.commit()
    db_session.refresh(company)

    # Verify getters
    assert company.jd_required_skills == ["React", "TypeScript"]
    assert company.jd_preferred_skills == ["GraphQL", "Next.js"]
    assert company.jd_ats_keywords == ["Frontend", "Engineer"]
    assert company.interview_topics == ["React Hooks", "CSS Flexbox"]

    # Verify JSON structure
    assert company.jd_analysis["required_skills"] == ["React", "TypeScript"]
    assert company.jd_analysis["preferred_skills"] == ["GraphQL", "Next.js"]
    assert company.jd_analysis["ats_keywords"] == ["Frontend", "Engineer"]
    assert company.jd_analysis["interview_topics"] == ["React Hooks", "CSS Flexbox"]

def test_company_effective_deadline(db_session):
    # Test that effective_deadline defaults to registration_deadline
    # and overrides it if a newer event contains a deadline_iso in parsed_metadata.
    company = Company(
        name="Test Corp",
        role="Frontend Engineer",
        category="Super Dream",
        fingerprint="test-fingerprint",
        registration_deadline=datetime(2026, 6, 18, 20, 0)
    )
    db_session.add(company)
    db_session.commit()

    assert company.effective_deadline == datetime(2026, 6, 18, 20, 0)
    assert company.registration_deadline == datetime(2026, 6, 18, 20, 0)

    # Add a newer event with deadline override
    event1 = CompanyEvent(
        company_id=company.id,
        event_type="DEADLINE_EXTENSION",
        subject="Deadline Extended",
        timestamp=datetime(2026, 6, 15, 10, 0),
        parsed_metadata={"deadline_iso": "2026-06-20T20:00:00"}
    )
    db_session.add(event1)
    db_session.commit()

    db_session.refresh(company)
    assert company.effective_deadline == datetime(2026, 6, 20, 20, 0)
    # The property registration_deadline should also return the effective deadline
    assert company.registration_deadline == datetime(2026, 6, 20, 20, 0)

def test_extract_event_metadata():
    body = "Online Assessment is on Neopat. Link is meet.google.com/abc-defg-hij"
    subject = "Google OA"
    ext_data = {"deadline_iso": {"value": "2026-06-18T20:00:00"}}
    
    # Test OA platform detection
    meta_oa = extract_event_metadata(body, subject, "OA", ext_data)
    assert meta_oa["oa_platform"] == "NEOPAT"
    assert meta_oa["deadline_iso"] == "2026-06-18T20:00:00"

    # Test Google Meet link detection
    meta_interview = extract_event_metadata(body, subject, "INTERVIEW", ext_data)
    assert meta_interview["interview_platform"] == "GOOGLE_MEET"
    assert meta_interview["meeting_link"] == "https://meet.google.com/abc-defg-hij"

def test_ingestion_execution_logs(db_session):
    job = RawIngestionJob(
        payload={"subject": "Test"},
        status="pending"
    )
    db_session.add(job)
    db_session.commit()

    log_execution_stage(db_session, job.id, "INGESTED", "SUCCESS", "Job ingested.")
    log_execution_stage(db_session, job.id, "PARSED", "SUCCESS")

    logs = db_session.query(IngestionExecutionLog).filter(IngestionExecutionLog.job_id == job.id).order_by(IngestionExecutionLog.timestamp.asc()).all()
    assert len(logs) == 2
    assert logs[0].stage == "INGESTED"
    assert logs[0].status == "SUCCESS"
    assert logs[0].message == "Job ingested."
    assert logs[1].stage == "PARSED"
    assert logs[1].status == "SUCCESS"
