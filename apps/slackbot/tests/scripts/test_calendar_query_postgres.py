import os
import subprocess
import sys
import time
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL
from sqlalchemy.orm import Session

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from scripts import calendar_images

POSTGRES_IMAGE = "postgres:18.6-trixie@sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280"
pytestmark = pytest.mark.skipif(
    os.environ.get("SLACKBOT_POSTGRES_TESTS") != "1",
    reason="set SLACKBOT_POSTGRES_TESTS=1 to run disposable-Postgres integration tests",
)


@pytest.fixture
def isolated_postgres():
    container_id = None
    engine = None
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
                "POSTGRES_USER=calendar_test",
                "--env",
                "POSTGRES_PASSWORD=calendar_test",
                "--env",
                "POSTGRES_DB=calendar_test",
                POSTGRES_IMAGE,
            ],
            text=True,
        ).strip()
        subprocess.run(["docker", "start", container_id], check=True, capture_output=True, text=True)
        published_port = subprocess.check_output(["docker", "port", container_id, "5432/tcp"], text=True).strip()
        port = int(published_port.rsplit(":", maxsplit=1)[1])
        url = URL.create(
            "postgresql+psycopg2",
            username="calendar_test",
            password="calendar_test",
            host="127.0.0.1",
            port=port,
            database="calendar_test",
        )
        engine = create_engine(url, pool_pre_ping=True)

        deadline = time.monotonic() + 30
        while True:
            try:
                with engine.connect() as connection:
                    connection.execute(text("SELECT 1"))
                break
            except Exception:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.2)

        with engine.begin() as connection:
            # Only columns touched by _build_calendar_query are needed here.
            for statement in (
                "CREATE TABLE orgs (id integer PRIMARY KEY, name text, description text, parent_id integer)",
                "CREATE TABLE event_instances (id integer PRIMARY KEY, start_date date, start_time time, "
                "updated timestamp, pax_count integer, series_exception text, org_id integer, location_id integer, "
                "is_active boolean)",
                "CREATE TABLE attendance (id integer PRIMARY KEY, event_instance_id integer, user_id integer, "
                "created timestamp, updated timestamp)",
                "CREATE TABLE attendance_x_attendance_types (attendance_id integer, attendance_type_id integer)",
                "CREATE TABLE users (id integer PRIMARY KEY, f3_name text)",
                "CREATE TABLE event_tags (id integer PRIMARY KEY, name text, color text)",
                "CREATE TABLE event_tags_x_event_instances (event_instance_id integer, event_tag_id integer)",
                "CREATE TABLE event_types (id integer PRIMARY KEY, name text, acronym text)",
                "CREATE TABLE event_instances_x_event_types (event_instance_id integer, event_type_id integer)",
                "CREATE TABLE locations (id integer PRIMARY KEY, name text, description text, address_street text)",
            ):
                connection.execute(text(statement))
        yield engine
    finally:
        if engine is not None:
            engine.dispose()
        if container_id:
            subprocess.run(["docker", "rm", "--force", container_id], check=True, capture_output=True, text=True)


