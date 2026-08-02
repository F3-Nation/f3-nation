import os
import re
import ssl
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional

import pytz
from f3_data_models.models import Attendance, Attendance_x_AttendanceType, SlackSpace, User
from f3_data_models.utils import DbManager, get_session
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError
from sqlalchemy import Date, Integer, case, cast, func, literal, select

from utilities.database.orm import SlackSettings
from utilities.database.orm.views import EventInstanceExpanded
from utilities.helper_functions import safe_get

# Attendance type ids (see f3_data_models.models.AttendanceType): 1='PAX', 2='Q', 3='Co-Q'
Q_ATTENDANCE_TYPE_ID = 2

# "Flags" (Ghost Flag, Pirate Flag, HIM Belt, ...): configurable, multiple, region-defined
# named items with two ways to track the current holder:
# - "location": an AO. Preferred detection: a region-defined Custom Field (see
#   features/custom_fields.py — use the "Location" field type for a real channel picker)
#   that the Q fills in on the backblast. Falls back to hashtag detection (scanning
#   preblast/backblast text) if no Custom Field is configured for the flag.
# - "pax": a person. Always read from a region-defined Custom Field (use the "PAX" field
#   type for a real person picker) — no hashtag fallback.
# Both field-based methods reuse the existing backblast Custom Field mechanism instead of
# adding dedicated flag-assignment UI; the value on an event's most recent match wins.
# Stored in SlackSettings.weekly_report_flags as
# {flag_key: {"name": str, "hashtag": str, "custom_field_name": str, "holder_type": ..., "enabled": bool}}.
FLAG_HOLDER_LOCATION = "location"
FLAG_HOLDER_PAX = "pax"
FLAG_HOLDER_TYPE_OPTIONS = {
    FLAG_HOLDER_LOCATION: "A Location (AO)",
    FLAG_HOLDER_PAX: "PAX",
}
FLAG_LOOKBACK_DAYS = 90
FLAG_HOLDER_FALLBACK = "not currently held"

# Section keys — these are stored in SlackSettings.weekly_report_sections
WEEKLY_SECTION_SUMMARY = "summary"
WEEKLY_SECTION_FNGS = "fngs"
WEEKLY_SECTION_TOP_AO_POSTS = "top_ao_posts"
WEEKLY_SECTION_TOP_POSTERS = "top_posters"
WEEKLY_SECTION_TOP_QS = "top_qs"
WEEKLY_SECTION_FLAGS = "flags"

WEEKLY_REPORT_SECTION_OPTIONS = {
    WEEKLY_SECTION_SUMMARY: "Summary numbers (events, AOs, Qs, FNGs, average / unique PAX)",
    WEEKLY_SECTION_FNGS: "FNGs by AO",
    WEEKLY_SECTION_TOP_AO_POSTS: "Highest attended workout at each AO",
    WEEKLY_SECTION_TOP_POSTERS: "Top posters",
    WEEKLY_SECTION_TOP_QS: "Top Qs",
    WEEKLY_SECTION_FLAGS: "Trophies (Ghost Flag, HIM Belt, etc. — configured below)",
}
DEFAULT_WEEKLY_SECTIONS = list(WEEKLY_REPORT_SECTION_OPTIONS.keys())

# Individual summary numbers — stored in SlackSettings.weekly_report_summary_metrics.
# Each maps to one fixed-format line in WEEKLY_SUMMARY_METRIC_LINES, rendered in this order.
SUMMARY_METRIC_TOTAL_EVENTS = "total_events"
SUMMARY_METRIC_AO_COUNT = "ao_count"
SUMMARY_METRIC_UNIQUE_QS = "unique_qs"
SUMMARY_METRIC_FNG_COUNT = "fng_count"
SUMMARY_METRIC_AVG_PAX = "avg_pax"
SUMMARY_METRIC_UNIQUE_PAX = "unique_pax"

WEEKLY_SUMMARY_METRIC_OPTIONS = {
    SUMMARY_METRIC_TOTAL_EVENTS: "Total Events",
    SUMMARY_METRIC_AO_COUNT: "AO Count",
    SUMMARY_METRIC_UNIQUE_QS: "Unique Qs",
    SUMMARY_METRIC_FNG_COUNT: "FNGs",
    SUMMARY_METRIC_AVG_PAX: "Average PAX (with all-time record)",
    SUMMARY_METRIC_UNIQUE_PAX: "Unique PAX participating (with all-time record)",
}
DEFAULT_WEEKLY_SUMMARY_METRICS = list(WEEKLY_SUMMARY_METRIC_OPTIONS.keys())

