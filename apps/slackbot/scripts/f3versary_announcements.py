"""Post configurable regional F3versary announcements from the hourly runner."""

from __future__ import annotations

import argparse
import logging
import os
import sys
import traceback
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from html import escape
from time import sleep
from uuid import NAMESPACE_URL, uuid4, uuid5

import pytz
from f3_data_models.models import (
    Attendance,
    EventInstance,
    F3versaryAnnouncementSetting,
    F3versaryDeliveryPage,
    F3versaryDeliveryRun,
    Org,
    Org_x_SlackSpace,
    SlackSpace,
    SlackUser,
    User,
)
from f3_data_models.utils import DbManager, get_session
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError
from sqlalchemy import and_, func

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

logger = logging.getLogger(__name__)

CENTRAL_TIMEZONE = pytz.timezone("US/Central")
SEND_HOUR_CST = 17
DEFAULT_LEAD_DAYS = 14
MIN_LEAD_DAYS = 0
MAX_LEAD_DAYS = 30
LAST_PROCESSED_SETTING = "f3versary_announcements_last_processed_date"
DELIVERY_PLAN_SETTING = "f3versary_announcements_delivery_plan"
START_DATE_OVERRIDE_META_KEY = "start_date_override"
MAX_SECTION_TEXT_LENGTH = 3000
MAX_MESSAGE_TEXT_LENGTH = 4000
MAX_MESSAGE_BLOCKS = 50
MAX_F3_NAME_LENGTH = 256
CLAIM_LEASE = timedelta(minutes=5)
SLACK_HTTP_TIMEOUT_SECONDS = 20
MIN_POST_INTERVAL_SECONDS = 1.1


@dataclass(frozen=True)
class F3versaryConfig:
    enabled: bool
    org_id: int
    team_id: str
    bot_token: str | None
    channel: str | None
    lead_days: int
    last_processed_date: date | None


@dataclass(frozen=True)
class F3versaryCandidate:
    user_id: int
    f3_name: str | None
    slack_id: str | None
    effective_start_date: date
    anniversary_date: date
    completed_years: int


@dataclass(frozen=True)
class ClaimedPage:
    run_id: int
    page_id: int
    page_number: int
    channel: str
    text: str
    blocks: list[dict]
    client_msg_id: str
    claim_token: str


def _bounded_lead_days(value: object) -> int:
    if value is None:
        return DEFAULT_LEAD_DAYS
    try:
        if isinstance(value, (bool, float)):
            raise ValueError("Lead time must be a whole number")
        lead_days = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        logger.warning("Invalid F3versary lead-time setting (type=%s); using default", type(value).__name__)
        return DEFAULT_LEAD_DAYS
    if not MIN_LEAD_DAYS <= lead_days <= MAX_LEAD_DAYS:
        logger.warning("Out-of-range F3versary lead-time setting; using default")
        return DEFAULT_LEAD_DAYS
    return lead_days


def _parse_date(value: object) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _effective_start_date(first_attendance_date: date | None, user_meta: object) -> date | None:
    if isinstance(user_meta, dict):
        override_date = _parse_date(user_meta.get(START_DATE_OVERRIDE_META_KEY))
        if override_date is not None:
            return override_date
    return first_attendance_date


def _load_settings(
    org: Org,
    slack_space: SlackSpace,
    regional_setting: F3versaryAnnouncementSetting | None,
) -> F3versaryConfig:
    """Use the region row for opt-in; workspace JSONB is read only for legacy cutover."""
    lead_days = _bounded_lead_days(regional_setting.lead_days if regional_setting else None)
    if regional_setting is not None and lead_days != regional_setting.lead_days:
        logger.warning("Invalid stored F3versary lead time for org_id=%s; using default", org.id)
    return F3versaryConfig(
        enabled=bool(regional_setting.enabled) if regional_setting else False,
        org_id=org.id,
        team_id=slack_space.team_id,
        bot_token=slack_space.bot_token,
        channel=regional_setting.channel if regional_setting else None,
        lead_days=lead_days,
        last_processed_date=_parse_date((slack_space.settings or {}).get(LAST_PROCESSED_SETTING)),
    )


