"""Daily (idempotent) auto-award achievements script.

Usage (from repo root, with env + poetry activated):
  poetry run python scripts/award_achievements.py --dry-run

Core logic:
  1. Load active, auto_award achievements
  2. For each achievement + each relevant (award_year, award_period) within the current year
     (or lifetime), compute the metric defined by auto_threshold_type subject to auto_filters
  3. Identify users whose metric >= auto_threshold
  4. Respect region scoping (specific_org_id => user.home_region_id must match)
  5. Insert missing rows into achievements_x_users (award_year/period keyed) (unless --dry-run)

Idempotent: already-awarded combinations are skipped.

Assumptions / notes:
  - award_year == calendar year (UTC) for all non-lifetime cadences
  - weekly periods use ISO week numbers (1..53); monthly 1..12; quarterly 1..4; yearly single period 1
  - lifetime uses award_year = -1, award_period = -1 (per model defaults)
  - auto_filters structure: {"include": [{"event_type_id": [..]}, {"event_tag_id": [..]}],
                             "exclude": [...] }
       * We treat each dict in include as a dimension constraint (AND across dimensions, OR within values)
       * Exclude removes events matching ANY of its value lists.
    - Supported threshold types: 'posts' (attendance count),
                                                             'unique_aos' (distinct EventInstanceExpanded.ao_org_id),
                                                             'qs' (number of times user Q'd),
                                                             'posts_at_ao' (attendance at a specific AO or any AO)
  - Additional threshold types can be added by extending _build_metric_clause.

If filter keys are unrecognised, they are ignored (logged at DEBUG level).
"""

from __future__ import annotations

import os
import ssl
import sys

import pytz

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

import argparse
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Dict, Iterable, List, Sequence, Tuple

from f3_data_models.models import Achievement, Achievement_x_User, Org_x_SlackSpace, SlackSpace, SlackUser, User
from f3_data_models.utils import get_session
from slack_sdk.web import WebClient
from sqlalchemy import Integer, and_, distinct, func, literal, select, tuple_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from utilities import constants
from utilities.database.orm import SlackSettings
from utilities.database.orm.views import EventAttendance, EventInstanceExpanded

# ---------------------------------------------------------------------------
# Period calculations
# ---------------------------------------------------------------------------


def _daterange_year(year: int) -> Tuple[date, date]:
    return date(year, 1, 1), date(year, 12, 31)


def _week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())  # Monday


def _iso_week_range(year: int, iso_week: int) -> Tuple[date, date]:
    # ISO weeks: find first week containing Jan 4 (always week 1)
    jan4 = date(year, 1, 4)
    week1_start = _week_start(jan4)
    start = week1_start + timedelta(weeks=iso_week - 1)
    end = start + timedelta(days=6)
    return start, end