WEEKLY_SUMMARY_METRIC_LINES = {
    SUMMARY_METRIC_TOTAL_EVENTS: "• Total Events: {total_events} Workouts",
    SUMMARY_METRIC_AO_COUNT: "• AO Count: {ao_count} AOs",
    SUMMARY_METRIC_UNIQUE_QS: "• Unique Qs: {unique_qs} Qs",
    SUMMARY_METRIC_FNG_COUNT: "• FNGs: {fng_count} FNGs :fire:",
    SUMMARY_METRIC_AVG_PAX: "• Average PAX: {avg_pax} PAX (current record: {avg_pax_record})",
    SUMMARY_METRIC_UNIQUE_PAX: "• Unique PAX: {unique_pax} PAX (current record: {unique_pax_record})",
}

DEFAULT_WEEKLY_DAY = 0  # Monday
DEFAULT_WEEKLY_HOUR = 8

# Regions can be anywhere in the US (or beyond) — weekly_report_day/_hour are interpreted in
# whichever of these the region picks (SlackSettings.weekly_report_timezone), not a fixed
# server timezone. Defaults to Central to match this report's original fixed-CST behavior.
DEFAULT_WEEKLY_TIMEZONE = "America/Chicago"
WEEKLY_REPORT_TIMEZONE_OPTIONS = {
    "America/New_York": "Eastern",
    "America/Chicago": "Central",
    "America/Denver": "Mountain",
    "America/Phoenix": "Arizona (no DST)",
    "America/Los_Angeles": "Pacific",
    "America/Anchorage": "Alaska",
    "Pacific/Honolulu": "Hawaii",
}

# "weekly" sends every week on weekly_report_day; "biweekly" sends every other week,
# in sync across all regions (see is_biweekly_send_week)
FREQUENCY_WEEKLY = "weekly"
FREQUENCY_BIWEEKLY = "biweekly"
WEEKLY_REPORT_FREQUENCY_OPTIONS = {
    FREQUENCY_WEEKLY: "Every Week",
    FREQUENCY_BIWEEKLY: "Every Other Week",
}
DEFAULT_WEEKLY_FREQUENCY = FREQUENCY_WEEKLY
# Reference Monday used to compute biweekly parity; arbitrary but fixed so all
# regions on "every other week" send on the same calendar weeks.
BIWEEKLY_EPOCH_MONDAY = date(2024, 1, 1)

# The header/intro is the only free-text part of the summary section; the numbers
# below it are individually toggleable fixed-format lines (WEEKLY_SUMMARY_METRIC_LINES)
DEFAULT_WEEKLY_INTRO_TEMPLATE = "Here goes the numbers from last week :point_down:"

WEEKLY_REPORT_TITLE = "*Weekly Region Report*"

# Bold section headers (Slack mrkdwn *text*) plus standard Unicode emoji only — no
# workspace-specific custom emoji (like Slack's own :slack: logo glyph), since not every
# region's workspace is guaranteed to have every custom emoji available.
FNGS_SECTION_HEADER = "*New Guys — welcome them to Slack!*"
TOP_AO_POSTS_SECTION_HEADER = "*Highest Attended Workout by AO* :muscle:"
TOP_POSTERS_SECTION_HEADER = "*Top Posters* :fire:"
TOP_QS_SECTION_HEADER = "*Top Qs* :muscle:"
FLAGS_SECTION_HEADER = "*Trophies* :triangular_flag_on_post:"


@dataclass
class WeeklyEvent:
    event_id: int
    name: str
    start_date: date
    ao_org_id: Optional[int]
    ao_name: Optional[str]
    ao_channel_id: Optional[str]
    pax_count: Optional[int]
    fng_count: Optional[int]
    backblast: Optional[str]


@dataclass
class WeeklyAttendanceRecord:
    event_id: int
    user_id: int
    f3_name: Optional[str]
    q_ind: int


@dataclass
class FlagCandidate:
    start_date: date
    ao_name: Optional[str]
    ao_channel_id: Optional[str]
    preblast: Optional[str]
    backblast: Optional[str]
    meta: Optional[dict]  # event custom-field values, used when a flag's holder_type is "pax"


