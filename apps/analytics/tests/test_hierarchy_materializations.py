from datetime import date, datetime, timezone
from pathlib import Path

import duckdb

SQL = Path(__file__).parents[1] / "analytics" / "sql"
REFRESHED = "2026-08-26T12:00:00+00:00"


def fixture() -> duckdb.DuckDBPyConnection:
    db = duckdb.connect(":memory:")
    db.execute("ATTACH ':memory:' AS pg")
    db.execute("CREATE SCHEMA pg.public")
    db.execute(
        "CREATE TABLE pg.public.orgs (id INTEGER, parent_id INTEGER, name VARCHAR, logo_url VARCHAR, "
        "is_active BOOLEAN, org_type VARCHAR)"
    )
    db.execute(
        "CREATE TABLE pg.public.event_instances ("
        "id INTEGER, series_id INTEGER, org_id INTEGER, location_id INTEGER, "
        "is_active BOOLEAN, start_date DATE, start_time VARCHAR, name VARCHAR, pax_count INTEGER)"
    )
    db.execute("CREATE TABLE pg.public.events (id INTEGER, name VARCHAR)")
    db.execute("CREATE TABLE pg.public.locations (id INTEGER, name VARCHAR)")
    db.execute("CREATE TABLE pg.public.event_types (id INTEGER, name VARCHAR, event_category VARCHAR)")
    db.execute(
        "CREATE TABLE pg.public.event_instances_x_event_types (event_instance_id INTEGER, event_type_id INTEGER)"
    )
    db.execute("CREATE TABLE pg.public.event_tags_x_event_instances (event_instance_id INTEGER, event_tag_id INTEGER)")
    db.execute("CREATE TABLE pg.public.event_tags (id INTEGER, name VARCHAR)")
    db.execute("CREATE TABLE pg.public.users (id INTEGER, f3_name VARCHAR, avatar_url VARCHAR)")
    db.execute(
        "CREATE TABLE pg.public.attendance (id INTEGER, user_id INTEGER, event_instance_id INTEGER, is_planned BOOLEAN)"
    )
    db.execute("CREATE TABLE pg.public.attendance_types (id INTEGER, type VARCHAR)")
    db.execute(
        "CREATE TABLE pg.public.attendance_x_attendance_types (attendance_id INTEGER, attendance_type_id INTEGER)"
    )
    db.executemany(
        "INSERT INTO pg.public.orgs VALUES (?, ?, ?, ?, ?, ?)",
        [
            (900, None, "Sector", "sector-logo", True, "sector"),
            (901, 900, "Area", "area-logo", False, "area"),
            (902, 900, "Other Area", None, True, "area"),
            (903, 901, "Region", None, True, "region"),
            (904, 901, "Quiet Region", None, False, "region"),
            (905, 903, "AO", "ao-logo", False, "ao"),
            (906, 903, "Not AO", None, True, "region"),
        ],
    )
    db.executemany("INSERT INTO pg.public.events VALUES (?, ?)", [(700, "Workout")])
    db.executemany("INSERT INTO pg.public.locations VALUES (?, ?)", [(800, "Park")])
    db.executemany(
        "INSERT INTO pg.public.event_types VALUES (?, ?, ?)",
        [(1, "Run", "first_f"), (2, "Q", "second_f"), (3, "Jog", "first_f")],
    )
    db.executemany(
        "INSERT INTO pg.public.event_instances VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (600, 700, 905, 800, True, "2026-08-27", "06:00", "Workout", 10),
            (601, 700, 905, 800, True, "2026-08-26", "06:00", "Workout", 10),
            (602, 700, 905, 800, False, "2026-09-01", "06:00", "Workout", 10),
            (603, 700, 905, 800, True, "2026-09-01", "06:00", "Workout", None),
        ],
    )
    db.executemany(
        "INSERT INTO pg.public.event_instances_x_event_types VALUES (?, ?)",
        [(600, 1), (600, 2), (600, 3), (601, 1), (603, 2)],
    )
    db.execute("INSERT INTO pg.public.event_tags VALUES (10, 'Hill')")
    db.execute("INSERT INTO pg.public.event_tags_x_event_instances VALUES (600, 10)")
    db.execute("INSERT INTO pg.public.users VALUES (1, 'Q', 'avatar')")
    db.execute("INSERT INTO pg.public.attendance_types VALUES (1, 'Q'), (2, 'Planned')")
    db.execute("INSERT INTO pg.public.attendance VALUES (1, 1, 600, true)")
    db.execute("INSERT INTO pg.public.attendance_x_attendance_types VALUES (1, 1)")
    return db


def run(db: duckdb.DuckDBPyConnection, name: str):
    return db.execute((SQL / name).read_text(), [REFRESHED, "2026-08-26"]).fetchall()


def test_areas_and_sectors_keep_inactive_rows_and_order_nested_values():
    db = fixture()
    areas = run(db, "pv_areas.sql")
    assert areas[0][0:4] == (901, "Area", 900, "Sector")
    assert areas[0][4:6] == ("area-logo", False)
    assert areas[0][6] == [
        {"region_id": 904, "region_name": "Quiet Region", "is_active": False},
        {"region_id": 903, "region_name": "Region", "is_active": True},
    ]
    assert areas[1][6] == []
    assert run(db, "pv_sectors.sql")[0][2:5] == ("sector-logo", True, [
        {"area_id": 901, "area_name": "Area", "is_active": False},
        {"area_id": 902, "area_name": "Other Area", "is_active": True},
    ])


