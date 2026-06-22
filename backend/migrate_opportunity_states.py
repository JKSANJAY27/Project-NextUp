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
            print("Creating opportunity_states table...")
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS opportunity_states (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
                    state VARCHAR(50) DEFAULT 'unseen' CHECK (state IN ('unseen', 'tracking', 'decision_pending', 'archived', 'auto_archived')),
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, company_id)
                );
            """))
            
            print("Populating opportunity_states from existing applications...")
            # For any existing application, create a corresponding opportunity_states record
            conn.execute(text("""
                INSERT INTO opportunity_states (user_id, company_id, state, updated_at)
                SELECT user_id, company_id, user_decision, last_user_activity_at
                FROM applications
                ON CONFLICT (user_id, company_id) DO UPDATE 
                SET state = EXCLUDED.state, updated_at = EXCLUDED.updated_at;
            """))
            
            trans.commit()
            print("Migration completed successfully!")
        except Exception as e:
            trans.rollback()
            raise e
except Exception as e:
    print(f"Migration failed: {e}")
    sys.exit(1)
