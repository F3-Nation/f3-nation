from dataclasses import dataclass
from typing import Any, List

from f3_data_models.models import (
    Attendance,
    Attendance_x_AttendanceType,
    Event,
    EventInstance,
    EventTag,
    EventType,
    EventType_x_EventInstance,
    Location,
    Org,
    Org_Type,
    Permission,
    Position,
    Position_x_Org_x_User,
    Role,
    Role_x_Permission,
    Role_x_User_x_Org,
    SlackUser,
    User,
)
from f3_data_models.utils import _joinedloads, get_session
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import joinedload

from utilities.constants import ALL_PERMISSIONS, PERMISSIONS


@dataclass
class CalendarHomeQuery:
    event: EventInstance
    org: Org
    event_types: List[EventType]
    planned_qs: str = None
    user_attending: int = None
    user_q: int = None
    series: Event = None


def home_schedule_query(
    user_id: int, filters: list, limit: int = 45, open_q_only: bool = False, only_users_events: bool = False
) -> list[CalendarHomeQuery]:
    session = get_session()

    # LOGIC CHECK:
    # If we are filtering BY attendance data (open_q or user_events),
    # we cannot optimize using "Limit-First" because the Limit depends on the aggregation.
    # We only use the optimization for the standard schedule view.
    use_optimization = not (open_q_only or only_users_events)

    if use_optimization:
        # --- OPTIMIZED PATH (Limit First) ---

        # 1. The Scout: Find the IDs of the 45 events we want to show FIRST.
        # We apply all Event/Org filters here.
        candidate_ids_stmt = (
            select(EventInstance.id)
            .join(Org, Org.id == EventInstance.org_id)
            # Add other necessary joins for filtering/sorting if they are in *filters
            # Assuming 'filters' might reference EventType or others, ensure those joins exist:
            .join(EventType_x_EventInstance, EventType_x_EventInstance.event_instance_id == EventInstance.id)
            .join(EventType, EventType.id == EventType_x_EventInstance.event_type_id)
            .filter(*filters)
            .order_by(EventInstance.start_date, EventInstance.id, Org.name, EventInstance.start_time)
            .limit(limit)
        )

        # Turn this statement into a Common Table Expression (CTE)
        # This tells Postgres: "Run this small query first and hold the results."
        matches_cte = candidate_ids_stmt.cte("matches_cte")

        # 2. The Subquery: Calculate attendance ONLY for the IDs in the CTE.
        # Notice we do NOT apply *filters here. We only join on the CTE.
        subquery = (
            select(
                Attendance.event_instance_id,
                func.string_agg(
                    case(
                        (
                            and_(Attendance.is_planned, Attendance_x_AttendanceType.attendance_type_id.in_([2, 3])),
                            User.f3_name,
                        ),
                        else_=None,
                    ),
                    ",",
                ).label("planned_qs"),
                func.max(case((Attendance.user_id == user_id, 1), else_=0)).label("user_attending"),
                func.max(
                    case(
                        (
                            and_(
                                Attendance.user_id == user_id,
                                Attendance_x_AttendanceType.attendance_type_id.in_([2, 3]),
                            ),
                            1,
                        ),
                        else_=0,
                    )
                ).label("user_q"),
            )
            .select_from(Attendance)
            .join(User, User.id == Attendance.user_id)
            .join(Attendance_x_AttendanceType, Attendance.id == Attendance_x_AttendanceType.attendance_id)
            # CRITICAL OPTIMIZATION: Inner join to the CTE.
            # This forces the DB to only look at attendance for our 45 "winner" events.
            .join(matches_cte, matches_cte.c.id == Attendance.event_instance_id)
            .group_by(Attendance.event_instance_id)
            .alias()
        )

        # 3. Main Query: Select the details, joining the CTE to ensure we keep our Limit/Sort
        query = (
            select(
                EventInstance,
                Org,
                EventType,
                subquery.c.planned_qs,
                subquery.c.user_attending,
                subquery.c.user_q,
                Event,
            )
            .select_from(matches_cte)  # Start from our list of 45 IDs
            .join(EventInstance, EventInstance.id == matches_cte.c.id)  # Get the full Event object
            .join(Org, Org.id == EventInstance.org_id)
            .join(EventType_x_EventInstance, EventType_x_EventInstance.event_instance_id == EventInstance.id)
            .join(EventType, EventType.id == EventType_x_EventInstance.event_type_id)
            .outerjoin(subquery, subquery.c.event_instance_id == EventInstance.id)
            .outerjoin(Event, Event.id == EventInstance.series_id)
            # We must re-apply the order_by to ensure final output order
            .order_by(EventInstance.start_date, EventInstance.id, Org.name, EventInstance.start_time)
        )

    else:
        # --- LEGACY PATH (For Open Q / User Events) ---
        # This is your original logic, kept for when we need to filter BY the calculated fields.

        subquery = (
            select(
                Attendance.event_instance_id,
                func.string_agg(
                    case(
                        (
                            and_(Attendance.is_planned, Attendance_x_AttendanceType.attendance_type_id.in_([2, 3])),
                            User.f3_name,
                        ),
                        else_=None,
                    ),
                    ",",
                ).label("planned_qs"),
                func.max(case((Attendance.user_id == user_id, 1), else_=0)).label("user_attending"),
                func.max(
                    case(
                        (
                            and_(
                                Attendance.user_id == user_id,
                                Attendance_x_AttendanceType.attendance_type_id.in_([2, 3]),
                            ),
                            1,
                        ),
                        else_=0,
                    )
                ).label("user_q"),
            )
            .select_from(Attendance)
            .join(User, User.id == Attendance.user_id)
            .join(Attendance_x_AttendanceType, Attendance.id == Attendance_x_AttendanceType.attendance_id)
            .join(EventInstance, EventInstance.id == Attendance.event_instance_id)
            # We still keep these joins to ensure the subquery filters correctly
            .join(Org, Org.id == EventInstance.org_id)
            .filter(*filters)  # Original heavy filtering
            .group_by(Attendance.event_instance_id)
            .alias()
        )

        # Apply the specific dynamic filters to the alias columns
        final_filters = list(filters)  # Copy to avoid modifying the input list
        if open_q_only:
            final_filters.append(subquery.c.planned_qs.is_(None))
        if only_users_events:
            final_filters.append(subquery.c.user_attending == 1)

        query = (
            select(
                EventInstance,
                Org,
                EventType,
                subquery.c.planned_qs,
                subquery.c.user_attending,
                subquery.c.user_q,
                Event,
            )
            .join(Org, Org.id == EventInstance.org_id)
            .join(EventType_x_EventInstance, EventType_x_EventInstance.event_instance_id == EventInstance.id)
            .join(EventType, EventType.id == EventType_x_EventInstance.event_type_id)
            .outerjoin(subquery, subquery.c.event_instance_id == EventInstance.id)
            .outerjoin(Event, Event.id == EventInstance.series_id)
            .filter(*final_filters)
            .order_by(EventInstance.start_date, EventInstance.id, Org.name, EventInstance.start_time)
            .limit(limit)
        )

    # --- EXECUTION ---
    results = session.execute(query).all()

    # Turn EventType into a list of EventType objects for each Event.id
    event_types = {}
    for r in results:
        event_types.setdefault(r[0].id, []).append(r[2])

    # Turn the results into a list of CalendarHomeQuery objects
    output = []

    for r in results:
        output.append(
            CalendarHomeQuery(
                event=r[0],
                org=r[1],
                event_types=event_types.get(r[0].id, []),
                planned_qs=r[3],
                user_attending=r[4],
                user_q=r[5],
                series=r[6],
            )
        )
    session.close()
    return output


