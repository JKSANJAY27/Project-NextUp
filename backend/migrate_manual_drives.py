"""
Migration: Add is_manual and created_by_user_id to companies table.

Run once:
    cd backend
    python migrate_manual_drives.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import text
from app.core.database import engine

SQL = [
    # Add is_manual column (default FALSE so all existing rows are unaffected)
    """
    ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS is_manual BOOLEAN NOT NULL DEFAULT FALSE;
    """,
    # Add created_by_user_id FK (nullable — only set for manual drives)
    """
    ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS created_by_user_id UUID
        REFERENCES users(id) ON DELETE SET NULL;
    """,
    # Index on created_by_user_id so per-user filtering is fast
    """
    CREATE INDEX IF NOT EXISTS idx_companies_created_by_user_id
        ON companies(created_by_user_id)
        WHERE is_manual = TRUE;
    """,
]

def run():
    with engine.begin() as conn:
        for stmt in SQL:
            print(f"Running: {stmt.strip()[:80]}...")
            conn.execute(text(stmt))
    print("Migration complete: is_manual + created_by_user_id added to companies.")

if __name__ == "__main__":
    run()
