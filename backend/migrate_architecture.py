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
    # 1. Add parsed_metadata to company_events
    "ALTER TABLE company_events ADD COLUMN IF NOT EXISTS parsed_metadata JSONB DEFAULT '{}';",
    
    # 2. Add jd_analysis to companies
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS jd_analysis JSONB DEFAULT '{}';",
    
    # 3. Add final_classification to raw_ingestion_jobs
    "ALTER TABLE raw_ingestion_jobs ADD COLUMN IF NOT EXISTS final_classification VARCHAR(100);",
    
    # 4. Add matched_company_id to pending_company_events
    "ALTER TABLE pending_company_events ADD COLUMN IF NOT EXISTS matched_company_id UUID REFERENCES companies(id) ON DELETE SET NULL;",
    
    # 5. Create ingestion_execution_logs table
    """
    CREATE TABLE IF NOT EXISTS ingestion_execution_logs (
        id UUID PRIMARY KEY,
        job_id UUID REFERENCES raw_ingestion_jobs(id) ON DELETE CASCADE,
        stage VARCHAR(100) NOT NULL,
        status VARCHAR(50) NOT NULL,
        message TEXT,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    """,
    
    # 6. Migrate existing company jd_required_skills etc to jd_analysis JSONB
    """
    UPDATE companies
    SET jd_analysis = jsonb_build_object(
        'required_skills', COALESCE(to_jsonb(jd_required_skills), '[]'::jsonb),
        'preferred_skills', COALESCE(to_jsonb(jd_preferred_skills), '[]'::jsonb),
        'ats_keywords', COALESCE(to_jsonb(jd_ats_keywords), '[]'::jsonb),
        'interview_topics', COALESCE(to_jsonb(interview_topics), '[]'::jsonb)
    )
    WHERE jd_analysis IS NULL OR jd_analysis = '{}'::jsonb;
    """
]

try:
    with engine.connect() as conn:
        trans = conn.begin()
        try:
            for sql in migrations:
                print(f"Executing: {sql.strip()[:100]}...")
                conn.execute(text(sql))
            trans.commit()
            print("Architecture migration completed successfully!")
        except Exception as e:
            trans.rollback()
            raise e
except Exception as e:
    print(f"Migration failed: {e}")
    sys.exit(1)
