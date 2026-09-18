"""DuckDB setup; extension loading is explicit and never installs at runtime."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .settings import Settings


def connect(
    settings: Settings,
    duckdb_module: Any | None = None,
    *,
    diagnostic_text_copy: bool = False,
) -> Any:
    module: Any = duckdb_module
    if module is None:
        import duckdb as module
    connection = module.connect(
        ":memory:",
        config={
            "autoinstall_known_extensions": "false",
            "autoload_known_extensions": "false",
            "extension_directory": str(settings.extension_directory),
        },
    )
    try:
        extension = Path(settings.postgres_extension_path)
        extension.relative_to(settings.extension_directory)
        connection.load_extension("postgres")
        # Work around the postgres extension's "Unsupported table filter type";
        # this must precede configuration locking because the setting is immutable after it.
        connection.execute("SET pg_experimental_filter_pushdown = false")
        if diagnostic_text_copy:
            connection.execute("SET pg_use_binary_copy = false")
        connection.execute("SET lock_configuration = true")
        return connection
    except Exception:
        connection.close()
        raise
