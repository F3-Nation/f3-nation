from __future__ import annotations

from pathlib import Path

import duckdb

from analytics.schema_registry import SCHEMAS_BY_NAME

SQL = Path(__file__).parents[1].joinpath("analytics/sql/pv_pax.sql").read_text()


def test_pax_materialization_contract(tmp_path: Path):
    db = duckdb.connect()
    db.execute("ATTACH ':memory:' AS pg")
    db.execute("CREATE SCHEMA pg.public")
    db.execute(
        "CREATE TABLE pg.public.users (id INTEGER, first_name VARCHAR, last_name VARCHAR, email VARCHAR, "
        "f3_name VARCHAR, home_region_id INTEGER, avatar_url VARCHAR, status VARCHAR, meta JSON)"
    )
    db.execute("CREATE TABLE pg.public.orgs (id INTEGER, parent_id INTEGER, name VARCHAR, org_type VARCHAR)")
    db.execute("CREATE TABLE pg.public.roles (id INTEGER, name VARCHAR)")
    db.execute("CREATE TABLE pg.public.roles_x_users_x_org (role_id INTEGER, user_id INTEGER, org_id INTEGER)")
    db.execute(
        "CREATE TABLE pg.public.event_instances (id INTEGER, org_id INTEGER, is_active BOOLEAN, "
        "pax_count INTEGER, meta JSON)"
    )
    db.execute("CREATE TABLE pg.public.attendance (user_id INTEGER, event_instance_id INTEGER, is_planned BOOLEAN)")
    db.execute(
        "CREATE TABLE pg.public.event_instances_x_event_types (event_instance_id INTEGER, event_type_id INTEGER)"
    )
    db.execute("CREATE TABLE pg.public.event_types (id INTEGER, name VARCHAR)")
    db.execute("CREATE TABLE pg.public.event_tags_x_event_instances (event_instance_id INTEGER, event_tag_id INTEGER)")
    db.execute("CREATE TABLE pg.public.event_tags (id INTEGER, name VARCHAR)")
    db.executemany(
        "INSERT INTO pg.public.users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (
                1,
                "Ada",
                "Zed",
                "ada@example.test",
                "Raven",
                10,
                "ada.png",
                "active",
                '{"start_date_override":"2025-01-01"}',
            ),
            (2, "No", "Show", "bad", None, None, None, "inactive", "{}"),
            (3, None, None, "solo@example.test", None, 99, None, "active", "{}"),
            (
                4,
                "Object",
                "Value",
                "object@example.test",
                None,
                None,
                None,
                "active",
                '{"start_date_override":{"date":"2025-01-01"}}',
            ),
            (
                5,
                "Array",
                "Value",
                "array@example.test",
                None,
                None,
                None,
                "active",
                '{"start_date_override":["2025-01-01"]}',
            ),
            (6, "Null", "Value", "null@example.test", None, None, None, "active", '{"start_date_override":null}'),
            (7, "Number", "Value", "number@example.test", None, None, None, "active", '{"start_date_override":42}'),
            (8, "Boolean", "Value", "boolean@example.test", None, None, None, "active", '{"start_date_override":true}'),
        ],
    )
    db.executemany(
        "INSERT INTO pg.public.orgs VALUES (?, ?, ?, ?)", [(10, None, "North", "region"), (20, 10, "AO", "ao")]
    )
    db.execute("INSERT INTO pg.public.roles VALUES (3, 'Q'), (2, 'Site Q')")
    db.execute("INSERT INTO pg.public.roles_x_users_x_org VALUES (3, 1, 20), (2, 1, 10), (3, 1, 20), (99, 1, 99)")
    db.executemany(
        "INSERT INTO pg.public.event_instances VALUES (?, ?, ?, ?, ?)",
        [(1, 20, True, 1, "{}"), (2, 10, True, 1, "{}"), (3, 10, False, 1, "{}"), (4, 10, True, None, "{}")],
    )
    db.execute("INSERT INTO pg.public.attendance VALUES (1, 1, false), (1, 2, true), (NULL, 1, false)")
    db.execute("INSERT INTO pg.public.event_instances_x_event_types VALUES (1, 7)")
    db.execute("INSERT INTO pg.public.event_types VALUES (7, 'Run')")
    db.execute("INSERT INTO pg.public.event_tags_x_event_instances VALUES (1, 8)")
    db.execute("INSERT INTO pg.public.event_tags VALUES (8, 'Morning')")
    output = tmp_path / "pv_pax.parquet"
    db.execute(f"COPY ({SQL}) TO ? (FORMAT PARQUET)", [str(output), "2026-01-01T00:00:00Z", "2026-01-01"])
    rows = db.execute("SELECT * FROM read_parquet(?) ORDER BY user_id", [str(output)]).fetchall()
    assert len(rows) == 7
    assert rows[0][1:9] == (1, "Raven", 10, "North", "ada.png", "ada@example.test", "active", "2025-01-01")
    assert rows[0][9] == [{"region_org_id": 10, "region_name": "North"}]
    assert rows[0][10] == [{"ao_org_id": 20, "ao_name": "AO"}]
    assert rows[0][11] == [{"type_id": 7, "type_name": "Run"}]
    assert rows[0][12] == [{"tag_id": 8, "tag_name": "Morning"}]
    assert rows[0][13] == [
        {"role_id": 2, "role_name": "Site Q", "org_id": 10, "org_name": "North", "org_type": "region"},
        {"role_id": 3, "role_name": "Q", "org_id": 20, "org_name": "AO", "org_type": "ao"},
        {"role_id": 99, "role_name": "99", "org_id": 99, "org_name": "99", "org_type": None},
    ]
    assert rows[1][1] == 3 and rows[1][2:9] == ("3", 99, None, None, "solo@example.test", "active", None)
    assert rows[1][9:14] == ([], [], [], [], [])
    by_id = {row[1]: row for row in rows}
    assert by_id[7][8] == "42"
    assert by_id[8][8] == "true"
    for user_id in (4, 5, 6):
        assert by_id[user_id][8] is None
    columns = db.execute("DESCRIBE SELECT * FROM read_parquet(?)", [str(output)]).fetchall()
    assert [column[0] for column in columns] == [
        "refreshed_at",
        "user_id",
        "f3_name",
        "home_region_id",
        "home_region_name",
        "avatar_url",
        "email",
        "status",
        "start_date_override",
        "regions",
        "aos",
        "types",
        "tags",
        "roles",
    ]
    assert columns[9][1] == "STRUCT(region_org_id INTEGER, region_name VARCHAR)[]"
    assert columns[10][1] == "STRUCT(ao_org_id INTEGER, ao_name VARCHAR)[]"
    assert columns[13][1] == (
        "STRUCT(role_id INTEGER, role_name VARCHAR, org_id INTEGER, org_name VARCHAR, org_type VARCHAR)[]"
    )
    assert [(column[0], column[1], column[2] == "YES") for column in columns] == [
        (column.name, column.duckdb_type, column.nullable) for column in SCHEMAS_BY_NAME["pv_pax"].columns
    ]
