"""Post configurable regional F3versary announcements from the hourly runner."""

from __future__ import annotations

import argparse
import logging
import os
import sys
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta

import pytz
from f3_data_models.models import Attendance, EventInstance, Org, Org_x_SlackSpace, SlackSpace, SlackUser, User
from f3_data_models.utils import DbManager, get_session
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError
from sqlalchemy import and_, func

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from utilities.database.orm import SlackSettings

logger = logging.getLogger(__name__)

CENTRAL_TIMEZONE = pytz.timezone("US/Central")
SEND_HOUR_CST = 17
DEFAULT_LEAD_DAYS = 14
MIN_LEAD_DAYS = 0
MAX_LEAD_DAYS = 30
LAST_PROCESSED_SETTING = "f3versary_announcements_last_processed_date"


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
    first_attendance_date: date
    anniversary_date: date
    completed_years: int


def _bounded_lead_days(value: object) -> int:
    try:
        lead_days = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return DEFAULT_LEAD_DAYS
    return lead_days if MIN_LEAD_DAYS <= lead_days <= MAX_LEAD_DAYS else DEFAULT_LEAD_DAYS


def _parse_date(value: object) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _load_settings(org: Org, slack_space: SlackSpace) -> tuple[SlackSettings, F3versaryConfig]:
    values = dict(slack_space.settings or {})
    values["team_id"] = values.get("team_id") or slack_space.team_id
    values["db_id"] = values.get("db_id") or slack_space.id
    values["workspace_name"] = values.get("workspace_name") or slack_space.workspace_name
    values["bot_token"] = values.get("bot_token") or slack_space.bot_token
    values["org_id"] = org.id
    settings = SlackSettings(**values)
    config = F3versaryConfig(
        enabled=bool(settings.f3versary_announcements_enabled),
        org_id=org.id,
        team_id=slack_space.team_id,
        bot_token=settings.bot_token,
        channel=settings.f3versary_announcements_channel,
        lead_days=_bounded_lead_days(settings.f3versary_announcements_lead_days),
        last_processed_date=_parse_date(settings.f3versary_announcements_last_processed_date),
    )
    return settings, config


def observed_anniversary(first_attendance_date: date, target_year: int) -> date:
    """Return the anniversary observed in target_year, treating Feb 28 as Feb 29 in non-leap years."""
    try:
        return first_attendance_date.replace(year=target_year)
    except ValueError:
        return date(target_year, 2, 28)


def select_f3versary_candidates(
    rows: Iterable[tuple[int, str | None, date, str | None]],
    target_date: date,
) -> list[F3versaryCandidate]:
    candidates: list[F3versaryCandidate] = []
    for user_id, f3_name, first_attendance_date, slack_id in rows:
        anniversary_date = observed_anniversary(first_attendance_date, target_date.year)
        completed_years = target_date.year - first_attendance_date.year
        if anniversary_date != target_date or completed_years < 1:
            continue
        if not slack_id and not (f3_name and f3_name.strip()):
            continue
        candidates.append(
            F3versaryCandidate(
                user_id=user_id,
                f3_name=f3_name.strip() if f3_name else None,
                slack_id=slack_id,
                first_attendance_date=first_attendance_date,
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
            .filter(
                Attendance.user_id.is_not(None),
                Attendance.is_planned.is_(False),
                EventInstance.start_date.is_not(None),
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
            )
            .join(first_attendance, first_attendance.c.user_id == User.id)
            .outerjoin(
                SlackUser,
                and_(SlackUser.user_id == User.id, SlackUser.slack_team_id == config.team_id),
            )
            .filter(User.home_region_id == config.org_id)
            .group_by(User.id, User.f3_name, first_attendance.c.first_attendance_date)
            .all()
        )

    return select_f3versary_candidates(rows, target_date)


def build_f3versary_message(
    candidates: list[F3versaryCandidate],
    target_date: date,
    is_today: bool = False,
) -> tuple[str, list[dict]]:
    formatted_date = f"{target_date.strftime('%B')} {target_date.day}"
    anniversary_phrase = "TODAY" if is_today else f"on {formatted_date}"
    lines = [":tada: *F3versary Announcements:*"]

    for candidate in candidates:
        display_name = f"<@{candidate.slack_id}>" if candidate.slack_id else candidate.f3_name
        year_word = "year" if candidate.completed_years == 1 else "years"
        lines.append(
            f"*• {display_name} celebrates {candidate.completed_years} {year_word} "
            f"with F3 {anniversary_phrase} — "
            "be sure to celebrate by grabbing a Q slot!*"
        )

    text = "\n".join(lines)
    blocks = [{"type": "section", "text": {"type": "mrkdwn", "text": text}}]
    return text, blocks


def _mark_processed(slack_space_id: int, processed_date: date) -> None:
    with get_session() as session:
        slack_space = session.query(SlackSpace).filter(SlackSpace.id == slack_space_id).one()
        settings = dict(slack_space.settings or {})
        settings[LAST_PROCESSED_SETTING] = processed_date.isoformat()
        slack_space.settings = settings
        session.commit()


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
            _, config = _load_settings(org, slack_space)
            if not config.enabled:
                continue
            if config.last_processed_date == processing_date:
                continue
            if not config.channel:
                logger.warning("Skipping F3versary Announcements for org_id=%s: no channel configured", org.id)
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

            if not candidates:
                if not dry_run:
                    _mark_processed(slack_space.id, processing_date)
                continue

            text, blocks = build_f3versary_message(
                candidates,
                target_date,
                is_today=config.lead_days == 0,
            )
            if dry_run:
                print(f"F3versary dry run for org {org.name} ({org.id})\n{text}")
                continue
            if not config.bot_token:
                logger.warning("Skipping F3versary Announcements for org_id=%s: no bot token available", org.id)
                continue

            client = WebClient(token=config.bot_token)
            client.chat_postMessage(channel=config.channel, text=text, blocks=blocks)
            _mark_processed(slack_space.id, processing_date)
        except SlackApiError as error:
            logger.error(
                "Slack error posting F3versary Announcements (org_id=%s, error=%s)",
                org.id,
                error.response.get("error"),
            )
        except Exception as error:
            logger.error(
                "Error processing F3versary Announcements (org_id=%s, error_type=%s)",
                org.id,
                type(error).__name__,
            )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Send regional F3versary announcements")
    parser.add_argument("--force", action="store_true", help="Run outside the normal daily time window")
    parser.add_argument("--dry-run", action="store_true", help="Print messages without posting or saving state")
    parser.add_argument("--org-id", type=int, default=None, help="Limit execution to one region organization ID")
    args = parser.parse_args()

    send_f3versary_announcements(force=args.force, dry_run=args.dry_run, run_org_id=args.org_id)
