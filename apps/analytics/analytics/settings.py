"""Validated, explicit environment configuration for the foundation app."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path


class SettingsError(ValueError):
    """Raised when required analytics configuration is invalid."""


_ENVIRONMENT = re.compile(r"^(?:nonprod|production|local|test)$")
_GCS_PREFIX = re.compile(r"^gs://([a-z0-9][a-z0-9._-]{1,61}[a-z0-9])/(?!/)[^\s]+$")
_BQ_IDENTIFIER = re.compile(r"^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$")
_PG_DATABASE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$")
_PG_SOCKET = re.compile(r"^/cloudsql/f3data:us-central1:f3data(?:-nonprod)?$")
_PG_PORT = re.compile(r"^[0-9]+$")

APPROVED_GCS_PREFIX = "gs://analytics/parquets/pv_regions"
APPROVED_BIGQUERY_TABLE = "f3data.paxVaultDuck.pv_regions"
APPROVED_TARGETS = {
    "nonprod": ("gs://f3-analytics-nonprod/parquets/pv_regions", "f3data.paxVaultDuckStaging.pv_regions"),
    "production": (APPROVED_GCS_PREFIX, APPROVED_BIGQUERY_TABLE),
}
APPROVED_DATABASES = {"nonprod": "f3_staging", "production": "f3_prod"}
_ENVIRONMENT_ALIASES = {"local": "nonprod", "test": "nonprod"}


@dataclass(frozen=True, slots=True)
class Settings:
    environment: str
    extension_directory: Path
    postgres_extension_path: Path
    postgres_socket_dir: str | None
    postgres_host: str | None
    postgres_port: int | None
    postgres_user: str
    postgres_password: str
    postgres_database: str
    gcs_prefix: str
    bigquery_table: str

    @classmethod
    def from_env(cls, environ: dict[str, str] | None = None) -> "Settings":
        values = os.environ if environ is None else environ
        environment = values.get("ANALYTICS_ENVIRONMENT", "").strip()
        extension_directory = values.get("DUCKDB_EXTENSION_DIR", "").strip()
        extension_path = values.get("DUCKDB_POSTGRES_EXTENSION_PATH", "").strip()
        postgres_socket_dir = values.get("ANALYTICS_POSTGRES_SOCKET_DIR", "").strip()
        postgres_host = values.get("ANALYTICS_POSTGRES_HOST", "").strip()
        postgres_port = values.get("ANALYTICS_POSTGRES_PORT", "").strip()
        postgres_user = values.get("ANALYTICS_POSTGRES_USER", "").strip()
        postgres_password = values.get("ANALYTICS_POSTGRES_PASSWORD", "")
        postgres_database = values.get("ANALYTICS_POSTGRES_DATABASE", "").strip()
        gcs_prefix = values.get("ANALYTICS_GCS_PREFIX", "").strip()
        bigquery_table = values.get("ANALYTICS_BIGQUERY_TABLE", "").strip()
        if not _ENVIRONMENT.fullmatch(environment):
            raise SettingsError("ANALYTICS_ENVIRONMENT must be a safe token")
        if not extension_directory:
            raise SettingsError("DUCKDB_EXTENSION_DIR is required")
        if not extension_path:
            raise SettingsError("DUCKDB_POSTGRES_EXTENSION_PATH is required")
        if not all((postgres_user, postgres_password, postgres_database)):
            raise SettingsError("all ANALYTICS_POSTGRES_* connection values are required")
        if not _PG_DATABASE.fullmatch(postgres_database):
            raise SettingsError("ANALYTICS_POSTGRES_DATABASE must be a safe database component")
        if not _GCS_PREFIX.fullmatch(gcs_prefix):
            raise SettingsError("ANALYTICS_GCS_PREFIX must be a valid gs:// bucket prefix")
        if not _BQ_IDENTIFIER.fullmatch(bigquery_table):
            raise SettingsError("ANALYTICS_BIGQUERY_TABLE must be project.dataset.table")
        if environment not in APPROVED_TARGETS:
            target_environment = _ENVIRONMENT_ALIASES[environment]
        else:
            target_environment = environment
        expected_gcs, expected_bigquery = APPROVED_TARGETS[target_environment]
        if (gcs_prefix, bigquery_table) != (expected_gcs, expected_bigquery):
            raise SettingsError(f"publication targets do not match {target_environment}")

        tcp_configured = bool(postgres_host or postgres_port)
        if environment != "local" and tcp_configured:
            raise SettingsError("TCP PostgreSQL configuration is allowed only for local")
        if environment == "local":
            if postgres_socket_dir and tcp_configured:
                raise SettingsError("configure either a PostgreSQL socket or TCP endpoint, not both")
            if tcp_configured:
                if not postgres_host or not postgres_port:
                    raise SettingsError("local TCP PostgreSQL host and port are both required")
                if postgres_host != "localhost":
                    raise SettingsError("local TCP PostgreSQL host must be localhost")
                if not _PG_PORT.fullmatch(postgres_port) or not 1 <= int(postgres_port) <= 65535:
                    raise SettingsError("local TCP PostgreSQL port must be numeric and between 1 and 65535")
                socket_endpoint = None
                tcp_endpoint = (postgres_host, int(postgres_port))
            elif postgres_socket_dir:
                socket_endpoint = postgres_socket_dir
                tcp_endpoint = (None, None)
            else:
                raise SettingsError("local PostgreSQL requires a socket or localhost TCP endpoint")
        else:
            if not postgres_socket_dir:
                raise SettingsError("all ANALYTICS_POSTGRES_* connection values are required")
            socket_endpoint = postgres_socket_dir
            tcp_endpoint = (None, None)

        if socket_endpoint and not _PG_SOCKET.fullmatch(socket_endpoint):
            raise SettingsError("ANALYTICS_POSTGRES_SOCKET_DIR must be an approved Cloud SQL socket")
        expected_socket = (
            "/cloudsql/f3data:us-central1:f3data-nonprod"
            if target_environment == "nonprod"
            else "/cloudsql/f3data:us-central1:f3data"
        )
        if socket_endpoint and socket_endpoint != expected_socket:
            raise SettingsError(f"PostgreSQL socket does not match {target_environment}")
        if postgres_database != APPROVED_DATABASES[target_environment]:
            raise SettingsError(f"PostgreSQL database does not match {target_environment}")
        directory = Path(extension_directory).expanduser()
        path = Path(extension_path).expanduser()
        if not directory.is_absolute() or not path.is_absolute():
            raise SettingsError("DuckDB extension paths must be absolute")
        try:
            path.relative_to(directory)
        except ValueError as error:
            raise SettingsError("PostgreSQL extension must be beneath DUCKDB_EXTENSION_DIR") from error
        if not directory.is_dir():
            raise SettingsError(f"DuckDB extension directory does not exist: {directory}")
        if not path.is_file():
            raise SettingsError(f"PostgreSQL extension does not exist: {path}")
        return cls(
            environment,
            directory,
            path,
            socket_endpoint,
            tcp_endpoint[0],
            tcp_endpoint[1],
            postgres_user,
            postgres_password,
            postgres_database,
            gcs_prefix,
            bigquery_table,
        )