@dataclass
class EventExtended:
    event: EventInstance
    org: Org
    event_types: List[EventType]
    location: Location
    event_tags: List[EventTag]
    org_slack_id: str


@dataclass
class AttendanceExtended:
    attendance: Attendance
    user: User
    slack_user: SlackUser


def event_attendance_query(attendance_filter: List[Any] = None, event_filter: List[Any] = None) -> List[EventInstance]:
    with get_session() as session:
        attendance_subquery = (
            select(Attendance.event_instance_id.distinct().label("event_instance_id"))
            .options(joinedload(Attendance.attendance_types))
            .filter(*(attendance_filter or []))
            .alias()
        )
        query = (
            select(EventInstance)
            .join(attendance_subquery, attendance_subquery.c.event_instance_id == EventInstance.id)
            .filter(*(event_filter or []))
            .order_by(EventInstance.start_date, EventInstance.start_time)
        )
        query = _joinedloads(EventInstance, query, "all")
        event_records = session.scalars(query).unique().all()
        return event_records


def event_instances_without_attendance_types(
    *,
    excluded_attendance_type_ids: list[int],
    event_filter: List[Any] = None,
    limit: int = 20,
) -> List[EventInstance]:
    """
    Returns EventInstances where there are NO Attendance records with any of the given attendance type IDs.
    This includes events with zero Attendance rows.
    """
    with get_session() as session:
        # Correlated subquery: TRUE if the event has any of the excluded attendance types
        has_excluded_type = (
            select(Attendance.id)
            .join(
                Attendance_x_AttendanceType,
                Attendance_x_AttendanceType.attendance_id == Attendance.id,
            )
            .where(
                Attendance_x_AttendanceType.attendance_type_id.in_(excluded_attendance_type_ids),
                Attendance.event_instance_id == EventInstance.id,
            )
            .correlate(EventInstance)
            .exists()
        )

        # NOT EXISTS: keep only events without those attendance types
        query = (
            select(EventInstance)
            .filter(~has_excluded_type)
            .filter(*(event_filter or []))
            .order_by(EventInstance.start_date, EventInstance.start_time)
            .limit(limit)
            .options(joinedload(EventInstance.org), joinedload(EventInstance.event_types))
        )
        return session.scalars(query).unique().all()