def _month_range(year: int, month: int) -> Tuple[date, date]:
    if month == 12:
        return date(year, 12, 1), date(year, 12, 31)
    start = date(year, month, 1)
    next_month = date(year + (month // 12), (month % 12) + 1, 1)
    return start, next_month - timedelta(days=1)


def _quarter_range(year: int, quarter: int) -> Tuple[date, date]:
    start_month = (quarter - 1) * 3 + 1
    start = date(year, start_month, 1)
    end_month = start_month + 2
    end = _month_range(year, end_month)[1]
    return start, end


def iter_periods(cadence: str, year: int, today: date) -> Iterable[Tuple[int, Tuple[date, date]]]:
    """Yield (period_number, (start, end)) for all periods in [start_of_year, today]."""
    if cadence == "weekly":
        current_week = today.isocalendar().week
        for w in range(1, current_week + 1):
            yield w, _iso_week_range(year, w)
    elif cadence == "monthly":
        for m in range(1, today.month + 1):
            yield m, _month_range(year, m)
    elif cadence == "quarterly":
        current_quarter = (today.month - 1) // 3 + 1
        for q in range(1, current_quarter + 1):
            yield q, _quarter_range(year, q)
    elif cadence == "yearly":
        # Single period = 1 spanning the year to date
        start, _ = _daterange_year(year)
        yield 1, (start, today)
    elif cadence == "lifetime":
        # Represent no bounded date range (None, None) sentinel
        yield -1, (date.min, date.max)
    else:
        raise ValueError(f"Unsupported cadence: {cadence}")


# ---------------------------------------------------------------------------
# Filter & metric helpers
# ---------------------------------------------------------------------------


SUPPORTED_THRESHOLD_TYPES = {"posts", "unique_aos", "qs", "posts_at_ao"}


def _apply_filters(base_filters: list, auto_filters: Dict[str, Any]) -> tuple[list, bool, bool, list, list]:
    """Return (filters, need_type_join, need_tag_join, exclude_type_ids, exclude_tag_ids)."""
    if not auto_filters:
        return base_filters, False, False, [], []
    includes = auto_filters.get("include") or []
    excludes = auto_filters.get("exclude") or []

    include_type_ids: set[int] = set()
    include_tag_ids: set[int] = set()
    exclude_type_ids: set[int] = set()
    exclude_tag_ids: set[int] = set()

    # Collect include constraints
    for inc in includes:
        if not isinstance(inc, dict):
            continue
        type_ids = inc.get("event_type_id") or []
        tag_ids = inc.get("event_tag_id") or []
        include_type_ids.update([tid for tid in type_ids if isinstance(tid, int)])
        include_tag_ids.update([tg for tg in tag_ids if isinstance(tg, int)])
        first_f_ind = inc.get("first_f_ind")
        if first_f_ind is not None:
            base_filters.append(EventInstanceExpanded.first_f_ind == first_f_ind)
            print(f"Applying include first_f_ind filter: {first_f_ind}")
        second_f_ind = inc.get("second_f_ind")
        if second_f_ind is not None:
            base_filters.append(EventInstanceExpanded.second_f_ind == second_f_ind)
        third_f_ind = inc.get("third_f_ind")
        if third_f_ind is not None:
            base_filters.append(EventInstanceExpanded.third_f_ind == third_f_ind)
        ao_org_id = inc.get("ao_org_id")
        if ao_org_id is not None:
            base_filters.append(EventInstanceExpanded.ao_org_id == ao_org_id)

    # Collect exclude constraints
    for exc in excludes:
        if not isinstance(exc, dict):
            continue
        type_ids = exc.get("event_type_id") or []
        tag_ids = exc.get("event_tag_id") or []
        exclude_type_ids.update([tid for tid in type_ids if isinstance(tid, int)])
        exclude_tag_ids.update([tg for tg in tag_ids if isinstance(tg, int)])
        first_f_ind = exc.get("first_f_ind")
        if first_f_ind is not None:
            base_filters.append(EventInstanceExpanded.first_f_ind != first_f_ind)
        second_f_ind = exc.get("second_f_ind")
        if second_f_ind is not None:
            base_filters.append(EventInstanceExpanded.second_f_ind != second_f_ind)
        third_f_ind = exc.get("third_f_ind")
        if third_f_ind is not None:
            base_filters.append(EventInstanceExpanded.third_f_ind != third_f_ind)
        ao_org_id = exc.get("ao_org_id")
        if ao_org_id is not None:
            base_filters.append(EventInstanceExpanded.ao_org_id != ao_org_id)

    # When using the flattened views, we no longer need separate joins
    # for type / tag link tables, so the booleans are always False.
    # For now, event_type_id / event_tag_id-based filters are not
    # supported directly against the view and are ignored (but the
    # first/second/third_f_ind filters above are applied normally).

    return base_filters, False, False, list(exclude_type_ids), list(exclude_tag_ids)


def _build_metric_columns(threshold_type: str):
    if threshold_type == "posts":
        return func.count(EventAttendance.id)
    if threshold_type == "unique_aos":
        return func.count(distinct(EventInstanceExpanded.ao_org_id))
    if threshold_type == "qs":
        # Number of times the user Q'd (q_ind is 1 for Q, 0/NULL otherwise)
        return func.coalesce(func.sum(EventAttendance.q_ind), 0)
    if threshold_type == "posts_at_ao":
        # Posts scoped by AO via auto_filters (ao_org_id); when no ao_org_id
        # filter is supplied, this becomes equivalent to total posts.
        return func.count(EventAttendance.id)
    raise ValueError(f"Unsupported auto_threshold_type: {threshold_type}")


def _compute_all_period_metrics(
    session: Session, achievement: Achievement, threshold_type: str, today: date
) -> list[tuple[int, int, int]]:
    """Return list of (user_id, award_year, award_period, metric).

    Single query per achievement to cover all elapsed periods in current year (or lifetime).
    """
    print(f"Computing metrics for achievement={achievement.id} ({threshold_type})...")
    metric_col = _build_metric_columns(threshold_type)
    cadence = str(achievement.auto_cadence.name).lower()

    # Lifetime: group to a fixed (-1, -1)
    if cadence == "lifetime":
        filters: list = []
        filters, need_type_join, need_tag_join, *_ = _apply_filters([], achievement.auto_filters or {})
        if achievement.specific_org_id:
            filters.append(EventAttendance.home_region_id == achievement.specific_org_id)
        query = select(
            EventAttendance.user_id.label("user_id"),
            func.cast(literal(-1), Integer).label("award_year"),
            func.cast(literal(-1), Integer).label("award_period"),
            metric_col.label("metric"),
        ).join(
            EventInstanceExpanded,
            EventInstanceExpanded.id == EventAttendance.event_instance_id,
        )
        query = query.filter(*filters).group_by("user_id")
        return [(r[0], r[1], r[2], int(r[3])) for r in session.execute(query).all()]

    # Non-lifetime: restrict to year start..today
    year = today.year
    start_year = date(year, 1, 1)
    filters: list = [and_(EventInstanceExpanded.start_date >= start_year, EventInstanceExpanded.start_date <= today)]
    filters, need_type_join, need_tag_join, *_ = _apply_filters(filters, achievement.auto_filters or {})
    if achievement.specific_org_id:
        filters.append(EventAttendance.home_region_id == achievement.specific_org_id)

    # Period expression
    if cadence == "weekly":
        period_expr = func.extract("week", EventInstanceExpanded.start_date)
    elif cadence == "monthly":
        period_expr = func.extract("month", EventInstanceExpanded.start_date)
    elif cadence == "quarterly":
        period_expr = (func.extract("month", EventInstanceExpanded.start_date) - 1) / 3 + 1
    elif cadence == "yearly":
        period_expr = 1
    else:
        raise ValueError(f"Unsupported cadence: {cadence}")

    query = select(
        EventAttendance.user_id.label("user_id"),
        func.cast(year, Integer).label("award_year"),
        func.cast(period_expr, Integer).label("award_period"),
        metric_col.label("metric"),
    ).join(
        EventInstanceExpanded,
        EventInstanceExpanded.id == EventAttendance.event_instance_id,
    )
    query = query.filter(*filters).group_by("user_id", "award_period")
    rows = session.execute(query).all()
    # Filter out future periods (e.g., if partial query produced future periods due to date overlap) - defensive
    valid_rows: list[tuple[int, int, int, int]] = []
    if cadence == "weekly":
        current_week = today.isocalendar().week
        for r in rows:
            if 1 <= r[2] <= current_week:
                valid_rows.append((r[0], r[1], r[2], int(r[3])))
    elif cadence == "monthly":
        for r in rows:
            if 1 <= r[2] <= today.month:
                valid_rows.append((r[0], r[1], r[2], int(r[3])))
    elif cadence == "quarterly":
        current_q = (today.month - 1) // 3 + 1
        for r in rows:
            if 1 <= r[2] <= current_q:
                valid_rows.append((r[0], r[1], r[2], int(r[3])))
    elif cadence == "yearly":
        for r in rows:
            if r[2] == 1:
                valid_rows.append((r[0], r[1], r[2], int(r[3])))
    return valid_rows


# ---------------------------------------------------------------------------
# Core awarding logic
# ---------------------------------------------------------------------------


@dataclass
class CandidateAward:
    achievement_id: int
    user_id: int
    award_year: int
    award_period: int
    metric: int


def _existing_awards(session: Session, achievement_id: int, year: int, period: int) -> set[int]:
    q = select(Achievement_x_User.user_id).filter(
        Achievement_x_User.achievement_id == achievement_id,
        Achievement_x_User.award_year == year,
        Achievement_x_User.award_period == period,
    )
    return {r[0] for r in session.execute(q).all()}


def process_achievement(session: Session, achievement: Achievement, today: date) -> List[CandidateAward]:
    if not achievement.auto_award or not achievement.is_active:
        return []
    if not achievement.auto_threshold or not achievement.auto_threshold_type:
        return []

    threshold_type = str(achievement.auto_threshold_type).lower()
    if threshold_type not in SUPPORTED_THRESHOLD_TYPES:
        return []

    all_rows = _compute_all_period_metrics(session, achievement, threshold_type, today)
    if not all_rows:
        return []

    # Collect unique (year, period)
    period_keys = {(r[1], r[2]) for r in all_rows}

    # Prefetch all existing awards for this achievement & these periods
    existing_map: dict[tuple[int, int], set[int]] = {k: set() for k in period_keys}
    period_list = list(period_keys)
    if period_list:
        existing_query = (
            select(
                Achievement_x_User.user_id,
                Achievement_x_User.award_year,
                Achievement_x_User.award_period,
            )
            .filter(Achievement_x_User.achievement_id == achievement.id)
            .filter(tuple_(Achievement_x_User.award_year, Achievement_x_User.award_period).in_(list(period_keys)))
        )
        # Note: Using period_keys directly inside IN since SQLAlchemy will expand tuple set properly.
        # If dialect issues arise, replace with list(year_period_tuples).
        for user_id, y, p in session.execute(existing_query).all():
            existing_map.setdefault((y, p), set()).add(user_id)

    awards: list[CandidateAward] = []
    for user_id, award_year, award_period, metric in all_rows:
        if metric >= achievement.auto_threshold and user_id not in existing_map.get((award_year, award_period), set()):
            awards.append(
                CandidateAward(
                    achievement_id=achievement.id,
                    user_id=user_id,
                    award_year=award_year,
                    award_period=award_period,
                    metric=metric,
                )
            )
    return awards


def award_candidates(session: Session, candidates: Sequence[CandidateAward], dry_run: bool) -> None:
    """Persist awards efficiently.

    Uses a single bulk INSERT .. ON CONFLICT DO NOTHING for Postgres to avoid per-row round trips.
    Falls back to no-op when dry-run.
    """
    if not candidates:
        return
    if dry_run:
        for c in candidates:
            print(
                "[DRY-RUN] Would award achievement="
                f"{c.achievement_id} user={c.user_id} year={c.award_year} "
                f"period={c.award_period} metric={c.metric}"
            )
        print(f"[DRY-RUN] Total new awards: {len(candidates)}")
        return

    now = datetime.now(UTC).date()
    rows = [
        {
            "achievement_id": c.achievement_id,
            "user_id": c.user_id,
            "award_year": c.award_year,
            "award_period": c.award_period,
            "date_awarded": now,
        }
        for c in candidates
    ]

    # Bulk insert with ON CONFLICT DO NOTHING (composite PK prevents duplicates in races)
    stmt = pg_insert(Achievement_x_User).values(rows)
    stmt = stmt.on_conflict_do_nothing(
        index_elements=[
            Achievement_x_User.achievement_id,
            Achievement_x_User.user_id,
            Achievement_x_User.award_year,
            Achievement_x_User.award_period,
        ]
    )
    result = session.execute(stmt)
    session.commit()

    inserted = result.rowcount if result.rowcount is not None else 0
    print(f"Inserted {inserted} new achievement awards (requested {len(rows)}).")
    if inserted < len(rows):
        print("Some awards already existed and were skipped.")


# ---------------------------------------------------------------------------
# Achievement posting logic
# ---------------------------------------------------------------------------


@dataclass
class AwardedUserInfo:
    """Container for user info needed to post achievements."""

    user_id: int
    slack_user_id: str
    user_name: str


@dataclass
class RegionAchievementGroup:
    """Groups achievement candidates by region for posting."""

    team_id: str
    slack_settings: SlackSettings
    bot_token: str
    # Map of achievement_id -> list of (AwardedUserInfo, CandidateAward)
    achievements: Dict[int, List[Tuple[AwardedUserInfo, CandidateAward]]]


def _get_ssl_context():
    """Create SSL context for Slack client."""
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    return ssl_context


def _build_achievement_message(achievement: Achievement, user_tag: str) -> str:
    """Build a message for a single achievement award."""
    msg = f"🏆 *{achievement.name}*"
    if achievement.description:
        msg += f"\n_{achievement.description}_"
    msg += f"\n\nEarned by {user_tag}!"
    if achievement.image_url:
        msg += f"\n{achievement.image_url}"
    return msg


def _build_achievement_blocks(achievement: Achievement, user_tag: str) -> List[Dict]:
    """Build Slack blocks for a single achievement award."""
    blocks = [
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"🏆 *{achievement.name}*\nEarned by {user_tag}!"},
        }
    ]
    if achievement.description:
        blocks.append({"type": "context", "elements": [{"type": "mrkdwn", "text": f"_{achievement.description}_"}]})
    if achievement.image_url:
        blocks.append({"type": "image", "image_url": achievement.image_url, "alt_text": achievement.name})
    return blocks


