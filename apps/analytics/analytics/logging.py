"""Small JSON logging adapter with safe structured context."""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import traceback
from typing import Any, TextIO

import duckdb

_EVENT = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$")
_DUCKDB_IO_EXCEPTION = duckdb.IOException
_DUCKDB_IO_MARKERS = {
    "no_space": ("no space left", "disk full", "out of disk space", "enospc"),
    "postgres": ("postgres", "network", "socket"),
    "read": ("read", "recv", "receive"),
    "write": ("write", "writing", "flush", "fsync", "checkpoint"),
}
_SECRET_KEY = re.compile(
    r"(secret|token|password|passwd|pwd|credential|authorization|api[_-]?key|private[_-]?key|"
    r"access[_-]?key|refresh[_-]?token|dsn|connection|string|bearer|cookie|session)",
    re.I,
)


def _safe_error_detail(error: BaseException) -> str:
    """Return a normalized category without exposing the exception message."""
    if isinstance(error, _DUCKDB_IO_EXCEPTION):
        message = str(error).lower()
        if any(marker in message for marker in _DUCKDB_IO_MARKERS["no_space"]):
            return "duckdb_io_no_space"
        if any(marker in message for marker in _DUCKDB_IO_MARKERS["postgres"]) and any(
            marker in message for marker in _DUCKDB_IO_MARKERS["read"]
        ):
            return "duckdb_io_postgres_network_read"
        if any(marker in message for marker in _DUCKDB_IO_MARKERS["write"]):
            return "duckdb_io_write"
        return "duckdb_io"

    categories = (
        (TimeoutError, "timeout_error"),
        (ConnectionError, "connection_error"),
        (PermissionError, "permission_error"),
        (FileNotFoundError, "not_found_error"),
        ((ValueError, TypeError), "validation_error"),
        (OSError, "system_error"),
        (RuntimeError, "runtime_error"),
    )
    for error_type, category in categories:
        if isinstance(error, error_type):
            return category
    return "exception"


def _safe(value: Any, key: str = "") -> Any:
    if _SECRET_KEY.search(key):
        return "[REDACTED]"
    if isinstance(value, dict):
        return {str(k): _safe(v, str(k)) for k, v in value.items()}
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, (list, tuple)):
        return [_safe(item) for item in value]
    return str(value)


class JsonLogger:
    def __init__(self, name: str = "analytics", stream: TextIO | None = None) -> None:
        self._logger = logging.getLogger(name)
        self._stream = stream

    def _write(self, level: str, event: str, context: dict[str, Any], error: BaseException | None = None) -> None:
        if not _EVENT.fullmatch(event):
            raise ValueError(f"invalid log event: {event}")
        record: dict[str, Any] = {"level": level, "event": event, "context": _safe(context)}
        if error is not None:
            error_record: dict[str, Any] = {
                "type": type(error).__name__,
                "module": type(error).__module__,
                "detail": _safe_error_detail(error),
            }
            frames = traceback.extract_tb(error.__traceback__) if error.__traceback__ else ()
            if frames:
                frame = frames[-1]
                error_record["origin"] = {
                    "file": os.path.basename(frame.filename),
                    "line": frame.lineno,
                    "function": frame.name,
                }
            record["error"] = error_record
        stream = self._stream or (sys.stderr if level == "ERROR" else sys.stdout)
        stream.write(json.dumps(record, separators=(",", ":"), default=str) + "\n")
        stream.flush()

    def info(self, event: str, **context: Any) -> None:
        self._write("INFO", event, context)

    def error(self, event: str, error: BaseException | None = None, **context: Any) -> None:
        self._write("ERROR", event, context, error)
