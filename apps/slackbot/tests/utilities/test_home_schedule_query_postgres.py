import datetime
import os
import subprocess
import sys
import time

import pytest
from f3_data_models.models import (
    Attendance,
    Attendance_x_AttendanceType,
    AttendanceType,
    Base,
    EventInstance,
    EventType,
    EventType_x_EventInstance,
    Org,
    Org_Type,
    User,
)
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL
from sqlalchemy.orm import Session, sessionmaker

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from utilities.database import special_queries  # noqa: E402

POSTGRES_IMAGE = os.environ.get(
    "SLACKBOT_POSTGRES_IMAGE",
    "postgres:18.6-trixie@sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280",
)
pytestmark = pytest.mark.skipif(
    os.environ.get("SLACKBOT_POSTGRES_TESTS") != "1",
    reason="set SLACKBOT_POSTGRES_TESTS=1 to run disposable-Postgres integration tests",
)

START = datetime.date(2026, 12, 1)
HC, Q = 1, 2


@pytest.fixture
def engine(monkeypatch):
    container_id = None
    db_engine = None
    try:
        container_id = subprocess.check_output(
            [
                "docker",
                "create",
                "--tmpfs",
                "/var/lib/postgresql:rw",
                "--publish",
                "127.0.0.1::5432",
                "--env",
                "POSTGRES_USER=home_test",
                "--env",
                "POSTGRES_PASSWORD=home_test",
                "--env",
                "POSTGRES_DB=home_test",
                POSTGRES_IMAGE,
            ],
            text=True,
        ).strip()
        subprocess.run(["docker", "start", container_id], check=True, capture_output=True, text=True)
        published_port = subprocess.check_output(["docker", "port", container_id, "5432/tcp"], text=True).strip()
        url = URL.create(
            "postgresql+psycopg2",
            username="home_test",
            password="home_test",
            host="127.0.0.1",
            port=int(published_port.rsplit(":", maxsplit=1)[1]),
            database="home_test",
        )
        db_engine = create_engine(url, pool_pre_ping=True)
        deadline = time.monotonic() + 30
        while True:
            try:
                with db_engine.connect() as connection:
                    connection.execute(text("SELECT 1"))
                break
            except Exception:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.2)

        with db_engine.begin() as connection:
            connection.execute(text("CREATE EXTENSION citext"))
            for schema in {t.schema for t in Base.metadata.tables.values() if t.schema}:
                connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        Base.metadata.create_all(db_engine)
        session_factory = sessionmaker(bind=db_engine)
        monkeypatch.setattr(special_queries, "get_session", lambda backend=None: session_factory())
        yield db_engine
    finally:
        if db_engine is not None:
            db_engine.dispose()
        if container_id:
            subprocess.run(["docker", "rm", "--force", container_id], check=True, capture_output=True, text=True)


@pytest.fixture
def schedule(engine):
    """A region with one AO; event ids are inserted out of date order so ordering comes from the query."""
    with Session(engine) as session:
        session.add_all(
            [
                Org(id=100, org_type=Org_Type.region, name="Region", is_active=True),
                Org(id=10, parent_id=100, org_type=Org_Type.ao, name="The Forge", is_active=True),
                EventType(id=1, name="Bootcamp", event_category="first_f"),
                EventType(id=2, name="Ruck", event_category="first_f"),
                AttendanceType(id=HC, type="PAX"),
                AttendanceType(id=Q, type="Q"),
                User(id=1, f3_name="Viewer", email="viewer@example.invalid"),
                User(id=2, f3_name="Chip", email="chip@example.invalid"),
                User(id=3, f3_name="Dale", email="dale@example.invalid"),
            ]
        )
        session.flush()
        day_offsets = {5: 0, 3: 1, 4: 1, 1: 2, 2: 3}
        for event_id, offset in day_offsets.items():
            session.add(
                EventInstance(
                    id=event_id,
                    org_id=10,
                    name=f"Event {event_id}",
                    start_date=START + datetime.timedelta(days=offset),
                    start_time="0515",
                    is_active=True,
                    highlight=False,
                )
            )
        session.flush()
        # Event 6 has no event type, so the schedule leaves it out.
        session.add(
            EventInstance(
                id=6, org_id=10, name="Event 6", start_date=START, start_time="0515", is_active=True, highlight=False
            )
        )
        session.flush()
        session.add_all([EventType_x_EventInstance(event_instance_id=i, event_type_id=1) for i in day_offsets])
        # Event 3 has two event types: it must still come back as one schedule entry.
        session.add(EventType_x_EventInstance(event_instance_id=3, event_type_id=2))
        session.flush()
        for attendance_id, user_id, types in [(1, 2, [Q]), (2, 1, [HC]), (3, 3, [HC])]:
            session.add(Attendance(id=attendance_id, event_instance_id=3, user_id=user_id, is_planned=True))
            session.flush()
            session.add_all(
                [Attendance_x_AttendanceType(attendance_id=attendance_id, attendance_type_id=t) for t in types]
            )
        session.commit()
    return engine


