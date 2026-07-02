import os
import sys
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

dotenv_path = os.path.join(os.path.dirname(__file__), '.env')
load_dotenv(dotenv_path)

db_url = os.getenv("DATABASE_URL")
if not db_url:
    print("Error: DATABASE_URL not found in .env file.")
    sys.exit(1)

if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

engine = create_engine(db_url)

migrations = [
    # 1. Create canonical company registry table
    """
    CREATE TABLE IF NOT EXISTS company_registry (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        canonical_name VARCHAR(255) UNIQUE NOT NULL,
        aliases JSONB DEFAULT '[]'::jsonb,
        website VARCHAR(255) DEFAULT NULL,
        email_domains JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    """,

    # 2. Add new timeline columns to company_events
    "ALTER TABLE company_events ADD COLUMN IF NOT EXISTS stage VARCHAR(100) DEFAULT NULL;",
    "ALTER TABLE company_events ADD COLUMN IF NOT EXISTS date TIMESTAMP WITH TIME ZONE DEFAULT NULL;",
    "ALTER TABLE company_events ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending';",
    "ALTER TABLE company_events ADD COLUMN IF NOT EXISTS source_email VARCHAR(255) DEFAULT NULL;",
    "ALTER TABLE company_events ADD COLUMN IF NOT EXISTS round_number INTEGER DEFAULT NULL;",
    "ALTER TABLE company_events ADD COLUMN IF NOT EXISTS sequence INTEGER DEFAULT NULL;",
    "ALTER TABLE company_events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;",

    # 3. Backfill stage and date from existing data
    "UPDATE company_events SET stage = event_type WHERE stage IS NULL;",
    "UPDATE company_events SET date = timestamp WHERE date IS NULL;",

    # 4. Seed company_registry from existing unique company names (with dedup)
    """
    INSERT INTO company_registry (canonical_name)
    SELECT DISTINCT TRIM(name)
    FROM companies
    WHERE name IS NOT NULL AND name != '' AND name != 'Unknown Company'
    ON CONFLICT (canonical_name) DO NOTHING;
    """,
]

try:
    with engine.connect() as conn:
        trans = conn.begin()
        try:
            for sql in migrations:
                print(f"Executing: {sql.strip()[:120]}...")
                conn.execute(text(sql))
            trans.commit()
            print("\nMigration completed successfully!")
        except Exception as e:
            trans.rollback()
            raise e
except Exception as e:
    print(f"Migration failed: {e}")
    sys.exit(1)