def _build_summary_message(achievement: Achievement, user_awards: List[Tuple[AwardedUserInfo, CandidateAward]]) -> str:
    """Build a summary line for an achievement with multiple earners."""
    user_mentions = []
    user_counts: Dict[str, int] = defaultdict(int)

    for user_info, _candidate in user_awards:
        user_counts[user_info.slack_user_id] += 1

    for slack_user_id, count in user_counts.items():
        mention = f"<@{slack_user_id}>"
        if count > 1:
            mention += f" (x{count})"
        user_mentions.append(mention)

    earners = ", ".join(user_mentions)
    desc = f": {achievement.description}" if achievement.description else ""
    return f"🏆 *{achievement.name}*{desc}\nEarned by {earners}"


def _build_dm_message(achievement: Achievement) -> str:
    """Build a DM message for an individual achievement notification."""
    msg = f"🎉 Congratulations! You've earned an achievement!\n\n🏆 *{achievement.name}*"
    if achievement.description:
        msg += f"\n_{achievement.description}_"
    if achievement.image_url:
        msg += f"\n{achievement.image_url}"
    return msg


def _build_dm_blocks(achievement: Achievement) -> List[Dict]:
    """Build Slack blocks for an achievement DM."""
    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"🎉 Congratulations! You've earned an achievement!\n\n🏆 *{achievement.name}*",
            },
        }
    ]
    if achievement.description:
        blocks.append({"type": "context", "elements": [{"type": "mrkdwn", "text": f"_{achievement.description}_"}]})
    if achievement.image_url:
        blocks.append({"type": "image", "image_url": achievement.image_url, "alt_text": achievement.name})
    return blocks


