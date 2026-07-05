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

is_sqlite = db_url.startswith("sqlite")

migrations = [
    # Add jd_strategy to companies
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS jd_strategy JSONB;" if not is_sqlite else "ALTER TABLE companies ADD COLUMN IF NOT EXISTS jd_strategy TEXT;",
    # Add result_json to ai_generation_jobs
    "ALTER TABLE ai_generation_jobs ADD COLUMN IF NOT EXISTS result_json JSONB;" if not is_sqlite else "ALTER TABLE ai_generation_jobs ADD COLUMN IF NOT EXISTS result_json TEXT;",
    # Create status index for faster polling
    "CREATE INDEX IF NOT EXISTS idx_ai_generation_jobs_status_created ON ai_generation_jobs(status, created_at);"
]

# For PostgreSQL, drop the old status check constraint if it exists and add the updated one
postgres_only = [
    "ALTER TABLE ai_generation_jobs DROP CONSTRAINT IF EXISTS ai_generation_jobs_status_check;",
    "ALTER TABLE ai_generation_jobs ADD CONSTRAINT ai_generation_jobs_status_check CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled'));"
]

try:
    with engine.connect() as conn:
        trans = conn.begin()
        try:
            for sql in migrations:
                print(f"Executing: {sql}")
                conn.execute(text(sql))
            
            if not is_sqlite:
                for sql in postgres_only:
                    print(f"Executing PG only: {sql}")
                    conn.execute(text(sql))
                    
            trans.commit()
            print("Migration completed successfully!")
        except Exception as e:
            trans.rollback()
            raise e
except Exception as e:
    print(f"Migration failed: {e}")
    sys.exit(1)
