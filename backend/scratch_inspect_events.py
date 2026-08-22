import psycopg2
from app.core.config import settings

conn = psycopg2.connect(settings.DATABASE_URL)
cur = conn.cursor()

for name in ['India Pvt Ltd', 'Major', 'LPA']:
    cur.execute("SELECT id, name FROM companies WHERE name ILIKE %s;", (f"%{name}%",))
    comps = cur.fetchall()
    print(f"\n==================== Companies matching {name} ====================")
    for c in comps:
        cid, cname = c
        print(f"Company ID: {cid}, Name: {cname}")
        cur.execute("SELECT id, event_type, subject, stage, date FROM company_events WHERE company_id = %s ORDER BY date ASC NULLS LAST;", (cid,))
        evs = cur.fetchall()
        print("  Events:")
        for e in evs:
            print(f"    Event {e[0]}: type={e[1]}, stage={e[3]}, subj={e[2]!r}, date={e[4]}")