def observed_anniversary(first_attendance_date: date, target_year: int) -> date:
    """Return the anniversary observed in target_year, treating Feb 28 as Feb 29 in non-leap years."""
    try:
        return first_attendance_date.replace(year=target_year)
    except ValueError:
        return date(target_year, 2, 28)


def select_f3versary_candidates(
    rows: Iterable[tuple[int, str | None, date | None, str | None, object]],
    target_date: date,
) -> list[F3versaryCandidate]:
    candidates: list[F3versaryCandidate] = []
    for user_id, f3_name, first_attendance_date, slack_id, user_meta in rows:
        effective_start_date = _effective_start_date(first_attendance_date, user_meta)
        if effective_start_date is None:
            continue
        anniversary_date = observed_anniversary(effective_start_date, target_date.year)
        completed_years = target_date.year - effective_start_date.year
        if anniversary_date != target_date or completed_years < 1:
            continue
        if not slack_id and not (f3_name and f3_name.strip()):
            continue
        candidates.append(
            F3versaryCandidate(
                user_id=user_id,
                f3_name=f3_name.strip() if f3_name else None,
                slack_id=slack_id,
                effective_start_date=effective_start_date,
                anniversary_date=anniversary_date,
                completed_years=completed_years,
            )
        )

    return sorted(candidates, key=lambda candidate: ((candidate.f3_name or "").casefold(), candidate.user_id))


def get_f3versary_candidates(config: F3versaryConfig, target_date: date) -> list[F3versaryCandidate]:
    with get_session() as session:
        first_attendance = (
            session.query(
                Attendance.user_id.label("user_id"),
                func.min(EventInstance.start_date).label("first_attendance_date"),
            )
            .select_from(Attendance)
            .join(EventInstance, EventInstance.id == Attendance.event_instance_id)
            .join(User, User.id == Attendance.user_id)
            .filter(
                Attendance.user_id.is_not(None),
                Attendance.is_planned.is_(False),
                EventInstance.is_active.is_(True),
                EventInstance.start_date.is_not(None),
                User.home_region_id == config.org_id,
            )
            .group_by(Attendance.user_id)
            .subquery()
        )
        rows = (
            session.query(
                User.id,
                User.f3_name,
                first_attendance.c.first_attendance_date,
                func.min(SlackUser.slack_id).label("slack_id"),
                User.meta,
            )
            .outerjoin(first_attendance, first_attendance.c.user_id == User.id)
            .outerjoin(
                SlackUser,
                and_(SlackUser.user_id == User.id, SlackUser.slack_team_id == config.team_id),
            )
            .filter(User.home_region_id == config.org_id)
            .group_by(User.id, User.f3_name, first_attendance.c.first_attendance_date, User.meta)
            .all()
        )

    return select_f3versary_candidates(rows, target_date)


def build_f3versary_message(
    candidates: list[F3versaryCandidate],
    target_date: date,
    is_today: bool = False,
) -> tuple[str, list[dict]]:
    heading = ":tada: *F3versary Announcements:*"
    lines = [heading, *_format_f3versary_lines(candidates, target_date, is_today)]
    return _render_f3versary_message(lines)


def build_f3versary_messages(
    candidates: list[F3versaryCandidate],
    target_date: date,
    is_today: bool = False,
) -> list[tuple[str, list[dict]]]:
    """Build complete, numbered messages within Slack's text and block limits."""
    if not candidates:
        return []

    candidate_lines = _format_f3versary_lines(candidates, target_date, is_today)
    single_page = [":tada: *F3versary Announcements:*", *candidate_lines]
    if _message_fits(single_page):
        return [_render_f3versary_message(single_page)]

    number_width = len(str(len(candidate_lines)))
    conservative_heading = f":tada: *F3versary Announcements ({'9' * number_width}/{'9' * number_width}):*"
    page_lines: list[list[str]] = []
    current_page: list[str] = []
    for line in candidate_lines:
        if _message_fits([conservative_heading, *current_page, line]):
            current_page.append(line)
            continue
        if not current_page:
            raise ValueError("A single F3versary announcement line exceeds Slack's message limits")
        page_lines.append(current_page)
        current_page = [line]
        if not _message_fits([conservative_heading, line]):
            raise ValueError("A single F3versary announcement line exceeds Slack's message limits")
    if current_page:
        page_lines.append(current_page)

    messages = []
    for page_number, lines in enumerate(page_lines, start=1):
        heading = f":tada: *F3versary Announcements ({page_number}/{len(page_lines)}):*"
        page = [heading, *lines]
        if not _message_fits(page):
            raise ValueError("A F3versary announcement page exceeds Slack's message limits")
        messages.append(_render_f3versary_message(page))
    return messages


