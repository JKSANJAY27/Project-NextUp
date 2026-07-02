import logging
from typing import Optional
from uuid import UUID
from datetime import datetime
from sqlalchemy.orm import Session
from app.models.models import Application, Company, CompanyEvent, CalendarEvent, OpportunityState

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

        # 1. Fetch user's opportunity states and applications
        opp_states = db.query(OpportunityState).filter(OpportunityState.user_id == user_id).all()
        opp_state_map = {os.company_id: os.state for os in opp_states}

        apps = db.query(Application).filter(Application.user_id == user_id).all()
        app_map = {a.company_id: a for a in apps}

        # 2. Fetch companies to process
        company_query = db.query(Company)
        if company_id:
            company_query = company_query.filter(Company.id == company_id)
        companies = company_query.all()

        active_company_ids = set()
        tracking_company_ids = set()

        for company in companies:
            state = opp_state_map.get(company.id)
            if state in ('archived', 'auto_archived'):
                continue
            active_company_ids.add(company.id)
            # A company is tracked if its state is tracking or it has an application record with a tracking/interested decision
            is_tracked = (state == 'tracking') or (company.id in app_map and app_map[company.id].user_decision in ('tracking', 'interested'))
            if is_tracked:
                tracking_company_ids.add(company.id)

        # 3. Cleanup logic for database calendar events
        if not company_id:
            # Get all calendar events from application timeline for this user
            existing_cal_events = db.query(CalendarEvent).filter(
                CalendarEvent.user_id == user_id,
                CalendarEvent.source == 'application_timeline'
            ).all()

            for cal_ev in existing_cal_events:
                # Delete if company no longer exists or is archived
                if not cal_ev.company_id or cal_ev.company_id not in active_company_ids:
                    db.delete(cal_ev)
                # Delete company milestone events if company is no longer tracked
                elif cal_ev.event_type != 'registration_deadline' and cal_ev.company_id not in tracking_company_ids:
                    db.delete(cal_ev)
            db.flush()
        else:
            # Delete if the specific company is archived or no longer active
            if company_id not in active_company_ids:
                db.query(CalendarEvent).filter(
                    CalendarEvent.user_id == user_id,
                    CalendarEvent.company_id == company_id,
                    CalendarEvent.source == 'application_timeline'
                ).delete(synchronize_session=False)
                db.flush()
            # Delete milestones if company is active but no longer tracked
            elif company_id not in tracking_company_ids:
                db.query(CalendarEvent).filter(
                    CalendarEvent.user_id == user_id,
                    CalendarEvent.company_id == company_id,
                    CalendarEvent.source == 'application_timeline',
                    CalendarEvent.event_type != 'registration_deadline'
                ).delete(synchronize_session=False)
                db.flush()

        # 4. Reconcile/Create events
        for company in companies:
            if company.id not in active_company_ids:
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
                    if not cal_event.is_deleted and not cal_event.is_user_modified:
                        cal_event.title = f"Registration Deadline: {company.name}"
                        cal_event.company_name = company.name
                        cal_event.role = company.role
                        cal_event.date = company.registration_deadline

            # B. Company Milestones / Events (only if tracked)
            if company.id in tracking_company_ids:
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
