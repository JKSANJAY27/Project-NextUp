import os
import sys
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

# Load backend .env file
dotenv_path = os.path.join(os.path.dirname(__file__), '.env')
load_dotenv(dotenv_path)

db_url = os.getenv("DATABASE_URL")
if not db_url:
    print("Error: DATABASE_URL not found in .env file.")
    sys.exit(1)

if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

print("Connecting to database...")
engine = create_engine(db_url)

try:
    with engine.connect() as conn:
        trans = conn.begin()
        try:
            print("Adding columns to opportunity_states...")
            conn.execute(text("""
                ALTER TABLE opportunity_states 
                ADD COLUMN IF NOT EXISTS archive_reason VARCHAR(100) DEFAULT NULL,
                ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
                ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMP WITH TIME ZONE DEFAULT NULL;
            """))
            trans.commit()
            print("Migration completed successfully!")
        except Exception as e:
            trans.rollback()
            raise e
except Exception as e:
    print(f"Migration failed: {e}")
    sys.exit(1)