def post_achievements(session: Session, candidates: Sequence[CandidateAward], dry_run: bool) -> None:
    """Post achievement notifications based on each region's settings.

    Groups candidates by their home region's Slack space and posts according
    to the region's achievement_send_option setting:
    - post_individually: Post each achievement separately in achievement_channel
    - post_summary: Post a daily summary grouped by achievement in achievement_channel
    - send_in_dms_only: Send DM to each user for their achievements
    """
    if not candidates:
        return

    # Gather all unique user_ids and achievement_ids
    user_ids = list({c.user_id for c in candidates})
    achievement_ids = list({c.achievement_id for c in candidates})

    # Load users with their home regions
    users_query = select(User).filter(User.id.in_(user_ids))
    users_by_id: Dict[int, User] = {u.id: u for u in session.scalars(users_query).all()}

    # Load achievements
    achievements_query = select(Achievement).filter(Achievement.id.in_(achievement_ids))
    achievements_by_id: Dict[int, Achievement] = {a.id: a for a in session.scalars(achievements_query).all()}

    # Find unique home_region_ids (filter out None)
    home_region_ids = list({u.home_region_id for u in users_by_id.values() if u.home_region_id})
    if not home_region_ids:
        print("No users with home regions found. Skipping achievement posting.")
        return

    # Load SlackSpaces for home regions via Org_x_SlackSpace
    slack_space_query = (
        select(Org_x_SlackSpace.org_id, SlackSpace)
        .join(SlackSpace, SlackSpace.id == Org_x_SlackSpace.slack_space_id)
        .filter(Org_x_SlackSpace.org_id.in_(home_region_ids))
    )
    region_slack_spaces: Dict[int, SlackSpace] = {}
    for org_id, slack_space in session.execute(slack_space_query).all():
        region_slack_spaces[org_id] = slack_space

    if not region_slack_spaces:
        print("No Slack spaces found for user home regions. Skipping achievement posting.")
        return

    # Get all team_ids we need slack users for
    team_ids = list({ss.team_id for ss in region_slack_spaces.values()})

    # Load SlackUsers for all our users across all relevant teams
    slack_users_query = select(SlackUser).filter(SlackUser.user_id.in_(user_ids), SlackUser.slack_team_id.in_(team_ids))
    # Map: (user_id, team_id) -> SlackUser
    slack_users_map: Dict[Tuple[int, str], SlackUser] = {}
    for su in session.scalars(slack_users_query).all():
        slack_users_map[(su.user_id, su.slack_team_id)] = su

    # Group candidates by region (team_id)
    region_groups: Dict[str, RegionAchievementGroup] = {}

    for candidate in candidates:
        user = users_by_id.get(candidate.user_id)
        if not user or not user.home_region_id:
            continue

        slack_space = region_slack_spaces.get(user.home_region_id)
        if not slack_space:
            continue

        team_id = slack_space.team_id
        slack_user = slack_users_map.get((user.id, team_id))
        if not slack_user:
            continue

        # Initialize group if needed
        if team_id not in region_groups:
            settings = SlackSettings(**slack_space.settings) if slack_space.settings else SlackSettings(team_id=team_id)
            region_groups[team_id] = RegionAchievementGroup(
                team_id=team_id,
                slack_settings=settings,
                bot_token=slack_space.bot_token,
                achievements={},
            )

        group = region_groups[team_id]
        user_info = AwardedUserInfo(
            user_id=user.id,
            slack_user_id=slack_user.slack_id,
            user_name=slack_user.user_name or user.f3_name or "Unknown",
        )

        if candidate.achievement_id not in group.achievements:
            group.achievements[candidate.achievement_id] = []
        group.achievements[candidate.achievement_id].append((user_info, candidate))

    # Post for each region based on settings
    for team_id, group in region_groups.items():
        settings = group.slack_settings

        # Check if achievements are enabled
        if not settings.send_achievements:
            print(f"[{team_id}] Achievement posting disabled. Skipping.")
            continue

        send_option = settings.achievement_send_option or "post_summary"
        achievement_channel = settings.achievement_channel

        if not group.bot_token:
            print(f"[{team_id}] No bot token available. Skipping.")
            continue

        if dry_run:
            print(f"[DRY-RUN] [{team_id}] Would post achievements with option: {send_option}")
            for ach_id, user_awards in group.achievements.items():
                ach = achievements_by_id.get(ach_id)
                ach_name = ach.name if ach else f"Achievement #{ach_id}"
                users = [ui.user_name for ui, _ in user_awards]
                print(f"  - {ach_name}: {', '.join(users)}")
            continue

        ssl_context = _get_ssl_context()
        client = WebClient(group.bot_token, ssl=ssl_context)

        if send_option == "post_individually":
            _post_individually(client, achievement_channel, group, achievements_by_id, team_id)
        elif send_option == "post_summary":
            _post_summary(client, achievement_channel, group, achievements_by_id, team_id)
        elif send_option == "send_in_dms_only":
            _send_dms(client, group, achievements_by_id, team_id)
        else:
            print(f"[{team_id}] Unknown send_option: {send_option}. Defaulting to summary.")
            _post_summary(client, achievement_channel, group, achievements_by_id, team_id)


