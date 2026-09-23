from datetime import date
from pathlib import Path

import duckdb

from analytics.materializations import select_materializations
from analytics.schema_registry import SCHEMAS_BY_NAME
from analytics.source import materialize

SQL_DIR = Path(__file__).parents[1] / "analytics" / "sql"
PARAMS = ["2026-08-26T12:00:00+00:00", "2026-08-26"]


def fixture() -> duckdb.DuckDBPyConnection:
    db = duckdb.connect(":memory:")
    db.execute("ATTACH ':memory:' AS pg")
    db.execute("CREATE SCHEMA pg.public")
    db.execute(
        "CREATE TABLE pg.public.event_instances ("
        "id INTEGER, org_id INTEGER, location_id INTEGER, series_id INTEGER, highlight BOOLEAN, "
        "start_date DATE, end_date DATE, start_time VARCHAR, end_time VARCHAR, name VARCHAR, "
        "description VARCHAR, pax_count INTEGER, fng_count INTEGER, preblast VARCHAR, backblast VARCHAR, "
        "meta JSON, created TIMESTAMP, updated TIMESTAMP, is_active BOOLEAN)"
    )
    db.execute("CREATE TABLE pg.public.events (id INTEGER, name VARCHAR, description VARCHAR)")
    db.execute(
        "CREATE TABLE pg.public.orgs (id INTEGER, parent_id INTEGER, org_type VARCHAR, name VARCHAR, "
        "description VARCHAR, logo_url VARCHAR, website VARCHAR, meta JSON)"
    )
    db.execute(
        "CREATE TABLE pg.public.locations (id INTEGER, name VARCHAR, description VARCHAR, "
        "latitude DOUBLE, longitude DOUBLE)"
    )
    db.execute("CREATE TABLE pg.public.event_types (id INTEGER, name VARCHAR, event_category VARCHAR)")
    db.execute(
        "CREATE TABLE pg.public.event_instances_x_event_types (event_instance_id INTEGER, event_type_id INTEGER)"
    )
    db.execute("CREATE TABLE pg.public.event_tags (id INTEGER, name VARCHAR)")
    db.execute("CREATE TABLE pg.public.event_tags_x_event_instances (event_instance_id INTEGER, event_tag_id INTEGER)")
    db.execute(
        "CREATE TABLE pg.public.attendance (id INTEGER, user_id INTEGER, event_instance_id INTEGER, "
        "meta JSON, created TIMESTAMP, updated TIMESTAMP, is_planned BOOLEAN)"
    )
    db.execute("CREATE TABLE pg.public.attendance_types (id INTEGER, type VARCHAR)")
    db.execute(
        "CREATE TABLE pg.public.attendance_x_attendance_types (attendance_id INTEGER, attendance_type_id INTEGER)"
    )
    db.execute(
        "CREATE TABLE pg.public.users (id INTEGER, f3_name VARCHAR, home_region_id INTEGER, "
        "avatar_url VARCHAR, status VARCHAR)"
    )

    db.executemany(
        "INSERT INTO pg.public.orgs VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (10, None, "sector", "Sector", "sector desc", "s.png", "sector.test", "{}"),
            (20, 10, "territory", "Territory", "territory desc", "t.png", "territory.test", "{}"),
            (30, 20, "area", "Area", "area desc", "a.png", "area.test", "{}"),
            (40, 30, "region", "Region", "region desc", "r.png", "region.test", "{}"),
            (50, 40, "ao", "AO", "ao desc", "ao.png", "ao.test", "{}"),
            (60, None, "region", "Direct Region", "direct desc", None, None, "{}"),
            # A non-area ancestor must not be reported as an area by either query.
            (70, 20, "division", "Division", "division desc", None, None, "{}"),
            (80, 70, "region", "Unusual Region", "unusual desc", None, None, "{}"),
            (81, 80, "ao", "Unusual AO", "unusual AO desc", None, None, "{}"),
        ],
    )
    db.execute("INSERT INTO pg.public.events VALUES (100, 'Series', 'Series description')")
    db.execute("INSERT INTO pg.public.locations VALUES (200, 'Park', 'Park description', 1.25, -2.5)")
    db.executemany(
        "INSERT INTO pg.public.event_instances VALUES "
        "(?, ?, 200, 100, true, ?, NULL, '06:00', '07:00', ?, 'description', ?, 2, 'pre', ?, '{}', "
        "TIMESTAMP '2026-01-01 00:00:00', TIMESTAMP '2026-01-02 00:00:00', true)",
        [
            (1, 50, "2026-08-25", "Past", 10, "backblast"),
            (2, 50, "2026-08-26", "Today", None, None),
            (3, 50, "2026-08-27", "Future", None, None),
            (4, 50, "2026-08-26", "Empty aggregations", 5, "backblast"),
            (5, 81, "2026-08-27", "Non-area ancestor", None, None),
            (6, 50, "2026-08-27", "Inactive", None, None),
            (7, 50, "2026-08-25", "No Q", None, None),
        ],
    )
    db.execute("UPDATE pg.public.event_instances SET is_active = false WHERE id = 6")
    db.executemany(
        "INSERT INTO pg.public.event_types VALUES (?, ?, ?)",
        [(1, "Run", "first_f"), (2, "Bootcamp", "second_f"), (3, "Ruck", "third_f")],
    )
    db.executemany("INSERT INTO pg.public.event_instances_x_event_types VALUES (?, ?)", [(1, 1), (1, 2), (1, 3)])
    db.executemany("INSERT INTO pg.public.event_tags VALUES (?, ?)", [(1, "VQ"), (2, "Pre-Workout")])
    db.executemany("INSERT INTO pg.public.event_tags_x_event_instances VALUES (?, ?)", [(1, 1), (1, 2)])
    db.executemany("INSERT INTO pg.public.attendance_types VALUES (?, ?)", [(2, "Q"), (3, "Co-Q")])
    db.executemany(
        "INSERT INTO pg.public.users VALUES (?, ?, ?, ?, ?)",
        [(1, "Zed", 40, "zed.png", "active"), (2, "Amy", 40, "amy.png", "active")],
    )
    db.executemany(
        "INSERT INTO pg.public.attendance VALUES (?, ?, ?, '{}', NULL, NULL, ?)",
        [(11, 1, 2, True), (12, 2, 2, True), (13, 1, 2, False), (14, 2, 1, False)],
    )
    db.executemany(
        "INSERT INTO pg.public.attendance_x_attendance_types VALUES (?, ?)",
        [(11, 2), (12, 2), (13, 3), (14, 2)],
    )
    return db


