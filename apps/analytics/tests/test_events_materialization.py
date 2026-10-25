from datetime import date
from pathlib import Path

import duckdb
import pytest

from analytics.materializations import MATERIALIZATION_REGISTRY
from analytics.source import materialize

SQL = (Path(__file__).parents[1] / "analytics" / "sql" / "pv_events.sql").read_text()
DETAILS_SQL = (Path(__file__).parents[1] / "analytics" / "sql" / "pv_event_details.sql").read_text()


def test_events_uses_explicit_event_and_attendance_projections():
    assert "SELECT ei.*" not in SQL
    assert "SELECT a.*" not in SQL
    assert "e.description" not in SQL
    assert "e.preblast" not in SQL
    assert "e.backblast" not in SQL
    assert "e.meta" not in SQL
    assert "SELECT a.*" not in DETAILS_SQL


def source():
    c = duckdb.connect(":memory:")
    c.execute("ATTACH ':memory:' AS pg")
    c.execute("CREATE SCHEMA pg.public")
    c.execute("CREATE TABLE pg.public.orgs(id INTEGER, parent_id INTEGER, name VARCHAR, org_type VARCHAR)")
    c.execute(
        "CREATE TABLE pg.public.event_instances(id INTEGER, org_id INTEGER, is_active BOOLEAN, pax_count INTEGER, "
        "fng_count INTEGER, meta JSON, name VARCHAR, start_date DATE, end_date DATE, "
        "highlight BOOLEAN, is_private BOOLEAN, description VARCHAR, preblast VARCHAR, preblast_rich JSON, "
        "backblast VARCHAR, backblast_rich JSON)"
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
        "INSERT INTO pg.public.event_instances VALUES (?, ?, true, 10, 2, ?, ?, ?, NULL, true, false, ?, ?, ?, ?, ?)",
        [
            (
                1,
                5,
                "{}",
                "Workout",
                "2026-01-01",
                "Workout description",
                "Plan",
                '{"blocks":[]}',
                "Blast",
                '{"text":"Blast"}',
            ),
            (2, 5, "{}", "No plans", "2026-01-02", None, None, None, None, None),
            (3, 5, "{}", "Ghosts", "2026-01-03", None, None, None, None, None),
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


def rows_as_dicts(connection, query, parameters=None):
    cursor = connection.execute(query, parameters or [])
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row, strict=True)) for row in cursor.fetchall()]


