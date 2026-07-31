import os
import ssl
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta

import pytz
from f3_data_models.models import (
    Attendance,
    Attendance_x_AttendanceType,
    EventInstance,
    Org,
    Org_x_SlackSpace,
    SlackSpace,
    SlackUser,
    User,
)
from f3_data_models.utils import DbManager, get_session
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError
from sqlalchemy import and_, func, or_

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from utilities.database.orm import SlackSettings
from utilities.database.special_queries import get_admin_users, get_site_q_slack_ids_by_ao

Q_ATTENDANCE_TYPE_IDS = [2, 3]
DEFAULT_NO_POST_WEEKS = 2
DEFAULT_HOME_AO_WEEKS = 8
DEFAULT_NO_Q_WEEKS = 12
DEFAULT_NO_Q_POSTS = 4
DEFAULT_SEND_DAY = 0
DEFAULT_SEND_HOUR_CST = 8
VALID_SEND_MODES = {"group", "individual"}

SLACK_TABLE_MAX_ROWS = 100
SLACK_TABLE_HEADER_ROWS = 1
SLACK_TABLE_MAX_DATA_ROWS = SLACK_TABLE_MAX_ROWS - SLACK_TABLE_HEADER_ROWS
TEXT_FALLBACK_MAX_ROWS = 99
DEFAULT_SAMPLE_REPORT_ROWS = 8


@dataclass
class KotterConfig:
    enabled: bool
    org_id: int | None
    team_id: str
    bot_token: str | None
    recipient_users: list[str]
    include_admins: bool
    include_site_qs: bool
    send_mode: str
    split_site_qs: bool
    day: int
    hour_cst: int
    no_post_weeks: int
    remove_weeks: int | None
    home_ao_weeks: int
    no_q_weeks: int
    no_q_posts: int


@dataclass
class KotterRow:
    user_id: int
    f3_name: str
    slack_user_id: str | None
    last_post_date: date | None
    last_q_date: date | None
    recent_post_count: int
    recent_q_count: int
    home_ao_org_id: int | None
    home_ao_name: str | None
    reasons: list[str]


@dataclass
class Delivery:
    destination: str | None
    rows: list[KotterRow]
    title: str = "Weekly Kotter Report"
    summary_only: bool = False
    destination_users: list[str] | None = None