def test_bounded_calendar_query_matches_legacy_global_q_subqueries(isolated_postgres):
    week_start = date(2026, 10, 5)
    overall_end = week_start + timedelta(weeks=3)
    with isolated_postgres.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO orgs (id, name, description, parent_id) VALUES "
                "(1, 'Region One', '', NULL), (2, 'Region Two', '', NULL), "
                "(11, 'AO One', '', 1), (22, 'AO Two', '', 2)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO users (id, f3_name) VALUES "
                "(101, 'First Q One'), (102, 'Second Q One'), (201, 'First Q Two')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO event_instances (id, start_date, start_time, updated, pax_count, series_exception, "
                "org_id, location_id, is_active) "
                "VALUES (1001, :event_date, '06:00', '2026-10-01 09:00:00', 0, NULL, 11, NULL, true), "
                "(2001, :event_date, '06:00', '2026-10-01 10:00:00', 0, NULL, 22, NULL, true)"
            ),
            {"event_date": week_start + timedelta(days=1)},
        )
        connection.execute(text("INSERT INTO event_types (id, name, acronym) VALUES (1, 'Workout', 'WO')"))
        connection.execute(
            text(
                "INSERT INTO event_instances_x_event_types (event_instance_id, event_type_id) "
                "VALUES (1001, 1), (2001, 1)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO attendance (id, event_instance_id, user_id, created, updated) VALUES "
                "(501, 1001, 101, '2026-09-20 06:00:00', '2026-10-01 11:00:00'), "
                "(502, 1001, 102, '2026-09-21 06:00:00', '2026-10-03 12:00:00'), "
                "(601, 2001, 201, '2026-09-22 06:00:00', '2026-10-02 13:00:00')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO attendance_x_attendance_types (attendance_id, attendance_type_id) "
                "VALUES (501, 2), (502, 2), (601, 2)"
            )
        )

    # This deliberately retains the pre-change unbounded attendance subqueries:
    # no region predicate is applied inside either Q lookup.
    with isolated_postgres.connect() as connection:
        legacy_q_rows = connection.execute(
            text(
                "WITH ranked_q AS ("
                " SELECT attendance.event_instance_id, attendance.user_id, "
                " row_number() OVER (PARTITION BY attendance.event_instance_id ORDER BY attendance.created) AS rn "
                " FROM attendance JOIN attendance_x_attendance_types "
                " ON attendance.id = attendance_x_attendance_types.attendance_id "
                " WHERE attendance_x_attendance_types.attendance_type_id = 2 "
                "), q_updates AS ("
                " SELECT attendance.event_instance_id, max(attendance.updated) AS q_last_updated "
                " FROM attendance JOIN attendance_x_attendance_types "
                " ON attendance.id = attendance_x_attendance_types.attendance_id "
                " WHERE attendance_x_attendance_types.attendance_type_id = 2 "
                " GROUP BY attendance.event_instance_id"
                ") SELECT event_instances.id, event_instances.start_date, orgs.name, users.f3_name, "
                "q_updates.q_last_updated "
                "FROM event_instances LEFT JOIN ranked_q "
                "ON event_instances.id = ranked_q.event_instance_id AND ranked_q.rn = 1 "
                "LEFT JOIN users ON users.id = ranked_q.user_id "
                "LEFT JOIN q_updates ON event_instances.id = q_updates.event_instance_id "
                "JOIN orgs ON event_instances.org_id = orgs.id "
                "WHERE event_instances.start_date >= :week_start AND event_instances.start_date < :overall_end "
                "AND event_instances.is_active ORDER BY event_instances.id"
            ),
            {"week_start": week_start, "overall_end": overall_end},
        ).all()

    legacy_by_event = {
        event_id: (event_date, ao_name, q_name, q_updated)
        for event_id, event_date, ao_name, q_name, q_updated in legacy_q_rows
    }
    with Session(isolated_postgres) as session:
        query, region_org = calendar_images._build_calendar_query(session, week_start, overall_end)
        for region_id, expected_event_id, expected_name in (
            (1, 1001, "First Q One"),
            (2, 2001, "First Q Two"),
        ):
            actual_rows = (
                query.filter(region_org.id == region_id)
                .params(**{calendar_images.CALENDAR_REGION_BIND_PARAMETER: region_id})
                .order_by(calendar_images.EventInstance.id)
                .all()
            )
            expected = legacy_by_event[expected_event_id]
            assert [(row.start_date, row.ao_name, row.q_name, row.q_last_updated) for row in actual_rows] == [expected]
            assert expected == (
                week_start + timedelta(days=1),
                "AO One" if region_id == 1 else "AO Two",
                expected_name,
                datetime(2026, 10, 3, 12) if region_id == 1 else datetime(2026, 10, 2, 13),
            )
