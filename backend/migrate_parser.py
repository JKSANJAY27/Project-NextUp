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
    "ALTER TABLE raw_ingestion_jobs ADD COLUMN IF NOT EXISTS parsed_output JSONB DEFAULT NULL;",
    "ALTER TABLE raw_ingestion_jobs ADD COLUMN IF NOT EXISTS validated_output JSONB DEFAULT NULL;",
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS requires_review BOOLEAN DEFAULT FALSE;"
]

try:
    with engine.connect() as conn:
        trans = conn.begin()
        try:
            for sql in migrations:
                print(f"Executing: {sql}")
                conn.execute(text(sql))
            trans.commit()
            print("Migration completed successfully!")
        except Exception as e:
            trans.rollback()
            raise e
except Exception as e:
    print(f"Migration failed: {e}")
    sys.exit(1)
