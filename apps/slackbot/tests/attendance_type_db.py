"""Seed data for tests of code that finds an event's Q and Co-Qs.

`create_schema` builds the full `f3_data_models` schema in the disposable Postgres
from `tests.postgres_fixture`. `seed_event` adds one event with a Q, a Co-Q and a PAX,
typed only by `attendance.attendance_type` (no link-table rows), so a query that still
reads the link table, or that drops its type filter, gets the wrong people back.
"""

from datetime import date, datetime, timedelta
from pathlib import Path

from f3_data_models.models import (
    Attendance,
    Attendance_Type,
    Attendance_x_AttendanceType,
    Base,
    Event_Category,
    EventInstance,
    EventType,
    EventType_x_EventInstance,
    Org,
    Org_Type,
    Org_x_SlackSpace,
    SlackSpace,
    SlackUser,
    User,
)
from sqlalchemy import select, text
from sqlalchemy.orm import Session

TEAM_ID = "T1"
REGION_ID = 1
AO_ID = 2
Q_USER = 10
CO_Q_USER = 11
PAX_USER = 12
SLACK_IDS = {Q_USER: "U10", CO_Q_USER: "U11", PAX_USER: "U12"}
F3_NAMES = {Q_USER: "TheQ", CO_Q_USER: "TheCoQ", PAX_USER: "ThePax"}


SYNC_MIGRATION = Path(__file__).parents[3] / "packages/db/drizzle/0039_attendance_type_sync.sql"


def create_schema(engine) -> None:
    """The full schema, the three attendance types, and the trigger that derives the column from link rows.

    The trigger comes from its migration, so writers that still add link rows (Take Q, Assign Q) update
    the column here as they do in production.
    """
    with engine.begin() as connection:
        connection.execute(text("CREATE EXTENSION citext"))
        connection.execute(text("CREATE SCHEMA slackbot"))
    Base.metadata.create_all(engine)
    statements = [s.strip() for s in SYNC_MIGRATION.read_text().split("--> statement-breakpoint")]
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO attendance_types (id, type) VALUES (1, 'PAX'), (2, 'Q'), (3, 'Co-Q')"))
        for statement in statements:
            body = "\n".join(line for line in statement.splitlines() if not line.startswith("--")).strip()
            if body.startswith(("CREATE OR REPLACE FUNCTION", "CREATE TRIGGER")):
                connection.exec_driver_sql(body)


def seed_event(
    engine,
    *,
    start_date: date,
    event_id: int = 100,
    leaders: bool = True,
    with_links: bool = False,
    is_planned: bool = True,
    **event_fields,
) -> int:
    """One event at the AO with a PAX and, unless `leaders` is False, a Q and a Co-Q.

    The PAX signed up first, then the Co-Q, then the Q, so "the first record" is never the Q by accident.
    With `with_links`, each record also gets the link row matching its type, as a backfilled record has.
    The region has a Slack space in TEAM_ID, and every user's home region is the region.
    """
    with Session(engine) as session:
        if session.get(Org, REGION_ID) is None:
            session.add(Org(id=REGION_ID, org_type=Org_Type.region, name="Region", is_active=True))
            session.add(Org(id=AO_ID, org_type=Org_Type.ao, name="AO", is_active=True, parent_id=REGION_ID))
            session.add(EventType(id=1, name="Bootcamp", event_category=Event_Category.first_f))
            session.add(SlackSpace(id=1, team_id=TEAM_ID, settings={"team_id": TEAM_ID, "org_id": REGION_ID}))
            session.flush()
            for user_id, name in F3_NAMES.items():
                session.add(
                    User(id=user_id, email=f"{name.lower()}@example.test", f3_name=name, home_region_id=REGION_ID)
                )
            session.flush()
            session.add(Org_x_SlackSpace(org_id=REGION_ID, slack_space_id=1))
            for user_id, name in F3_NAMES.items():
                session.add(
                    SlackUser(
                        slack_id=SLACK_IDS[user_id],
                        user_name=name,
                        email=f"{name.lower()}@example.test",
                        is_admin=False,
                        is_owner=False,
                        is_bot=False,
                        slack_team_id=TEAM_ID,
                        user_id=user_id,
                    )
                )
            session.flush()
        session.add(
            EventInstance(
                id=event_id,
                org_id=AO_ID,
                start_date=start_date,
                name=f"Event {event_id}",
                is_active=True,
                **event_fields,
            )
        )
        session.flush()
        session.add(EventType_x_EventInstance(event_instance_id=event_id, event_type_id=1))
        members = [(PAX_USER, Attendance_Type.pax)]
        if leaders:
            members += [(CO_Q_USER, Attendance_Type.co_q), (Q_USER, Attendance_Type.q)]
        for order, (user_id, attendance_type) in enumerate(members):
            session.add(
                Attendance(
                    event_instance_id=event_id,
                    user_id=user_id,
                    is_planned=is_planned,
                    created=datetime(2026, 1, 1) + timedelta(minutes=order),
                    attendance_type=attendance_type,
                    attendance_x_attendance_types=(
                        [Attendance_x_AttendanceType(attendance_type_id=attendance_type.value)] if with_links else []
                    ),
                )
            )
        session.commit()
    return event_id


def planned_attendance(engine, event_id: int = 100) -> dict[int, Attendance_Type]:
    """The event's planned attendance as {user_id: attendance_type}."""
    with Session(engine) as session:
        rows = session.execute(
            select(Attendance.user_id, Attendance.attendance_type).where(
                Attendance.event_instance_id == event_id, Attendance.is_planned
            )
        ).all()
    return dict(rows)
