from __future__ import annotations

from datetime import date
from enum import StrEnum
from typing import Any

from pydantic import BaseModel


PREBLAST_CHANNEL_META_KEY = "preblast_channel_id"
PREBLAST_POST_CHANNEL_META_KEY = "preblast_post_channel_id"
HC_ANNOUNCED_META_KEY = "hc_announced"
HC_ANNOUNCEMENT_KEY = "hc"
UNHC_ANNOUNCEMENT_KEY = "unhc"

FIRST_F_CATEGORY = "first_f"
SECOND_F_CATEGORY = "second_f"
THIRD_F_CATEGORY = "third_f"


class PostMode(StrEnum):
    SAVE = "save"
    POST_NEW = "post_new"
    UPDATE_EXISTING = "update_existing"
    POST_NEW_CHANNEL = "post_new_channel"


class PreblastEventTypeData(BaseModel):
    id: int
    event_category: str | None = None


class PreblastChannelSelection(BaseModel):
    desired_channel_id: str | None
    source: str


class PreblastPostDecision(BaseModel):
    mode: PostMode
    desired_channel_id: str | None
    posted_channel_id: str | None = None
    existing_preblast_ts: int | float | None = None


class PreblastUpdateCommand(BaseModel):
    instance_id: int
    name: str | None = None
    preblast_rich: Any | None = None
    preblast: str | None = None
    location_id: int | None = None
    clear_location_id: bool = False
    start_date: date | None = None
    start_time: str | None = None
    event_tag_ids: list[int] | None = None
    meta_updates: dict | None = None
    preblast_channel_id: str | None = None


class PostedPreblastCommand(BaseModel):
    instance_id: int
    preblast_ts: int | float
    preblast_post_channel_id: str
