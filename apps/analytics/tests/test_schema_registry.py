from __future__ import annotations

from pathlib import Path
from shutil import copyfile
from typing import Any

import pytest
from test_events_materialization import source as events_source

from analytics.materializations import MATERIALIZATIONS_BY_NAME
from analytics.schema_registry import SCHEMAS_BY_NAME, ExpectedColumn, manifest_columns, schema_fingerprint
from analytics.source import (
    MaterializationArtifacts,
    SchemaValidationError,
    materialize,
    validate_artifacts,
)


def _event_artifacts(tmp_path: Path) -> tuple[Any, MaterializationArtifacts]:
    connection = events_source()
    definition = MATERIALIZATIONS_BY_NAME["pv_events"]
    artifacts = materialize(connection, tmp_path / "events", definition, "2026-01-05T00:00:00Z", "2026-01-05")
    return connection, artifacts


def _rewrite_file(connection, artifacts: MaterializationArtifacts, query: str, source_count: int = 1) -> None:
    path = artifacts.sorted_parquet_files[0]
    replacement = path.with_suffix(".replacement.parquet")
    connection.execute(
        f"COPY ({query}) TO ? (FORMAT PARQUET)", [str(replacement), *(str(path) for _ in range(source_count))]
    )
    replacement.replace(path)


def test_schema_registry_is_complete_and_ordered_for_all_registered_datasets():
    assert tuple(SCHEMAS_BY_NAME) == tuple(MATERIALIZATIONS_BY_NAME)
    for name, definition in MATERIALIZATIONS_BY_NAME.items():
        schema = SCHEMAS_BY_NAME[name]
        assert schema.dataset == definition.name
        assert schema.schema_version == definition.schema_version
        assert schema.columns
        assert all(
            column.name and column.duckdb_type and isinstance(column.nullable, bool) for column in schema.columns
        )

    for dataset in ("event_info", "future_event_info", "attendance_info"):
        columns = {column.name: column.duckdb_type for column in SCHEMAS_BY_NAME[dataset].columns}
        assert columns["created"] == "TIMESTAMP"
        assert columns["updated"] == "TIMESTAMP"

    assert next(column.duckdb_type for column in SCHEMAS_BY_NAME["pv_events"].columns if column.name == "types") == (
        'STRUCT(id INTEGER, "name" VARCHAR, description VARCHAR, event_category VARCHAR)[]'
    )


def test_manifest_columns_keep_projection_order_and_fingerprint_is_stable():
    columns = (ExpectedColumn("zeta", "VARCHAR", True), ExpectedColumn("alpha", "INTEGER", False))
    assert manifest_columns(columns) == [
        {"name": "zeta", "logicalType": "VARCHAR", "nullable": True},
        {"name": "alpha", "logicalType": "INTEGER", "nullable": False},
    ]
    assert schema_fingerprint(columns) == "9938b2472774d28c567ba8dd2fe0358ff23a7bc8cc7c07ff227e9f16009eded5"


def test_materialize_records_fingerprint_row_counts_and_physical_nested_schema(tmp_path: Path):
    connection, artifacts = _event_artifacts(tmp_path)
    assert artifacts.schema_evidence is not None
    evidence = artifacts.schema_evidence
    assert evidence.schemaFingerprintSha256 == evidence.schema_fingerprint_sha256
    assert len(evidence.schema_fingerprint_sha256) == 64
    assert evidence.file_row_counts == (artifacts.row_count,)
    assert len(evidence.physical_schemas) == 1
    assert any(name == "types" and children > 0 for name, _type, _repetition, children in evidence.physical_schemas[0])
    assert validate_artifacts(connection, artifacts, MATERIALIZATIONS_BY_NAME["pv_events"]) == evidence


