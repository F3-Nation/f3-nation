"""Small JSON logging adapter with safe structured context."""

from __future__ import annotations

import json
import logging
import re
import sys
from typing import Any, TextIO

_EVENT = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$")
_SECRET_KEY = re.compile(
    r"(secret|token|password|passwd|pwd|credential|authorization|api[_-]?key|private[_-]?key|"
    r"access[_-]?key|refresh[_-]?token|dsn|connection|string|bearer|cookie|session)",
    re.I,
)


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
            record["error"] = {"type": type(error).__name__}
        stream = self._stream or (sys.stderr if level == "ERROR" else sys.stdout)
        stream.write(json.dumps(record, separators=(",", ":"), default=str) + "\n")
        stream.flush()

    def info(self, event: str, **context: Any) -> None:
        self._write("INFO", event, context)

    def error(self, event: str, error: BaseException | None = None, **context: Any) -> None:
        self._write("ERROR", event, context, error)
