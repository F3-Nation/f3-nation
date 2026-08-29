"""Guard against drift between the SQLAlchemy models and the real Postgres schema.

The Postgres enums are owned by `packages/db` (Drizzle): they are declared in
`packages/shared/src/app/enums.ts`, wired into `packages/db/drizzle/schema.ts`,
and materialised by the generated migrations. This package's `enum.Enum`
classes are a hand-maintained mirror of those types, so nothing stops the two
from diverging -- which is exactly what happened in #848, where `Request_Type`
kept a `create_location` member that Postgres had already dropped.

Rather than re-parse the TypeScript, these tests compare against the Drizzle
migration snapshot for the latest applied migration. That snapshot is the
committed record of the schema Postgres actually ends up with, and CI already
fails if it drifts from `schema.ts`.
"""

import enum
import inspect
import json
from collections import defaultdict
from pathlib import Path
from typing import Dict, List

import pytest
import sqlalchemy as sa

from f3_data_models import models
from f3_data_models.models import Base

DRIZZLE_META_DIR = Path(__file__).resolve().parents[3] / "packages" / "db" / "drizzle" / "meta"

# Everything below is computed at import time, so a missing snapshot directory
# would otherwise surface as a bare `FileNotFoundError` during collection. The
# package is also published standalone (see `pyproject.toml`), where the
# surrounding monorepo -- and therefore Drizzle -- is simply not present.
if not DRIZZLE_META_DIR.is_dir():
    pytest.skip(
        f"Drizzle migration snapshots not found at {DRIZZLE_META_DIR}; "
        "this suite requires a checkout of the f3-nation monorepo.",
        allow_module_level=True,
    )

# Enums that intentionally have no Postgres counterpart in the Drizzle schema.
# `codex_submission_status` belongs to the Codex tables, which are provisioned
# outside of Drizzle (see the raw-SQL comment at the bottom of `models.py`).
# Entries here are asserted to be genuinely absent, so a type that later gains a
# Drizzle definition fails this suite instead of silently staying unchecked.
POSTGRES_UNMANAGED_ENUMS = frozenset({"codex_submission_status"})


def _latest_snapshot() -> Dict:
    """Load the snapshot for the most recent entry in the Drizzle journal."""
    journal = json.loads((DRIZZLE_META_DIR / "_journal.json").read_text())
    latest = max(journal["entries"], key=lambda entry: entry["idx"])
    return json.loads((DRIZZLE_META_DIR / f"{latest['idx']:04d}_snapshot.json").read_text())


def postgres_enums() -> Dict[str, List[str]]:
    """Map every Postgres enum name to its values, in declaration order."""
    return {definition["name"]: list(definition["values"]) for definition in _latest_snapshot()["enums"].values()}


def mapped_enum_columns() -> Dict[str, Dict[str, List[str]]]:
    """Map every Postgres enum name to the values each mapped column emits.

    `sa.Enum.enums` is the authoritative answer to "what strings will actually
    be sent to and read from Postgres" -- it already accounts for whether the
    column was configured to persist member names or member values. Because
    that is a per-column decision, the values are kept keyed by `table.column`
    so a second column of the same type (one that forgot `values_callable`,
    say) is checked too instead of being masked by the first one.
    """
    found: Dict[str, Dict[str, List[str]]] = defaultdict(dict)
    for table in Base.metadata.tables.values():
        for column in table.columns:
            if isinstance(column.type, sa.Enum) and column.type.name:
                found[column.type.name][f"{table.name}.{column.name}"] = list(column.type.enums)
    return dict(found)


def mapped_enums() -> Dict[str, List[str]]:
    """Map every enum type used by a mapped column to the values SQLAlchemy emits.

    Picks an arbitrary column per type; `test_columns_sharing_an_enum_agree`
    is what guarantees the choice does not matter.
    """
    return {enum_name: next(iter(columns.values())) for enum_name, columns in mapped_enum_columns().items()}


def declared_enums() -> Dict[str, List[str]]:
    """Map every enum class declared in `models` to its member names.

    Some enums (`Region_Role`, `User_Role`) mirror a Postgres type without yet
    being attached to a mapped column, so `mapped_enums()` cannot see them.
    Member names are what SQLAlchemy would persist for them by default, and
    lowercasing the class name is how `sa.Enum` derives the Postgres type name.
    """
    return {
        obj.__name__.lower(): [member.name for member in obj]
        for _, obj in inspect.getmembers(models, inspect.isclass)
        if issubclass(obj, enum.Enum) and obj.__module__ == models.__name__
    }


def model_enums() -> Dict[str, List[str]]:
    """Every enum this package models, keyed by its Postgres type name.

    Mapped columns win: they carry the configured persistence behaviour, which
    a bare class cannot express (see `Series_Exception`).
    """
    return {**declared_enums(), **mapped_enums()}


MAPPED_ENUM_COLUMNS = mapped_enum_columns()
MODEL_ENUMS = model_enums()
POSTGRES_ENUMS = postgres_enums()
SHARED_ENUM_NAMES = sorted(set(MODEL_ENUMS) & set(POSTGRES_ENUMS))


@pytest.mark.parametrize("enum_name", sorted(MAPPED_ENUM_COLUMNS))
def test_columns_sharing_an_enum_agree(enum_name: str) -> None:
    """Every column of one Postgres enum must persist the same strings.

    Postgres accepts exactly one set of labels per type, so two columns that
    disagree mean one of them writes values the type rejects. `Series_Exception`
    is the live example: it needs `values_callable` to persist `different-time`
    rather than the member name `different_time`.
    """
    columns = MAPPED_ENUM_COLUMNS[enum_name]
    assert len({tuple(values) for values in columns.values()}) == 1, columns


@pytest.mark.parametrize("enum_name", SHARED_ENUM_NAMES)
def test_model_enum_matches_postgres(enum_name: str) -> None:
    """Values and their order must match the Postgres type exactly.

    Order matters: it defines the sort order of the type in Postgres, and a
    reordered enum is a schema change the models should not invent on their own.
    """
    assert MODEL_ENUMS[enum_name] == POSTGRES_ENUMS[enum_name]


def test_every_postgres_enum_has_a_model_enum() -> None:
    """A new Postgres enum should not be able to land without a model counterpart."""
    assert not sorted(set(POSTGRES_ENUMS) - set(MODEL_ENUMS))


def test_model_enums_without_postgres_counterpart_are_expected() -> None:
    """Only the documented Postgres-unmanaged types may be missing from Drizzle."""
    assert sorted(set(MODEL_ENUMS) - set(POSTGRES_ENUMS)) == sorted(POSTGRES_UNMANAGED_ENUMS)


@pytest.mark.parametrize("enum_name", sorted(POSTGRES_UNMANAGED_ENUMS))
def test_unmanaged_enum_allowlist_is_still_accurate(enum_name: str) -> None:
    """Drop the allowlist entry once Drizzle starts managing the type."""
    assert enum_name not in POSTGRES_ENUMS


def test_request_type_matches_postgres() -> None:
    """Explicit regression test for #848, where these two silently diverged."""
    assert MODEL_ENUMS["request_type"] == POSTGRES_ENUMS["request_type"]
    assert "create_location" not in MODEL_ENUMS["request_type"]
