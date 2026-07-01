import sys
from sqlalchemy import text
from app.core.database import engine

def migrate():
    with engine.connect() as conn:
        try:
            if engine.name == 'sqlite':
                conn.execute(text("ALTER TABLE attachments_metadata ADD COLUMN file_data BLOB;"))
            elif engine.name == 'postgresql':
                conn.execute(text("ALTER TABLE attachments_metadata ADD COLUMN file_data BYTEA;"))
            conn.commit()
            print("Successfully added file_data column.")
        except Exception as e:
            print(f"Error or column already exists: {e}")

if __name__ == "__main__":
    migrate()