def _format_f3versary_lines(candidates: list[F3versaryCandidate], target_date: date, is_today: bool) -> list[str]:
    formatted_date = f"{target_date.strftime('%B')} {target_date.day}"
    anniversary_phrase = "TODAY" if is_today else f"on {formatted_date}"
    lines = []

    for candidate in candidates:
        fallback_name = escape((candidate.f3_name or "")[:MAX_F3_NAME_LENGTH], quote=False)
        display_name = f"<@{candidate.slack_id}>" if candidate.slack_id else fallback_name
        year_word = "year" if candidate.completed_years == 1 else "years"
        lines.append(
            f"*• {display_name} celebrates {candidate.completed_years} {year_word} "
            f"with F3 {anniversary_phrase} — "
            "be sure to celebrate by grabbing a Q slot!*"
        )

    return lines


def _message_fits(lines: list[str]) -> bool:
    if sum(len(line) for line in lines) + len(lines) - 1 > MAX_MESSAGE_TEXT_LENGTH:
        return False
    return len(_chunk_message_lines(lines)) <= MAX_MESSAGE_BLOCKS


def _render_f3versary_message(lines: list[str]) -> tuple[str, list[dict]]:
    text = "\n".join(lines)
    block_texts = _chunk_message_lines(lines)
    blocks = [{"type": "section", "text": {"type": "mrkdwn", "text": block_text}} for block_text in block_texts]
    return text, blocks


def _chunk_message_lines(lines: list[str]) -> list[str]:
    chunks: list[str] = []
    current = ""
    for line in lines:
        if len(line) > MAX_SECTION_TEXT_LENGTH:
            raise ValueError("A single F3versary announcement line exceeds Slack's section limit")
        candidate = f"{current}\n{line}" if current else line
        if len(candidate) <= MAX_SECTION_TEXT_LENGTH:
            current = candidate
        else:
            chunks.append(current)
            current = line
    if current:
        chunks.append(current)
    return chunks


def _message_id(slack_space_id: int, org_id: int, channel: str, processing_date: date, page_number: int) -> str:
    value = f"f3versary:{slack_space_id}:{org_id}:{processing_date.isoformat()}:{channel}:{page_number}"
    return str(uuid5(NAMESPACE_URL, value))


def _read_slack_space(slack_space_id: int) -> SlackSpace:
    with get_session() as session:
        return session.query(SlackSpace).filter(SlackSpace.id == slack_space_id).one()


def _read_region_setting(slack_space_id: int, org_id: int) -> F3versaryAnnouncementSetting | None:
    with get_session() as session:
        return (
            session.query(F3versaryAnnouncementSetting)
            .filter(
                F3versaryAnnouncementSetting.slack_space_id == slack_space_id,
                F3versaryAnnouncementSetting.org_id == org_id,
            )
            .first()
        )


def _run_for_date(slack_space_id: int, org_id: int, processing_date: date) -> F3versaryDeliveryRun | None:
    with get_session() as session:
        return (
            session.query(F3versaryDeliveryRun)
            .filter(
                F3versaryDeliveryRun.slack_space_id == slack_space_id,
                F3versaryDeliveryRun.org_id == org_id,
                F3versaryDeliveryRun.processing_date == processing_date,
            )
            .first()
        )