def run(db: duckdb.DuckDBPyConnection, name: str):
    return db.execute((SQL_DIR / f"{name}.sql").read_text(), PARAMS).fetchall()


def test_all_analytics_views_materialize_and_validate_populated_and_empty_parquet(tmp_path: Path):
    db = fixture()
    definitions = select_materializations(None, product="analytics")
    for definition in definitions:
        artifacts = materialize(
            db,
            tmp_path / "populated" / definition.name,
            definition,
            PARAMS[0],
            PARAMS[1],
        )
        assert artifacts.row_count > 0
        assert artifacts.schema_evidence is not None
        assert tuple(
            (column.name, column.duckdb_type, column.nullable) for column in artifacts.schema_evidence.columns
        ) == tuple(
            (column.name, column.duckdb_type, column.nullable) for column in SCHEMAS_BY_NAME[definition.name].columns
        )

    db.execute("DELETE FROM pg.public.event_instances")
    db.execute("DELETE FROM pg.public.attendance")
    for definition in definitions:
        artifacts = materialize(
            db,
            tmp_path / "empty" / definition.name,
            definition,
            PARAMS[0],
            PARAMS[1],
        )
        assert artifacts.row_count == 0
        assert artifacts.schema_evidence is not None
        assert artifacts.schema_evidence.file_row_counts == (0,)
        assert tuple(column.name for column in artifacts.schema_evidence.columns) == tuple(
            column.name for column in SCHEMAS_BY_NAME[definition.name].columns
        )


