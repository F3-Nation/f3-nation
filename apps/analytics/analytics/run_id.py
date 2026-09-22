"""Stable-format, unique identifiers for ETL runs."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID, uuid4


@dataclass(frozen=True, slots=True)
class RunId:
    value: str

    @classmethod
    def create(cls, now: datetime | None = None) -> "RunId":
        timestamp = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
        return cls(f"{timestamp:%Y%m%dT%H%M%S.%fZ}-{uuid4().hex}")

    def __post_init__(self) -> None:
        prefix, separator, suffix = self.value.partition("-")
        if not separator or len(prefix) != 23 or len(suffix) != 32:
            raise ValueError("invalid run identifier")
        UUID(suffix)

    def __str__(self) -> str:
        return self.value
