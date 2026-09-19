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
    diagnostic_single_thread: bool = False,
    diagnostic_temp_directory: Path | None = None,
) -> Any:
    module: Any = duckdb_module
    if module is None:
        import duckdb as module
    config = {
        "autoinstall_known_extensions": "false",
        "autoload_known_extensions": "false",
        "extension_directory": str(settings.extension_directory),
    }
    if diagnostic_single_thread:
        config["threads"] = "1"
    if diagnostic_temp_directory is not None:
        config["temp_directory"] = str(diagnostic_temp_directory)
    connection = module.connect(
        ":memory:",
        config=config,
    )
    try:
        extension = Path(settings.postgres_extension_path)
        extension.relative_to(settings.extension_directory)
        connection.load_extension("postgres")
        # Work around the postgres extension's "Unsupported table filter type";
        # this must precede configuration locking because the setting is immutable after it.
        connection.execute("SET pg_experimental_filter_pushdown = false")
        if diagnostic_single_thread:
            connection.execute("SET pg_connection_limit = 1")
        if diagnostic_text_copy:
            connection.execute("SET pg_use_binary_copy = false")
        connection.execute("SET lock_configuration = true")
        return connection
    except Exception:
        connection.close()
        raise


def connect_staged_diagnostic(temp_directory: Path, duckdb_module: Any | None = None) -> Any:
    """Create an un-attached DuckDB connection for staged diagnostics only."""
    module: Any = duckdb_module
    if module is None:
        import duckdb as module
    return module.connect(
        ":memory:",
        config={
            "autoinstall_known_extensions": "false",
            "autoload_known_extensions": "false",
            "temp_directory": str(temp_directory),
        },
    )


def connect_ctas_diagnostic(settings: Settings, temp_directory: Path, duckdb_module: Any | None = None) -> Any:
    """Create a temporary extension-enabled connection for CTAS diagnostics."""
    return connect(
        settings,
        duckdb_module,
        diagnostic_single_thread=True,
        diagnostic_temp_directory=temp_directory,
    )
