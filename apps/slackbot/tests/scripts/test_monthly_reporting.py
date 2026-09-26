import os
import sys
from datetime import datetime
from types import SimpleNamespace

import pytest
from sqlalchemy import Boolean, Column, DateTime, Integer, MetaData, String, Table, create_engine, event
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from scripts import monthly_reporting


class January2025:
    def __new__(cls, *args, **kwargs):
        return datetime(*args, **kwargs)

    @classmethod
    def now(cls, tz=None):
        return datetime(2025, 1, 15, 12, 0, 0, tzinfo=tz)


@pytest.fixture
def reporting_session(monkeypatch):
    engine = create_engine("sqlite+pysqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def register_date_trunc(connection, _record):
        def date_trunc(unit, value):
            if value is None:
                return None
            date_value = datetime.fromisoformat(value)
            if unit == "month":
                truncated = date_value.replace(day=1)
            elif unit == "year":
                truncated = date_value.replace(month=1, day=1)
            else:
                raise ValueError(f"Unsupported date_trunc unit: {unit}")
            return truncated.strftime("%Y-%m-%d %H:%M:%S.%f")

        connection.create_function("date_trunc", 2, date_trunc)

    metadata = MetaData()
    orgs = Table(
        "orgs",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("parent_id", Integer),
        Column("org_type", String),
        Column("name", String),
    )
    events = Table(
        "event_instances",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("org_id", Integer),
        Column("start_date", DateTime),
        Column("pax_count", Integer),
        Column("fng_count", Integer),
        Column("is_active", Boolean),
    )
    attendance = Table(
        "attendance",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("event_instance_id", Integer),
        Column("user_id", Integer),
        Column("is_planned", Boolean),
    )
    attendance_types = Table(
        "attendance_types",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("type", String),
    )
    attendance_type_links = Table(
        "attendance_x_attendance_types",
        metadata,
        Column("attendance_id", Integer, primary_key=True),
        Column("attendance_type_id", Integer, primary_key=True),
    )
    users = Table(
        "users",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("f3_name", String),
        Column("avatar_url", String),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            orgs.insert(),
            [
                {"id": 100, "parent_id": None, "org_type": "region", "name": "North"},
                {"id": 10, "parent_id": 100, "org_type": "ao", "name": "Alpha"},
                {"id": 200, "parent_id": None, "org_type": "region", "name": "South"},
                {"id": 300, "parent_id": None, "org_type": "area", "name": "Area"},
            ],
        )
        connection.execute(
            events.insert(),
            [
                {
                    "id": 1,
                    "org_id": 10,
                    "start_date": datetime(2024, 12, 2),
                    "pax_count": 5,
                    "fng_count": 1,
                    "is_active": True,
                },
                {
                    "id": 2,
                    "org_id": 10,
                    "start_date": datetime(2024, 12, 9),
                    "pax_count": 3,
                    "fng_count": 0,
                    "is_active": True,
                },
                {
                    "id": 3,
                    "org_id": 200,
                    "start_date": datetime(2024, 12, 12),
                    "pax_count": 2,
                    "fng_count": 1,
                    "is_active": True,
                },
                {
                    "id": 4,
                    "org_id": 10,
                    "start_date": datetime(2024, 2, 1),
                    "pax_count": 4,
                    "fng_count": 0,
                    "is_active": True,
                },
                {
                    "id": 5,
                    "org_id": 10,
                    "start_date": datetime(2024, 12, 15),
                    "pax_count": 7,
                    "fng_count": 2,
                    "is_active": False,
                },
                {
                    "id": 6,
                    "org_id": 10,
                    "start_date": datetime(2024, 12, 16),
                    "pax_count": None,
                    "fng_count": 3,
                    "is_active": True,
                },
                {
                    "id": 7,
                    "org_id": 10,
                    "start_date": datetime(2025, 1, 2),
                    "pax_count": 9,
                    "fng_count": 4,
                    "is_active": True,
                },
                {
                    "id": 8,
                    "org_id": 300,
                    "start_date": datetime(2024, 12, 20),
                    "pax_count": 6,
                    "fng_count": 1,
                    "is_active": True,
                },
                {
                    "id": 9,
                    "org_id": 10,
                    "start_date": datetime(2022, 12, 10),
                    "pax_count": 2,
                    "fng_count": 0,
                    "is_active": True,
                },
            ],
        )
        connection.execute(
            users.insert(),
            [
                {"id": 1, "f3_name": "PAX One", "avatar_url": None},
                {"id": 2, "f3_name": "PAX Two", "avatar_url": None},
                {"id": 3, "f3_name": "Planned Only", "avatar_url": None},
                {"id": 4, "f3_name": "No Type", "avatar_url": None},
            ],
        )
        connection.execute(
            attendance.insert(),
            [
                {"id": 11, "event_instance_id": 1, "user_id": 1, "is_planned": False},
                {"id": 12, "event_instance_id": 1, "user_id": 3, "is_planned": True},
                {"id": 21, "event_instance_id": 2, "user_id": 1, "is_planned": False},
                {"id": 22, "event_instance_id": 2, "user_id": 2, "is_planned": False},
                {"id": 24, "event_instance_id": 2, "user_id": 4, "is_planned": False},
                {"id": 31, "event_instance_id": 3, "user_id": 1, "is_planned": False},
                {"id": 41, "event_instance_id": 4, "user_id": 1, "is_planned": False},
                {"id": 51, "event_instance_id": 5, "user_id": 1, "is_planned": False},
                {"id": 61, "event_instance_id": 6, "user_id": 2, "is_planned": False},
                {"id": 71, "event_instance_id": 7, "user_id": 1, "is_planned": False},
                {"id": 81, "event_instance_id": 8, "user_id": 1, "is_planned": False},
                {"id": 91, "event_instance_id": 9, "user_id": 2, "is_planned": False},
            ],
        )
        connection.execute(
            attendance_types.insert(),
            [{"id": 1, "type": "Q"}, {"id": 2, "type": "Co-Q"}, {"id": 3, "type": "CoQ"}],
        )
        connection.execute(
            attendance_type_links.insert(),
            [
                {"attendance_id": 11, "attendance_type_id": 1},
                {"attendance_id": 12, "attendance_type_id": 1},
                {"attendance_id": 22, "attendance_type_id": 2},
                {"attendance_id": 31, "attendance_type_id": 1},
                {"attendance_id": 31, "attendance_type_id": 2},
                {"attendance_id": 31, "attendance_type_id": 3},
                {"attendance_id": 41, "attendance_type_id": 1},
                {"attendance_id": 51, "attendance_type_id": 1},
                {"attendance_id": 61, "attendance_type_id": 1},
                {"attendance_id": 71, "attendance_type_id": 1},
                {"attendance_id": 81, "attendance_type_id": 1},
                {"attendance_id": 91, "attendance_type_id": 3},
            ],
        )

    session = Session(engine)
    monkeypatch.setattr(monthly_reporting, "get_session", lambda: session)
    monkeypatch.setattr(monthly_reporting, "datetime", January2025)
    yield session
    session.close()
    engine.dispose()


class FakeRow:
    def __init__(self, values):
        self.values = values
        self._mapping = values

    def __getattr__(self, key):
        return self.values[key]

    def _asdict(self):
        return self.values


class FakeSession:
    def __init__(self, values):
        self.values = values
        self.statement = None
        self.closed = False

    def execute(self, statement):
        self.statement = statement
        return SimpleNamespace(all=lambda: [FakeRow(value) for value in self.values])

    def close(self):
        self.closed = True


def sql_for(statement):
    return str(statement.compile(dialect=postgresql.dialect()))


def test_leaderboard_queries_base_tables_and_preserve_report_rows(monkeypatch):
    session = FakeSession(
        [
            {
                "org_id": 12,
                "org_name": "AO",
                "basis": "month",
                "user_id": 34,
                "f3_name": "PAX",
                "avatar_url": "https://example.test/avatar.png",
                "post_count": 2,
                "total_qs": 1,
            }
        ]
    )
    monkeypatch.setattr(monthly_reporting, "get_session", lambda: session)

    results = monthly_reporting.pull_org_leaderboard_data()

    sql = sql_for(session.statement)
    assert "event_instance_expanded" not in sql
    assert "attendance_expanded" not in sql
    assert "event_instances" in sql
    assert "attendance_x_attendance_types" in sql
    assert "attendance_types" in sql
    assert "users" in sql
    assert "sum(CASE" in sql
    compiled = session.statement.compile(dialect=postgresql.dialect())
    bind_values = [
        value
        for parameter in compiled.params.values()
        for value in (parameter if isinstance(parameter, (list, tuple)) else [parameter])
    ]
    assert "Q" in bind_values
    assert "Co-Q" in bind_values
    assert "CoQ" in bind_values
    assert "event_org.org_type" in sql
    assert "event_parent_org.org_type" in sql
    assert "event_instances.pax_count IS NOT NULL" in sql
    assert "event_instances.is_active IS true" in sql
    assert "attendance.is_planned IS false" in sql
    assert "date_trunc" in sql
    assert "attendance_type_counts" in sql
    assert session.closed
    assert results == {
        12: [
            monthly_reporting.OrgUserLeaderboard(
                basis="month",
                org_id=12,
                org_name="AO",
                user_id=34,
                f3_name="PAX",
                avatar_url="https://example.test/avatar.png",
                post_count=2,
                total_qs=1,
            )
        ]
    }


def test_monthly_summary_queries_base_tables_and_preserves_summary_shape(monkeypatch):
    session = FakeSession(
        [
            {
                "org_id": 56,
                "month": datetime(2026, 5, 1),
                "event_count": 3,
                "total_posts": 18,
                "total_fngs": 2,
                "unique_pax_count": 7,
            }
        ]
    )
    monkeypatch.setattr(monthly_reporting, "get_session", lambda: session)

    results = monthly_reporting.pull_org_summary_data()

    sql = sql_for(session.statement)
    assert "event_instance_expanded" not in sql
    assert "attendance_expanded" not in sql
    assert "event_instances" in sql
    assert "attendance.is_planned IS false" in sql
    assert "event_org.org_type" in sql
    assert "event_parent_org.org_type" in sql
    assert "event_instances.pax_count IS NOT NULL" in sql
    assert "event_instances.is_active IS true" in sql
    assert "date_trunc" in sql
    compiled = session.statement.compile(dialect=postgresql.dialect())
    assert any("start_date" in key for key in compiled.params)
    assert session.closed
    assert results == {
        56: [
            monthly_reporting.OrgMonthlySummary(
                org_id=56,
                month=datetime(2026, 5, 1),
                event_count=3,
                total_posts=18,
                total_fngs=2,
                unique_pax_count=7,
            )
        ]
    }


def test_type_aggregate_is_scoped_to_current_year_reportable_attendance(monkeypatch):
    session = FakeSession([])
    monkeypatch.setattr(monthly_reporting, "get_session", lambda: session)
    monkeypatch.setattr(monthly_reporting, "datetime", January2025)

    monthly_reporting.pull_org_leaderboard_data()

    compiled = session.statement.compile(dialect=postgresql.dialect())
    sql = str(compiled)
    aggregate_start = sql.index("SELECT attendance_x_attendance_types.attendance_id AS attendance_id")
    aggregate_end = sql.index(") AS attendance_type_counts", aggregate_start)
    aggregate_sql = sql[aggregate_start:aggregate_end]

    assert "JOIN attendance ON attendance.id = attendance_x_attendance_types.attendance_id" in aggregate_sql
    assert "JOIN event_instances ON event_instances.id = attendance.event_instance_id" in aggregate_sql
    assert "attendance.is_planned IS false" in aggregate_sql
    assert "event_instances.is_active IS true" in aggregate_sql
    assert "event_instances.pax_count IS NOT NULL" in aggregate_sql
    assert "event_instances.start_date >=" in aggregate_sql
    assert "event_instances.start_date <" in aggregate_sql
    assert "event_org" not in aggregate_sql  # No repeated hierarchy joins in the type aggregate.
    assert datetime(2024, 1, 1) in compiled.params.values()
    assert datetime(2025, 1, 1) in compiled.params.values()


def test_leaderboard_executes_with_january_year_boundary_and_null_type_semantics(reporting_session):
    results = monthly_reporting.pull_org_leaderboard_data()

    rows = {(record.org_id, record.basis, record.user_id): record for records in results.values() for record in records}
    assert set(results) == {10, 100, 200}
    assert rows[(10, "month", 1)].post_count == 2
    assert rows[(10, "month", 1)].total_qs == 1
    assert rows[(10, "month", 2)].total_qs == 1  # Co-Q
    assert rows[(10, "month", 4)].total_qs == 0  # Actual attendance with no type link.
    assert rows[(10, "year", 1)].post_count == 3  # Includes February, but not January 2025
    assert rows[(100, "month", 1)].post_count == 2  # AO events roll up to their parent region.
    assert rows[(100, "month", 1)].total_qs == 1
    assert rows[(200, "month", 1)].post_count == 1  # Direct-region organization
    assert rows[(200, "month", 1)].total_qs == 3  # Q, Co-Q, and legacy CoQ all count.
    assert rows[(10, "month", 2)].post_count == 1  # 2022 CoQ attendance is outside the report year.
    assert rows[(10, "month", 2)].total_qs == 1
    assert (10, "month", 3) not in rows  # Planned attendance is excluded


def test_monthly_summary_executes_filters_and_counts_distinct_actual_users(reporting_session):
    results = monthly_reporting.pull_org_summary_data()

    def month_key(record):
        return record.month.strftime("%Y-%m-%d") if isinstance(record.month, datetime) else str(record.month)[:10]

    assert set(results) == {10, 100, 200}
    ao_december = next(record for record in results[10] if month_key(record) == "2024-12-01")
    assert ao_december.event_count == 2
    assert ao_december.total_posts == 8
    assert ao_december.total_fngs == 1
    assert ao_december.unique_pax_count == 3  # User 1 across events counts once; planned user 3 is excluded.

    region_december = next(record for record in results[100] if month_key(record) == "2024-12-01")
    assert region_december.event_count == 2  # The AO's parent region receives its two AO events.
    assert region_december.total_posts == 8
    assert region_december.total_fngs == 1
    assert region_december.unique_pax_count == 3

    direct_region = next(record for record in results[200] if month_key(record) == "2024-12-01")
    assert direct_region.event_count == 1
    assert direct_region.unique_pax_count == 1
    assert all(month_key(record) < "2025-01-01" for records in results.values() for record in records)


def test_leaderboard_chart_sorts_mixed_typed_and_untyped_attendance(monkeypatch, tmp_path):
    pytest.importorskip("matplotlib")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(monthly_reporting, "stitch_2x2", lambda *_args, **_kwargs: "stitched.png")
    records = [
        monthly_reporting.OrgUserLeaderboard(
            basis="month",
            org_id=10,
            org_name="Alpha",
            user_id=1,
            f3_name="Typed PAX",
            avatar_url=None,
            post_count=2,
            total_qs=1,
        ),
        monthly_reporting.OrgUserLeaderboard(
            basis="month",
            org_id=10,
            org_name="Alpha",
            user_id=2,
            f3_name="Untyped PAX",
            avatar_url=None,
            post_count=1,
            total_qs=0,
        ),
    ]

    result = monthly_reporting.create_post_leaders_plot(records)

    assert result == "stitched.png"
    assert (tmp_path / "month_Q_leaders.png").is_file()
    assert (tmp_path / "year_Q_leaders.png").is_file()