def _post_individually(
    client: WebClient,
    channel: str,
    group: RegionAchievementGroup,
    achievements_by_id: Dict[int, Achievement],
    team_id: str,
) -> None:
    """Post each achievement as an individual message."""
    if not channel:
        print(f"[{team_id}] No achievement channel configured. Skipping individual posts.")
        return

    for ach_id, user_awards in group.achievements.items():
        achievement = achievements_by_id.get(ach_id)
        if not achievement:
            continue

        for user_info, _candidate in user_awards:
            user_tag = f"<@{user_info.slack_user_id}>"
            msg = _build_achievement_message(achievement, user_tag)
            blocks = _build_achievement_blocks(achievement, user_tag)

            try:
                client.chat_postMessage(channel=channel, text=msg, blocks=blocks)
                print(f"[{team_id}] Posted achievement '{achievement.name}' for {user_info.user_name}")
            except Exception as e:
                print(f"[{team_id}] Error posting achievement: {e}")


def _post_summary(
    client: WebClient,
    channel: str,
    group: RegionAchievementGroup,
    achievements_by_id: Dict[int, Achievement],
    team_id: str,
) -> None:
    """Post a single summary of all achievements earned."""
    if not channel:
        print(f"[{team_id}] No achievement channel configured. Skipping summary post.")
        return

    # Build sections with their corresponding achievements for image support
    section_data: List[Tuple[Achievement, str]] = []
    for ach_id, user_awards in group.achievements.items():
        achievement = achievements_by_id.get(ach_id)
        if not achievement:
            continue

        section_text = _build_summary_message(achievement, user_awards)
        section_data.append((achievement, section_text))

    if not section_data:
        return

    today_str = datetime.now(UTC).strftime("%B %d, %Y")
    header = f"📊 *Achievement Summary for {today_str}*"
    full_msg = header + "\n\n" + "\n\n".join([text for _, text in section_data])

    blocks = [
        {"type": "header", "text": {"type": "plain_text", "text": f"📊 Achievement Summary for {today_str}"}},
        {"type": "divider"},
    ]
    for achievement, section_text in section_data:
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": section_text}})
        if achievement.image_url:
            blocks.append({"type": "image", "image_url": achievement.image_url, "alt_text": achievement.name})

    try:
        client.chat_postMessage(channel=channel, text=full_msg, blocks=blocks)
        print(f"[{team_id}] Posted achievement summary with {len(section_data)} achievement types")
    except Exception as e:
        print(f"[{team_id}] Error posting achievement summary: {e}")