def test_each_query_uses_two_parameters_and_exact_projection():
    db = fixture()
    expected = {
        "event_info": [
            "id",
            "org_id",
            "location_id",
            "series_id",
            "highlight",
            "start_date",
            "end_date",
            "start_time",
            "end_time",
            "name",
            "description",
            "pax_count",
            "fng_count",
            "preblast",
            "backblast",
            "meta",
            "created",
            "updated",
            "series_name",
            "series_description",
            "ao_org_id",
            "ao_name",
            "ao_description",
            "ao_logo_url",
            "ao_website",
            "ao_meta",
            "region_org_id",
            "region_name",
            "region_description",
            "region_logo_url",
            "region_website",
            "region_meta",
            "area_org_id",
            "area_name",
            "territory_org_id",
            "territory_name",
            "sector_org_id",
            "sector_name",
            "location_name",
            "location_description",
            "location_latitude",
            "location_longitude",
            "bootcamp_ind",
            "run_ind",
            "ruck_ind",
            "first_f_ind",
            "second_f_ind",
            "third_f_ind",
            "pre_workout_ind",
            "off_the_books_ind",
            "vq_ind",
            "convergence_ind",
            "all_types",
            "all_tags",
        ],
        "future_event_info": [
            "id",
            "org_id",
            "location_id",
            "series_id",
            "highlight",
            "start_date",
            "end_date",
            "start_time",
            "end_time",
            "name",
            "description",
            "preblast",
            "meta",
            "created",
            "updated",
            "series_name",
            "series_description",
            "ao_org_id",
            "ao_name",
            "ao_description",
            "ao_logo_url",
            "ao_website",
            "ao_meta",
            "region_org_id",
            "region_name",
            "region_description",
            "region_logo_url",
            "region_website",
            "region_meta",
            "area_org_id",
            "area_name",
            "territory_org_id",
            "territory_name",
            "sector_org_id",
            "sector_name",
            "location_name",
            "location_description",
            "location_latitude",
            "location_longitude",
            "bootcamp_ind",
            "run_ind",
            "ruck_ind",
            "first_f_ind",
            "second_f_ind",
            "third_f_ind",
            "pre_workout_ind",
            "off_the_books_ind",
            "vq_ind",
            "convergence_ind",
            "all_types",
            "all_tags",
            "planned_q_user_id",
        ],
        "attendance_info": [
            "id",
            "user_id",
            "event_instance_id",
            "attendance_meta",
            "created",
            "updated",
            "q_ind",
            "coq_ind",
            "f3_name",
            "home_region_id",
            "home_region_name",
            "avatar_url",
            "user_statusa",
            "start_date",
        ],
        "missing_backblasts": ["q_who", "region_name", "ao_name", "start_date", "start_time"],
    }
    for name, columns in expected.items():
        sql = (SQL_DIR / f"{name}.sql").read_text()
        assert sql.count("?::TIMESTAMPTZ") == 1
        assert sql.count("?::DATE") == 1
        described = db.execute(f"DESCRIBE ({sql})", PARAMS).fetchall()
        assert [row[0] for row in described] == columns


def test_event_and_future_boundary_aggregations_and_planned_q_grain():
    db = fixture()
    events = run(db, "event_info")
    events_by_id = {row[0]: row for row in events}
    assert set(events_by_id) == {1, 4}
    row = events_by_id[1]
    assert row[20:38] == (
        50,
        "AO",
        "ao desc",
        "ao.png",
        "ao.test",
        "{}",
        40,
        "Region",
        "region desc",
        "r.png",
        "region.test",
        "{}",
        30,
        "Area",
        20,
        "Territory",
        10,
        "Sector",
    )
    assert row[43:49] == (1, 1, 1, 1, 1, 1)
    assert row[52:54] == (["Bootcamp", "Ruck", "Run"], ["Pre-Workout", "VQ"])
    empty = events_by_id[4]
    assert empty[42:54] == (None,) * 12

    future = run(db, "future_event_info")
    future_by_id = {}
    for row in future:
        future_by_id.setdefault(row[0], []).append(row)
    assert set(future_by_id) == {2, 3, 4, 5}
    assert sorted(row[-1] for row in future_by_id[2]) == [1, 2]
    assert future_by_id[3][0][-1] is None
    assert future_by_id[4][0][-1] is None
    assert future_by_id[2][0][29:31] == (30, "Area")
    assert future_by_id[5][0][29:31] == (None, None)


def test_attendance_and_missing_backblast_null_and_date_semantics():
    db = fixture()
    attendance = run(db, "attendance_info")
    attendance_by_id = {row[0]: row for row in attendance}
    assert set(attendance_by_id) == {13, 14}
    assert attendance_by_id[13][6:8] == (0, 1)
    assert attendance_by_id[13][8:14] == ("Zed", 40, "Region", "zed.png", "active", date(2026, 8, 26))

    missing = run(db, "missing_backblasts")
    assert [row[2] for row in missing] == ["AO", "AO"]
    assert [row[3] for row in missing] == [date(2026, 8, 26), date(2026, 8, 25)]
    assert missing[0][0] == "Amy, Zed"
    assert missing[1][0] == "No Q Listed"
