"""A bounded GCS generation-precondition publication lease."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

from google.api_core.exceptions import NotFound, PreconditionFailed

from .materializations import Materialization
from .settings import Settings

LEASE_TTL = timedelta(minutes=90)


class LeaseActiveError(RuntimeError):
    """Another non-expired publisher owns the target lease."""

    def __init__(self, metadata: dict[str, Any]) -> None:
        super().__init__("analytics publication lease is active")
        self.metadata = metadata


class LeaseConflictError(RuntimeError):
    """A conditional lease operation lost a race."""

    def __init__(self, message: str, metadata: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.metadata = metadata or {}


@dataclass(frozen=True, slots=True)
class LeaseHandle:
    generation: str
    payload: dict[str, Any]


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class GcsLease:
    def __init__(self, storage_client: Any, settings: Settings, materialization: Materialization) -> None:
        self.materialization = materialization
        bucket_name = settings.target(materialization)[0].removeprefix("gs://").split("/", 1)[0]
        prefix = settings.target(materialization)[0].split("/", 3)[-1]
        self.blob = storage_client.bucket(bucket_name).blob(f"{prefix}/lease.json")

    @staticmethod
    def _payload(settings: Settings, run_id: str, context: dict[str, str], now: datetime) -> dict[str, Any]:
        return {
            "state": "active",
            "environment": settings.environment,
            "run_id": run_id,
            "job": context.get("job"),
            "execution": context.get("execution"),
            "acquired_at": _iso(now),
            "expires_at": _iso(now + LEASE_TTL),
        }

    def _write(self, payload: dict[str, Any], generation: int) -> LeaseHandle:
        self.blob.upload_from_string(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode(),
            content_type="application/json",
            if_generation_match=generation,
            checksum="crc32c",
        )
        self.blob.reload()
        return LeaseHandle(str(self.blob.generation), payload)

    def acquire(self, settings: Settings, run_id: str, context: dict[str, str], now: datetime) -> LeaseHandle:
        payload = self._payload(settings, run_id, context, now)
        try:
            self.blob.reload()
        except NotFound:
            try:
                return self._write(payload, 0)
            except PreconditionFailed as error:
                raise LeaseConflictError(
                    "publication lease acquisition raced",
                    {"stage": "lease_acquire", "materialization": self.materialization.name, "attempt_run_id": run_id},
                ) from error

        current = json.loads(self.blob.download_as_text())
        expires_at = datetime.fromisoformat(current["expires_at"].replace("Z", "+00:00"))
        if current.get("state") == "active" and expires_at > now:
            raise LeaseActiveError(
                {
                    "stage": "lease_acquire",
                    "environment": current.get("environment"),
                    "lease_owner_run_id": current.get("run_id"),
                    "expires_at": current.get("expires_at"),
                    "generation": str(self.blob.generation),
                    "materialization": self.materialization.name,
                }
            )
        try:
            return self._write(payload, int(self.blob.generation))
        except PreconditionFailed as error:
            raise LeaseConflictError(
                "expired publication lease takeover raced",
                {"stage": "lease_acquire", "materialization": self.materialization.name, "attempt_run_id": run_id},
            ) from error

    def release(self, handle: LeaseHandle, now: datetime) -> LeaseHandle:
        released = dict(handle.payload)
        released.update({"state": "released", "released_at": _iso(now)})
        try:
            return self._write(released, int(handle.generation))
        except (NotFound, PreconditionFailed) as error:
            raise LeaseConflictError(
                "publication lease release lost its generation race", {"materialization": self.materialization.name}
            ) from error


def cloud_run_context(environ: Mapping[str, str]) -> dict[str, str]:
    context = {}
    if environ.get("CLOUD_RUN_JOB"):
        context["job"] = environ["CLOUD_RUN_JOB"]
    if environ.get("CLOUD_RUN_EXECUTION"):
        context["execution"] = environ["CLOUD_RUN_EXECUTION"]
    return context
