"""DuckDB setup; extension loading is explicit and never installs at runtime."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .settings import Settings


def connect(settings: Settings, duckdb_module: Any | None = None) -> Any:
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
        connection.execute("SET lock_configuration = true")
        return connection
    except Exception:
        connection.close()
        raise
