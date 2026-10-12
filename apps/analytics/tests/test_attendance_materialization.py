from datetime import date
from pathlib import Path

import duckdb
import pytest

from analytics.schema_registry import SCHEMAS_BY_NAME

SQL = Path(__file__).parents[1].joinpath("analytics/sql/pv_attendance.sql").read_text()


def source():
    db = duckdb.connect(":memory:")
    db.execute("ATTACH ':memory:' AS pg")
    db.execute("CREATE SCHEMA pg.public")
    db.execute("CREATE TABLE pg.public.orgs(id INTEGER, parent_id INTEGER, name VARCHAR, org_type VARCHAR)")
    db.execute(
        "CREATE TABLE pg.public.event_instances(id INTEGER, org_id INTEGER, is_active BOOLEAN, "
        "pax_count INTEGER, meta JSON, start_date DATE)"
    )
    db.execute(
        "CREATE TABLE pg.public.users(id INTEGER, email VARCHAR, f3_name VARCHAR, home_region_id INTEGER, "
        "avatar_url VARCHAR, status VARCHAR)"
    )
    db.execute(
        "CREATE TABLE pg.public.attendance(id INTEGER, user_id INTEGER, event_instance_id INTEGER, "
        "is_planned BOOLEAN, meta VARCHAR, created TIMESTAMP, updated TIMESTAMP)"
    )
    db.execute("CREATE TABLE pg.public.event_instances_x_event_types(event_instance_id INTEGER, event_type_id INTEGER)")
    db.execute(
        "CREATE TABLE pg.public.event_types(id INTEGER, name VARCHAR, description VARCHAR, event_category VARCHAR)"
    )
    db.execute("CREATE TABLE pg.public.event_tags_x_event_instances(event_instance_id INTEGER, event_tag_id INTEGER)")
    db.execute("CREATE TABLE pg.public.event_tags(id INTEGER, name VARCHAR, description VARCHAR)")
    db.execute("CREATE TABLE pg.public.attendance_types(id INTEGER, type VARCHAR)")
    db.execute(
        "CREATE TABLE pg.public.attendance_x_attendance_types(attendance_id INTEGER, attendance_type_id INTEGER)"
    )
    db.executemany(
        "INSERT INTO pg.public.orgs VALUES (?, ?, ?, ?)",
        [
            (1, None, "Region", "region"),
            (2, 1, "AO", "ao"),
            (3, None, "Orphan", "sector"),
        ],
    )
    db.executemany(
        "INSERT INTO pg.public.event_instances VALUES (?, ?, ?, ?, ?, ?)",
        [
            (10, 2, True, 5, "{}", "2026-01-01"),
            (11, 2, True, 3, '{"exclude_from_pax_vault":null}', "2026-01-01"),
            (12, 2, False, 1, "{}", "2026-01-02"),
            (13, 2, True, None, "{}", "2026-01-02"),
            (14, 2, True, 2, '{"exclude_from_pax_vault":true}', "2026-01-02"),
            (15, 999, True, 2, "{}", "2026-01-02"),
            (16, 3, True, 2, "{}", "2026-01-02"),
        ],
    )
    db.executemany(
        "INSERT INTO pg.public.users VALUES (?, ?, ?, ?, ?, ?)",
        [
            (1, "alpha@example.test", "Alpha", 1, "alpha.png", "active"),
            (2, "invalid", "Invalid", 1, None, "inactive"),
            (3, None, "No email", None, None, "active"),
            (4, "null-name@example.test", None, 1, None, "active"),
            (5, "blank-name@example.test", "", 1, None, "active"),
        ],
    )
    db.executemany(
        "INSERT INTO pg.public.attendance VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
            (100, 1, 10, False, None, "2026-01-01 08:00:00", "2026-01-01 09:00:00"),
            (101, 1, 10, True, "{}", "2026-01-01 08:00:00", "2026-01-01 09:00:00"),
            (102, 2, 10, False, "{}", "2026-01-01 08:00:00", "2026-01-01 09:00:00"),
            (103, 3, 10, False, "{}", "2026-01-01 08:00:00", "2026-01-01 09:00:00"),
            (104, 1, 11, False, "{}", "2026-01-01 08:00:00", "2026-01-01 09:00:00"),
            (105, 1, 12, False, "{}", "2026-01-02 08:00:00", "2026-01-02 09:00:00"),
            (106, 1, 13, False, "{}", "2026-01-02 08:00:00", "2026-01-02 09:00:00"),
            (107, 1, 14, False, "{}", "2026-01-02 08:00:00", "2026-01-02 09:00:00"),
            (108, 1, 15, False, "{}", "2026-01-02 08:00:00", "2026-01-02 09:00:00"),
            (109, 1, 10, False, "{}", "2026-01-01 08:00:00", "2026-01-01 09:00:00"),
            (110, 4, 10, False, "{}", "2026-01-01 08:00:00", "2026-01-01 09:00:00"),
            (111, 5, 10, False, "{}", "2026-01-01 08:00:00", "2026-01-01 09:00:00"),
            (112, 1, 10, False, "{}", "2026-01-01 08:00:00", "2026-01-01 09:00:00"),
            (113, 1, 10, False, "{}", "2026-01-01 08:00:00", "2026-01-01 09:00:00"),
            (114, 1, 10, False, "{}", "2026-01-01 08:00:00", "2026-01-01 09:00:00"),
            (115, 1, 10, False, "{}", "2026-01-01 08:00:00", "2026-01-01 09:00:00"),
            (116, 1, 16, False, "{}", "2026-01-02 08:00:00", "2026-01-02 09:00:00"),
        ],
    )
    db.executemany(
        "INSERT INTO pg.public.event_types VALUES (?, ?, ?, ?)",
        [
            (1, "Beta", "second", "second_f"),
            (2, "Alpha", "first", "first_f"),
            (3, "Null category", "none", None),
        ],
    )
    db.executemany(
        "INSERT INTO pg.public.event_instances_x_event_types VALUES (?, ?)", [(10, 1), (10, 2), (10, 3), (10, 2)]
    )
    db.execute("INSERT INTO pg.public.event_tags VALUES (7, 'Morning', 'Workout')")
    db.execute("INSERT INTO pg.public.event_tags_x_event_instances VALUES (10, 7), (10, 7)")
    db.executemany(
        "INSERT INTO pg.public.attendance_types VALUES (?, ?)", [(1, "Q"), (2, "CoQ"), (3, "Co-Q"), (4, "Pax")]
    )
    db.execute(
        "INSERT INTO pg.public.attendance_x_attendance_types VALUES "
        "(100, 1), (100, 1), (100, 2), (112, 1), (113, 2), (114, 3), (115, 4)"
    )
    return db