def _abandon_old_runs(slack_space_id: int, org_id: int, processing_date: date) -> None:
    """Leave unfinished older batches intact for audit, but never post their remaining pages."""
    with get_session() as session:
        runs = (
            session.query(F3versaryDeliveryRun)
            .filter(
                F3versaryDeliveryRun.slack_space_id == slack_space_id,
                F3versaryDeliveryRun.org_id == org_id,
                F3versaryDeliveryRun.processing_date < processing_date,
                F3versaryDeliveryRun.status == "planned",
            )
            .with_for_update()
            .all()
        )
        old_dates = [run.processing_date for run in runs]
        for run in runs:
            run.status = "abandoned"
        if runs:
            session.commit()
            for old_date in old_dates:
                logger.warning(
                    "Abandoned incomplete F3versary delivery (org_id=%s, processing_date=%s)",
                    org_id,
                    old_date,
                )


def _run_matches_config(run: F3versaryDeliveryRun, config: F3versaryConfig, processing_date: date) -> bool:
    return (
        run.processing_date == processing_date
        and run.org_id == config.org_id
        and run.channel == config.channel
        and run.lead_days == config.lead_days
        and run.target_date == processing_date + timedelta(days=config.lead_days)
    )


def _create_run(
    org: Org,
    slack_space_id: int,
    config: F3versaryConfig,
    processing_date: date,
    target_date: date,
    messages: list[tuple[str, list[dict]]],
) -> int | None:
    """Atomically save the immutable page plan after rechecking current admin settings."""
    with get_session() as session:
        regional_setting = (
            session.query(F3versaryAnnouncementSetting)
            .filter(
                F3versaryAnnouncementSetting.slack_space_id == slack_space_id,
                F3versaryAnnouncementSetting.org_id == org.id,
            )
            .with_for_update()
            .one_or_none()
        )
        if regional_setting is None:
            return None
        slack_space = session.query(SlackSpace).filter(SlackSpace.id == slack_space_id).one()
        current_config = _load_settings(org, slack_space, regional_setting)
        if not current_config.enabled or not _config_matches(config, current_config):
            return None
        if current_config.last_processed_date == processing_date:
            return None
        existing = (
            session.query(F3versaryDeliveryRun)
            .filter(
                F3versaryDeliveryRun.slack_space_id == slack_space_id,
                F3versaryDeliveryRun.org_id == org.id,
                F3versaryDeliveryRun.processing_date == processing_date,
            )
            .first()
        )
        if existing is not None:
            return existing.id
        run = F3versaryDeliveryRun(
            slack_space_id=slack_space_id,
            org_id=org.id,
            processing_date=processing_date,
            target_date=target_date,
            channel=config.channel,
            lead_days=config.lead_days,
            status="planned" if messages else "complete",
            page_count=len(messages),
        )
        session.add(run)
        session.flush()
        for page_number, (page_text, blocks) in enumerate(messages, start=1):
            if not _valid_saved_page({"text": page_text, "blocks": blocks}):
                raise ValueError("Invalid F3versary announcement page")
            session.add(
                F3versaryDeliveryPage(
                    run_id=run.id,
                    page_number=page_number,
                    text=page_text,
                    blocks=blocks,
                    client_msg_id=_message_id(slack_space_id, org.id, config.channel, processing_date, page_number),
                    status="pending",
                )
            )
        run_id = run.id
        session.commit()
        return run_id


def _config_matches(original: F3versaryConfig, current: F3versaryConfig) -> bool:
    return (
        current.enabled
        and original.org_id == current.org_id
        and original.team_id == current.team_id
        and original.channel == current.channel
        and original.lead_days == current.lead_days
        and original.bot_token == current.bot_token
    )


def _valid_saved_page(page: object) -> bool:
    if not isinstance(page, dict):
        return False
    page_text = page.get("text")
    blocks = page.get("blocks")
    if (
        not isinstance(page_text, str)
        or len(page_text) > MAX_MESSAGE_TEXT_LENGTH
        or not isinstance(blocks, list)
        or not 1 <= len(blocks) <= MAX_MESSAGE_BLOCKS
    ):
        return False
    block_texts = []
    for block in blocks:
        if not isinstance(block, dict) or block.get("type") != "section":
            return False
        text_value = block.get("text")
        if not isinstance(text_value, dict) or text_value.get("type") != "mrkdwn":
            return False
        block_text = text_value.get("text")
        if not isinstance(block_text, str) or not 1 <= len(block_text) <= MAX_SECTION_TEXT_LENGTH:
            return False
        block_texts.append(block_text)
    return "\n".join(block_texts) == page_text