@dataclass
class WeeklyRegionStats:
    total_events: int = 0
    ao_count: int = 0
    unique_qs: int = 0
    fng_count: int = 0
    avg_pax: float = 0.0
    unique_pax: int = 0
    avg_pax_record: float = 0.0  # best 7-day-window average PAX in region history
    unique_pax_record: int = 0  # best 7-day-window unique PAX in region history
    flags: List[tuple] = None  # (flag_name, holder_or_fallback)
    fngs_by_ao: List[tuple] = None  # (count, ao_label, names_csv)
    top_ao_events: List[tuple] = None  # (attendance, ao_label, q_name, title)
    top_posters: List[tuple] = None  # (post_count, f3_name)
    top_qs: List[tuple] = None  # (q_count, f3_name)


class _SafeFormatDict(dict):
    """Leaves unknown placeholders in place instead of raising KeyError."""

    def __missing__(self, key):
        return "{" + key + "}"


def is_biweekly_send_week(current_date: date) -> bool:
    """True on send-eligible weeks for 'every other week' regions, synced across all regions."""
    weeks_since_epoch = (current_date - BIWEEKLY_EPOCH_MONDAY).days // 7
    return weeks_since_epoch % 2 == 0


def report_window_days(frequency: Optional[str]) -> int:
    """Number of days the report covers: 7 for weekly, 14 for biweekly."""
    return 14 if frequency == FREQUENCY_BIWEEKLY else 7


def ao_label(ao_name: Optional[str], ao_channel_id: Optional[str]) -> str:
    """Renders an AO as a real Slack channel mention when we know its channel, otherwise a #-slug of its name."""
    if ao_channel_id:
        return f"<#{ao_channel_id}>"
    if not ao_name:
        return "#unknown"
    return "#" + re.sub(r"[^a-z0-9]+", "-", ao_name.lower()).strip("-")


def build_flag_pattern(hashtag: str) -> re.Pattern:
    """Builds a regex matching hashtag variations of a flag's name/hashtag words.

    E.g. hashtag="ghost flag" matches #ghostflag, #ghost-flag, #nwpghostflag, #f3ghostflag, etc.
    """
    words = [re.escape(w) for w in re.split(r"[\s_-]+", (hashtag or "").strip().lower()) if w]
    if not words:
        return re.compile(r"(?!)")  # never matches
    core = r"[\s_-]?".join(words)
    return re.compile(rf"#[a-z0-9_-]*{core}[a-z0-9_-]*", re.IGNORECASE)


def resolve_location_holder(candidates: List[FlagCandidate], pattern: re.Pattern) -> Optional[str]:
    """Returns the AO of the most recent event whose preblast/backblast matches the flag's
    hashtag pattern, or None."""
    for c in sorted(candidates, key=lambda c: c.start_date, reverse=True):
        text = "\n".join(t for t in (c.preblast, c.backblast) if t)
        if text and pattern.search(text):
            return ao_label(c.ao_name, c.ao_channel_id)
    return None


def resolve_custom_field_holder(
    candidates: List[FlagCandidate], custom_field_name: str, holder_type: str
) -> Optional[str]:
    """Returns the value of a region-defined Custom Field (filled in by the Q on the
    backblast) from the most recent event that has one set, or None. Reuses the existing
    backblast Custom Field mechanism rather than a dedicated flag-assignment UI.

    The "PAX" and "Location" field types store a ready-to-render Slack mention (<@U0123456>
    or <#C0123456>, auto-resolved to a name/channel by Slack when displayed); other field
    types (Dropdown/Text) store a plain typed value, which gets formatted to match — "@name"
    for PAX-held flags, "#slug" for location-held flags."""
    if not custom_field_name:
        return None
    for c in sorted(candidates, key=lambda c: c.start_date, reverse=True):
        value = safe_get(c.meta, custom_field_name)
        if value:
            value = str(value)
            if value.startswith("<") or value.startswith("@") or value.startswith("#"):
                return value
            if holder_type == FLAG_HOLDER_LOCATION:
                return "#" + re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
            return f"@{value}"
    return None


def resolve_org_flags(flags_config: Optional[dict], candidates: List[FlagCandidate]) -> List[tuple]:
    """Resolves every enabled flag in a region's config to its (name, current holder) pair,
    in configured order. A configured Custom Field always wins over hashtag detection for
    location-held flags; PAX-held flags require a Custom Field (no hashtag fallback)."""
    if not flags_config:
        return []
    resolved = []
    for flag in flags_config.values():
        if not flag.get("enabled", True):
            continue
        holder_type = flag.get("holder_type") or FLAG_HOLDER_LOCATION
        custom_field_name = flag.get("custom_field_name") or ""
        if custom_field_name:
            holder = resolve_custom_field_holder(candidates, custom_field_name, holder_type)
        elif holder_type == FLAG_HOLDER_LOCATION:
            pattern = build_flag_pattern(flag.get("hashtag") or flag.get("name") or "")
            holder = resolve_location_holder(candidates, pattern)
        else:
            holder = None
        resolved.append((flag.get("name", "Trophy"), holder or FLAG_HOLDER_FALLBACK))
    return resolved


