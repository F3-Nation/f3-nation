from dataclasses import dataclass
from typing import Any, Optional


@dataclass
class SlackSettings:
    team_id: str
    db_id: Optional[int] = None
    workspace_name: Optional[str] = None
    bot_token: Optional[str] = None
    email_enabled: Optional[int] = None
    email_server: Optional[str] = None
    email_server_port: Optional[int] = None
    email_user: Optional[str] = None
    email_password: Optional[str] = None
    email_to: Optional[str] = None
    email_option_show: Optional[int] = None
    postie_format: Optional[int] = None
    editing_locked: Optional[int] = None
    default_backblast_destination: Optional[str] = None
    backblast_destination_channel: Optional[str] = None
    default_preblast_destination: Optional[str] = None
    preblast_destination_channel: Optional[str] = None
    backblast_moleskin_template: Optional[dict[str, Any]] = None
    preblast_moleskin_template: Optional[dict[str, Any]] = None
    strava_enabled: Optional[int] = None
    custom_fields: Optional[dict[str, Any]] = None
    welcome_dm_enable: Optional[int] = None
    welcome_dm_template: Optional[dict[str, Any]] = None
    welcome_channel_enable: Optional[int] = None
    welcome_channel: Optional[str] = None
    send_achievements: Optional[int] = None
    send_aoq_reports: Optional[int] = None
    achievement_channel: Optional[str] = None
    achievement_send_option: Optional[str] = None  # Options: "post_individually", "post_summary", "send_in_dms_only"
    default_siteq: Optional[str] = None
    NO_POST_THRESHOLD: Optional[int] = None
    REMINDER_WEEKS: Optional[int] = None
    HOME_AO_CAPTURE: Optional[int] = None
    NO_Q_THRESHOLD_WEEKS: Optional[int] = None
    NO_Q_THRESHOLD_POSTS: Optional[int] = None
    org_id: Optional[int] = (
        None  # NOTE: down the road, we may not want this here, for example if we want a slack space to be associated with multiple orgs # noqa
    )
    calendar_image_current: Optional[str] = None
    calendar_image_next: Optional[str] = None
    preblast_reminder_days: Optional[int] = None
    backblast_reminder_days: Optional[int] = None
    special_events_enabled: Optional[int] = None
    special_events_channel: Optional[str] = None
    special_events_post_days: Optional[int] = None
    canvas_channel: Optional[str] = None
    paxminer_schema: Optional[str] = None
    calendar_group_by_option: Optional[str] = None
    send_q_lineups: Optional[bool] = None
    send_q_lineups_method: Optional[str] = None
    send_q_lineups_channel: Optional[str] = None
    send_q_lineups_day: Optional[int] = None
    send_q_lineups_hour_cst: Optional[int] = None
    migration_date: Optional[str] = None
    reporting_region_leaderboard_enabled: Optional[bool] = None
    reporting_region_channel: Optional[str] = None
    reporting_region_monthly_summary_enabled: Optional[bool] = None
    reporting_ao_leaderboard_enabled: Optional[bool] = None
    q_image_posting_enabled: Optional[bool] = None
    q_image_posting_channel: Optional[str] = None
    q_image_posting_ts: Optional[str] = None
    reporting_ao_monthly_summary_enabled: Optional[bool] = None
    automated_preblast_option: Optional[str] = None
    automated_preblast_hour_cst: Optional[int] = None
    scheduled_preblast_hour_cst: Optional[int] = None
    preblast_reminder_hour_cst: Optional[int] = None
    hc_announce_option: Optional[str] = None
    hc_announce_targets: Optional[str] = None
    downrange_invite_link: Optional[str] = None
    downrange_invite_sharing: Optional[str] = None  # "proactive" or "request_only"
    downrange_channel_posting: Optional[str] = None  # "off" or "enabled"
    downrange_channel: Optional[str] = None
    open_event_color: Optional[str] = None
    bot_log_channel: Optional[str] = None
    calendar_config_special_days_out: Optional[int] = None
    weekly_report_enabled: Optional[bool] = None
    weekly_report_sections: Optional[list[str]] = None
    weekly_report_day: Optional[int] = None  # 0 = Monday ... 6 = Sunday
    weekly_report_hour_cst: Optional[int] = None
    weekly_report_destination: Optional[str] = None  # conversation id: channel or user (DM)
    weekly_report_intro_template: Optional[str] = None
    weekly_report_summary_metrics: Optional[list[str]] = None
    weekly_report_frequency: Optional[str] = None  # "weekly" (default) or "biweekly"
    # {flag_key: {"name": str, "hashtag": str, "custom_field_name": str,
    #              "holder_type": "location"|"pax", "enabled": bool}}
    weekly_report_flags: Optional[dict[str, dict]] = None
    # Optional per-section header text overrides — blank/unset falls back to the built-in
    # default header for that section (see scripts/weekly_reporting.py).
    weekly_report_fngs_header: Optional[str] = None
    weekly_report_top_ao_posts_header: Optional[str] = None
    weekly_report_top_posters_header: Optional[str] = None
    weekly_report_top_qs_header: Optional[str] = None
    weekly_report_flags_header: Optional[str] = None