def _claim_next_page(
    run_id: int,
    org: Org,
    config: F3versaryConfig,
    processing_date: date,
    check_real_clock: bool = False,
) -> ClaimedPage | None:
    """Claim only the first unsent page in a short transaction; never skip a busy page."""
    if check_real_clock and datetime.now(CENTRAL_TIMEZONE).date() != processing_date:
        return None
    with get_session() as session:
        run = session.query(F3versaryDeliveryRun).filter(F3versaryDeliveryRun.id == run_id).with_for_update().one()
        if run.status != "planned" or not _run_matches_config(run, config, processing_date):
            return None
        regional_setting = (
            session.query(F3versaryAnnouncementSetting)
            .filter(
                F3versaryAnnouncementSetting.slack_space_id == run.slack_space_id,
                F3versaryAnnouncementSetting.org_id == org.id,
            )
            .with_for_update()
            .one_or_none()
        )
        slack_space = session.query(SlackSpace).filter(SlackSpace.id == run.slack_space_id).one()
        current_config = _load_settings(org, slack_space, regional_setting)
        if not _config_matches(config, current_config):
            logger.warning("Pausing F3versary delivery for org_id=%s: settings changed", org.id)
            return None
        page = (
            session.query(F3versaryDeliveryPage)
            .filter(F3versaryDeliveryPage.run_id == run.id, F3versaryDeliveryPage.status != "sent")
            .order_by(F3versaryDeliveryPage.page_number)
            .first()
        )
        if page is None:
            run.status = "complete"
            session.commit()
            return None
        now = datetime.now(timezone.utc)
        if page.status == "claimed" and page.claim_expires_at and page.claim_expires_at > now:
            return None
        saved_page = {"text": page.text, "blocks": page.blocks}
        if not _valid_saved_page(saved_page):
            raise ValueError("Invalid saved F3versary announcement page")
        claim_token = str(uuid4())
        claimed = ClaimedPage(
            run_id=run.id,
            page_id=page.id,
            page_number=page.page_number,
            channel=run.channel,
            text=page.text,
            blocks=page.blocks,
            client_msg_id=page.client_msg_id,
            claim_token=claim_token,
        )
        page.status = "claimed"
        page.claim_token = claim_token
        page.claim_expires_at = now + CLAIM_LEASE
        session.commit()
        return claimed


def _record_sent_page(claim: ClaimedPage, slack_ts: str | None) -> None:
    """Commit one successful page without writing the administrator-owned settings JSON."""
    with get_session() as session:
        run_id = claim.run_id
        run = session.query(F3versaryDeliveryRun).filter(F3versaryDeliveryRun.id == run_id).with_for_update().one()
        page = session.query(F3versaryDeliveryPage).filter(F3versaryDeliveryPage.id == claim.page_id).one()
        if page.status != "claimed" or page.claim_token != claim.claim_token:
            raise RuntimeError("F3versary delivery claim was superseded")
        page.status = "sent"
        page.claim_token = None
        page.claim_expires_at = None
        page.sent_at = datetime.now(timezone.utc)
        page.slack_ts = slack_ts
        remaining = (
            session.query(F3versaryDeliveryPage.id)
            .filter(F3versaryDeliveryPage.run_id == run.id, F3versaryDeliveryPage.status != "sent")
            .first()
        )
        if remaining is None:
            run.status = "complete"
        session.commit()


def _deliver_pages(
    run_id: int,
    org: Org,
    config: F3versaryConfig,
    processing_date: date,
    check_real_clock: bool = False,
) -> None:
    """No DB connection or lock remains open during any Slack HTTP request."""
    client = WebClient(token=config.bot_token, timeout=SLACK_HTTP_TIMEOUT_SECONDS, retry_handlers=[])
    while True:
        claim = _claim_next_page(run_id, org, config, processing_date, check_real_clock)
        if claim is None:
            return
        if check_real_clock and datetime.now(CENTRAL_TIMEZONE).date() != processing_date:
            return
        response = client.chat_postMessage(
            channel=claim.channel,
            text=claim.text,
            blocks=claim.blocks,
            client_msg_id=claim.client_msg_id,
        )
        slack_ts = response.get("ts") if hasattr(response, "get") else None
        _record_sent_page(claim, slack_ts)
        sleep(MIN_POST_INTERVAL_SECONDS)