def get_user_permission_list(user_id: int, org_id: int) -> list[Permission]:
    with get_session() as session:
        query = (
            session.query(Permission)
            .join(Role_x_Permission, Role_x_Permission.permission_id == Permission.id)
            .join(Role, Role.id == Role_x_Permission.role_id)
            .join(Role_x_User_x_Org, Role_x_User_x_Org.role_id == Role.id)
            .filter(Role_x_User_x_Org.user_id == user_id, Role_x_User_x_Org.org_id == org_id)
        )
        return query.all()


def get_admin_users_list(org_id: int, slack_team_id: str) -> list[SlackUser]:
    with get_session() as session:
        query = (
            session.query(SlackUser)
            .join(Role_x_User_x_Org, Role_x_User_x_Org.user_id == SlackUser.user_id)
            .join(Role, Role.id == Role_x_User_x_Org.role_id)
            .join(Role_x_Permission, Role_x_Permission.role_id == Role.id)
            .join(Permission, Permission.id == Role_x_Permission.permission_id)
            .filter(
                Permission.name == PERMISSIONS[ALL_PERMISSIONS],
                Role_x_User_x_Org.org_id == org_id,
                SlackUser.slack_team_id == slack_team_id,
            )
        )
        return query.all()


@dataclass
class PositionExtended:
    position: Position
    slack_users: List[SlackUser]


def get_position_users(org_id: int, region_org_id: int, slack_team_id: str) -> List[PositionExtended]:
    org_type_level = Org_Type.region if region_org_id == org_id else Org_Type.ao
    with get_session() as session:
        query = (
            session.query(Position, SlackUser)
            .select_from(Position)
            .join(
                Position_x_Org_x_User,
                and_(Position_x_Org_x_User.position_id == Position.id, Position_x_Org_x_User.org_id == org_id),
                isouter=True,
            )
            .join(User, User.id == Position_x_Org_x_User.user_id, isouter=True)
            .join(SlackUser, and_(SlackUser.user_id == User.id, SlackUser.slack_team_id == slack_team_id), isouter=True)
            .filter(
                and_(
                    or_(Position.org_type == org_type_level, Position.org_type.is_(None)),
                    or_(Position.org_id == region_org_id, Position.org_id.is_(None)),
                    Position.is_active,
                )
            )
            .order_by(Position.id)
        )
        positions = {}
        for position, slack_user in query.all():
            positions.setdefault(position, []).append(slack_user)

        output = []
        for position, slack_users in positions.items():
            output.append(PositionExtended(position=position, slack_users=slack_users))

        return output


def get_aoq_users(region_org_id: int) -> List[User]:
    with get_session() as session:
        query = (
            session.query(User)
            .join(Position_x_Org_x_User, Position_x_Org_x_User.user_id == User.id)
            .join(Position, Position.id == Position_x_Org_x_User.position_id)
            .join(Org, Org.id == Position_x_Org_x_User.org_id)
            .filter(
                Position.name == "Site Q",
                Org.parent_id == region_org_id,
            )
        )
        return query.all()


def get_admin_users(org_id: int, slack_team_id: str) -> List[tuple[User, SlackUser]]:
    with get_session() as session:
        query = (
            session.query(User, SlackUser)
            .join(Role_x_User_x_Org, and_(Role_x_User_x_Org.user_id == User.id, Role_x_User_x_Org.org_id == org_id))
            .join(Role, and_(Role.id == Role_x_User_x_Org.role_id, Role.name == "admin"))
            .join(SlackUser, and_(SlackUser.user_id == User.id, SlackUser.slack_team_id == slack_team_id), isouter=True)
        )
        return query.all()


def make_user_admin(org_id: int, user_id: int) -> None:
    with get_session() as session:
        # Check if the user is already an admin
        existing_admin = (
            session.query(Role_x_User_x_Org)
            .filter(Role_x_User_x_Org.user_id == user_id, Role_x_User_x_Org.org_id == org_id)
            .join(Role, Role.id == Role_x_User_x_Org.role_id)
            .filter(Role.name == "admin")
            .first()
        )
        if existing_admin:
            return  # User is already an admin

        # Create a new admin role if it doesn't exist
        admin_role = session.query(Role).filter(Role.name == "admin").first()
        if not admin_role:
            admin_role = Role(name="admin")
            session.add(admin_role)
            session.commit()

        # Assign the admin role to the user
        new_admin = Role_x_User_x_Org(user_id=user_id, org_id=org_id, role_id=admin_role.id)
        session.add(new_admin)
        session.commit()


