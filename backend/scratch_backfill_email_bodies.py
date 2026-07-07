"""One-off repair (2026-07-07):
Backfill email bodies onto company_events. The cleanup/reparse left only
milestone events (body NULL) for most companies — for each (company,
subject, timestamp) group with no body, copy the body from the matching
raw_ingestion_jobs payload onto ONE event of the group.

Touches ONLY company_events.body of existing companies. Creates nothing.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding="utf-8")

from dotenv import load_dotenv
load_dotenv()

from sqlalchemy import text
from app.core.database import SessionLocal


def main():
    db = SessionLocal()
    try:
        # ---- 1. Backfill bodies ----
        rows = db.execute(text("""
            SELECT e.company_id, e.subject, e.timestamp
            FROM company_events e
            WHERE e.subject IS NOT NULL
            GROUP BY e.company_id, e.subject, e.timestamp
            HAVING count(*) FILTER (WHERE e.body IS NOT NULL AND e.body != '') = 0
        """)).fetchall()
        print(f"Email groups missing a body: {len(rows)}")

        filled = 0
        for company_id, subject, ts in rows:
            job_row = db.execute(text("""
                SELECT payload->>'body'
                FROM raw_ingestion_jobs
                WHERE payload->>'subject' = :subj
                  AND payload->>'body' IS NOT NULL AND payload->>'body' != ''
                ORDER BY created_at DESC
                LIMIT 1
            """), {"subj": subject}).fetchone()
            if not job_row or not job_row[0]:
                print(f"  ✗ no payload found for: {subject[:70]!r}")
                continue
            # Attach the body to one event of the group (prefer the non-milestone
            # one if present, else the first by id).
            db.execute(text("""
                UPDATE company_events SET body = :body
                WHERE id = (
                    SELECT id FROM company_events
                    WHERE company_id = :cid AND subject = :subj AND timestamp = :ts
                    ORDER BY (stage IS NULL) DESC, id
                    LIMIT 1
                )
            """), {"body": job_row[0], "cid": str(company_id), "subj": subject, "ts": ts})
            filled += 1
            print(f"  ✓ backfilled body for: {subject[:70]!r}")
        db.commit()
        print(f"Backfilled {filled}/{len(rows)} email bodies.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
