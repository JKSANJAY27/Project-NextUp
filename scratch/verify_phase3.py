import os
import sys
import sqlite3
import json
from datetime import datetime, timedelta

# Add backend directory to sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, backend_dir)

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.dialects.postgresql import ARRAY
from app.core.database import Base
from app.models.models import User, Company, CompanyEvent, Application, StudentProfile
from app.services.priority_scorer import calculate_priority_score
from app.services.stale_detector import is_application_stale

# Support lists in SQLite
sqlite3.register_adapter(list, lambda l: json.dumps(l))

@compiles(ARRAY, "sqlite")
def compile_array_sqlite(element, compiler, **kw):
    return "TEXT"

TEST_DB_URL = "sqlite:///./test_phase3.db"
if os.path.exists("./test_phase3.db"):
    os.remove("./test_phase3.db")

engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create tables
Base.metadata.create_all(bind=engine)

def run_tests():
    db = TestingSessionLocal()
    try:
        print("--- Start Phase 3 Priority Scoring & Stale Detection Verification ---")
        
        # Setup test user
        user = User(email="test3@vit.edu", role="student")
        db.add(user)
        db.flush()
        
        # 1. Test Stage Weights
        company1 = Company(name="Co1", role="SWE", category="Dream", fingerprint="fp1")
        company2 = Company(name="Co2", role="QA", category="Dream", fingerprint="fp2")
        db.add_all([company1, company2])
        db.flush()
        
        five_days_ago = datetime.utcnow() - timedelta(days=5)
        app1 = Application(
            user_id=user.id, 
            company_id=company1.id, 
            recruitment_state="Interview", 
            status="Interview",
            applied_at=five_days_ago,
            last_user_activity_at=five_days_ago
        )
        app2 = Application(
            user_id=user.id, 
            company_id=company2.id, 
            recruitment_state="Registration", 
            status="Applied",
            applied_at=five_days_ago,
            last_user_activity_at=five_days_ago
        )
        db.add_all([app1, app2])
        db.flush()
        
        score1 = calculate_priority_score(app1, company1, [])
        score2 = calculate_priority_score(app2, company2, [])
        print(f"1. Stage Weights: Interview={score1}, Registration={score2}")
        assert score1 > score2, "Interview priority should be higher than Registration!"
        
        # 2. Test Pinned Override
        app2.workspace_priority_override = "pinned"
        db.add(app2)
        db.flush()
        score2_pinned = calculate_priority_score(app2, company2, [])
        print(f"2. Pinned Override: Pinned Registration={score2_pinned}, Unpinned Interview={score1}")
        assert score2_pinned > score1, "Pinned application must have higher priority than unpinned!"
        
        # 3. Test Deadline Weights
        # Reset pin
        app2.workspace_priority_override = None
        db.add(app2)
        
        # Set company1 deadline in 2 hours
        company1.registration_deadline = datetime.utcnow() + timedelta(hours=2)
        db.add(company1)
        db.flush()
        score1_deadline = calculate_priority_score(app1, company1, [])
        print(f"3. Deadline Weights: Close Deadline Interview={score1_deadline}, Standard Interview={score1}")
        assert score1_deadline > score1, "Closer deadline should increase priority!"
        
        # 4. Test Recent Update Weights
        # Add a recent event (last 2 hours)
        event = CompanyEvent(company_id=company2.id, event_type="OA", subject="Test OA", timestamp=datetime.utcnow() - timedelta(hours=2))
        db.add(event)
        db.flush()
        score2_recent = calculate_priority_score(app2, company2, [event])
        print(f"4. Recent Update: Recent Event={score2_recent}, Base Registration={score2}")
        assert score2_recent > score2, "Recent update should increase priority!"
        
        # 5. Test Focus Weights
        app2.workspace_priority_override = "focus"
        db.add(app2)
        db.flush()
        score2_focus = calculate_priority_score(app2, company2, [event])
        print(f"5. Focus Weight: Focus Company={score2_focus}, Non-focus={score2_recent}")
        assert score2_focus > score2_recent, "Focus override should increase priority!"
        
        # 6. Test Stale Detection
        # Clean test stale check
        stale_company = Company(name="StaleCo", role="QA", category="Dream", fingerprint="fp_stale")
        db.add(stale_company)
        db.flush()
        
        # App applied 35 days ago, last user activity 35 days ago, no events
        stale_app = Application(
            user_id=user.id,
            company_id=stale_company.id,
            status="Applied",
            recruitment_state="Awaiting Shortlist",
            applied_at=datetime.utcnow() - timedelta(days=35),
            last_user_activity_at=datetime.utcnow() - timedelta(days=35)
        )
        db.add(stale_app)
        db.flush()
        
        # Active application is NOT stale (activity today)
        active_company = Company(name="ActiveCo", role="QA", category="Dream", fingerprint="fp_active")
        db.add(active_company)
        db.flush()
        
        active_app = Application(
            user_id=user.id,
            company_id=active_company.id,
            status="Applied",
            recruitment_state="Awaiting Shortlist",
            applied_at=datetime.utcnow() - timedelta(days=35),
            last_user_activity_at=datetime.utcnow() # updated today
        )
        db.add(active_app)
        db.flush()
        
        db.refresh(stale_app)
        db.refresh(active_app)
        
        is_stale_1 = is_application_stale(stale_app)
        is_stale_2 = is_application_stale(active_app)
        
        print(f"6. Stale Detection: Stale Application={is_stale_1}, Active Application={is_stale_2}")
        assert is_stale_1 is True, "Application with no activity for 35 days should be stale!"
        assert is_stale_2 is False, "Application with recent activity should NOT be stale!"
        
        # Terminal state check: Stale should not apply to Offer
        stale_app.status = "Offer"
        stale_app.recruitment_state = "Offer"
        db.add(stale_app)
        db.flush()
        is_stale_terminal = is_application_stale(stale_app)
        print(f"   Terminal State check (Offer): is_stale={is_stale_terminal}")
        assert is_stale_terminal is False, "Terminal states like Offer should not be flagged as stale!"
        
        print("--- All Phase 3 Priority Scoring & Stale Detection Tests Passed! ---")
        
    finally:
        db.close()
        engine.dispose()
        if os.path.exists("./test_phase3.db"):
            try:
                os.remove("./test_phase3.db")
            except Exception as e:
                print(f"Warning: could not remove test DB: {e}")

if __name__ == "__main__":
    run_tests()