def test_aos_observe_only_active_non_null_pax_events_and_has_nested_schema():
    db = fixture()
    row = run(db, "pv_aos.sql")[0]
    assert row[0] == datetime(2026, 8, 26, 12, tzinfo=timezone.utc)
    assert row[1:7] == (905, "AO", 903, "Region", "ao-logo", False)
    assert row[7] == [
        {"type_id": 3, "type_name": "Jog"},
        {"type_id": 2, "type_name": "Q"},
        {"type_id": 1, "type_name": "Run"},
    ]
    assert row[8] == [{"tag_id": 10, "tag_name": "Hill"}]
    columns = db.execute(
        f"DESCRIBE SELECT * FROM ({(SQL / 'pv_aos.sql').read_text()})", [REFRESHED, "2026-08-26"]
    ).fetchall()
    assert ("types", "STRUCT(type_id INTEGER, type_name VARCHAR)[]") in [(column[0], column[1]) for column in columns]


def test_upcoming_uses_strict_date_cutoff_and_ordered_q_list():
    db = fixture()
    rows = run(db, "pv_upcoming.sql")
    assert len(rows) == 3
    rows_600 = [row for row in rows if row[1] == date(2026, 8, 27)]
    assert {row[9] for row in rows_600} == {"first_f", "second_f"}
    row = next(row for row in rows_600 if row[9] == "first_f")
    assert row[0] == datetime(2026, 8, 26, 12, tzinfo=timezone.utc)
    assert row[1:] == (
        date(2026, 8, 27),
        "06:00",
        "AO",
        905,
        903,
        "Park",
        "Workout",
        "Jog, Run",
        "first_f",
        [{"user_id": 1, "f3_name": "Q", "avatar_url": "avatar"}],
    )


def test_upcoming_keeps_standalone_instance_without_series_or_ao():
    db = fixture()
    db.execute(
        "INSERT INTO pg.public.event_instances VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (604, 999, 999, 800, True, "2026-09-02", "07:00", "Standalone", 10),
    )
    db.execute("INSERT INTO pg.public.event_instances_x_event_types VALUES (604, 1)")

    row = run(db, "pv_upcoming.sql")[-1]
    assert row[1:] == (
        date(2026, 9, 2),
        "07:00",
        None,
        None,
        None,
        "Park",
        "Standalone",
        "Run",
        "first_f",
        [],
    )

    db.execute(
        "INSERT INTO pg.public.event_instances VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (605, 700, 906, 800, True, "2026-09-03", "07:00", None, 10),
    )
    db.execute("INSERT INTO pg.public.event_instances_x_event_types VALUES (605, 1)")
    row = run(db, "pv_upcoming.sql")[-1]
    assert row[1:] == (
        date(2026, 9, 3),
        "07:00",
        "Not AO",
        906,
        903,
        "Park",
        "Workout",
        "Run",
        "first_f",
        [],
    )


def test_upcoming_q_list_ignores_planned_flag_but_requires_q_type():
    db = fixture()
    db.execute("INSERT INTO pg.public.users VALUES (2, 'Alpha', 'alpha-avatar')")
    db.execute("INSERT INTO pg.public.users VALUES (3, 'Beta', 'beta-avatar')")
    db.execute("INSERT INTO pg.public.attendance VALUES (2, 2, 603, false), (3, 1, 603, true), (4, 3, 603, false)")
    db.execute("INSERT INTO pg.public.attendance_x_attendance_types VALUES (2, 1), (3, 1), (4, 2)")

    row = next(row for row in run(db, "pv_upcoming.sql") if row[1] == date(2026, 9, 1))
    assert row[-1] == [
        {"user_id": 2, "f3_name": "Alpha", "avatar_url": "alpha-avatar"},
        {"user_id": 1, "f3_name": "Q", "avatar_url": "avatar"},
    ]


def test_physical_nested_schema_is_list_of_structs():
    db = fixture()
    for name, expected in (
        ("pv_areas.sql", ["area_id", "area_name", "sector_id", "sector_name", "logo_url", "is_active", "regions"]),
        ("pv_sectors.sql", ["sector_id", "sector_name", "logo_url", "is_active", "areas"]),
        (
            "pv_aos.sql",
            ["refreshed_at", "ao_id", "ao_name", "region_id", "region_name", "logo_url", "is_active", "types", "tags"],
        ),
        (
            "pv_upcoming.sql",
            [
                "refreshed_at",
                "start_date",
                "start_time",
                "ao_name",
                "ao_org_id",
                "region_org_id",
                "location_name",
                "event_name",
                "event_type",
                "event_category",
                "q_list",
            ],
        ),
    ):
        columns = db.execute(
            f"DESCRIBE SELECT * FROM ({(SQL / name).read_text()})", [REFRESHED, "2026-08-26"]
        ).fetchall()
        assert [column[0] for column in columns] == expected
