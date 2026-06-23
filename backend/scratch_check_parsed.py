from app.core.database import SessionLocal
from sqlalchemy import text

db = SessionLocal()
try:
    print("Querying jobs count...")
    count = db.execute(text("SELECT count(*) FROM raw_ingestion_jobs")).scalar()
    print("Jobs count:", count)

    print("Querying last 10 jobs...")
    result = db.execute(text("SELECT id, status, error_message, created_at FROM raw_ingestion_jobs ORDER BY created_at DESC LIMIT 10")).fetchall()
    for row in result:
        print(f"ID: {row[0]} | Status: {row[1]} | Error: {row[2]} | Created: {row[3]}")
except Exception as e:
    print("Failed:", e)
finally:
    db.close()
