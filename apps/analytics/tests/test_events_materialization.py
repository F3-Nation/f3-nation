from datetime import date
from pathlib import Path

import duckdb
import pytest

SQL = (Path(__file__).parents[1] / "analytics" / "sql" / "pv_events.sql").read_text()


def source():
    c = duckdb.connect(":memory:")
    c.execute("ATTACH ':memory:' AS pg")
    c.execute("CREATE SCHEMA pg.public")
    c.execute("CREATE TABLE pg.public.orgs(id INTEGER, parent_id INTEGER, name VARCHAR, org_type VARCHAR)")
    c.execute(
        "CREATE TABLE pg.public.event_instances(id INTEGER, org_id INTEGER, is_active BOOLEAN, pax_count INTEGER, "
        "fng_count INTEGER, meta JSON, name VARCHAR, start_date DATE, end_date DATE, "
        "highlight BOOLEAN, is_private BOOLEAN)"
    )
    c.execute("CREATE TABLE pg.public.event_instances_x_event_types(event_instance_id INTEGER, event_type_id INTEGER)")
    c.execute(
        "CREATE TABLE pg.public.event_types(id INTEGER, name VARCHAR, description VARCHAR, event_category VARCHAR)"
    )
    c.execute("CREATE TABLE pg.public.event_tags_x_event_instances(event_instance_id INTEGER, event_tag_id INTEGER)")
    c.execute("CREATE TABLE pg.public.event_tags(id INTEGER, name VARCHAR, description VARCHAR)")
    c.execute("CREATE TABLE pg.public.users(id INTEGER, f3_name VARCHAR, email VARCHAR, avatar_url VARCHAR)")
    c.execute(
        "CREATE TABLE pg.public.attendance(id INTEGER, event_instance_id INTEGER, user_id INTEGER, is_planned BOOLEAN)"
    )
    c.execute("CREATE TABLE pg.public.attendance_types(id INTEGER, type VARCHAR)")
    c.execute("CREATE TABLE pg.public.attendance_x_attendance_types(attendance_id INTEGER, attendance_type_id INTEGER)")
    c.executemany(
        "INSERT INTO pg.public.orgs VALUES (?, ?, ?, ?)",
        [(1, None, "Sector", "sector"), (2, 1, "Area", "area"), (3, 2, "Region", "region"), (4, 3, "AO", "ao")],
    )
    c.executemany(
        "INSERT INTO pg.public.event_instances VALUES (?, ?, true, 10, 2, ?, ?, ?, NULL, true, false)",
        [
            (1, 4, "{}", "Workout", "2026-01-01"),
            (2, 4, "{}", "No plans", "2026-01-02"),
            (3, 4, "{}", "Ghosts", "2026-01-03"),
        ],
    )
    c.executemany("INSERT INTO pg.public.event_instances_x_event_types VALUES (?, ?)", [(1, 1), (1, 2)])
    c.executemany(
        "INSERT INTO pg.public.event_types VALUES (?, ?, ?, ?)",
        [(1, "Run", "Running", "first_f"), (2, "Bible", "Study", "third_f")],
    )
    c.execute("INSERT INTO pg.public.event_tags_x_event_instances VALUES (1, 7)")
    c.execute("INSERT INTO pg.public.event_tags VALUES (7, 'Morning', 'Morning workout')")
    c.executemany(
        "INSERT INTO pg.public.users VALUES (?, ?, ?, ?)",
        [
            (1, "Alpha", "a@example.com", "alpha.png"),
            (2, "Bravo", "b@example.com", "bravo.png"),
            (3, "Bad", "bad", "bad.png"),
        ],
    )
    c.executemany(
        "INSERT INTO pg.public.attendance VALUES (?, ?, ?, ?)",
        [
            (1, 1, 1, True),
            (2, 1, 1, False),
            (3, 1, 2, False),
            (4, 1, 3, False),
            (5, 2, 1, True),
            (6, 3, 1, True),
            (7, 3, 2, False),
        ],
    )
    c.executemany("INSERT INTO pg.public.attendance_types VALUES (?, ?)", [(2, "Q"), (3, "Co-Q")])
    c.executemany("INSERT INTO pg.public.attendance_x_attendance_types VALUES (?, ?)", [(1, 2), (2, 3)])
    return c


def test_events_contract_and_materialization(tmp_path: Path):
    c = source()
    out = tmp_path / "events.parquet"
    c.execute("COPY (" + SQL + ") TO ? (FORMAT PARQUET)", [str(out), "2026-01-03T00:00:00Z", "2026-01-03"])
    columns = c.execute("DESCRIBE SELECT * FROM read_parquet(?)", [str(out)]).fetchall()
    assert [column[0] for column in columns] == [
        "refreshed_at",
        "event_id",
        "event_date",
        "event_name",
        "pax_count",
        "fng_count",
        "ao_org_id",
        "ao_name",
        "region_org_id",
        "region_name",
        "area_org_id",
        "area_name",
        "sector_org_id",
        "sector_name",
        "first_f_ind",
        "second_f_ind",
        "third_f_ind",
        "types",
        "tags",
        "attendance",
    ]
    row = c.execute("SELECT * FROM read_parquet(?) WHERE event_id = 1", [str(out)]).fetchone()
    assert row[1:17] == (1, date(2026, 1, 1), "Workout", 10, 2, 4, "AO", 3, "Region", 2, "Area", 1, "Sector", 1, 0, 1)
    assert row[17] == [
        {"id": 2, "name": "Bible", "description": "Study", "event_category": "third_f"},
        {"id": 1, "name": "Run", "description": "Running", "event_category": "first_f"},
    ]
    assert row[18] == [{"id": 7, "name": "Morning", "description": "Morning workout"}]
    assert row[19] == [
        {
            "user_id": 1,
            "f3_name": "Alpha",
            "q_ind": 0,
            "coq_ind": 1,
            "avatar_url": "alpha.png",
            "attended": True,
            "ghost": False,
            "fartsack": False,
        },
        {
            "user_id": 2,
            "f3_name": "Bravo",
            "q_ind": 0,
            "coq_ind": 0,
            "avatar_url": "bravo.png",
            "attended": True,
            "ghost": True,
            "fartsack": False,
        },
    ]
    assert c.execute("SELECT count(*) FROM read_parquet(?) WHERE event_id = 2", [str(out)]).fetchone()[0] == 1
    assert (
        c.execute("SELECT attendance FROM read_parquet(?) WHERE event_id = 2", [str(out)]).fetchone()[0][0]["fartsack"]
        is True
    )
    assert (
        c.execute("SELECT attendance FROM read_parquet(?) WHERE event_id = 3", [str(out)]).fetchone()[0][1]["ghost"]
        is True
    )


def test_malformed_exclusion_flag_is_strict():
    c = source()
    c.execute('UPDATE pg.public.event_instances SET meta = \'{"exclude_from_pax_vault":"yes"}\' WHERE id = 1')
    with pytest.raises(Exception, match="exclude_from_pax_vault"):
        c.execute(SQL, ["2026-01-03T00:00:00Z", "2026-01-03"])