def _positive_int(value, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def _optional_positive_int(value) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _bounded_int(value, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if minimum <= parsed <= maximum else default


def _unique_truthy_strings(values) -> list[str]:
    if not isinstance(values, list):
        return []
    return list(dict.fromkeys(value.strip() for value in values if isinstance(value, str) and value.strip()))


def get_kotter_config(settings: SlackSettings) -> KotterConfig:
    enabled = (
        bool(settings.kotter_reports_enabled)
        if settings.kotter_reports_enabled is not None
        else bool(settings.send_aoq_reports == 1)
    )
    legacy_ao_reports_enabled = bool(
        settings.kotter_reports_enabled is None
        and settings.kotter_report_include_site_qs is None
        and settings.kotter_report_split_site_qs is None
        and settings.send_aoq_reports == 1
    )
    send_mode = settings.kotter_report_send_mode if settings.kotter_report_send_mode in VALID_SEND_MODES else "group"
    no_post_weeks = _positive_int(settings.NO_POST_THRESHOLD, DEFAULT_NO_POST_WEEKS)
    remove_weeks = _optional_positive_int(settings.REMINDER_WEEKS)
    # Unset/0/invalid values disable the upper removal bound. A positive bound must be beyond the inactive threshold.
    if remove_weeks is not None and remove_weeks <= no_post_weeks:
        remove_weeks = None

    config = KotterConfig(
        enabled=enabled,
        org_id=settings.org_id,
        team_id=settings.team_id,
        bot_token=settings.bot_token,
        recipient_users=_unique_truthy_strings(settings.kotter_report_recipient_users),
        include_admins=bool(settings.kotter_report_include_admins),
        include_site_qs=bool(
            settings.kotter_report_include_site_qs or settings.kotter_report_split_site_qs or legacy_ao_reports_enabled
        ),
        send_mode=send_mode,
        split_site_qs=bool(settings.kotter_report_split_site_qs),
        day=_bounded_int(settings.kotter_report_day, DEFAULT_SEND_DAY, 0, 6),
        hour_cst=_bounded_int(settings.kotter_report_hour_cst, DEFAULT_SEND_HOUR_CST, 0, 23),
        no_post_weeks=no_post_weeks,
        remove_weeks=remove_weeks,
        home_ao_weeks=_positive_int(settings.HOME_AO_CAPTURE, DEFAULT_HOME_AO_WEEKS),
        no_q_weeks=_positive_int(settings.NO_Q_THRESHOLD_WEEKS, DEFAULT_NO_Q_WEEKS),
        no_q_posts=_positive_int(settings.NO_Q_THRESHOLD_POSTS, DEFAULT_NO_Q_POSTS),
    )
    config.enabled = bool(config.enabled and config.org_id and config.bot_token)
    return config


def _completed_attendance_filters(config: KotterConfig, today: date):
    return [
        EventInstance.is_active.is_(True),
        EventInstance.start_date <= today,
        Attendance.is_planned.is_(False),
    ]


def _local_region_filters(config: KotterConfig):
    return [
        or_(Org.id == config.org_id, Org.parent_id == config.org_id),
    ]


def get_kotter_rows(config: KotterConfig, today: date | None = None) -> list[KotterRow]:
    if not config.enabled or not config.org_id:
        return []
    today = today or date.today()
    no_post_cutoff = today - timedelta(weeks=config.no_post_weeks)
    remove_cutoff = today - timedelta(weeks=config.remove_weeks) if config.remove_weeks else None
    no_q_cutoff = today - timedelta(weeks=config.no_q_weeks)
    home_ao_cutoff = today - timedelta(weeks=config.home_ao_weeks)

    with get_session() as session:
        base_filters = _completed_attendance_filters(config, today)
        local_filters = _local_region_filters(config)
        candidate_rows = (
            session.query(
                User.id,
                User.f3_name,
                func.min(SlackUser.slack_id).label("slack_id"),
                func.max(EventInstance.start_date).label("last_post_date"),
            )
            .select_from(Attendance)
            .join(User, User.id == Attendance.user_id)
            .join(EventInstance, EventInstance.id == Attendance.event_instance_id)
            .join(Org, Org.id == EventInstance.org_id)
            .outerjoin(SlackUser, and_(SlackUser.user_id == User.id, SlackUser.slack_team_id == config.team_id))
            .filter(*base_filters, User.home_region_id == config.org_id)
            .group_by(User.id, User.f3_name)
            .all()
        )

        recent_post_rows = (
            session.query(Attendance.user_id, func.count(func.distinct(Attendance.id)))
            .select_from(Attendance)
            .join(EventInstance, EventInstance.id == Attendance.event_instance_id)
            .join(Org, Org.id == EventInstance.org_id)
            .join(User, User.id == Attendance.user_id)
            .filter(*base_filters, User.home_region_id == config.org_id, EventInstance.start_date >= no_q_cutoff)
            .group_by(Attendance.user_id)
            .all()
        )
        recent_posts = dict(recent_post_rows)

        recent_q_rows = (
            session.query(Attendance.user_id, func.count(func.distinct(Attendance.id)))
            .select_from(Attendance)
            .join(EventInstance, EventInstance.id == Attendance.event_instance_id)
            .join(Org, Org.id == EventInstance.org_id)
            .join(User, User.id == Attendance.user_id)
            .join(Attendance_x_AttendanceType, Attendance_x_AttendanceType.attendance_id == Attendance.id)
            .filter(
                *base_filters,
                User.home_region_id == config.org_id,
                EventInstance.start_date >= no_q_cutoff,
                Attendance_x_AttendanceType.attendance_type_id.in_(Q_ATTENDANCE_TYPE_IDS),
            )
            .group_by(Attendance.user_id)
            .all()
        )
        recent_qs = dict(recent_q_rows)

        last_q_rows = (
            session.query(Attendance.user_id, func.max(EventInstance.start_date).label("last_q_date"))
            .select_from(Attendance)
            .join(EventInstance, EventInstance.id == Attendance.event_instance_id)
            .join(Org, Org.id == EventInstance.org_id)
            .join(User, User.id == Attendance.user_id)
            .join(Attendance_x_AttendanceType, Attendance_x_AttendanceType.attendance_id == Attendance.id)
            .filter(
                *base_filters,
                User.home_region_id == config.org_id,
                Attendance_x_AttendanceType.attendance_type_id.in_(Q_ATTENDANCE_TYPE_IDS),
            )
            .group_by(Attendance.user_id)
            .all()
        )
        last_qs = dict(last_q_rows)

        home_ao_rows = (
            session.query(
                Attendance.user_id,
                Org.id,
                Org.name,
                func.count(func.distinct(Attendance.id)).label("post_count"),
                func.max(EventInstance.start_date).label("latest_post"),
            )
            .select_from(Attendance)
            .join(EventInstance, EventInstance.id == Attendance.event_instance_id)
            .join(Org, Org.id == EventInstance.org_id)
            .join(User, User.id == Attendance.user_id)
            .filter(
                *base_filters,
                *local_filters,
                User.home_region_id == config.org_id,
                EventInstance.start_date >= home_ao_cutoff,
            )
            .group_by(Attendance.user_id, Org.id, Org.name)
            .all()
        )

    home_aos = {}
    for user_id, org_id, org_name, post_count, latest_post in home_ao_rows:
        current = home_aos.get(user_id)
        candidate = (post_count or 0, latest_post or date.min, -(org_id or 0), org_name or "", org_id, org_name)
        if current is None or candidate > current:
            home_aos[user_id] = candidate

    rows = []
    for user_id, f3_name, slack_id, last_post_date in candidate_rows:
        reasons = []
        if last_post_date and last_post_date < no_post_cutoff:
            if remove_cutoff is None or last_post_date >= remove_cutoff:
                reasons.append("inactive")
        post_count = recent_posts.get(user_id, 0) or 0
        q_count = recent_qs.get(user_id, 0) or 0
        if post_count >= config.no_q_posts and q_count == 0:
            reasons.append("posting_not_qing")
        if not reasons:
            continue
        home_ao = home_aos.get(user_id)
        rows.append(
            KotterRow(
                user_id=user_id,
                f3_name=f3_name or f"User {user_id}",
                slack_user_id=slack_id,
                last_post_date=last_post_date,
                last_q_date=last_qs.get(user_id),
                recent_post_count=post_count,
                recent_q_count=q_count,
                home_ao_org_id=home_ao[4] if home_ao else None,
                home_ao_name=home_ao[5] if home_ao else None,
                reasons=reasons,
            )
        )
    return sorted(rows, key=lambda r: (r.home_ao_name or "", r.f3_name.lower(), r.user_id))


def _sample_kotter_user_rows(session, config: KotterConfig, limit: int):
    def build_query(*filters):
        return (
            session.query(
                User.id,
                User.f3_name,
                User.first_name,
                User.last_name,
                func.min(SlackUser.slack_id).label("slack_id"),
            )
            .outerjoin(SlackUser, and_(SlackUser.user_id == User.id, SlackUser.slack_team_id == config.team_id))
            .filter(*filters)
            .group_by(User.id, User.f3_name, User.first_name, User.last_name)
            .order_by(User.f3_name, User.first_name, User.last_name, User.id)
            .limit(limit)
        )

    if config.org_id:
        home_region_rows = build_query(User.home_region_id == config.org_id).all()
        if home_region_rows:
            return home_region_rows
    return build_query().all()


def _mark_sample_deliveries(deliveries: list[Delivery]) -> None:
    for delivery in deliveries:
        if not delivery.title.startswith("Sample "):
            delivery.title = f"Sample {delivery.title}"


def get_sample_kotter_rows(
    config: KotterConfig,
    today: date | None = None,
    row_count: int = DEFAULT_SAMPLE_REPORT_ROWS,
) -> list[KotterRow]:
    """Build deterministic sample Kotter rows without reading attendance or event instance data."""
    if not config.org_id:
        return []
    today = today or date.today()
    row_count = _positive_int(row_count, DEFAULT_SAMPLE_REPORT_ROWS)

    with get_session() as session:
        user_rows = _sample_kotter_user_rows(session, config, row_count)
        ao_rows = (
            session.query(Org.id, Org.name)
            .filter(Org.parent_id == config.org_id, Org.is_active.is_(True))
            .order_by(Org.name, Org.id)
            .limit(max(row_count, 1))
            .all()
        )
        if not ao_rows:
            ao_rows = session.query(Org.id, Org.name).filter(Org.id == config.org_id).limit(1).all()

    rows: list[KotterRow] = []
    for index, (user_id, f3_name, first_name, last_name, slack_id) in enumerate(user_rows):
        ao_id, ao_name = ao_rows[index % len(ao_rows)] if ao_rows else (None, None)
        sample_pattern = index % 3
        reasons = ["inactive"] if sample_pattern in (0, 2) else []
        if sample_pattern in (1, 2):
            reasons.append("posting_not_qing")

        inactive = "inactive" in reasons
        posting_not_qing = "posting_not_qing" in reasons
        display_name = f3_name or " ".join(part for part in [first_name, last_name] if part) or f"User {user_id}"
        rows.append(
            KotterRow(
                user_id=user_id,
                f3_name=display_name,
                slack_user_id=slack_id,
                last_post_date=(
                    today - timedelta(weeks=config.no_post_weeks + 1 + index)
                    if inactive
                    else today - timedelta(days=3 + index)
                ),
                last_q_date=(
                    today - timedelta(weeks=config.no_q_weeks + 1 + index)
                    if posting_not_qing
                    else today - timedelta(days=10 + index)
                ),
                recent_post_count=(
                    config.no_q_posts + (index % 3) if posting_not_qing else max(1, config.no_q_posts - 1)
                ),
                recent_q_count=0 if posting_not_qing else 1,
                home_ao_org_id=ao_id,
                home_ao_name=ao_name,
                reasons=reasons,
            )
        )
    return rows


def _base_recipients(config: KotterConfig) -> list[str]:
    recipients = list(config.recipient_users)
    if config.include_admins and config.org_id:
        recipients.extend(
            slack_user.slack_id for _, slack_user in get_admin_users(config.org_id, config.team_id) if slack_user
        )
    return _unique_truthy_strings(recipients)


def resolve_kotter_deliveries(config: KotterConfig, rows: list[KotterRow]) -> list[Delivery]:
    if not config.enabled or not rows:
        return []
    deliveries: list[Delivery] = []
    seen: set[tuple[str, tuple[int, ...]]] = set()

    def add_delivery(
        destination: str | None,
        delivery_rows: list[KotterRow],
        title: str,
        summary_only: bool = False,
        destination_users: list[str] | None = None,
    ):
        destination_users = _unique_truthy_strings(destination_users or [])
        if (not destination and not destination_users) or not delivery_rows:
            return
        row_ids = tuple(sorted(row.user_id for row in delivery_rows))
        destination_key = destination or f"users:{','.join(sorted(destination_users))}"
        key = (destination_key, row_ids)
        if key in seen:
            return
        seen.add(key)
        deliveries.append(
            Delivery(
                destination=destination,
                rows=delivery_rows,
                title=title,
                summary_only=summary_only,
                destination_users=destination_users or None,
            )
        )

    base_recipients = _base_recipients(config)

    if config.include_site_qs:
        ao_ids = sorted({row.home_ao_org_id for row in rows if row.home_ao_org_id})
        site_qs_by_ao = get_site_q_slack_ids_by_ao(ao_ids, config.team_id) if ao_ids else {}
        rows_by_ao: dict[int, list[KotterRow]] = {}
        for row in rows:
            if row.home_ao_org_id and site_qs_by_ao.get(row.home_ao_org_id):
                rows_by_ao.setdefault(row.home_ao_org_id, []).append(row)
        for ao_id, ao_rows in rows_by_ao.items():
            title = f"Weekly Kotter Report: {ao_rows[0].home_ao_name or 'AO'}"
            for site_q in _unique_truthy_strings(site_qs_by_ao.get(ao_id, [])):
                add_delivery(site_q, ao_rows, title)

    if config.send_mode == "group":
        add_delivery(None, rows, "Weekly Kotter Report: full list", destination_users=base_recipients)
    else:
        for recipient in base_recipients:
            add_delivery(recipient, rows, "Weekly Kotter Report: full list")
    return deliveries


def _row_name(row: KotterRow, stats_url: str | None) -> str:
    name = ""
    if row.slack_user_id:
        name = f"<@{row.slack_user_id}>"
    else:
        name = row.f3_name
    if stats_url:
        name += f" (<{stats_url.rstrip('/')}/stats/pax/{row.user_id}|stats)>"
    return name


def _stats_url(row: KotterRow, stats_url: str | None) -> str | None:
    if not stats_url:
        return None
    return f"{stats_url.rstrip('/')}/stats/pax/{row.user_id}"


def _pax_table_cell(row: KotterRow, stats_url: str | None) -> dict:
    url = _stats_url(row, stats_url)
    name_element = (
        {"type": "user", "user_id": row.slack_user_id} if row.slack_user_id else {"type": "text", "text": row.f3_name}
    )
    if not url:
        if row.slack_user_id:
            return {"type": "rich_text", "elements": [{"type": "rich_text_section", "elements": [name_element]}]}
        return {"type": "raw_text", "text": row.f3_name}
    return {
        "type": "rich_text",
        "elements": [
            {
                "type": "rich_text_section",
                "elements": [
                    name_element,
                    {"type": "text", "text": " ("},
                    {"type": "link", "url": url, "text": "stats"},
                    {"type": "text", "text": ")"},
                ],
            }
        ],
    }


def _reason_label(reason: str) -> str:
    labels = {"inactive": "No recent posts", "posting_not_qing": "Posting, not Qing"}
    return labels.get(reason, reason)


def _reason_text(row: KotterRow) -> str:
    return ", ".join(_reason_label(reason) for reason in row.reasons)


def _summary_text(title: str, rows: list[KotterRow]) -> str:
    reason_counts: dict[str, int] = {}
    ao_counts: dict[str, int] = {}
    for row in rows:
        for reason in row.reasons:
            reason_counts[reason] = reason_counts.get(reason, 0) + 1
        ao_name = row.home_ao_name or "unknown AO"
        ao_counts[ao_name] = ao_counts.get(ao_name, 0) + 1

    reason_text = ", ".join(f"{_reason_label(reason)}: {count}" for reason, count in sorted(reason_counts.items()))
    top_aos = sorted(ao_counts.items(), key=lambda item: (-item[1], item[0]))[:5]
    ao_text = ", ".join(f"{name}: {count}" for name, count in top_aos)
    lines = [f"*{title}*", f"{len(rows)} PAX need attention."]
    if reason_text:
        lines.append(f"Reasons: {reason_text}")
    if ao_text:
        lines.append(f"Top AOs: {ao_text}")
    lines.append("Detailed AO reports are sent separately to matching Site Qs when enabled.")
    return "\n".join(lines)


def build_kotter_message(delivery: Delivery, stats_url: str | None = None) -> tuple[str, list[dict]]:
    rows = delivery.rows
    if delivery.summary_only:
        text = _summary_text(delivery.title, rows)
        return text, [{"type": "section", "text": {"type": "mrkdwn", "text": text[:3000]}}]

    shown_rows = rows[:TEXT_FALLBACK_MAX_ROWS]
    more_count = max(len(rows) - len(shown_rows), 0)
    lines = [f"*{delivery.title}*", f"{len(rows)} PAX need attention."]
    for row in shown_rows:
        last_post = row.last_post_date.isoformat() if row.last_post_date else "unknown"
        last_q = row.last_q_date.isoformat() if row.last_q_date else "unknown"
        row_name = _row_name(row, stats_url)
        reason_text = _reason_text(row)
        home_ao = row.home_ao_name or "unknown"
        lines.append(f"• {row_name} — {reason_text} — Home AO: {home_ao} — Last post: {last_post} — Last Q: {last_q}")
    if more_count:
        lines.append(f"+{more_count} more")
    text = "\n".join(lines)

    if len(rows) > SLACK_TABLE_MAX_DATA_ROWS:
        return text, [{"type": "section", "text": {"type": "mrkdwn", "text": text[:3000]}}]

    table_rows: list[list[dict]] = [
        [{"type": "raw_text", "text": header} for header in ["PAX", "Reason", "Home AO", "Last Post", "Last Q"]]
    ]
    for row in rows:
        table_rows.append(
            [
                _pax_table_cell(row, stats_url),
                {"type": "raw_text", "text": _reason_text(row)},
                {"type": "raw_text", "text": row.home_ao_name or ""},
                {"type": "raw_text", "text": row.last_post_date.isoformat() if row.last_post_date else ""},
                {"type": "raw_text", "text": row.last_q_date.isoformat() if row.last_q_date else ""},
            ]
        )
    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": text[:3000],
            },
        },
        {"type": "table", "rows": table_rows},
    ]
    return text, blocks


