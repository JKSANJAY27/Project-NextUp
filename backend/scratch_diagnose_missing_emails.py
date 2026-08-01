"""
Diagnostic script: find all recent raw_ingestion_jobs that haven't been properly
ingested, including pending, failed, dead_letter, and stale processing jobs.

Shows subjects so we can match them against the missing emails.

Usage:
  venv/Scripts/python scratch_diagnose_missing_emails.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from datetime import datetime, timedelta
from sqlalchemy import text
from app.core.database import SessionLocal
from app.models.models import RawIngestionJob, Company, PendingCompanyEvent

db = SessionLocal()

try:
    print("\n=== RAW INGESTION JOB STATUS SUMMARY ===")
    from sqlalchemy import func
    stats = db.execute(text("""
        SELECT status, COUNT(*) as cnt
        FROM raw_ingestion_jobs
        GROUP BY status
        ORDER BY cnt DESC
    """)).fetchall()
    total = 0
    for row in stats:
        print(f"  {row[0]:20s}: {row[1]}")
        total += row[1]
    print(f"  {'TOTAL':20s}: {total}")

    # Cutoff: last 7 days
    cutoff = datetime.utcnow() - timedelta(days=7)

    print("\n=== RECENT JOBS (last 7 days) BY STATUS ===")
    recent_jobs = db.query(RawIngestionJob).filter(
        RawIngestionJob.created_at >= cutoff
    ).order_by(RawIngestionJob.created_at.desc()).all()

    for status in ['pending', 'processing', 'failed', 'dead_letter']:
        jobs_with_status = [j for j in recent_jobs if j.status == status]
        if jobs_with_status:
            print(f"\n--- {status.upper()} ({len(jobs_with_status)}) ---")
            for j in jobs_with_status:
                subj = j.payload.get('subject', 'N/A') if j.payload else 'N/A'
                ts = j.created_at.strftime('%Y-%m-%d %H:%M') if j.created_at else 'N/A'
                err = (j.error_message or '')[:80]
                retry = j.retry_count or 0
                print(f"  [{ts}] {j.id}")
                print(f"    Subject: {subj}")
                print(f"    Retries: {retry}  Error: {err}")

    print("\n=== COMPLETED JOBS (last 2 days) ===")
    two_days_ago = datetime.utcnow() - timedelta(days=2)
    completed = db.query(RawIngestionJob).filter(
        RawIngestionJob.status == 'completed',
        RawIngestionJob.created_at >= two_days_ago
    ).order_by(RawIngestionJob.created_at.desc()).all()
    for j in completed:
        subj = j.payload.get('subject', 'N/A') if j.payload else 'N/A'
        ts = j.created_at.strftime('%Y-%m-%d %H:%M') if j.created_at else 'N/A'
        fc = j.final_classification or 'N/A'
        print(f"  [{ts}] {fc:20s} | {subj[:70]}")

    print("\n=== PENDING COMPANY EVENTS ===")
    pending_events = db.query(PendingCompanyEvent).filter(
        PendingCompanyEvent.status == 'PENDING_PARENT'
    ).all()
    print(f"Total pending company events: {len(pending_events)}")
    for pe in pending_events:
        print(f"  Company: {pe.company_name}  Role: {pe.role_name}  Event: {pe.event_type}")

    print("\n=== COMPANIES (most recent 30) ===")
    companies = db.query(Company).order_by(Company.created_at.desc()).limit(30).all()
    for c in companies:
        ts = c.created_at.strftime('%Y-%m-%d %H:%M') if c.created_at else 'N/A'
        print(f"  [{ts}] {c.name} | {c.role}")

finally:
    db.close()
