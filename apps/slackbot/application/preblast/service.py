from __future__ import annotations

from datetime import date
from typing import Any, Iterable

from application.attendance.service import AttendanceService
from application.event_instance import EventInstanceData
from application.event_instance.service import EventInstanceService
from application.preblast import (
    HC_ANNOUNCED_META_KEY,
    HC_ANNOUNCEMENT_KEY,
    PREBLAST_CHANNEL_META_KEY,
    PREBLAST_POST_CHANNEL_META_KEY,
    SECOND_F_CATEGORY,
    THIRD_F_CATEGORY,
    UNHC_ANNOUNCEMENT_KEY,
    PostMode,
    PreblastChannelSelection,
    PreblastEventTypeData,
    PreblastPostDecision,
    PreblastUpdateCommand,
)


class PreblastService:
    """Slack-free preblast business logic and command assembly."""

    def __init__(
        self,
        event_instance_service: EventInstanceService | None = None,
        attendance_service: AttendanceService | None = None,
    ) -> None:
        self._event_instance_service = event_instance_service
        self._attendance_service = attendance_service

    def is_channel_selector_eligible(
        self,
        event: EventInstanceData,
        event_types: Iterable[PreblastEventTypeData],
    ) -> bool:
        if event.series_id is None or event.highlight or event.is_private:
            return True
        categories = {event_type.event_category for event_type in event_types if event_type.id in event.event_type_ids}
        return bool(categories.intersection({SECOND_F_CATEGORY, THIRD_F_CATEGORY}))

    def resolve_destination_channel(
        self,
        event: EventInstanceData,
        default_channel_id: str | None,
    ) -> PreblastChannelSelection:
        configured_channel = (event.meta or {}).get(PREBLAST_CHANNEL_META_KEY)
        if configured_channel:
            return PreblastChannelSelection(desired_channel_id=str(configured_channel), source="event_meta")
        return PreblastChannelSelection(desired_channel_id=default_channel_id, source="default")

    def resolve_posted_channel(self, event: EventInstanceData, fallback_channel_id: str | None) -> str | None:
        posted_channel = (event.meta or {}).get(PREBLAST_POST_CHANNEL_META_KEY) or fallback_channel_id
        return str(posted_channel) if posted_channel else None

    def decide_post_mode(
        self,
        event: EventInstanceData,
        desired_channel_id: str | None,
        *,
        posted_channel_fallback_id: str | None = None,
        save_only: bool = False,
        force_repost: bool = False,
        update_existing: bool = True,
    ) -> PreblastPostDecision:
        posted_channel_id = None
        if event.preblast_ts:
            posted_channel_id = self.resolve_posted_channel(event, posted_channel_fallback_id)
        if save_only:
            mode = PostMode.SAVE
        elif not desired_channel_id:
            mode = PostMode.SAVE
        elif event.preblast_ts and posted_channel_id and posted_channel_id != desired_channel_id:
            mode = PostMode.POST_NEW_CHANNEL
        elif force_repost or not event.preblast_ts:
            mode = PostMode.POST_NEW
        elif update_existing:
            mode = PostMode.UPDATE_EXISTING
        else:
            mode = PostMode.POST_NEW
        return PreblastPostDecision(
            mode=mode,
            desired_channel_id=desired_channel_id,
            posted_channel_id=posted_channel_id,
            existing_preblast_ts=event.preblast_ts,
        )

    def merge_meta(self, existing_meta: dict | None, updates: dict | None = None) -> dict:
        meta = dict(existing_meta or {})
        if updates:
            meta.update(updates)
        return meta

    def with_desired_channel_meta(self, existing_meta: dict | None, channel_id: str | None) -> dict:
        return self.merge_meta(existing_meta, {PREBLAST_CHANNEL_META_KEY: channel_id} if channel_id else None)

    def with_posted_channel_meta(self, existing_meta: dict | None, channel_id: str) -> dict:
        return self.merge_meta(existing_meta, {PREBLAST_POST_CHANNEL_META_KEY: channel_id})

    def _hc_announced_ids(self, meta: dict | None, announcement_key: str = HC_ANNOUNCEMENT_KEY) -> set[str]:
        announced = (meta or {}).get(HC_ANNOUNCED_META_KEY, {}) or {}
        if isinstance(announced, list):
            # Compatibility with early Phase 2 drafts that stored one flat list.
            raw_ids = announced
        else:
            raw_ids = announced.get(announcement_key, []) or []
        return {str(user_id) for user_id in raw_ids}

    def has_hc_announcement_been_sent(
        self,
        meta: dict | None,
        user_id: int | str,
        *,
        is_hc: bool = True,
    ) -> bool:
        announcement_key = HC_ANNOUNCEMENT_KEY if is_hc else UNHC_ANNOUNCEMENT_KEY
        return str(user_id) in self._hc_announced_ids(meta, announcement_key)

    def mark_hc_announcement_sent(
        self,
        meta: dict | None,
        user_id: int | str,
        *,
        is_hc: bool = True,
    ) -> dict:
        announcement_key = HC_ANNOUNCEMENT_KEY if is_hc else UNHC_ANNOUNCEMENT_KEY
        announced_ids = self._hc_announced_ids(meta, announcement_key)
        raw_announced = (meta or {}).get(HC_ANNOUNCED_META_KEY, {}) or {}
        if isinstance(raw_announced, list):
            announced = {announcement_key: sorted(announced_ids)}
        else:
            announced = dict(raw_announced)
        announced_ids.add(str(user_id))
        announced[announcement_key] = sorted(announced_ids)
        return self.merge_meta(meta, {HC_ANNOUNCED_META_KEY: announced})

    def build_update_command(
        self,
        event: EventInstanceData,
        *,
        name: str | None = None,
        preblast_rich: Any | None = None,
        preblast: str | None = None,
        location_id: int | None = None,
        clear_location_id: bool = False,
        start_date: date | None = None,
        start_time: str | None = None,
        event_tag_ids: list[int] | None = None,
        desired_channel_id: str | None = None,
        meta_updates: dict | None = None,
    ) -> PreblastUpdateCommand:
        return PreblastUpdateCommand(
            instance_id=event.id,
            name=name,
            preblast_rich=preblast_rich,
            preblast=preblast,
            location_id=location_id,
            clear_location_id=clear_location_id,
            start_date=start_date,
            start_time=start_time,
            event_tag_ids=event_tag_ids,
            meta_updates=meta_updates,
            preblast_channel_id=desired_channel_id,
        )

    def save_event_update(
        self,
        command: PreblastUpdateCommand,
        *,
        existing_event: EventInstanceData | None = None,
    ) -> EventInstanceData:
        if self._event_instance_service is None:
            raise ValueError("EventInstanceService is required to save preblast updates")
        payload = command.model_dump()
        if existing_event is not None:
            payload["existing_instance"] = existing_event
        return self._event_instance_service.update_preblast_fields(**payload)

    def persist_posted_preblast(
        self,
        *,
        instance_id: int,
        preblast_ts: int | float,
        channel_id: str,
        existing_event: EventInstanceData | None = None,
    ) -> EventInstanceData:
        if self._event_instance_service is None:
            raise ValueError("EventInstanceService is required to persist posted preblast data")
        payload: dict[str, Any] = {
            "preblast_ts": preblast_ts,
            "preblast_post_channel_id": channel_id,
        }
        if existing_event is not None:
            payload["existing_instance"] = existing_event
        return self._event_instance_service.persist_posted_preblast(instance_id, **payload)

    def add_hc(self, event_instance_id: int | str, user_id: int | str):
        if self._attendance_service is None:
            raise ValueError("AttendanceService is required to update attendance")
        return self._attendance_service.add_hc(event_instance_id, user_id)

    def remove_hc(self, event_instance_id: int | str, user_id: int | str):
        if self._attendance_service is None:
            raise ValueError("AttendanceService is required to update attendance")
        return self._attendance_service.remove_hc(event_instance_id, user_id)

    def take_q(self, event_instance_id: int | str, user_id: int | str):
        if self._attendance_service is None:
            raise ValueError("AttendanceService is required to update attendance")
        return self._attendance_service.take_q(event_instance_id, user_id)

    def remove_q(self, event_instance_id: int | str, user_id: int | str):
        if self._attendance_service is None:
            raise ValueError("AttendanceService is required to update attendance")
        return self._attendance_service.remove_q(event_instance_id, user_id)

    def assign_qs(self, event_instance_id: int | str, q_user_id: int | str | None, co_q_user_ids: list[int | str]):
        if self._attendance_service is None:
            raise ValueError("AttendanceService is required to update attendance")
        return self._attendance_service.assign_qs(event_instance_id, q_user_id, co_q_user_ids)

    def check_and_mark_hc_announcement(
        self, event_instance_id: int, slack_user_id: str, *, is_hc: bool
    ) -> bool:
        """Return True if the HC announcement should be posted (and mark it sent)."""
        if not self._event_instance_service:
            return True  # fail open
        event = self._event_instance_service.get_by_id(event_instance_id)
        if not event:
            return True
        if self.has_hc_announcement_been_sent(event.meta, slack_user_id, is_hc=is_hc):
            return False
        updated_meta = self.mark_hc_announcement_sent(event.meta, slack_user_id, is_hc=is_hc)
        self._event_instance_service.update_preblast_fields(
            event_instance_id,
            existing_instance=event,
            meta_updates={
                k: updated_meta[k] for k in updated_meta
                if k not in (event.meta or {}) or updated_meta[k] != event.meta.get(k)
            },
        )
        return True