def test_events_contract_and_materialization(tmp_path: Path):
    c = source()
    out = tmp_path / "events.parquet"
    c.execute("COPY (" + SQL + ") TO ? (FORMAT PARQUET)", [str(out), "2026-01-03T00:00:00Z", "2026-01-03"])
    details_out = tmp_path / "event-details.parquet"
    c.execute(
        "COPY (" + DETAILS_SQL + ") TO ? (FORMAT PARQUET)",
        [str(details_out), "2026-01-03T00:00:00Z", "2026-01-03"],
    )
    columns = [
        column["column_name"] for column in rows_as_dicts(c, "DESCRIBE SELECT * FROM read_parquet(?)", [str(out)])
    ]
    assert columns == [
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
    row = rows_as_dicts(c, "SELECT * FROM read_parquet(?) WHERE event_id = 1", [str(out)])[0]
    assert {
        key: row[key]
        for key in (
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
        )
    } == {
        "event_id": 1,
        "event_date": date(2026, 1, 1),
        "event_name": "Workout",
        "pax_count": 10,
        "fng_count": 2,
        "ao_org_id": 5,
        "ao_name": "AO",
        "region_org_id": 4,
        "region_name": "Region",
        "area_org_id": 3,
        "area_name": "Area",
        "territory_org_id": 2,
        "territory_name": "Territory",
        "sector_org_id": 1,
        "sector_name": "Sector",
        "first_f_ind": 1,
        "second_f_ind": 0,
        "third_f_ind": 1,
    }
    assert row["types"] == [
        {"id": 2, "name": "Bible", "description": "Study", "event_category": "third_f"},
        {"id": 1, "name": "Run", "description": "Running", "event_category": "first_f"},
    ]
    assert row["tags"] == [{"id": 7, "name": "Morning", "description": "Morning workout"}]
    assert row["attendance"] == [
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
    detail_columns = [
        column["column_name"]
        for column in rows_as_dicts(c, "DESCRIBE SELECT * FROM read_parquet(?)", [str(details_out)])
    ]
    assert detail_columns == [
        "event_id",
        "description",
        "preblast",
        "preblast_rich",
        "backblast",
        "backblast_rich",
        "meta",
        "refreshed_at",
    ]
    assert not {"description", "preblast", "preblast_rich", "backblast", "backblast_rich", "meta"}.intersection(columns)
    event_ids = [
        row["event_id"]
        for row in rows_as_dicts(c, "SELECT event_id FROM read_parquet(?) ORDER BY event_id", [str(out)])
    ]
    detail_ids = [
        row["event_id"]
        for row in rows_as_dicts(c, "SELECT event_id FROM read_parquet(?) ORDER BY event_id", [str(details_out)])
    ]
    assert event_ids == detail_ids == [1, 2, 3]
    assert rows_as_dicts(
        c,
        "SELECT typeof(preblast_rich) AS preblast_rich_type, typeof(backblast_rich) AS backblast_rich_type, "
        "typeof(meta) AS meta_type FROM read_parquet(?) WHERE event_id = 1",
        [str(details_out)],
    )[0] == {"preblast_rich_type": "JSON", "backblast_rich_type": "JSON", "meta_type": "JSON"}
    detail = rows_as_dicts(c, "SELECT * FROM read_parquet(?) WHERE event_id = 1", [str(details_out)])[0]
    assert {
        key: detail[key] for key in ("description", "preblast", "preblast_rich", "backblast", "backblast_rich", "meta")
    } == {
        "description": "Workout description",
        "preblast": "Plan",
        "preblast_rich": '{"blocks":[]}',
        "backblast": "Blast",
        "backblast_rich": '{"text":"Blast"}',
        "meta": "{}",
    }
    assert {
        key: rows_as_dicts(
            c,
            "SELECT description, preblast, preblast_rich, backblast, backblast_rich "
            "FROM read_parquet(?) WHERE event_id = 2",
            [str(details_out)],
        )[0][key]
        for key in ("description", "preblast", "preblast_rich", "backblast", "backblast_rich")
    } == {"description": None, "preblast": None, "preblast_rich": None, "backblast": None, "backblast_rich": None}
    assert (
        rows_as_dicts(c, "SELECT count(*) AS row_count FROM read_parquet(?) WHERE event_id = 2", [str(out)])[0][
            "row_count"
        ]
        == 1
    )
    assert (
        rows_as_dicts(c, "SELECT attendance FROM read_parquet(?) WHERE event_id = 2", [str(out)])[0]["attendance"][0][
            "fartsack"
        ]
        is True
    )
    assert (
        rows_as_dicts(c, "SELECT attendance FROM read_parquet(?) WHERE event_id = 3", [str(out)])[0]["attendance"][1][
            "ghost"
        ]
        is True
    )


def test_malformed_exclusion_flag_is_strict():
    c = source()
    c.execute('UPDATE pg.public.event_instances SET meta = \'{"exclude_from_pax_vault":"yes"}\' WHERE id = 1')
    with pytest.raises(Exception, match="exclude_from_pax_vault"):
        c.execute(SQL, ["2026-01-03T00:00:00Z", "2026-01-03"])
    with pytest.raises(Exception, match="exclude_from_pax_vault"):
        c.execute(DETAILS_SQL, ["2026-01-03T00:00:00Z", "2026-01-03"])


def test_events_resolve_tiers_beyond_six_and_keep_direct_area_territory_nullable():
    c = source()
    c.execute("UPDATE pg.public.orgs SET parent_id = 6 WHERE id = 5")
    c.execute("INSERT INTO pg.public.orgs VALUES (6, 4, 'Intermediate', 'division')")
    c.execute("INSERT INTO pg.public.orgs VALUES (7, 1, 'Direct Area', 'area')")
    c.execute("INSERT INTO pg.public.orgs VALUES (8, 7, 'Direct Region', 'region')")
    c.execute("INSERT INTO pg.public.orgs VALUES (9, 8, 'Direct AO', 'ao')")
    c.execute(
        "INSERT INTO pg.public.event_instances VALUES "
        "(4, 9, true, 3, 1, '{}', 'Direct', '2026-01-04', NULL, true, false, NULL, NULL, NULL, NULL, NULL)"
    )
    rows = rows_as_dicts(c, SQL, ["2026-01-03T00:00:00Z", "2026-01-03"])
    deep = next(row for row in rows if row["event_id"] == 1)
    assert {key: deep[key] for key in ("sector_org_id", "sector_name")} == {"sector_org_id": 1, "sector_name": "Sector"}
    direct = next(row for row in rows if row["event_id"] == 4)
    assert {
        key: direct[key]
        for key in ("area_org_id", "area_name", "territory_org_id", "territory_name", "sector_org_id", "sector_name")
    } == {
        "area_org_id": 7,
        "area_name": "Direct Area",
        "territory_org_id": None,
        "territory_name": None,
        "sector_org_id": 1,
        "sector_name": "Sector",
    }


def test_events_materialization_orders_unpartitioned_file(tmp_path: Path):
    c = source()
    c.execute("INSERT INTO pg.public.orgs VALUES (9, 3, 'Region Two', 'region'), (10, 9, 'AO Two', 'ao')")
    c.execute(
        "INSERT INTO pg.public.event_instances VALUES "
        "(4, 10, true, 3, 1, '{}', 'Later', '2026-01-04', NULL, true, false, NULL, NULL, NULL, NULL, NULL)"
    )
    root = tmp_path / "events"
    artifacts = materialize(c, root, MATERIALIZATION_REGISTRY["pv_events"], "2026-01-05T00:00:00Z", "2026-01-05")

    assert artifacts.row_count == 4
    assert artifacts.sorted_parquet_files == (root / "pv_events.parquet",)
    columns = [
        row["column_name"]
        for row in rows_as_dicts(c, "DESCRIBE SELECT * FROM read_parquet(?)", [str(artifacts.sorted_parquet_files[0])])
    ]
    assert "region_org_id" in columns
    rows = rows_as_dicts(
        c, "SELECT region_org_id, event_date FROM read_parquet(?)", [str(artifacts.sorted_parquet_files[0])]
    )
    assert len(rows) == 4
    assert rows == sorted(rows, key=lambda row: (row["region_org_id"], row["event_date"]))


def test_event_details_materialize_uses_standard_source_parameters(tmp_path: Path):
    c = source()
    root = tmp_path / "event-details"
    artifacts = materialize(
        c,
        root,
        MATERIALIZATION_REGISTRY["pv_event_details"],
        "2026-01-05T00:00:00Z",
        "2026-01-05",
    )

    assert artifacts.row_count == 3
    assert artifacts.sorted_parquet_files == (root / "pv_event_details.parquet",)
    output = artifacts.sorted_parquet_files[0]
    columns = [row["column_name"] for row in rows_as_dicts(c, "DESCRIBE SELECT * FROM read_parquet(?)", [str(output)])]
    assert columns == [
        "event_id",
        "description",
        "preblast",
        "preblast_rich",
        "backblast",
        "backblast_rich",
        "meta",
        "refreshed_at",
    ]
    rows = rows_as_dicts(c, "SELECT event_id FROM read_parquet(?) ORDER BY event_id", [str(output)])
    assert [row["event_id"] for row in rows] == [1, 2, 3]


def test_event_details_materialization_orders_raw_parquet_rows(tmp_path: Path):
    c = source()
    c.execute(
        "INSERT INTO pg.public.event_instances VALUES "
        "(9, 5, true, 3, 1, '{}', 'Later ID', '2026-01-04', NULL, true, false, NULL, NULL, NULL, NULL, NULL), "
        "(0, 5, true, 3, 1, '{}', 'Earlier ID', '2026-01-05', NULL, true, false, NULL, NULL, NULL, NULL, NULL)"
    )
    artifacts = materialize(
        c,
        tmp_path / "event-details-ordered",
        MATERIALIZATION_REGISTRY["pv_event_details"],
        "2026-01-06T00:00:00Z",
        "2026-01-06",
    )

    rows = rows_as_dicts(c, "SELECT event_id FROM read_parquet(?)", [str(artifacts.sorted_parquet_files[0])])
    assert [row["event_id"] for row in rows] == [0, 1, 2, 3, 9]


def test_true_exclusion_flag_excludes_event_from_both_projections():
    c = source()
    c.execute("UPDATE pg.public.event_instances SET meta = '{\"exclude_from_pax_vault\":true}' WHERE id = 1")
    event_ids = [row["event_id"] for row in rows_as_dicts(c, SQL, ["2026-01-03T00:00:00Z", "2026-01-03"])]
    detail_ids = [row["event_id"] for row in rows_as_dicts(c, DETAILS_SQL, ["2026-01-03T00:00:00Z", "2026-01-03"])]
    assert event_ids == detail_ids == [2, 3]


def test_events_aggregates_independent_lists_and_attendance_flags():
    c = source()
    c.executemany(
        "INSERT INTO pg.public.event_instances VALUES "
        "(?, 5, true, 3, 1, '{}', ?, ?, NULL, true, false, NULL, NULL, NULL, NULL, NULL)",
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

    rows = rows_as_dicts(c, SQL, ["2026-01-03T00:00:00Z", "2026-01-03"])
    many = next(row for row in rows if row["event_id"] == 4)
    assert len(many["types"]) == 2
    assert len(many["tags"]) == 2
    assert len(many["attendance"]) == 2
    assert many["types"] == [
        {"id": 3, "name": "Alpha", "description": "Alpha description", "event_category": "first_f"},
        {"id": 4, "name": "Zulu", "description": "Zulu description", "event_category": "second_f"},
    ]
    assert [entry["user_id"] for entry in many["attendance"]] == [4, 5]
    assert many["attendance"][0]["coq_ind"] == 0
    assert many["attendance"][0]["fartsack"] is True
    assert many["attendance"][1]["coq_ind"] == 1
    assert many["attendance"][1]["ghost"] is True

    empty = next(row for row in rows if row["event_id"] == 5)
    assert empty["types"] == []
    assert empty["tags"] == []
    assert empty["attendance"] == []
