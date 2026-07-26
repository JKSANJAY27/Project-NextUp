"""
Test manual drive isolation and queries against DB schema.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from uuid import uuid4
from app.models.models import Company, User
from app.core.database import SessionLocal

def test_manual_drive_isolation():
    db = SessionLocal()
    try:
        # Fetch an existing user from DB
        existing_user = db.query(User).first()
        if not existing_user:
            print("No existing user found in DB, skipping DB test.")
            return

        user_1_id = existing_user.id
        dummy_user_2_id = uuid4()

        # Create manual company for User 1
        comp = Company(
            name="Test Manual Corp",
            role="Software Engineer",
            category="Dream",
            ctc="15 LPA",
            fingerprint=f"manual_test_{uuid4().hex[:8]}",
            is_manual=True,
            created_by_user_id=user_1_id
        )
        db.add(comp)
        db.commit()

        # Verify is_manual and created_by_user_id
        assert comp.is_manual is True
        assert comp.created_by_user_id == user_1_id

        # Verify gmail_sync candidate_companies query excludes it
        candidate_companies = db.query(Company).filter(Company.is_manual == False).all()
        assert comp.id not in [c.id for c in candidate_companies], "Manual drive must be excluded from email parser candidate companies!"

        # Verify user 2 query excludes user 1's manual company
        u2_manual_companies = db.query(Company).filter(
            Company.is_manual == True,
            Company.created_by_user_id == dummy_user_2_id
        ).all()
        assert comp.id not in [c.id for c in u2_manual_companies], "User 2 must not see User 1's manual drive!"

        # Clean up
        db.delete(comp)
        db.commit()
        print("ALL MANUAL DRIVE ISOLATION TESTS PASSED!")
    finally:
        db.close()

if __name__ == "__main__":
    test_manual_drive_isolation()
