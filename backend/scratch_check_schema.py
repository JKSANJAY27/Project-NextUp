import os
from sqlalchemy import create_engine, inspect
from dotenv import load_dotenv

# Load env
dotenv_path = '.env'
load_dotenv(dotenv_path)

db_url = os.getenv("DATABASE_URL")
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

print(f"Connecting to: {db_url}")
engine = create_engine(db_url)
inspector = inspect(engine)

print("\nTables in database:")
for table_name in inspector.get_table_names():
    print(table_name)