def query(db):
    return db.execute(SQL, ["2026-01-03T00:00:00Z", "2026-01-03"])


def test_attendance_rows_filter_and_aggregate_without_fanout():
    db = source()
    result = query(db)
    columns = result.description
    rows = result.fetchall()
    assert [column[0] for column in columns] == [
        "refreshed_at",
        "id",
        "user_id",
        "event_instance_id",
        "q_ind",
        "coq_ind",
        "start_date",
        "ao_org_id",
        "region_org_id",
        "tags",
        "types",
        "categories",
    ]
    assert len(rows) == 10
    row = rows[0]
    assert row[1:9] == (
        100,
        1,
        10,
        1,
        1,
        date(2026, 1, 1),
        2,
        1,
    )
    assert row[9:] == ([7], [1, 2, 3], ["first_f", "second_f"])
    assert rows[1][1:4] == (109, 1, 10)
    assert rows[1][4:6] == (0, 0)
    assert rows[2][1:4] == (110, 4, 10)
    assert rows[2][4:6] == (0, 0)
    assert rows[3][1:4] == (111, 5, 10)
    assert rows[3][4:6] == (0, 0)
    assert rows[4][1:4] == (112, 1, 10)
    assert rows[4][4:6] == (1, 0)  # Q only
    assert rows[5][1:4] == (113, 1, 10)
    assert rows[5][4:6] == (0, 1)  # CoQ only
    assert rows[6][1:4] == (114, 1, 10)
    assert rows[6][4:6] == (0, 1)  # Co-Q only
    assert rows[7][1:4] == (115, 1, 10)
    assert rows[7][4:6] == (0, 0)  # Pax only
    assert rows[8][1] == 104