def _delivery_destination_label(delivery: Delivery) -> str:
    if delivery.destination:
        return delivery.destination
    return ",".join(delivery.destination_users or [])


def _delivery_channel(client: WebClient, delivery: Delivery) -> str:
    if delivery.destination:
        return delivery.destination
    if delivery.destination_users:
        response = client.conversations_open(users=",".join(delivery.destination_users))
        channel = response.get("channel", {}).get("id")
        if channel:
            return channel
    raise ValueError("Kotter Report delivery has no destination")


def _send_delivery(client: WebClient, delivery: Delivery, stats_url: str | None):
    text, blocks = build_kotter_message(delivery, stats_url=stats_url)
    destination_label = _delivery_destination_label(delivery)
    try:
        channel = _delivery_channel(client, delivery)
        client.chat_postMessage(channel=channel, text=text, blocks=blocks)
        print(f"Sent Kotter Report to {destination_label} ({len(delivery.rows)} rows)")
    except SlackApiError as e:
        if e.response.get("error") == "not_in_channel" and delivery.destination:
            try:
                client.conversations_join(channel=delivery.destination)
                client.chat_postMessage(channel=delivery.destination, text=text, blocks=blocks)
                print(f"Joined and sent Kotter Report to {destination_label} ({len(delivery.rows)} rows)")
            except SlackApiError as e2:
                print(f"Error joining/sending Kotter Report to {destination_label}: {e2.response.get('error')}")
        else:
            print(f"Error sending Kotter Report to {destination_label}: {e.response.get('error')}")
    except ValueError as e:
        print(f"Error sending Kotter Report to {destination_label}: {e}")