def extract_fng_names(backblast: Optional[str]) -> List[str]:
    if not backblast:
        return []
    match = re.search(r"FNGs?:\s*\d*[\s:,-]*([^\n]*)", backblast, re.IGNORECASE)
    if not match:
        return []
    names = [n.strip() for n in match.group(1).split(",")]
    return [n for n in names if n and n.lower() not in {"none", "0", "n/a", "na"}]


def compute_weekly_stats(events: List[WeeklyEvent], attendance: List[WeeklyAttendanceRecord]) -> WeeklyRegionStats:
    stats = WeeklyRegionStats(fngs_by_ao=[], top_ao_events=[], top_posters=[], top_qs=[])
    if not events:
        return stats

    # Dedupe attendance per (event, user)
    seen = set()
    attendance_unique: List[WeeklyAttendanceRecord] = []
    for a in attendance:
        key = (a.event_id, a.user_id)
        if key not in seen:
            seen.add(key)
            attendance_unique.append(a)
        elif a.q_ind:
            # keep the Q indicator if any of the user's rows for the event carried it
            for existing in attendance_unique:
                if (existing.event_id, existing.user_id) == key:
                    existing.q_ind = 1
                    break

    tagged_by_event: Dict[int, int] = defaultdict(int)
    for a in attendance_unique:
        tagged_by_event[a.event_id] += 1

    def event_attendance(event: WeeklyEvent) -> int:
        # Prefer the backblast COUNT (pax_count); fall back to tagged attendance
        return event.pax_count if event.pax_count else tagged_by_event.get(event.event_id, 0)

    ao_keys = {e.ao_org_id or e.ao_name for e in events}
    stats.total_events = len(events)
    stats.ao_count = len(ao_keys)
    stats.unique_qs = len({a.user_id for a in attendance_unique if a.q_ind})
    stats.fng_count = sum(e.fng_count or 0 for e in events)
    stats.unique_pax = len({a.user_id for a in attendance_unique})
    # Average PAX mirrors pax-vault's AVG(pax_count): average the recorded pax_count
    # over events that have one; fall back to tagged attendance only if none do
    recorded_counts = [e.pax_count for e in events if e.pax_count is not None]
    if recorded_counts:
        stats.avg_pax = round(sum(recorded_counts) / len(recorded_counts), 2)
    else:
        stats.avg_pax = round(sum(event_attendance(e) for e in events) / len(events), 2)

    # FNGs by AO
    fng_counts: Dict[str, int] = defaultdict(int)
    fng_names: Dict[str, List[str]] = defaultdict(list)
    for e in events:
        names = extract_fng_names(e.backblast)
        count = e.fng_count if e.fng_count else len(names)
        if count > 0 or names:
            label = ao_label(e.ao_name, e.ao_channel_id)
            fng_counts[label] += max(count, len(names))
            for name in names:
                if name not in fng_names[label]:
                    fng_names[label].append(name)
    stats.fngs_by_ao = sorted(
        [(count, label, ", ".join(f"@{n}" for n in sorted(fng_names[label]))) for label, count in fng_counts.items()],
        key=lambda row: (-row[0], row[1]),
    )

    # Highest attended workout at each AO
    events_by_ao: Dict[str, List[WeeklyEvent]] = defaultdict(list)
    for e in events:
        events_by_ao[e.ao_org_id or e.ao_name].append(e)
    q_by_event: Dict[int, str] = {}
    for a in attendance_unique:
        if a.q_ind and a.f3_name and a.event_id not in q_by_event:
            q_by_event[a.event_id] = a.f3_name
    top_rows = []
    for ao_events in events_by_ao.values():
        top = max(ao_events, key=event_attendance)
        q_name = f"@{q_by_event[top.event_id]}" if top.event_id in q_by_event else ""
        title = f"{top.name} ({top.start_date.strftime('%a %m/%d/%y')})"
        top_rows.append((event_attendance(top), ao_label(top.ao_name, top.ao_channel_id), q_name, title))
    stats.top_ao_events = sorted(top_rows, key=lambda row: (-row[0], row[1]))

    # Top posters (dense rank <= 3 by post count)
    post_counts: Dict[str, int] = defaultdict(int)
    for a in attendance_unique:
        if a.f3_name:
            post_counts[a.f3_name] += 1
    distinct_counts = sorted(set(post_counts.values()), reverse=True)[:3]
    stats.top_posters = sorted(
        [(count, name) for name, count in post_counts.items() if count in distinct_counts],
        key=lambda row: (-row[0], row[1].lower()),
    )

    # Top Qs
    q_counts: Dict[str, int] = defaultdict(int)
    for a in attendance_unique:
        if a.q_ind and a.f3_name:
            q_counts[a.f3_name] += 1
    stats.top_qs = sorted(
        [(count, name) for name, count in q_counts.items()],
        key=lambda row: (-row[0], row[1].lower()),
    )[:10]

    return stats


