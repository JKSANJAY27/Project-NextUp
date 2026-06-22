import logging
from typing import Optional
from uuid import UUID
from datetime import datetime
from sqlalchemy.orm import Session
from app.models.models import Application, Company, CompanyEvent, CalendarEvent

logger = logging.getLogger(__name__)

def map_event_type(company_event_type: str) -> str:
    """
    Maps company_event_type from raw emails/notifications to clean calendar event types:
    'registration_deadline', 'online_assessment', 'interview', 'offer_result', 'manual'
    """
    cet_upper = company_event_type.upper()
    if cet_upper in ('REGISTRATION', 'DEADLINE', 'DEADLINE_EXTENSION'):
        return 'registration_deadline'
    elif cet_upper in ('OA', 'ONLINE_ASSESSMENT', 'TEST'):
        return 'online_assessment'
    elif cet_upper in ('INTERVIEW', 'TECHNICAL', 'HR', 'GD'):
        return 'interview'
    elif cet_upper in ('OFFER', 'REJECTION', 'SHORTLIST', 'OA_RESULT', 'INTERVIEW_RESULT'):
        return 'offer_result'
    else:
        return 'manual'

def sync_user_calendar_events(db: Session, user_id: UUID, company_id: Optional[UUID] = None):
    """
    Synchronizes company deadlines and company events to user calendar_events table.
    Ensures pure reads in GET /calendar and event-driven updates on mutations.
    """
    try:
        logger.info(f"Syncing calendar events for user {user_id} (company_id filter: {company_id})")

        # 1. Fetch active applications (user_decision != 'archived')
        query = db.query(Application).filter(
            Application.user_id == user_id,
            Application.user_decision != 'archived'
        )
        if company_id:
            query = query.filter(Application.company_id == company_id)
        
        active_apps = query.all()
        active_company_ids = {app.company_id for app in active_apps}

        # 2. Cleanup orphaned/archived synced timeline events if company_id filter is NOT active
        # (If we are syncing a specific company, we don't clear others, but if syncing all we clean up)
        if not company_id:
            db.query(CalendarEvent).filter(
                CalendarEvent.user_id == user_id,
                CalendarEvent.source == 'application_timeline',
                CalendarEvent.company_id.notin_(active_company_ids) if active_company_ids else True
            ).delete(synchronize_session=False)

        # 3. Reconcile calendar events for active applications
        for app in active_apps:
            company = db.query(Company).filter(Company.id == app.company_id).first()
            if not company:
                continue

            # A. Registration Deadline Event
            if company.registration_deadline:
                source_key = f"{user_id}:{company.id}:registration_deadline"
                cal_event = db.query(CalendarEvent).filter(CalendarEvent.source_key == source_key).first()

                if not cal_event:
                    cal_event = CalendarEvent(
                        user_id=user_id,
                        company_id=company.id,
                        title=f"Registration Deadline: {company.name}",
                        company_name=company.name,
                        role=company.role,
                        event_type='registration_deadline',
                        date=company.registration_deadline,
                        completed=False,
                        is_manual=False,
                        is_deleted=False,
                        is_user_modified=False,
                        source='application_timeline',
                        source_key=source_key
                    )
                    db.add(cal_event)
                else:
                    # Sync if not deleted and not modified by user
                    if not cal_event.is_deleted and not cal_event.is_user_modified:
                        cal_event.title = f"Registration Deadline: {company.name}"
                        cal_event.company_name = company.name
                        cal_event.role = company.role
                        cal_event.date = company.registration_deadline

            # B. Company Milestones / Events
            # Fetch all events associated with this company
            company_events = db.query(CompanyEvent).filter(CompanyEvent.company_id == company.id).all()
            for ce in company_events:
                source_key = f"{user_id}:{ce.id}:event"
                cal_event = db.query(CalendarEvent).filter(CalendarEvent.source_key == source_key).first()

                mapped_type = map_event_type(ce.event_type)

                if not cal_event:
                    cal_event = CalendarEvent(
                        user_id=user_id,
                        company_id=company.id,
                        company_event_id=ce.id,
                        title=f"{company.name} - {ce.event_type.upper()}",
                        company_name=company.name,
                        role=company.role,
                        event_type=mapped_type,
                        date=ce.timestamp or datetime.utcnow(),
                        notes=ce.body or ce.subject,
                        completed=False,
                        is_manual=False,
                        is_deleted=False,
                        is_user_modified=False,
                        source='application_timeline',
                        source_key=source_key
                    )
                    db.add(cal_event)
                else:
                    # Sync if not deleted and not modified by user
                    if not cal_event.is_deleted and not cal_event.is_user_modified:
                        cal_event.title = f"{company.name} - {ce.event_type.upper()}"
                        cal_event.company_name = company.name
                        cal_event.role = company.role
                        cal_event.date = ce.timestamp or datetime.utcnow()
                        cal_event.notes = ce.body or ce.subject

        db.commit()
        logger.info(f"Successfully reconciled calendar events for user {user_id}")
    except Exception as e:
        db.rollback()
        logger.error(f"Error syncing calendar events for user {user_id}: {str(e)}", exc_info=True)
