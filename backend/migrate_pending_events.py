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
    # Create pending_company_events table
    """
    CREATE TABLE IF NOT EXISTS pending_company_events (
        id UUID PRIMARY KEY,
        raw_ingestion_job_id UUID REFERENCES raw_ingestion_jobs(id) ON DELETE CASCADE,
        company_name VARCHAR(255) NOT NULL,
        role_name VARCHAR(255),
        event_type VARCHAR(100) NOT NULL,
        status VARCHAR(50) DEFAULT 'PENDING_PARENT' CHECK (status IN ('PENDING_PARENT', 'RECONCILED', 'FAILED')),
        parsed_payload JSONB DEFAULT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
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
