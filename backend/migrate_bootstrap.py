"""
Bootstrap Feature Migration
============================
Creates:
  - company_historical_snapshots  (derived cache of shortlist NEO ID hashes)
  - bootstrap_jobs                (one record per user bootstrap run)
  - bootstrap_job_progress        (one record per company per bootstrap run)

Alters:
  - student_profiles     → adds notification_baseline_at
  - opportunity_states   → adds bootstrap_inferred_stage, state_source

Run:  python migrate_bootstrap.py
Safe: all statements use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS — idempotent.
"""

import os
import sys
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

dotenv_path = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(dotenv_path)

db_url = os.getenv("DATABASE_URL")
if not db_url:
    print("Error: DATABASE_URL not found in .env file.")
    sys.exit(1)

if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

is_sqlite = db_url.startswith("sqlite")
print(f"Connecting to {'SQLite' if is_sqlite else 'PostgreSQL'}...")
engine = create_engine(db_url)

STATEMENTS = []

# ── 1. company_historical_snapshots ──────────────────────────────────────────
if is_sqlite:
    STATEMENTS.append("""\
CREATE TABLE IF NOT EXISTS company_historical_snapshots (
    id                      TEXT PRIMARY KEY,
    company_id              TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    oa_hashes               TEXT NOT NULL DEFAULT '[]',
    interview_hashes        TEXT NOT NULL DEFAULT '[]',
    offer_hashes            TEXT NOT NULL DEFAULT '[]',
    rejected_hashes         TEXT NOT NULL DEFAULT '[]',
    latest_stage            TEXT,
    snapshot_schema_version INTEGER NOT NULL DEFAULT 1,
    parser_version          TEXT NOT NULL DEFAULT 'v1.0',
    last_updated            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id)
);""")
else:
    STATEMENTS.append("""\
CREATE TABLE IF NOT EXISTS company_historical_snapshots (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id              UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    oa_hashes               JSONB NOT NULL DEFAULT '[]',
    interview_hashes        JSONB NOT NULL DEFAULT '[]',
    offer_hashes            JSONB NOT NULL DEFAULT '[]',
    rejected_hashes         JSONB NOT NULL DEFAULT '[]',
    latest_stage            VARCHAR(20),
    snapshot_schema_version INTEGER NOT NULL DEFAULT 1,
    parser_version          VARCHAR(20) NOT NULL DEFAULT 'v1.0',
    last_updated            TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_company_snapshot UNIQUE (company_id)
);""")
    STATEMENTS.append(
        "CREATE INDEX IF NOT EXISTS idx_snapshot_company "
        "ON company_historical_snapshots (company_id);"
    )

# ── 2. bootstrap_jobs ─────────────────────────────────────────────────────────
if is_sqlite:
    STATEMENTS.append("""\
CREATE TABLE IF NOT EXISTS bootstrap_jobs (
    id                   TEXT PRIMARY KEY,
    user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status               TEXT NOT NULL DEFAULT 'pending',
    trigger              TEXT NOT NULL DEFAULT 'onboarding',
    neo_id_hash_at_start TEXT,
    total_companies      INTEGER NOT NULL DEFAULT 0,
    processed_count      INTEGER NOT NULL DEFAULT 0,
    archived_count       INTEGER NOT NULL DEFAULT 0,
    suggested_count      INTEGER NOT NULL DEFAULT 0,
    failed_count         INTEGER NOT NULL DEFAULT 0,
    started_at           TIMESTAMP,
    completed_at         TIMESTAMP,
    cancelled_at         TIMESTAMP,
    error_message        TEXT,
    created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);""")
else:
    STATEMENTS.append("""\
CREATE TABLE IF NOT EXISTS bootstrap_jobs (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status               VARCHAR(30) NOT NULL DEFAULT 'pending',
    trigger              VARCHAR(20) NOT NULL DEFAULT 'onboarding',
    neo_id_hash_at_start VARCHAR(64),
    total_companies      INTEGER NOT NULL DEFAULT 0,
    processed_count      INTEGER NOT NULL DEFAULT 0,
    archived_count       INTEGER NOT NULL DEFAULT 0,
    suggested_count      INTEGER NOT NULL DEFAULT 0,
    failed_count         INTEGER NOT NULL DEFAULT 0,
    started_at           TIMESTAMP,
    completed_at         TIMESTAMP,
    cancelled_at         TIMESTAMP,
    error_message        TEXT,
    created_at           TIMESTAMP NOT NULL DEFAULT NOW()
);""")
    STATEMENTS.append(
        "CREATE INDEX IF NOT EXISTS idx_bootstrap_jobs_pending "
        "ON bootstrap_jobs (status) WHERE status = 'pending';"
    )

