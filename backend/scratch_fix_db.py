import os
import sys
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()
db_url = os.getenv("DATABASE_URL")
if not db_url:
    print("No DATABASE_URL")
    sys.exit(1)

engine = create_engine(db_url)
try:
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE attachments_metadata ALTER COLUMN file_data TYPE bytea USING decode(file_data, 'escape');"))
        conn.commit()
        print("Successfully updated attachments_metadata.file_data to bytea!")
except Exception as e:
    print("Error:", e)