def test_cyclic_org_ancestry_resolves_ao_and_terminates():
    db = source()
    db.execute("INSERT INTO pg.public.orgs VALUES (40, 41, 'Loop AO', 'ao'), (41, 40, 'Loop Region', 'region')")
    db.execute("INSERT INTO pg.public.event_instances VALUES (40, 40, true, 1, '{}', '2026-01-03')")
    db.execute("INSERT INTO pg.public.attendance VALUES (400, 1, 40, false, '{}', NULL, NULL)")

    rows = query(db).fetchall()
    cycle_row = next(row for row in rows if row[1] == 400)
    assert cycle_row[7:9] == (40, 41)
    ancestors_sql = SQL.split("\nSELECT p.refreshed_at", maxsplit=1)[0]
    ancestors = db.execute(
        ancestors_sql + "\nSELECT ancestor_id FROM org_ancestors WHERE source_id = 40 ORDER BY ancestor_id",
        ["2026-01-03T00:00:00Z", "2026-01-03"],
    ).fetchall()
    assert ancestors == [(40,), (41,)]


def test_attendance_without_tags_or_types_has_typed_empty_arrays_and_region_hierarchy(tmp_path: Path):
    db = source()
    # A direct region event has no AO but reports that region ancestor.
    db.execute("INSERT INTO pg.public.event_instances VALUES (20, 1, true, 1, '{}', '2026-01-03')")
    db.execute("INSERT INTO pg.public.attendance VALUES (200, 1, 20, false, NULL, NULL, NULL)")
    db.execute("INSERT INTO pg.public.event_instances VALUES (21, 3, true, 1, '{}', '2026-01-03')")
    db.execute("INSERT INTO pg.public.attendance VALUES (201, 1, 21, false, NULL, NULL, NULL)")
    row = next(r for r in query(db).fetchall() if r[1] == 200)
    assert row[4:6] == (0, 0)
    assert row[7:9] == (None, 1)
    assert row[9:12] == ([], [], [])
    no_region = next(r for r in query(db).fetchall() if r[1] == 201)
    assert no_region[7:9] == (None, None)
    assert no_region[9:12] == ([], [], [])
    output = tmp_path / "pv_attendance.parquet"
    db.execute("COPY (" + SQL + ") TO ? (FORMAT PARQUET)", [str(output), "2026-01-03T00:00:00Z", "2026-01-03"])
    columns = db.execute("DESCRIBE SELECT * FROM read_parquet(?)", [str(output)]).fetchall()
    assert [(column[0], column[1], column[2] == "YES") for column in columns] == [
        (column.name, column.duckdb_type, column.nullable) for column in SCHEMAS_BY_NAME["pv_attendance"].columns
    ]


def test_malformed_event_exclusion_fails_but_attendance_metadata_is_not_parsed():
    db = source()
    db.execute('UPDATE pg.public.event_instances SET meta = \'{"exclude_from_pax_vault":"yes"}\' WHERE id = 10')
    with pytest.raises(Exception, match="exclude_from_pax_vault"):
        query(db)

    db = source()
    db.execute("UPDATE pg.public.attendance SET meta = 'not-json' WHERE id = 100")
    rows = query(db).fetchall()
    assert len(rows) == 10
    assert next(row for row in rows if row[1] == 100)[1] == 100