def _base_filters():
    return [EventInstance.start_date >= START, EventInstance.is_active, Org.parent_id.in_([100])]


def test_event_with_two_types_is_listed_once_with_both_types(schedule):
    results = special_queries.home_schedule_query(1, _base_filters(), limit=10)

    assert [r.event.id for r in results] == [5, 3, 4, 1, 2]
    two_type_event = next(r for r in results if r.event.id == 3)
    assert sorted(t.name for t in two_type_event.event_types) == ["Bootcamp", "Ruck"]


def test_a_days_events_are_latest_start_first_then_by_ao_name(schedule):
    """Ids run against the expected order, and the time-less event sorts after the timed ones."""
    day = START + datetime.timedelta(days=4)
    with Session(schedule) as session:
        session.add(Org(id=11, parent_id=100, org_type=Org_Type.ao, name="Brickyard", is_active=True))
        session.flush()
        for event_id, org_id, start_time in [(7, 10, "0600"), (8, 11, "0515"), (9, 10, "0515"), (10, 11, "0600"),
                                             (11, 11, None)]:  # fmt: skip
            session.add(
                EventInstance(
                    id=event_id,
                    org_id=org_id,
                    name=f"Event {event_id}",
                    start_date=day,
                    start_time=start_time,
                    is_active=True,
                    highlight=False,
                )
            )
            session.flush()
            session.add(EventType_x_EventInstance(event_instance_id=event_id, event_type_id=1))
        session.commit()

    results = special_queries.home_schedule_query(1, [*_base_filters(), EventInstance.start_date == day], limit=10)

    assert [r.event.id for r in results] == [10, 7, 8, 9, 11]


def test_event_type_filter_matches_any_of_an_events_types(schedule):
    filters = [*_base_filters(), EventInstance.event_types.any(EventType.id.in_([2]))]

    results = special_queries.home_schedule_query(1, filters, limit=10)

    assert [r.event.id for r in results] == [3]
    assert sorted(t.name for t in results[0].event_types) == ["Bootcamp", "Ruck"]


def test_offset_pages_through_events_without_gaps_or_repeats(schedule):
    pages = [special_queries.home_schedule_query(1, _base_filters(), limit=2, offset=o) for o in (0, 2, 4)]

    assert [[r.event.id for r in page] for page in pages] == [[5, 3], [4, 1], [2]]


def test_attendance_counts_and_viewer_flags(schedule):
    results = special_queries.home_schedule_query(1, _base_filters(), limit=10)
    by_id = {r.event.id: r for r in results}

    assert by_id[3].hc_count == 3
    assert by_id[3].planned_qs == "Chip"
    assert by_id[3].user_attending == 1
    assert not by_id[3].user_q
    assert not by_id[4].hc_count


@pytest.mark.parametrize(
    ("kwargs", "expected_ids"),
    [({"only_users_events": True}, [3]), ({"open_q_only": True}, [5, 4, 1, 2])],
)
def test_attendance_filters_list_each_event_once(schedule, kwargs, expected_ids):
    results = special_queries.home_schedule_query(1, _base_filters(), limit=10, **kwargs)

    assert [r.event.id for r in results] == expected_ids
    if 3 in expected_ids:
        assert sorted(t.name for t in results[0].event_types) == ["Bootcamp", "Ruck"]


def test_attendance_filters_page_with_offset(schedule):
    first = special_queries.home_schedule_query(1, _base_filters(), limit=2, open_q_only=True)
    second = special_queries.home_schedule_query(1, _base_filters(), limit=2, offset=2, open_q_only=True)

    assert [r.event.id for r in first] == [5, 4]
    assert [r.event.id for r in second] == [1, 2]
