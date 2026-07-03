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
    # 1. Enable RLS on the 6 unrestricted tables
    "ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;",
    "ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;",
    "ALTER TABLE company_registry ENABLE ROW LEVEL SECURITY;",
    "ALTER TABLE ingestion_execution_logs ENABLE ROW LEVEL SECURITY;",
    "ALTER TABLE opportunity_states ENABLE ROW LEVEL SECURITY;",
    "ALTER TABLE pending_company_events ENABLE ROW LEVEL SECURITY;",

    # 2. Add policies for announcements
    "DROP POLICY IF EXISTS \"Authenticated users can read announcements\" ON announcements;",
    "CREATE POLICY \"Authenticated users can read announcements\" ON announcements FOR SELECT USING (auth.role() = 'authenticated');",
    "DROP POLICY IF EXISTS \"Admin/Coordinators can manage announcements\" ON announcements;",
    "CREATE POLICY \"Admin/Coordinators can manage announcements\" ON announcements FOR ALL USING (auth.jwt() ->> 'role' IN ('admin', 'coordinator'));",

    # 3. Add policies for calendar_events
    "DROP POLICY IF EXISTS \"Users can manage their own calendar events\" ON calendar_events;",
    "CREATE POLICY \"Users can manage their own calendar events\" ON calendar_events FOR ALL USING (auth.uid() = user_id);",

    # 4. Add policies for company_registry
    "DROP POLICY IF EXISTS \"Authenticated users can read company registry\" ON company_registry;",
    "CREATE POLICY \"Authenticated users can read company registry\" ON company_registry FOR SELECT USING (auth.role() = 'authenticated');",
    "DROP POLICY IF EXISTS \"Admin/Coordinators can manage company registry\" ON company_registry;",
    "CREATE POLICY \"Admin/Coordinators can manage company registry\" ON company_registry FOR ALL USING (auth.jwt() ->> 'role' IN ('admin', 'coordinator'));",

    # 5. Add policies for opportunity_states
    "DROP POLICY IF EXISTS \"Users can manage their own opportunity states\" ON opportunity_states;",
    "CREATE POLICY \"Users can manage their own opportunity states\" ON opportunity_states FOR ALL USING (auth.uid() = user_id);",

    # 6. Create user_google_credentials table
    """
    CREATE TABLE IF NOT EXISTS user_google_credentials (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        token_uri TEXT NOT NULL,
        client_id TEXT NOT NULL,
        client_secret TEXT NOT NULL,
        scopes TEXT[],
        expiry TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    """,

    # 7. Enable RLS on user_google_credentials
    "ALTER TABLE user_google_credentials ENABLE ROW LEVEL SECURITY;",

    # 8. Add google_event_id column to calendar_events
    "ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS google_event_id VARCHAR(255);"
]

try:
    with engine.connect() as conn:
        trans = conn.begin()
        try:
            for sql in migrations:
                print(f"Executing: {sql.strip()[:100]}...")
                conn.execute(text(sql))
            trans.commit()
            print("Security migration completed successfully!")
        except Exception as e:
            trans.rollback()
            raise e
except Exception as e:
    print(f"Migration failed: {e}")
    sys.exit(1)
