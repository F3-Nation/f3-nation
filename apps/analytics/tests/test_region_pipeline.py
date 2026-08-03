from __future__ import annotations

import json
from pathlib import Path

import duckdb
import pytest

from analytics.source import materialize


def make_source() -> duckdb.DuckDBPyConnection:
    connection = duckdb.connect(":memory:")
    connection.execute("ATTACH ':memory:' AS pg")
    connection.execute("CREATE SCHEMA pg.public")
    connection.execute(
        "CREATE TABLE pg.public.orgs (id INTEGER, parent_id INTEGER, name VARCHAR, "
        "logo_url VARCHAR, is_active BOOLEAN, org_type VARCHAR)"
    )
    connection.execute(
        "CREATE TABLE pg.public.event_instances (id INTEGER, org_id INTEGER, "
        "is_active BOOLEAN, pax_count INTEGER, meta JSON)"
    )
    connection.execute(
        "CREATE TABLE pg.public.event_instances_x_event_types "
        "(event_instance_id INTEGER, event_type_id INTEGER)"
    )
    connection.execute("CREATE TABLE pg.public.event_types (id INTEGER, name VARCHAR)")
    connection.execute(
        "CREATE TABLE pg.public.event_tags_x_event_instances "
        "(event_instance_id INTEGER, event_tag_id INTEGER)"
    )
    connection.execute("CREATE TABLE pg.public.event_tags (id INTEGER, name VARCHAR)")
    connection.executemany(
        "INSERT INTO pg.public.orgs VALUES (?, ?, ?, ?, ?, ?)",
        [
            (10, None, "Area", None, True, "area"),
            (1, 10, "Region One", "https://logo", True, "region"),
            (2, 10, None, None, True, "region"),
            (3, 10, "Inactive", None, False, "region"),
            (100, 1, "AO One", None, True, "ao"),
        ],
    )
    connection.executemany(
        "INSERT INTO pg.public.event_instances VALUES (?, ?, ?, ?, ?)",
        [
            (1, 1, True, 10, "{}"),
            (2, 100, True, 20, "{}"),
            (3, 1, True, 2, '{"exclude_from_pax_vault":true}'),
            (4, 1, False, 2, "{}"),
            (5, 1, True, None, "{}"),
            (6, 1, True, 1, None),
            (7, 1, True, 1, '{"exclude_from_pax_vault":null}'),
            (8, 1, True, 1, '{"exclude_from_pax_vault":false}'),
        ],
    )
    connection.execute("INSERT INTO pg.public.event_instances_x_event_types VALUES (1, 20), (2, 10)")
    connection.execute("INSERT INTO pg.public.event_types VALUES (20, 'Run'), (10, 'Q')")
    connection.execute("INSERT INTO pg.public.event_tags_x_event_instances VALUES (1, 8)")
    connection.execute("INSERT INTO pg.public.event_tags VALUES (8, 'Morning')")
    return connection


def test_region_materialization_semantics_and_nested_lists(tmp_path: Path):
    connection = make_source()
    output = tmp_path / "regions.parquet"
    assert materialize(connection, output, "2026-01-01T00:00:00+00:00") == 3
    rows = connection.execute("SELECT * FROM read_parquet(?) ORDER BY region_id", [str(output)]).fetchall()
    assert [row[0] for row in rows] == [1, 2, 3]
    assert rows[0][0:5] == (1, "Region One", 10, "Area", "https://logo")
    assert rows[0][6] == [{"ao_org_id": 100, "ao_name": "AO One"}]
    assert rows[0][7] == [{"type_id": 10, "type_name": "Q"}, {"type_id": 20, "type_name": "Run"}]
    assert rows[0][8] == [{"tag_id": 8, "tag_name": "Morning"}]
    assert rows[1][1] == "2" and rows[1][4] is None
    assert rows[1][6] == [] and rows[1][7] == [] and rows[1][8] == []
    assert rows[2][1] == "Inactive" and rows[2][5] is False
    columns = connection.execute("DESCRIBE SELECT * FROM read_parquet(?)", [str(output)]).fetchall()
    assert [(row[0], row[1]) for row in columns] == [
        ("region_id", "INTEGER"),
        ("region_name", "VARCHAR"),
        ("area_id", "INTEGER"),
        ("area_name", "VARCHAR"),
        ("logo_url", "VARCHAR"),
        ("is_active", "BOOLEAN"),
        ("aos", "STRUCT(ao_org_id INTEGER, ao_name VARCHAR)[]"),
        ("types", "STRUCT(type_id INTEGER, type_name VARCHAR)[]"),
        ("tags", "STRUCT(tag_id INTEGER, tag_name VARCHAR)[]"),
        ("refreshed_at", "TIMESTAMP WITH TIME ZONE"),
    ]
    assert output.exists()


def test_malformed_exclusion_flag_fails_in_materialization(tmp_path: Path):
    connection = make_source()
    connection.execute(
        "UPDATE pg.public.event_instances SET meta = ? WHERE id = 1",
        [json.dumps({"exclude_from_pax_vault": "yes"})],
    )
    with pytest.raises(Exception, match="exclude_from_pax_vault"):
        materialize(connection, tmp_path / "malformed.parquet", "2026-01-01T00:00:00+00:00")


def test_malformed_flag_on_an_ineligible_event_does_not_fail(tmp_path: Path):
    connection = make_source()
    connection.execute(
        "UPDATE pg.public.event_instances SET meta = ? WHERE id = 4",
        [json.dumps({"exclude_from_pax_vault": "yes"})],
    )
    assert materialize(connection, tmp_path / "regions.parquet", "2026-01-01T00:00:00+00:00") == 3
