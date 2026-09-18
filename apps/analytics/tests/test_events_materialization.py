from datetime import date
from pathlib import Path

import duckdb
import pytest

from analytics.materializations import MATERIALIZATION_REGISTRY
from analytics.source import materialize

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
        [
            (1, None, "Sector", "sector"),
            (2, 1, "Territory", "territory"),
            (3, 2, "Area", "area"),
            (4, 3, "Region", "region"),
            (5, 4, "AO", "ao"),
        ],
    )
    c.executemany(
        "INSERT INTO pg.public.event_instances VALUES (?, ?, true, 10, 2, ?, ?, ?, NULL, true, false)",
        [
            (1, 5, "{}", "Workout", "2026-01-01"),
            (2, 5, "{}", "No plans", "2026-01-02"),
            (3, 5, "{}", "Ghosts", "2026-01-03"),
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
        "territory_org_id",
        "territory_name",
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
    assert row[1:19] == (
        1,
        date(2026, 1, 1),
        "Workout",
        10,
        2,
        5,
        "AO",
        4,
        "Region",
        3,
        "Area",
        2,
        "Territory",
        1,
        "Sector",
        1,
        0,
        1,
    )
    assert row[19] == [
        {"id": 2, "name": "Bible", "description": "Study", "event_category": "third_f"},
        {"id": 1, "name": "Run", "description": "Running", "event_category": "first_f"},
    ]
    assert row[20] == [{"id": 7, "name": "Morning", "description": "Morning workout"}]
    assert row[21] == [
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


def test_events_resolve_tiers_beyond_six_and_keep_direct_area_territory_nullable():
    c = source()
    c.execute("UPDATE pg.public.orgs SET parent_id = 6 WHERE id = 5")
    c.execute("INSERT INTO pg.public.orgs VALUES (6, 4, 'Intermediate', 'division')")
    c.execute("INSERT INTO pg.public.orgs VALUES (7, 1, 'Direct Area', 'area')")
    c.execute("INSERT INTO pg.public.orgs VALUES (8, 7, 'Direct Region', 'region')")
    c.execute("INSERT INTO pg.public.orgs VALUES (9, 8, 'Direct AO', 'ao')")
    c.execute(
        "INSERT INTO pg.public.event_instances VALUES "
        "(4, 9, true, 3, 1, '{}', 'Direct', '2026-01-04', NULL, true, false)"
    )
    rows = c.execute(SQL, ["2026-01-03T00:00:00Z", "2026-01-03"]).fetchall()
    deep = next(row for row in rows if row[1] == 1)
    assert deep[14:16] == (1, "Sector")
    direct = next(row for row in rows if row[1] == 4)
    assert direct[10:16] == (7, "Direct Area", None, None, 1, "Sector")


def test_events_materialization_orders_unpartitioned_file(tmp_path: Path):
    c = source()
    c.execute("INSERT INTO pg.public.orgs VALUES (9, 3, 'Region Two', 'region'), (10, 9, 'AO Two', 'ao')")
    c.execute(
        "INSERT INTO pg.public.event_instances VALUES "
        "(4, 10, true, 3, 1, '{}', 'Later', '2026-01-04', NULL, true, false)"
    )
    root = tmp_path / "events"
    artifacts = materialize(c, root, MATERIALIZATION_REGISTRY["pv_events"], "2026-01-05T00:00:00Z", "2026-01-05")

    assert artifacts.row_count == 4
    assert artifacts.sorted_parquet_files == (root / "pv_events.parquet",)
    columns = [
        row[0]
        for row in c.execute(
            "DESCRIBE SELECT * FROM read_parquet(?)", [str(artifacts.sorted_parquet_files[0])]
        ).fetchall()
    ]
    assert "region_org_id" in columns
    rows = c.execute(
        "SELECT region_org_id, event_date FROM read_parquet(?)", [str(artifacts.sorted_parquet_files[0])]
    ).fetchall()
    assert len(rows) == 4
    assert rows == sorted(rows, key=lambda row: (row[0], row[1]))


def test_events_aggregates_independent_lists_and_attendance_flags():
    c = source()
    c.executemany(
        "INSERT INTO pg.public.event_instances VALUES (?, 5, true, 3, 1, '{}', ?, ?, NULL, true, false)",
        [(4, "Many lists", "2026-01-04"), (5, "Empty lists", "2026-01-05")],
    )
    c.executemany(
        "INSERT INTO pg.public.event_instances_x_event_types VALUES (?, ?)",
        [(4, 3), (4, 4)],
    )
    c.executemany(
        "INSERT INTO pg.public.event_types VALUES (?, ?, ?, ?)",
        [(3, "Alpha", "Alpha description", "first_f"), (4, "Zulu", "Zulu description", "second_f")],
    )
    c.executemany(
        "INSERT INTO pg.public.event_tags_x_event_instances VALUES (?, ?)",
        [(4, 7), (4, 8)],
    )
    c.execute("INSERT INTO pg.public.event_tags VALUES (8, 'Evening', 'Evening workout')")
    c.execute("INSERT INTO pg.public.attendance_types VALUES (4, 'CoQ')")
    c.executemany(
        "INSERT INTO pg.public.users VALUES (?, ?, ?, ?)",
        [(4, "Charlie", "c@example.com", "charlie.png"), (5, "Delta", "d@example.com", "delta.png")],
    )
    c.executemany(
        "INSERT INTO pg.public.attendance VALUES (?, 4, ?, ?)",
        [(8, 4, True), (9, 5, False), (10, 3, True)],
    )
    c.executemany(
        "INSERT INTO pg.public.attendance_x_attendance_types VALUES (?, ?)",
        [(8, 3), (9, 4)],
    )

    rows = c.execute(SQL, ["2026-01-03T00:00:00Z", "2026-01-03"]).fetchall()
    many = next(row for row in rows if row[1] == 4)
    assert len(many[19]) == 2
    assert len(many[20]) == 2
    assert len(many[21]) == 2
    assert many[19] == [
        {"id": 3, "name": "Alpha", "description": "Alpha description", "event_category": "first_f"},
        {"id": 4, "name": "Zulu", "description": "Zulu description", "event_category": "second_f"},
    ]
    assert [entry["user_id"] for entry in many[21]] == [4, 5]
    assert many[21][0]["coq_ind"] == 0
    assert many[21][0]["fartsack"] is True
    assert many[21][1]["coq_ind"] == 1
    assert many[21][1]["ghost"] is True

    empty = next(row for row in rows if row[1] == 5)
    assert empty[19] == []
    assert empty[20] == []
    assert empty[21] == []
