from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

# For SQLite, we need connect_args={"check_same_thread": False}
# For PostgreSQL (Supabase), we need sslmode=require.
# We also disable the hstore OID probe (use_native_hstore=False passed via
# executemany_mode trick) because Supabase's PgBouncer terminates the
# connection during the probe, causing SSL errors on every startup.
connect_args = {}
if settings.DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
else:
    # sslmode=require ensures the connection is encrypted.
    # The hstore probe is handled by passing use_native_hstore=False
    # as a dialect kwarg below.
    connect_args = {"sslmode": "require"}

engine_kwargs = {
    "pool_pre_ping": True,
}
if not settings.DATABASE_URL.startswith("sqlite"):
    engine_kwargs.update({
        # Render free/starter has ~512MB RAM. Keep pool small:
        # pool_size=5 + max_overflow=10 = 15 max connections.
        # Each PostgreSQL client connection uses ~5–10 MB RAM.
        "pool_size": 5,
        "max_overflow": 10,
        # Recycle connections every 5 minutes to prevent stale SSL errors
        # after Render sleeps/restarts the DB proxy.
        "pool_recycle": 300,
        # Give up after 10 seconds waiting for a connection (fail fast)
        "pool_timeout": 10,
        # CRITICAL: Disable hstore OID probe. Supabase's PgBouncer terminates
        # the connection during this probe, causing "SSL connection has been
        # closed unexpectedly" on every startup and every new pool connection.
        "use_native_hstore": False,
    })


engine = create_engine(
    settings.DATABASE_URL,
    connect_args=connect_args,
    **engine_kwargs
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Automatic Redis Cache Invalidation via SQLAlchemy Event Listeners
from sqlalchemy import event

@event.listens_for(SessionLocal, "after_flush")
def detect_db_changes(session, flush_context):
    try:
        from app.core.redis import (
            bump_user_version, bump_companies_list_version, 
            bump_company_version, bump_announcements_version
        )
        
        users_to_bump = set()
        companies_to_bump = set()
        bump_companies_list = False
        bump_announcements = False

        for obj in session.new | session.dirty | session.deleted:
            classname = obj.__class__.__name__
            
            # User-specific changes
            if classname in ("StudentProfile", "Resume", "Application", "CalendarEvent", "OpportunityState", "Notification"):
                if hasattr(obj, "user_id") and obj.user_id:
                    users_to_bump.add(obj.user_id)
            
            # Company-specific changes
            if classname == "Company":
                bump_companies_list = True
                if hasattr(obj, "id") and obj.id:
                    companies_to_bump.add(obj.id)
            elif classname in ("CompanyEvent", "PendingCompanyEvent"):
                if hasattr(obj, "company_id") and obj.company_id:
                    companies_to_bump.add(obj.company_id)
                    
            # Announcements
            elif classname == "Announcement":
                bump_announcements = True

        # Perform the bumps in Redis
        for uid in users_to_bump:
            bump_user_version(uid)
        for cid in companies_to_bump:
            bump_company_version(cid)
        if bump_companies_list:
            bump_companies_list_version()
        if bump_announcements:
            bump_announcements_version()
            
    except Exception as e:
        import logging
        logger = logging.getLogger("nextup.db_event")
        logger.warning(f"Error in detect_db_changes cache listener: {e}")

