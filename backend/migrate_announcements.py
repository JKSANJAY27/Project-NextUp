import os
import sys
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

# Load backend .env file
dotenv_path = os.path.join(os.path.dirname(__file__), '.env')
print(f"Loading env from: {dotenv_path}")
load_dotenv(dotenv_path)

db_url = os.getenv("DATABASE_URL")
if not db_url:
    print("Error: DATABASE_URL not found in .env file.")
    sys.exit(1)

if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

print("Connecting to database...")
engine = create_engine(db_url)

migrations = [
    # 1. Create announcements table
    """
    CREATE TABLE IF NOT EXISTS announcements (
        id UUID PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        announcement_type VARCHAR(100) DEFAULT 'GENERAL',
        deadline TIMESTAMP WITH TIME ZONE,
        source_email_id UUID REFERENCES raw_ingestion_jobs(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    """,
    # 2. Add announcement_id to attachments_metadata
    """
    ALTER TABLE attachments_metadata ADD COLUMN IF NOT EXISTS announcement_id UUID REFERENCES announcements(id) ON DELETE CASCADE;
    """,
    # 3. Make company_event_id nullable in attachments_metadata
    """
    ALTER TABLE attachments_metadata ALTER COLUMN company_event_id DROP NOT NULL;
    """
]

try:
    with engine.connect() as conn:
        trans = conn.begin()
        try:
            for sql in migrations:
                print(f"Executing query:\n{sql.strip()}\n")
                conn.execute(text(sql))
            trans.commit()
            print("Migration completed successfully!")
        except Exception as e:
            trans.rollback()
            raise e
except Exception as e:
    print(f"Migration failed: {e}")
    sys.exit(1)
