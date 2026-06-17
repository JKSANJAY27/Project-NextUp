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

# If database url starts with postgresql:// and not postgresql+psycopg2:// we can still connect, but let's make sure it is parsed correctly
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

print(f"Connecting to database...")
engine = create_engine(db_url)

migrations = [
    "ALTER TABLE applications ADD COLUMN IF NOT EXISTS user_decision VARCHAR(50) DEFAULT 'unseen';",
    "ALTER TABLE applications ADD COLUMN IF NOT EXISTS recruitment_state VARCHAR(50) DEFAULT 'Registration';",
    "ALTER TABLE applications ADD COLUMN IF NOT EXISTS last_user_activity_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;",
    "ALTER TABLE applications ADD COLUMN IF NOT EXISTS workspace_priority_override VARCHAR(50) DEFAULT NULL;",
    "ALTER TABLE applications ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMP WITH TIME ZONE DEFAULT NULL;"
]

try:
    with engine.connect() as conn:
        # Start a transaction
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