def _send_dms(
    client: WebClient,
    group: RegionAchievementGroup,
    achievements_by_id: Dict[int, Achievement],
    team_id: str,
) -> None:
    """Send DMs to each user for their achievements."""
    # Group by user to batch their achievements
    user_achievements: Dict[str, List[Tuple[Achievement, CandidateAward]]] = defaultdict(list)

    for ach_id, user_awards in group.achievements.items():
        achievement = achievements_by_id.get(ach_id)
        if not achievement:
            continue

        for user_info, _candidate in user_awards:
            user_achievements[user_info.slack_user_id].append((achievement, _candidate))

    for slack_user_id, achievements in user_achievements.items():
        for achievement, _candidate in achievements:
            msg = _build_dm_message(achievement)
            blocks = _build_dm_blocks(achievement)

            try:
                client.chat_postMessage(channel=slack_user_id, text=msg, blocks=blocks)
                print(f"[{team_id}] Sent DM for achievement '{achievement.name}' to {slack_user_id}")
            except Exception as e:
                print(f"[{team_id}] Error sending DM to {slack_user_id}: {e}")


def main():  # pragma: no cover - CLI
    parser = argparse.ArgumentParser(description="Auto-award achievements")
    parser.add_argument("--achievement-id", type=int, help="Process only a single achievement id", default=None)
    parser.add_argument("--dry-run", action="store_true", help="Do not persist, only log actions")
    parser.add_argument("--skip-post", action="store_true", help="Skip posting achievements to Slack")
    parser.add_argument(
        "--today", type=str, help="Override today's date (YYYY-MM-DD, UTC) for backfilling / testing", default=None
    )
    args = parser.parse_args()
    print(f"Auto-award achievements started at {datetime.now(UTC).isoformat()}")
    print(f"Arguments: achievement_id={args.achievement_id}, dry_run={args.dry_run}, today={args.today}")

    today = datetime.strptime(args.today, "%Y-%m-%d").date() if args.today else datetime.now(UTC).date()
    current_hour = datetime.now(pytz.timezone("US/Central")).hour

    if current_hour != constants.ACHIEVEMENT_AWARD_HOUR_CST:
        return

    with get_session() as session:
        ach_query = select(Achievement).filter(Achievement.auto_award.is_(True), Achievement.is_active.is_(True))
        if args.achievement_id:
            ach_query = ach_query.filter(Achievement.id == args.achievement_id)
        achievements = session.scalars(ach_query).all()
        print(f"Processing {len(achievements)} achievements...")
        total_candidates = 0
        all_candidates = []
        for ach in achievements:
            cands = process_achievement(session, ach, today)
            award_candidates(session, cands, args.dry_run)
            total_candidates += len(cands)
            all_candidates.extend(cands)

        # Post achievement notifications
        if all_candidates and not args.skip_post:
            print(f"\nPosting {len(all_candidates)} achievement notifications...")
            post_achievements(session, all_candidates, args.dry_run)

        # save a csv of candidates for record-keeping
        if all_candidates and args.dry_run:
            with open(f"achievement_candidates_{today}.csv", "w") as f:
                f.write("achievement_id,user_id,award_year,award_period,metric\n")
                for c in all_candidates:
                    f.write(f"{c.achievement_id},{c.user_id},{c.award_year},{c.award_period},{c.metric}\n")
        print(f"Done. Candidates processed: {total_candidates}")


if __name__ == "__main__":  # pragma: no cover
    main()