def send_kotter_reports(
    force: bool = False,
    run_org_id: int | None = None,
    today: date | None = None,
    now_cst: datetime | None = None,
    sample_report: bool = False,
    sample_row_count: int = DEFAULT_SAMPLE_REPORT_ROWS,
) -> None:
    current_time = now_cst or datetime.now(pytz.timezone("US/Central"))
    records = DbManager.find_join_records3(Org_x_SlackSpace, Org, SlackSpace, filters=[Org.is_active])
    stats_url = os.getenv("STATS_URL")
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE

    for org, slack in [(record[1], record[2]) for record in records]:
        if run_org_id and org.id != run_org_id:
            continue
        try:
            settings = SlackSettings(**slack.settings)
            config = get_kotter_config(settings)
            if sample_report and config.org_id and config.bot_token:
                config.enabled = True
            if not config.enabled:
                continue
            if (
                not sample_report
                and not force
                and (config.day != current_time.weekday() or config.hour_cst != current_time.hour)
            ):
                print(
                    f"Skipping Kotter Reports for org {org.name} ({org.id}): "
                    f"scheduled for day {config.day} hour {config.hour_cst}, "
                    f"current day {current_time.weekday()} hour {current_time.hour}"
                )
                continue
            report_date = today or current_time.date()
            rows = (
                get_sample_kotter_rows(config, today=report_date, row_count=sample_row_count)
                if sample_report
                else get_kotter_rows(config, today=report_date)
            )
            deliveries = resolve_kotter_deliveries(config, rows)
            if sample_report:
                _mark_sample_deliveries(deliveries)
            if not deliveries:
                print(f"No Kotter Report deliveries for org {org.name} ({org.id})")
                continue
            client = WebClient(token=config.bot_token, ssl=ssl_context)
            for delivery in deliveries:
                _send_delivery(client, delivery, stats_url=stats_url)
        except Exception as e:
            print(f"Error processing Kotter Reports for org {org.name} ({org.id}): {e}")


if __name__ == "__main__":
    send_kotter_reports(force=True, sample_report=True)