def build_weekly_report_text(region_record: SlackSettings, stats: WeeklyRegionStats) -> str:
    sections = region_record.weekly_report_sections or DEFAULT_WEEKLY_SECTIONS
    parts: List[str] = [WEEKLY_REPORT_TITLE]

    if WEEKLY_SECTION_SUMMARY in sections:
        header = region_record.weekly_report_intro_template or DEFAULT_WEEKLY_INTRO_TEMPLATE
        values = _SafeFormatDict(
            total_events=stats.total_events,
            ao_count=stats.ao_count,
            unique_qs=stats.unique_qs,
            fng_count=stats.fng_count,
            avg_pax=stats.avg_pax,
            unique_pax=stats.unique_pax,
            avg_pax_record=stats.avg_pax_record,
            unique_pax_record=stats.unique_pax_record,
        )
        try:
            summary_lines = [header.format_map(values)] if header else []
        except (ValueError, IndexError):
            # a malformed user header (e.g. stray braces) should not kill the report
            summary_lines = [DEFAULT_WEEKLY_INTRO_TEMPLATE]

        metrics = region_record.weekly_report_summary_metrics
        if metrics is None:
            metrics = DEFAULT_WEEKLY_SUMMARY_METRICS
        for metric in DEFAULT_WEEKLY_SUMMARY_METRICS:
            if metric in metrics:
                summary_lines.append(WEEKLY_SUMMARY_METRIC_LINES[metric].format_map(values))
        if summary_lines:
            parts.append("\n".join(summary_lines))

    # Row lines below use "• " bullets rather than padded multi-space columns — Slack's
    # mrkdwn renderer collapses consecutive spaces outside of code blocks, so a manually
    # spaced-out "column" layout doesn't actually stay aligned once posted.
    #
    # Each section's header text is admin-overridable (see reporting.py's Reporting
    # Settings form) — a blank/unset override falls back to the built-in default here.
    if WEEKLY_SECTION_FNGS in sections and stats.fngs_by_ao:
        lines = [region_record.weekly_report_fngs_header or FNGS_SECTION_HEADER, ""]
        for count, label, names in stats.fngs_by_ao:
            lines.append(f"• {label} — {names}" if names else f"• {label} — {count}")
        parts.append("\n".join(lines))

    if WEEKLY_SECTION_TOP_AO_POSTS in sections and stats.top_ao_events:
        lines = [region_record.weekly_report_top_ao_posts_header or TOP_AO_POSTS_SECTION_HEADER, ""]
        for attendance, label, q_name, title in stats.top_ao_events:
            q_part = f", Q: {q_name}" if q_name else ""
            lines.append(f"• {label} — {attendance} PAX{q_part} — {title}")
        parts.append("\n".join(lines))

    if WEEKLY_SECTION_TOP_POSTERS in sections and stats.top_posters:
        lines = [region_record.weekly_report_top_posters_header or TOP_POSTERS_SECTION_HEADER, ""]
        lines += [f"• @{name} — {count}" for count, name in stats.top_posters]
        parts.append("\n".join(lines))

    if WEEKLY_SECTION_TOP_QS in sections and stats.top_qs:
        lines = [region_record.weekly_report_top_qs_header or TOP_QS_SECTION_HEADER, ""]
        lines += [f"• @{name} — {count}" for count, name in stats.top_qs]
        parts.append("\n".join(lines))

    if WEEKLY_SECTION_FLAGS in sections and stats.flags:
        lines = [region_record.weekly_report_flags_header or FLAGS_SECTION_HEADER, ""]
        lines += [f"• {name} — {holder}" for name, holder in stats.flags]
        parts.append("\n".join(lines))

    return "\n\n".join(parts)


