import sys
print("Step 1: Importing config")
from app.core.config import settings
print("Database URL:", settings.DATABASE_URL)

print("Step 2: Importing sqlalchemy")
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

print("Step 3: Creating engine")
engine = create_engine(settings.DATABASE_URL)

print("Step 4: Creating SessionLocal")
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

print("Step 5: Opening session")
db = SessionLocal()

print("Step 6: Executing simple query")
try:
    result = db.execute("SELECT 1").first()
    print("Query result:", result)
except Exception as e:
    print("Query failed:", e)
finally:
    db.close()
    print("Session closed")