def send_f3versary_announcements(
    force: bool = False,
    dry_run: bool = False,
    run_org_id: int | None = None,
    now_cst: datetime | None = None,
) -> None:
    current_time = now_cst or datetime.now(CENTRAL_TIMEZONE)
    processing_date = current_time.date()

    if not force and current_time.hour < SEND_HOUR_CST:
        logger.info("Skipping F3versary Announcements before the daily send hour")
        return

    records = DbManager.find_join_records3(Org_x_SlackSpace, Org, SlackSpace, filters=[Org.is_active])
    for record in records:
        org = record[1]
        slack_space = record[2]
        if run_org_id is not None and org.id != run_org_id:
            continue

        try:
            current_slack_space = _read_slack_space(slack_space.id)
            regional_setting = _read_region_setting(slack_space.id, org.id)
            config = _load_settings(org, current_slack_space, regional_setting)
            if not dry_run:
                _abandon_old_runs(slack_space.id, org.id, processing_date)
            if not config.enabled:
                continue
            if not config.channel:
                logger.warning("Skipping F3versary Announcements for org_id=%s: no channel configured", org.id)
                continue
            if not dry_run:
                run = _run_for_date(slack_space.id, org.id, processing_date)
                if run is not None:
                    if run.status != "planned":
                        continue
                    if not _run_matches_config(run, config, processing_date):
                        logger.warning(
                            "Pausing F3versary delivery for org_id=%s: saved plan no longer matches today's settings",
                            org.id,
                        )
                        continue
                    if not config.bot_token:
                        logger.warning("Skipping F3versary Announcements for org_id=%s: no bot token available", org.id)
                        continue
                    _deliver_pages(run.id, org, config, processing_date, check_real_clock=now_cst is None)
                    continue
                if (current_slack_space.settings or {}).get(DELIVERY_PLAN_SETTING) is not None:
                    logger.warning(
                        "Pausing F3versary delivery for org_id=%s: legacy partial delivery needs maintainer review",
                        org.id,
                    )
                    continue
            if config.last_processed_date == processing_date:
                continue

            target_date = processing_date + timedelta(days=config.lead_days)
            candidates = get_f3versary_candidates(config, target_date)
            logger.info(
                "Processed F3versary candidates (org_id=%s, processing_date=%s, target_date=%s, count=%s)",
                org.id,
                processing_date,
                target_date,
                len(candidates),
            )
            messages = build_f3versary_messages(candidates, target_date, is_today=config.lead_days == 0)
            if dry_run:
                for page_number, (page_text, _) in enumerate(messages, start=1):
                    print(f"F3versary dry run for org {org.name} ({org.id}), page {page_number}\n{page_text}")
                continue
            if messages and not config.bot_token:
                logger.warning("Skipping F3versary Announcements for org_id=%s: no bot token available", org.id)
                continue
            run_id = _create_run(org, slack_space.id, config, processing_date, target_date, messages)
            if run_id is not None and messages:
                _deliver_pages(run_id, org, config, processing_date, check_real_clock=now_cst is None)
        except SlackApiError as error:
            logger.error(
                "Slack error posting F3versary Announcements (org_id=%s, error=%s)",
                org.id,
                error.response.get("error"),
            )
        except Exception as error:
            stack = " <- ".join(
                f"{os.path.basename(frame.filename)}:{frame.lineno}:{frame.name}"
                for frame in traceback.extract_tb(error.__traceback__)[-5:]
            )
            logger.error(
                "Error processing F3versary Announcements (org_id=%s, error_type=%s, stack=%s)",
                org.id,
                type(error).__name__,
                stack,
            )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Send regional F3versary announcements")
    parser.add_argument("--force", action="store_true", help="Run outside the normal daily time window")
    parser.add_argument("--dry-run", action="store_true", help="Print messages without posting or saving state")
    parser.add_argument("--org-id", type=int, default=None, help="Limit execution to one region organization ID")
    args = parser.parse_args()

    send_f3versary_announcements(force=args.force, dry_run=args.dry_run, run_org_id=args.org_id)
