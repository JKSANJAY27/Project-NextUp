import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

# Load env from backend/.env
dotenv_path = os.path.join(os.path.dirname(__file__), '.env')
print(f"Loading env from: {dotenv_path}")
load_dotenv(dotenv_path)

db_url = os.getenv("DATABASE_URL")
if not db_url:
    print("Error: DATABASE_URL not found")
    exit(1)

if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

engine = create_engine(db_url)

with engine.connect() as conn:
    trans = conn.begin()
    try:
        print("Checking if sqlite...")
        is_sqlite = "sqlite" in db_url.lower()
        if is_sqlite:
            print("SQLite database detected. Skipping constraint updates (not enforced or handled differently).")
        else:
            print("PostgreSQL detected. Dropping applications_status_check constraint if exists...")
            # Drop constraint
            conn.execute(text("ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_status_check;"))
            
            print("Adding updated applications_status_check constraint...")
            conn.execute(text("""
                ALTER TABLE applications ADD CONSTRAINT applications_status_check 
                CHECK (status IN ('Applied', 'Shortlisted', 'OA', 'Interview', 'Offer', 'Rejected', 'Declined', 'Ignored', 'Likely Rejected'));
            """))
            
            print("Checking if recruitment_state check constraint exists and updating it too...")
            conn.execute(text("ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_recruitment_state_check;"))
            conn.execute(text("""
                ALTER TABLE applications ADD CONSTRAINT applications_recruitment_state_check 
                CHECK (recruitment_state IN ('Registration', 'Shortlisted', 'OA', 'Interview', 'Offer', 'Rejected', 'Awaiting Result', 'Awaiting Shortlist', 'Awaiting OA Result', 'Awaiting Interview Result'));
            """))
            
        trans.commit()
        print("Migration for Phase 2 constraints completed successfully!")
    except Exception as e:
        trans.rollback()
        print(f"Migration failed: {e}")
        exit(1)
