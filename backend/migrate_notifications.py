import os
from sqlalchemy import text
from app.core.database import engine

def migrate():
    with engine.begin() as conn:
        print("Adding notification_scope column...")
        conn.execute(text("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS notification_scope VARCHAR(50) DEFAULT 'ACTIVE';"))
        
        print("Adding expires_at column...")
        conn.execute(text("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;"))
        
        print("Adding index idx_notifications_scope_user...")
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_notifications_scope_user 
            ON notifications(user_id, notification_scope, is_read);
        """))
        
        print("Migration successful.")

if __name__ == "__main__":
    migrate()