@dataclass
class MissingBackblastQuery:
    event: EventInstance
    org: Org
    event_types: List[EventType]
    q_slack_ids: List[str]
    site_q_slack_ids: List[str]


def get_site_q_slack_ids_by_ao(ao_org_ids: List[int], slack_team_id: str) -> dict:
    """Returns a dict mapping org_id -> list of site Q Slack IDs for the given AO org IDs."""
    if not ao_org_ids:
        return {}
    with get_session() as session:
        rows = (
            session.query(Position_x_Org_x_User.org_id, SlackUser.slack_id)
            .join(Position, Position.id == Position_x_Org_x_User.position_id)
            .join(User, User.id == Position_x_Org_x_User.user_id)
            .join(SlackUser, and_(SlackUser.user_id == User.id, SlackUser.slack_team_id == slack_team_id))
            .filter(
                Position.name == "Site Q",
                Position_x_Org_x_User.org_id.in_(ao_org_ids),
            )
            .all()
        )
    result: dict = {}
    for org_id, slack_id in rows:
        result.setdefault(org_id, []).append(slack_id)
    return result


def missing_backblasts_query(
    region_org_id: int,
    slack_team_id: str,
    org_ids: List[int] = None,
    limit: int = 50,
) -> List[MissingBackblastQuery]:
    """Returns EventInstances from the last 60 days that are active, have no pax recorded,
    and have not been admin-dismissed."""
    import datetime

    sixty_days_ago = datetime.date.today() - datetime.timedelta(days=60)
    today = datetime.date.today()

    with get_session() as session:
        filters = [
            EventInstance.is_active,
            EventInstance.pax_count.is_(None),
            EventInstance.start_date >= sixty_days_ago,
            EventInstance.start_date <= today,
            or_(
                EventInstance.org_id == region_org_id,
                Org.parent_id == region_org_id,
            ),
            or_(
                EventInstance.meta.is_(None),
                func.coalesce(
                    EventInstance.meta["backblast_admin_dismissed"].as_boolean(),
                    False,
                ).is_(False),
            ),
        ]
        if org_ids:
            filters.append(EventInstance.org_id.in_(org_ids))

        query = (
            select(EventInstance, Org, EventType)
            .join(Org, Org.id == EventInstance.org_id)
            .join(EventType_x_EventInstance, EventType_x_EventInstance.event_instance_id == EventInstance.id)
            .join(EventType, EventType.id == EventType_x_EventInstance.event_type_id)
            .filter(*filters)
            .order_by(EventInstance.start_date, EventInstance.id)
            .limit(limit)
        )
        results = session.execute(query).all()

    # Group event types by event id
    event_types_map: dict = {}
    for r in results:
        event_types_map.setdefault(r[0].id, []).append(r[2])

    # Collect unique (event, org) pairs preserving order
    seen = set()
    events_orgs = []
    for r in results:
        if r[0].id not in seen:
            seen.add(r[0].id)
            events_orgs.append((r[0], r[1]))

    if not events_orgs:
        return []

    # Fetch planned Q attendance + slack IDs for these events in one query
    event_ids = [e.id for e, _ in events_orgs]
    with get_session() as session:
        q_rows = (
            session.query(Attendance.event_instance_id, SlackUser.slack_id)
            .join(
                Attendance_x_AttendanceType,
                and_(
                    Attendance_x_AttendanceType.attendance_id == Attendance.id,
                    Attendance_x_AttendanceType.attendance_type_id.in_([2, 3]),
                ),
            )
            .join(User, User.id == Attendance.user_id)
            .join(SlackUser, and_(SlackUser.user_id == User.id, SlackUser.slack_team_id == slack_team_id))
            .filter(
                Attendance.event_instance_id.in_(event_ids),
                Attendance.is_planned,
            )
            .all()
        )
    q_slack_map: dict = {}
    for event_id, slack_id in q_rows:
        q_slack_map.setdefault(event_id, []).append(slack_id)

    ao_org_ids = list({e.org_id for e, _ in events_orgs})
    site_q_map = get_site_q_slack_ids_by_ao(ao_org_ids, slack_team_id)

    output = []
    for event, org in events_orgs:
        output.append(
            MissingBackblastQuery(
                event=event,
                org=org,
                event_types=event_types_map.get(event.id, []),
                q_slack_ids=q_slack_map.get(event.id, []),
                site_q_slack_ids=site_q_map.get(event.org_id, []),
            )
        )
    return output
