from app.db.session import SessionLocal
from app.models import Company, CompanyEvent, Application, EmailMessage, StudentProfile
from sqlalchemy import or_

db = SessionLocal()
sabre = db.query(Company).filter(Company.name.ilike('%Sabre%')).all()
print('Companies:', [(c.id, c.name) for c in sabre])

for c in sabre:
    apps = db.query(Application).filter(Application.company_id == c.id).all()
    print('Apps for', c.name, ':', [(a.id, a.user_id, a.status, a.recruitment_state) for a in apps])
    evts = db.query(CompanyEvent).filter(CompanyEvent.company_id == c.id).order_by(CompanyEvent.event_date.desc()).all()
    print('Events for', c.name, ':')
    for e in evts:
        print('  -', e.id, e.title, 'type:', e.event_type, 'date:', e.event_date, 'email_id:', e.email_id, 'meta:', e.parsed_metadata)

emails = db.query(EmailMessage).filter(or_(EmailMessage.subject.ilike('%Sabre%'), EmailMessage.body.ilike('%Sabre%'))).order_by(EmailMessage.received_at.desc()).all()
print('Emails found:', len(emails))
for em in emails:
    print('  - Email', em.id, em.subject, em.received_at, 'parsed_intent:', em.parsed_intent)