# ── 3. bootstrap_job_progress ─────────────────────────────────────────────────
if is_sqlite:
    STATEMENTS.append("""\
CREATE TABLE IF NOT EXISTS bootstrap_job_progress (
    id                TEXT PRIMARY KEY,
    bootstrap_job_id  TEXT NOT NULL REFERENCES bootstrap_jobs(id) ON DELETE CASCADE,
    company_id        TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    status            TEXT NOT NULL DEFAULT 'pending',
    outcome           TEXT,
    inferred_stage    TEXT,
    processed_at      TIMESTAMP,
    UNIQUE(bootstrap_job_id, company_id)
);""")
else:
    STATEMENTS.append("""\
CREATE TABLE IF NOT EXISTS bootstrap_job_progress (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bootstrap_job_id  UUID NOT NULL REFERENCES bootstrap_jobs(id) ON DELETE CASCADE,
    company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    status            VARCHAR(20) NOT NULL DEFAULT 'pending',
    outcome           VARCHAR(40),
    inferred_stage    VARCHAR(20),
    processed_at      TIMESTAMP,
    CONSTRAINT uq_bootstrap_progress UNIQUE (bootstrap_job_id, company_id)
);""")

# ── 4. Alter: student_profiles ────────────────────────────────────────────────
if is_sqlite:
    # SQLite does not support ADD COLUMN IF NOT EXISTS; guard with pragma
    STATEMENTS.append(
        "ALTER TABLE student_profiles ADD COLUMN notification_baseline_at TIMESTAMP;"
    )
    _SQLITE_GUARD_PROFILE = True
else:
    STATEMENTS.append(
        "ALTER TABLE student_profiles "
        "ADD COLUMN IF NOT EXISTS notification_baseline_at TIMESTAMP;"
    )
    _SQLITE_GUARD_PROFILE = False

# ── 5. Alter: opportunity_states ──────────────────────────────────────────────
if is_sqlite:
    STATEMENTS.append(
        "ALTER TABLE opportunity_states ADD COLUMN bootstrap_inferred_stage TEXT;"
    )
    STATEMENTS.append(
        "ALTER TABLE opportunity_states ADD COLUMN state_source TEXT DEFAULT 'MANUAL';"
    )
    _SQLITE_GUARD_OPP = True
else:
    STATEMENTS.append(
        "ALTER TABLE opportunity_states "
        "ADD COLUMN IF NOT EXISTS bootstrap_inferred_stage VARCHAR(20);"
    )
    STATEMENTS.append(
        "ALTER TABLE opportunity_states "
        "ADD COLUMN IF NOT EXISTS state_source VARCHAR(20) DEFAULT 'MANUAL';"
    )
    _SQLITE_GUARD_OPP = False


def _column_exists(conn, table: str, column: str) -> bool:
    """Check if a column exists (needed for SQLite idempotency)."""
    result = conn.execute(text(f"PRAGMA table_info({table})"))
    return any(row[1] == column for row in result)


try:
    with engine.connect() as conn:
        trans = conn.begin()
        try:
            for i, stmt in enumerate(STATEMENTS, 1):
                label = stmt.strip().splitlines()[0][:80]
                # SQLite idempotency guard for ALTER TABLE ADD COLUMN
                if is_sqlite and "ADD COLUMN" in stmt:
                    parts = stmt.split("ADD COLUMN")
                    col_def = parts[1].strip().split()[0]
                    tbl = parts[0].split("ALTER TABLE")[1].strip()
                    if _column_exists(conn, tbl, col_def):
                        print(f"  [{i}] Column '{col_def}' already exists on '{tbl}' — skipping.")
                        continue
                print(f"  [{i}] {label}...")
                conn.execute(text(stmt))

            trans.commit()
            print("Migration completed successfully!")
            print("Tables created / altered:")
            print("  [OK] company_historical_snapshots")
            print("  [OK] bootstrap_jobs")
            print("  [OK] bootstrap_job_progress")
            print("  [OK] student_profiles.notification_baseline_at")
            print("  [OK] opportunity_states.bootstrap_inferred_stage")
            print("  [OK] opportunity_states.state_source")
        except Exception as e:
            trans.rollback()
            print(f"\nMigration failed (rolled back): {e}")
            raise
except Exception as e:
    print(f"\nFatal error: {e}")
    sys.exit(1)