@pytest.mark.parametrize(
    "projection",
    (
        "SELECT event_name AS renamed, * EXCLUDE (event_name) FROM read_parquet(?)",
        "SELECT event_name, * EXCLUDE (event_name) FROM read_parquet(?)",
        "SELECT * REPLACE (CAST(event_id AS VARCHAR) AS event_id) FROM read_parquet(?)",
    ),
    ids=("name", "order", "type"),
)
def test_schema_mutations_are_rejected(tmp_path: Path, projection: str):
    connection, artifacts = _event_artifacts(tmp_path)
    _rewrite_file(connection, artifacts, projection)
    with pytest.raises(SchemaValidationError, match="schema mismatch"):
        validate_artifacts(connection, artifacts, MATERIALIZATIONS_BY_NAME["pv_events"])


def test_parquet_row_count_mutation_is_rejected(tmp_path: Path):
    connection, artifacts = _event_artifacts(tmp_path)
    _rewrite_file(
        connection,
        artifacts,
        "SELECT * FROM read_parquet(?) UNION ALL SELECT * FROM read_parquet(?)",
        source_count=2,
    )
    with pytest.raises(SchemaValidationError, match="row counts"):
        validate_artifacts(connection, artifacts, MATERIALIZATIONS_BY_NAME["pv_events"])


def test_unlisted_parquet_files_are_rejected(tmp_path: Path):
    connection, artifacts = _event_artifacts(tmp_path)
    extra_file = artifacts.root / "unexpected.parquet"
    connection.execute(
        "COPY (SELECT * FROM read_parquet(?)) TO ? (FORMAT PARQUET)",
        [str(extra_file), str(artifacts.sorted_parquet_files[0])],
    )
    with pytest.raises(SchemaValidationError, match="file set"):
        validate_artifacts(connection, artifacts, MATERIALIZATIONS_BY_NAME["pv_events"])


def test_parquet_partitions_with_different_physical_schemas_are_rejected(tmp_path: Path):
    connection, artifacts = _event_artifacts(tmp_path)
    first = artifacts.sorted_parquet_files[0]
    second = first.with_name("pv_events-second.parquet")
    copyfile(first, second)
    partitioned = MaterializationArtifacts(
        artifacts.root,
        (first, second),
        artifacts.row_count * 2,
        artifacts.schema_evidence,
    )

    class MismatchedPhysicalSchemaConnection:
        physical_reads = 0

        def execute(self, query: str, *parameters: Any):
            result = connection.execute(query, *parameters)
            if "parquet_schema" not in query:
                return result
            rows = result.fetchall()
            self.physical_reads += 1
            if self.physical_reads == 2:
                mismatched = list(rows[0])
                mismatched[4] = "MISMATCHED_REPETITION"
                rows[0] = tuple(mismatched)
            return type("Rows", (), {"fetchall": lambda _self: rows})()

    with pytest.raises(SchemaValidationError, match="inconsistent physical schemas"):
        validate_artifacts(
            MismatchedPhysicalSchemaConnection(),
            partitioned,
            MATERIALIZATIONS_BY_NAME["pv_events"],
        )


def test_rich_json_types_and_json_null_remain_distinct_from_sql_null(tmp_path: Path):
    connection = events_source()
    connection.execute("UPDATE pg.public.event_instances SET preblast_rich = 'null'::JSON WHERE id = 2")
    definition = MATERIALIZATIONS_BY_NAME["pv_events"]
    artifacts = materialize(connection, tmp_path / "json", definition, "2026-01-05T00:00:00Z", "2026-01-05")
    rows = connection.execute(
        "SELECT preblast_rich, backblast_rich FROM read_parquet(?) WHERE event_id = 2",
        [str(artifacts.sorted_parquet_files[0])],
    ).fetchone()
    assert rows == ("null", None)
    assert artifacts.schema_evidence is not None
    columns = {column.name: column.duckdb_type for column in artifacts.schema_evidence.columns}
    assert columns["preblast_rich"] == "JSON"
    assert columns["backblast_rich"] == "JSON"