def pull_weekly_data(
    org_ids: List[int], window_start: date, window_end: date
) -> Dict[int, tuple[List[WeeklyEvent], List[WeeklyAttendanceRecord]]]:
    """Pulls first-F events + attendance for the window, grouped by region org id."""
    if not org_ids:
        return {}
    session = get_session()
    try:
        event_rows = session.execute(
            select(
                EventInstanceExpanded.id,
                EventInstanceExpanded.name,
                EventInstanceExpanded.start_date,
                EventInstanceExpanded.ao_org_id,
                EventInstanceExpanded.ao_name,
                EventInstanceExpanded.ao_meta,
                EventInstanceExpanded.pax_count,
                EventInstanceExpanded.fng_count,
                EventInstanceExpanded.backblast,
                EventInstanceExpanded.region_org_id,
            ).where(
                EventInstanceExpanded.region_org_id.in_(org_ids),
                EventInstanceExpanded.start_date >= window_start,
                EventInstanceExpanded.start_date <= window_end,
                EventInstanceExpanded.first_f_ind == 1,
            )
        ).all()

        region_by_event: Dict[int, int] = {row.id: row.region_org_id for row in event_rows}
        attendance_rows = []
        if region_by_event:
            # Actual attendance only (is_planned=False) — mirrors pax-vault, which strips
            # "fartsack" rows (signed up but no-showed) from all counts
            q_case = case((Attendance_x_AttendanceType.attendance_type_id == Q_ATTENDANCE_TYPE_ID, 1), else_=0)
            attendance_rows = session.execute(
                select(
                    Attendance.event_instance_id,
                    Attendance.user_id,
                    User.f3_name,
                    func.max(q_case).label("q_ind"),
                )
                .join(User, User.id == Attendance.user_id)
                .outerjoin(Attendance_x_AttendanceType, Attendance_x_AttendanceType.attendance_id == Attendance.id)
                .where(
                    Attendance.event_instance_id.in_(list(region_by_event.keys())),
                    Attendance.is_planned.is_(False),
                )
                .group_by(Attendance.event_instance_id, Attendance.user_id, User.f3_name)
            ).all()
    finally:
        session.close()

    data: Dict[int, tuple[List[WeeklyEvent], List[WeeklyAttendanceRecord]]] = {org_id: ([], []) for org_id in org_ids}
    for row in event_rows:
        data[row.region_org_id][0].append(
            WeeklyEvent(
                event_id=row.id,
                name=row.name,
                start_date=row.start_date,
                ao_org_id=row.ao_org_id,
                ao_name=row.ao_name,
                ao_channel_id=safe_get(row.ao_meta or {}, "slack_channel_id"),
                pax_count=row.pax_count,
                fng_count=row.fng_count,
                backblast=row.backblast,
            )
        )
    for row in attendance_rows:
        region_org_id = region_by_event.get(row.event_instance_id)
        if region_org_id in data:
            data[region_org_id][1].append(
                WeeklyAttendanceRecord(
                    event_id=row.event_instance_id,
                    user_id=row.user_id,
                    f3_name=row.f3_name,
                    q_ind=row.q_ind or 0,
                )
            )
    return data


def pull_flag_candidates(org_ids: List[int], window_end: date) -> Dict[int, List[FlagCandidate]]:
    """Pulls events with preblast/backblast text or custom-field data within the lookback
    window, grouped by region, for resolving each region's configured flags' current holders.
    Since each region can configure different flag hashtags/custom fields, the per-flag match
    happens in Python (resolve_org_flags), not in SQL — this just gathers the raw candidate
    pool once per region."""
    if not org_ids:
        return {}
    session = get_session()
    try:
        event_rows = session.execute(
            select(
                EventInstanceExpanded.region_org_id,
                EventInstanceExpanded.start_date,
                EventInstanceExpanded.ao_name,
                EventInstanceExpanded.ao_meta,
                EventInstanceExpanded.preblast,
                EventInstanceExpanded.backblast,
                EventInstanceExpanded.meta,
            ).where(
                EventInstanceExpanded.region_org_id.in_(org_ids),
                EventInstanceExpanded.start_date > window_end - timedelta(days=FLAG_LOOKBACK_DAYS),
                EventInstanceExpanded.start_date <= window_end,
                (EventInstanceExpanded.preblast.is_not(None))
                | (EventInstanceExpanded.backblast.is_not(None))
                | (EventInstanceExpanded.meta.is_not(None)),
            )
        ).all()
    finally:
        session.close()

    candidates_by_region: Dict[int, List[FlagCandidate]] = defaultdict(list)
    for row in event_rows:
        candidates_by_region[row.region_org_id].append(
            FlagCandidate(
                start_date=row.start_date,
                ao_name=row.ao_name,
                ao_channel_id=safe_get(row.ao_meta or {}, "slack_channel_id"),
                preblast=row.preblast,
                backblast=row.backblast,
                meta=row.meta,
            )
        )
    return {org_id: candidates_by_region.get(org_id, []) for org_id in org_ids}


