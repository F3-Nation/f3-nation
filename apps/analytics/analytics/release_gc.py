"""Generation-aware cleanup of unreferenced product release prefixes.

Age alone cannot tell which release the live pointer or its rollback target
uses, so this module never deletes by age alone. A release prefix is deleted
only when all of the following hold:

- the product pointer exists and passes the publisher's validation, and the
  ``release.json`` of its current and ``retainedPrevious`` releases still exist;
- the release is neither the pointer's current release nor its
  ``retainedPrevious`` rollback target;
- the release is not among the ``keep_latest`` newest complete releases older
  than ``min_age``, not counting the current and ``retainedPrevious`` releases;
- every object in the prefix is older than ``min_age``. This assumes a
  publication finishes (objects written and pointer swapped) within
  ``min_age``; a publication stalled for longer can lose its objects.

Before each release is deleted the pointer generation is re-read; if it moved,
the run stops so the next run plans against the new pointer. Every delete is
pinned to the object generation that was planned, so an object replaced after
planning is never removed. ``release.json`` is deleted first so a partially
deleted prefix can never validate as a release.

The default mode is a dry run that only reports the plan.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from google.api_core.exceptions import GoogleAPICallError, NotFound, PreconditionFailed, RetryError
from google.cloud.storage import Client as StorageClient  # type: ignore[import-untyped]

from .publication import _SAFE_COMPONENT, GcsPublisher
from .settings import Settings

# Shorter than this and a slow publication could lose objects before its pointer swap.
MIN_AGE_FLOOR = timedelta(days=1)
DEFAULT_MIN_AGE = timedelta(days=14)
DEFAULT_KEEP_LATEST = 3
DEFAULT_MAX_RELEASES = 50


@dataclass(slots=True)
class GcResult:
    deleted_release_ids: list[str] = field(default_factory=list)
    deleted_object_count: int = 0
    already_absent_count: int = 0
    skipped_release_ids: list[str] = field(default_factory=list)
    # Set only on a stopped run: the prefix whose deletion had started, which may be partial.
    in_progress_release_id: str | None = None


class ReleaseGcError(RuntimeError):
    """Cleanup refused to plan or stopped before finishing.

    ``reason`` is a fixed, log-safe token. ``release_id`` names the affected
    release when one applies; it is a validated safe component. ``partial`` is
    set when ``apply`` stops after it may have deleted objects.
    """

    def __init__(
        self,
        message: str,
        *,
        reason: str,
        release_id: str | None = None,
        partial: GcResult | None = None,
    ) -> None:
        super().__init__(message)
        self.reason = reason
        self.release_id = release_id
        self.partial = partial


class PointerMovedError(ReleaseGcError):
    """The product pointer changed between planning and deletion."""

    def __init__(self) -> None:
        super().__init__("product pointer changed after planning; re-run to re-plan", reason="pointer_moved")


@dataclass(frozen=True, slots=True)
class PlannedObject:
    name: str
    generation: int
    size: int


@dataclass(frozen=True, slots=True)
class ReleasePrefix:
    release_id: str
    newest_created: datetime
    objects: tuple[PlannedObject, ...]

    @property
    def size(self) -> int:
        return sum(item.size for item in self.objects)


@dataclass(frozen=True, slots=True)
class GcPlan:
    product: str
    pointer_generation: str
    protected: tuple[str, ...]
    kept_recent: tuple[str, ...]
    kept_young: tuple[str, ...]
    deferred: tuple[str, ...]
    candidates: tuple[ReleasePrefix, ...]
    ignored_object_count: int

    def summary(self) -> dict[str, Any]:
        return {
            "product": self.product,
            "pointer_generation": self.pointer_generation,
            "protected_release_ids": list(self.protected),
            "kept_recent_release_ids": list(self.kept_recent),
            "kept_young_count": len(self.kept_young),
            "deferred_release_ids": list(self.deferred),
            "candidate_release_ids": [item.release_id for item in self.candidates],
            "candidate_object_count": sum(len(item.objects) for item in self.candidates),
            "candidate_bytes": sum(item.size for item in self.candidates),
            "ignored_object_count": self.ignored_object_count,
        }


class ReleaseGarbageCollector:
    def __init__(self, client: StorageClient, settings: Settings, *, product: str) -> None:
        self.publisher = GcsPublisher(client, settings, product=product)
        self.client = client
        self.product = product
        self.bucket = self.publisher.bucket
        self.releases_prefix = f"{self.publisher.prefix}/releases/"

    def _pointer(self) -> tuple[dict[str, Any], str]:
        current = self.publisher.read_current_pointer()
        if current is None:
            raise ReleaseGcError("product pointer is absent; refusing to plan cleanup", reason="pointer_absent")
        return current

    def _pointer_generation(self) -> str:
        blob = self.bucket.blob(f"{self.publisher.prefix}/current.json")
        try:
            blob.reload()
        except NotFound:
            raise ReleaseGcError(
                "product pointer disappeared during cleanup; the bucket needs a human", reason="pointer_disappeared"
            ) from None
        return str(blob.generation)

    def _require_release_manifest(self, release_id: str) -> None:
        blob = self.bucket.blob(f"{self.releases_prefix}{release_id}/release.json")
        try:
            blob.reload()
        except NotFound:
            raise ReleaseGcError(
                "a pointer-referenced release manifest is already missing",
                reason="referenced_manifest_missing",
                release_id=release_id,
            ) from None

    def plan(
        self,
        *,
        now: datetime,
        min_age: timedelta = DEFAULT_MIN_AGE,
        keep_latest: int = DEFAULT_KEEP_LATEST,
        max_releases: int = DEFAULT_MAX_RELEASES,
    ) -> GcPlan:
        if now.tzinfo is None:
            raise ValueError("now must be timezone-aware")
        if min_age < MIN_AGE_FLOOR:
            raise ValueError("min_age is below the in-flight publication floor")
        if keep_latest < 0 or max_releases < 1:
            raise ValueError("keep_latest must be >= 0 and max_releases >= 1")

        pointer, generation = self._pointer()
        protected = [pointer["releaseId"]]
        retained = pointer.get("retainedPrevious")
        if retained is not None:
            protected.append(retained["releaseId"])
        # A missing referenced manifest means the bucket is already damaged; stop for a human.
        for release_id in protected:
            self._require_release_manifest(release_id)

        grouped: dict[str, list[tuple[PlannedObject, datetime]]] = {}
        ignored = 0
        for blob in self.client.list_blobs(self.bucket, prefix=self.releases_prefix):
            relative = blob.name[len(self.releases_prefix) :]
            release_id, separator, rest = relative.partition("/")
            created = getattr(blob, "time_created", None)
            if not separator or not rest or not _SAFE_COMPONENT.fullmatch(release_id) or created is None:
                ignored += 1
                continue
            grouped.setdefault(release_id, []).append(
                (PlannedObject(blob.name, int(blob.generation), int(blob.size or 0)), created)
            )

        prefixes = [
            ReleasePrefix(
                release_id,
                max(created for _, created in entries),
                # release.json first so a partial delete never leaves a valid-looking release.
                tuple(
                    sorted(
                        (item for item, _ in entries),
                        key=lambda item: (not item.name.endswith(f"/{release_id}/release.json"), item.name),
                    )
                ),
            )
            for release_id, entries in grouped.items()
        ]
        prefixes.sort(key=lambda item: (item.newest_created, item.release_id), reverse=True)

        protected_set = set(protected)
        unprotected = [item for item in prefixes if item.release_id not in protected_set]
        cutoff = now - min_age
        # Keep-latest is a margin of valid releases the age rule would not already keep, so
        # young prefixes and incomplete ones (no release.json, from failed runs) never use a slot.
        # objects[0] is release.json when the prefix has one (see the sort above).
        complete_old = [
            item
            for item in unprotected
            if item.newest_created <= cutoff and item.objects[0].name.endswith(f"/{item.release_id}/release.json")
        ]
        kept_recent = complete_old[:keep_latest]
        kept_recent_ids = {item.release_id for item in kept_recent}
        kept_young: list[str] = []
        eligible: list[ReleasePrefix] = []
        for item in unprotected:
            if item.release_id in kept_recent_ids:
                continue
            if item.newest_created > cutoff:
                kept_young.append(item.release_id)
            else:
                eligible.append(item)
        # Oldest first, so a capped run makes steady progress on the backlog.
        eligible.reverse()
        return GcPlan(
            product=self.product,
            pointer_generation=generation,
            protected=tuple(protected),
            kept_recent=tuple(item.release_id for item in kept_recent),
            kept_young=tuple(kept_young),
            deferred=tuple(item.release_id for item in eligible[max_releases:]),
            candidates=tuple(eligible[:max_releases]),
            ignored_object_count=ignored,
        )

    def apply(self, plan: GcPlan) -> GcResult:
        result = GcResult()
        current: str | None = None
        try:
            for release in plan.candidates:
                current = None
                if self._pointer_generation() != plan.pointer_generation:
                    raise PointerMovedError()
                current = release.release_id
                for item in release.objects:
                    try:
                        self.bucket.blob(item.name).delete(if_generation_match=item.generation)
                    except NotFound:
                        result.already_absent_count += 1
                        continue
                    except PreconditionFailed:
                        # Release objects are create-only; a new generation means something
                        # unexpected wrote here. Stop on this prefix and report it; a later run
                        # re-plans it once it is older than min_age again.
                        result.skipped_release_ids.append(release.release_id)
                        break
                    result.deleted_object_count += 1
                else:
                    result.deleted_release_ids.append(release.release_id)
        except ReleaseGcError as error:
            result.in_progress_release_id = current
            error.partial = result
            raise
        except (GoogleAPICallError, RetryError) as error:
            result.in_progress_release_id = current
            raise ReleaseGcError("cleanup stopped mid-run", reason="storage_error", partial=result) from error
        return result


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
