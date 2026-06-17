import os
import sys
import sqlite3
import json
from datetime import datetime

# Add backend directory to sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, backend_dir)

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.dialects.postgresql import ARRAY
from app.core.database import Base
from app.models.models import User, Company, CompanyEvent, Notification, IngestionAuditLog
from app.api.notifications import get_notifications, mark_company_notifications_as_read

# Support lists in SQLite
sqlite3.register_adapter(list, lambda l: json.dumps(l))

@compiles(ARRAY, "sqlite")
def compile_array_sqlite(element, compiler, **kw):
    return "TEXT"

TEST_DB_URL = "sqlite:///./test_phase4.db"
if os.path.exists("./test_phase4.db"):
    os.remove("./test_phase4.db")

engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create tables
Base.metadata.create_all(bind=engine)

def run_tests():
    db = TestingSessionLocal()
    try:
        print("--- Start Phase 4 Bundled Notifications & Sources Verification ---")
        
        # Setup test user
        user = User(email="test4@vit.edu", role="student")
        db.add(user)
        db.flush()
        
        # Setup test companies
        co_nokia = Company(name="Nokia", role="SWE", category="Dream", fingerprint="fp_nokia")
        co_wipro = Company(name="Wipro", role="QA", category="Regular", fingerprint="fp_wipro")
        db.add_all([co_nokia, co_wipro])
        db.flush()
        
        # Setup company events
        evt_nokia_1 = CompanyEvent(company_id=co_nokia.id, event_type="REGISTRATION", subject="Nokia Drive Open", sender="cdc@vit.ac.in", body="Body Nokia 1", timestamp=datetime.utcnow())
        evt_nokia_2 = CompanyEvent(company_id=co_nokia.id, event_type="OA", subject="Nokia OA Schedule", sender="cdc@vit.ac.in", body="Body Nokia 2", timestamp=datetime.utcnow())
        evt_wipro_1 = CompanyEvent(company_id=co_wipro.id, event_type="REGISTRATION", subject="Wipro Drive Open", sender="cdc@vit.ac.in", body="Body Wipro 1", timestamp=datetime.utcnow())
        db.add_all([evt_nokia_1, evt_nokia_2, evt_wipro_1])
        db.flush()
        
        # Setup ingestion audit log confidence scores
        log_deadline = IngestionAuditLog(company_event_id=evt_nokia_1.id, field_name="registration_deadline", confidence_score=98.50, status="approved")
        log_location = IngestionAuditLog(company_event_id=evt_nokia_2.id, field_name="job_location", confidence_score=72.00, status="approved")
        db.add_all([log_deadline, log_location])
        db.flush()
        
        # Setup notifications
        notif_nokia_1 = Notification(user_id=user.id, company_event_id=evt_nokia_1.id, message="Nokia Registration has started!", is_read=False, notification_type="company_update")
        notif_nokia_2 = Notification(user_id=user.id, company_event_id=evt_nokia_2.id, message="Nokia OA Scheduled for tomorrow!", is_read=False, notification_type="company_update")
        notif_wipro_1 = Notification(user_id=user.id, company_event_id=evt_wipro_1.id, message="Wipro Registration has started!", is_read=False, notification_type="company_update")
        db.add_all([notif_nokia_1, notif_nokia_2, notif_wipro_1])
        db.commit()
        
        # 1. Fetch bundled notifications
        bundles = get_notifications(user, db)
        print(f"1. Bundled Notifications count: {len(bundles)}")
        assert len(bundles) == 2, f"Should have exactly 2 bundles! got: {len(bundles)}"
        
        # Verify Nokia bundle has 2 updates, Wipro has 1
        nokia_bundle = next(b for b in bundles if b["company_name"] == "Nokia")
        wipro_bundle = next(b for b in bundles if b["company_name"] == "Wipro")
        
        assert nokia_bundle["unread_count"] == 2, "Nokia unread count should be 2"
        assert len(nokia_bundle["notifications"]) == 2, "Nokia notifications count should be 2"
        assert wipro_bundle["unread_count"] == 1, "Wipro unread count should be 1"
        print("   Success: Grouping by company and unread counts match.")
        
        # 2. Verify Confidence Scores & Sources
        nokia_notifs = nokia_bundle["notifications"]
        notif_reg = next(n for n in nokia_notifs if n.company_event_id == evt_nokia_1.id)
        notif_oa = next(n for n in nokia_notifs if n.company_event_id == evt_nokia_2.id)
        
        print(f"2. Nokia Reg confidence score: {notif_reg.confidence_scores}")
        print(f"   Nokia OA confidence score: {notif_oa.confidence_scores}")
        assert notif_reg.confidence_scores.get("registration_deadline") == 98.50
        assert notif_oa.confidence_scores.get("job_location") == 72.00
        assert notif_reg.body == "Body Nokia 1"
        assert notif_reg.sender == "cdc@vit.ac.in"
        print("   Success: Confidence scores and event source headers retrieved correctly.")
        
        # 3. Mark entire Nokia bundle as read
        print("3. Testing mark company notifications as read...")
        mark_company_notifications_as_read(co_nokia.id, user, db)
        
        # Fetch bundles again
        bundles_after = get_notifications(user, db)
        nokia_bundle_after = next(b for b in bundles_after if b["company_name"] == "Nokia")
        wipro_bundle_after = next(b for b in bundles_after if b["company_name"] == "Wipro")
        
        print(f"   Nokia unread after read-company: {nokia_bundle_after['unread_count']}")
        print(f"   Wipro unread after read-company: {wipro_bundle_after['unread_count']}")
        assert nokia_bundle_after["unread_count"] == 0
        assert wipro_bundle_after["unread_count"] == 1
        print("   Success: Company-based notifications read triage works cleanly.")
        
        print("--- All Phase 4 Bundled Notifications & Sources Tests Passed! ---")
        
    finally:
        db.close()
        engine.dispose()
        if os.path.exists("./test_phase4.db"):
            try:
                os.remove("./test_phase4.db")
            except Exception as e:
                print(f"Warning: could not remove test DB: {e}")

if __name__ == "__main__":
    run_tests()