def pull_weekly_records(org_ids: List[int], window_end: date) -> Dict[int, tuple[float, int]]:
    """Computes each region's all-time weekly records: (best average PAX, best unique PAX).

    History is split into 7-day buckets aligned to window_end so the current report
    window is one of the buckets and the numbers stay directly comparable.
    """
    if not org_ids:
        return {}
    session = get_session()
    try:
        # In Postgres, date - date yields integer days; integer / 7 floors to the bucket
        days_ago = cast(literal(window_end, Date) - EventInstanceExpanded.start_date, Integer)
        bucket = days_ago.op("/")(7)

        avg_rows = session.execute(
            select(
                EventInstanceExpanded.region_org_id,
                bucket.label("bucket"),
                func.avg(EventInstanceExpanded.pax_count).label("avg_pax"),
            )
            .where(
                EventInstanceExpanded.region_org_id.in_(org_ids),
                EventInstanceExpanded.start_date <= window_end,
                EventInstanceExpanded.first_f_ind == 1,
            )
            .group_by(EventInstanceExpanded.region_org_id, bucket)
        ).all()

        unique_rows = session.execute(
            select(
                EventInstanceExpanded.region_org_id,
                bucket.label("bucket"),
                func.count(func.distinct(Attendance.user_id)).label("unique_pax"),
            )
            .select_from(EventInstanceExpanded)
            .join(Attendance, Attendance.event_instance_id == EventInstanceExpanded.id)
            .where(
                EventInstanceExpanded.region_org_id.in_(org_ids),
                EventInstanceExpanded.start_date <= window_end,
                EventInstanceExpanded.first_f_ind == 1,
                Attendance.is_planned.is_(False),
            )
            .group_by(EventInstanceExpanded.region_org_id, bucket)
        ).all()
    finally:
        session.close()

    records: Dict[int, tuple[float, int]] = {}
    best_avg: Dict[int, float] = defaultdict(float)
    best_unique: Dict[int, int] = defaultdict(int)
    for row in avg_rows:
        if row.avg_pax is not None:
            best_avg[row.region_org_id] = max(best_avg[row.region_org_id], round(float(row.avg_pax), 2))
    for row in unique_rows:
        best_unique[row.region_org_id] = max(best_unique[row.region_org_id], int(row.unique_pax))
    for org_id in org_ids:
        records[org_id] = (best_avg.get(org_id, 0.0), best_unique.get(org_id, 0))
    return records


def send_weekly_report(region_record: SlackSettings, text: str, channel: str):
    if not region_record.bot_token or not channel or not text:
        print("Slack bot token, weekly report destination, or report text missing; skipping send")
        return

    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    client = WebClient(token=region_record.bot_token, ssl=ssl_context)
    try:
        client.chat_postMessage(channel=channel, text=text)
    except SlackApiError as e:
        if e.response["error"] == "not_in_channel":
            try:
                client.conversations_join(channel=channel)
                client.chat_postMessage(channel=channel, text=text)
            except SlackApiError as e2:
                print(f"Error joining channel or sending weekly report: {e2.response['error']}")
        else:
            print(f"Error sending weekly report: {e.response['error']}")


def region_timezone(region_record: SlackSettings) -> pytz.BaseTzInfo:
    return pytz.timezone(region_record.weekly_report_timezone or DEFAULT_WEEKLY_TIMEZONE)


def region_local_window_end(region_record: SlackSettings) -> date:
    """Yesterday, in the region's own configured timezone (defaults to Central)."""
    return datetime.now(region_timezone(region_record)).date() - timedelta(days=1)


