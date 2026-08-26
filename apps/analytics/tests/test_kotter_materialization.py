from __future__ import annotations

from pathlib import Path

import duckdb

SQL = Path(__file__).parents[1].joinpath("analytics", "sql", "pv_kotter.sql").read_text()


def source() -> duckdb.DuckDBPyConnection:
    db = duckdb.connect(":memory:")
    db.execute("ATTACH ':memory:' AS pg")
    db.execute("CREATE SCHEMA pg.public")
    db.execute("CREATE TABLE pg.public.orgs (id INTEGER, parent_id INTEGER, name VARCHAR, org_type VARCHAR)")
    db.execute(
        "CREATE TABLE pg.public.event_instances (id INTEGER, name VARCHAR, org_id INTEGER, "
        "is_active BOOLEAN, pax_count INTEGER, start_date DATE, meta JSON)"
    )
    db.execute(
        "CREATE TABLE pg.public.users (id INTEGER, f3_name VARCHAR, avatar_url VARCHAR, "
        "email VARCHAR, home_region_id INTEGER)"
    )
    db.execute("CREATE TABLE pg.public.attendance (user_id INTEGER, event_instance_id INTEGER, is_planned BOOLEAN)")
    db.executemany(
        "INSERT INTO pg.public.orgs VALUES (?, ?, ?, ?)",
        [(1, None, "Region", "region"), (10, 1, "AO", "ao")],
    )
    db.executemany(
        "INSERT INTO pg.public.users VALUES (?, ?, ?, ?, ?)",
        [
            (1, "", "drop.png", "drop@example.test", 1),
            (4, "Bestie", "bestie.png", "bestie@example.test", 1),
            (3, "Invalid", "bad.png", "not-an-email", 1),
            (5, "Solo", "solo.png", "solo@example.test", 1),
        ],
    )
    db.executemany(
        "INSERT INTO pg.public.event_instances VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
            (1, "Workout", 10, True, 10, "2026-08-10", "{}"),
            (2, "Earlier", 10, True, 10, "2026-08-01", "{}"),
            (3, "Old", 10, True, 10, "2026-07-01", "{}"),
            (4, "Inactive", 10, False, 10, "2026-08-09", "{}"),
            (5, "No pax", 10, True, None, "2026-08-08", "{}"),
            (6, "Excluded", 10, True, 10, "2026-08-07", '{"exclude_from_pax_vault": true}'),
            (8, "Solo workout", 10, True, 10, "2026-08-10", "{}"),
        ],
    )
    db.executemany(
        "INSERT INTO pg.public.attendance VALUES (?, ?, ?)",
        [(1, 1, False), (1, 2, False), (1, 3, False), (1, 4, False),
         (1, 5, False), (1, 6, False), (1, 1, True), (3, 1, False), (5, 8, False)],
    )
    return db


def rows(db: duckdb.DuckDBPyConnection):
    return db.execute(SQL, ["2026-08-26T12:00:00+00:00", "2026-08-26"]).fetchall()


def test_exact_contract_and_bestie_shape():
    db = source()
    db.execute("INSERT INTO pg.public.event_instances VALUES (7, 'Bestie workout', 10, true, 10, '2026-08-11', '{}')")
    db.execute("INSERT INTO pg.public.attendance VALUES (1, 7, false), (4, 7, false)")
    result = rows(db)
    row = next(row for row in result if row[0] == 1)
    assert row == (
        1, 1, "1", "drop.png", "New PAX Drop", 4, "2026-07-01", 15,
        "2026-08-11", "Bestie workout", "AO", 10,
        [{"user_id": 4, "f3_name": "Bestie", "avatar_url": "bestie.png", "co_attendance_count": 1}],
    )
    solo = next(row for row in result if row[0] == 5)
    assert solo[-1] == []
    assert [row[0] for row in result] == [1, 4, 5]


def test_parquet_schema_is_exact_contract(tmp_path: Path):
    db = source()
    parquet = tmp_path / "pv_kotter.parquet"
    db.execute(
        "COPY (" + SQL.rstrip().rstrip(";") + ") TO ? (FORMAT PARQUET)",
        [str(parquet), "2026-08-26T12:00:00+00:00", "2026-08-26"],
    )
    columns = db.execute("DESCRIBE SELECT * FROM read_parquet(?)", [str(parquet)]).fetchall()
    assert [column[0] for column in columns] == [
        "user_id", "home_region_id", "f3_name", "avatar_url", "kotter_status",
        "total_events", "first_event_date", "days_since_last_event",
        "last_event_date", "last_event_name", "last_event_ao_name",
        "last_event_ao_org_id", "bestie_list",
    ]