def run_weekly_report_for_region(
    region_record: SlackSettings, window_end: Optional[date] = None, dry_run: bool = False
):
    # The report covers the N full days ending yesterday, in the region's own timezone:
    # 7 for weekly, 14 for biweekly, so a Monday send covers the prior week(s) through Sunday
    window_end = window_end or region_local_window_end(region_record)
    window_start = window_end - timedelta(days=report_window_days(region_record.weekly_report_frequency) - 1)
    data = pull_weekly_data([region_record.org_id], window_start, window_end)
    records = pull_weekly_records([region_record.org_id], window_end)
    flag_candidates = pull_flag_candidates([region_record.org_id], window_end)
    events, attendance = data.get(region_record.org_id, ([], []))
    stats = compute_weekly_stats(events, attendance)
    stats.avg_pax_record, stats.unique_pax_record = records.get(region_record.org_id, (0.0, 0))
    stats.flags = resolve_org_flags(region_record.weekly_report_flags, flag_candidates.get(region_record.org_id, []))
    text = build_weekly_report_text(region_record, stats)
    if dry_run:
        print(f"--- weekly report for org {region_record.org_id} ({window_start} to {window_end}) ---")
        print(text)
        return
    channel = region_record.weekly_report_destination or region_record.reporting_region_channel
    send_weekly_report(region_record, text, channel)


def run_weekly_report_single_org(
    body: dict, client: WebClient, logger: any, context: dict, region_record: SlackSettings
):
    """Handler for the 'Send Weekly Report Now' button in the reporting settings modal."""
    run_weekly_report_for_region(region_record)


def cycle_weekly_reports(force_org_id: int = None, dry_run: bool = False):
    slack_spaces = DbManager.find_records(SlackSpace, filters=[True])
    settings_list: List[SlackSettings] = [
        SlackSettings(**s.settings) for s in slack_spaces if safe_get(s.settings, "org_id")
    ]

    def is_due(s: SlackSettings) -> bool:
        # weekly_report_day/_hour are in the region's own configured timezone, not a fixed
        # server timezone — this cron runs hourly, so only the regions whose local clock
        # currently matches their configured send day/hour are due on this particular tick.
        local_now = datetime.now(region_timezone(s))
        day = s.weekly_report_day if s.weekly_report_day is not None else DEFAULT_WEEKLY_DAY
        hour = s.weekly_report_hour_cst if s.weekly_report_hour_cst is not None else DEFAULT_WEEKLY_HOUR
        if not (bool(s.weekly_report_enabled) and day == local_now.weekday() and hour == local_now.hour):
            return False
        frequency = s.weekly_report_frequency or DEFAULT_WEEKLY_FREQUENCY
        if frequency == FREQUENCY_BIWEEKLY and not is_biweekly_send_week(local_now.date()):
            return False
        return True

    due_settings = [s for s in settings_list if is_due(s) or s.org_id == force_org_id]
    if not due_settings and force_org_id and dry_run:
        # allow local/dry-run testing for a region that has no Slack space connected yet
        due_settings = [SlackSettings(team_id="dry-run", org_id=force_org_id)]
    if not due_settings:
        return

    # Group by (window length, window end) rather than just window length — due regions can
    # span multiple timezones, and each one's "yesterday" is computed in its own timezone
    # (see region_local_window_end), so window_end isn't necessarily the same across all of
    # them even within a single cron tick.
    settings_by_window: Dict[tuple, List[SlackSettings]] = defaultdict(list)
    for s in due_settings:
        window_key = (report_window_days(s.weekly_report_frequency), region_local_window_end(s))
        settings_by_window[window_key].append(s)

    for (window_days, window_end), group in settings_by_window.items():
        window_start = window_end - timedelta(days=window_days - 1)
        org_ids = [s.org_id for s in group]
        data = pull_weekly_data(org_ids, window_start, window_end)
        records = pull_weekly_records(org_ids, window_end)
        flag_candidates = pull_flag_candidates(org_ids, window_end)
        for settings in group:
            try:
                events, attendance = data.get(settings.org_id, ([], []))
                stats = compute_weekly_stats(events, attendance)
                stats.avg_pax_record, stats.unique_pax_record = records.get(settings.org_id, (0.0, 0))
                stats.flags = resolve_org_flags(settings.weekly_report_flags, flag_candidates.get(settings.org_id, []))
                text = build_weekly_report_text(settings, stats)
                if dry_run:
                    print(f"--- weekly report for org {settings.org_id} ({window_start} to {window_end}) ---")
                    print(text)
                    continue
                channel = settings.weekly_report_destination or settings.reporting_region_channel
                send_weekly_report(settings, text, channel)
            except Exception as e:
                print(f"Error sending weekly report for org {settings.org_id}: {e}")
                continue


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Run weekly reporting")
    parser.add_argument("--org-id", type=int, default=None, help="Force-run for a single org, ignoring schedules")
    parser.add_argument("--dry-run", action="store_true", help="Print the report(s) instead of sending to Slack")
    args = parser.parse_args()
    cycle_weekly_reports(force_org_id=args.org_id, dry_run=args.dry_run)
