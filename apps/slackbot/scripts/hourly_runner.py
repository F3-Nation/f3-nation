import logging
import os
import re
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

import argparse

import requests
from google.cloud.logging_v2.handlers import StructuredLogHandler, setup_logging

# from features import canvas
from scripts import (
    auto_preblast_send,
    award_achievements,
    backblast_reminders,
    calendar_images,
    f3versary_announcements,
    fng_reminders,
    home_region_nudge,
    kotter_reports,
    monthly_reporting,
    preblast_reminders,
    q_lineups,
    update_slack_users,
)
from utilities.constants import LOCAL_DEVELOPMENT

APP_URL = os.getenv("APP_URL", "http://localhost:8080")


def configure_logging():
    level = logging.DEBUG if os.environ.get("LOG_LEVEL", "INFO").upper() == "DEBUG" else logging.INFO
    if LOCAL_DEVELOPMENT:
        logging.basicConfig(level=level, handlers=[logging.StreamHandler()], force=True)
    else:
        root = logging.getLogger()
        for handler in root.handlers[:]:
            root.removeHandler(handler)
            handler.close()
        setup_logging(StructuredLogHandler(), log_level=level)


logger = logging.getLogger(__name__)


def log_job_failure(job: str, error: Exception) -> None:
    # Exception messages and tracebacks can contain credentials or member data.
    name = type(error).__name__
    error_type = name if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", name) else "Exception"
    logger.error(
        "slack.hourly.job_failed job=%s error_type=%s",
        job,
        error_type,
        extra={"json_fields": {"event": "slack.hourly.job_failed", "job": job, "error_type": error_type}},
    )


def run_all_hourly_scripts(force: bool = False, run_reporting: bool = True, reporting_org_id: int | None = None):
    print("Running hourly scripts")

    print("Running calendar images")
    try:
        calendar_images.generate_calendar_images(force=force)
    except Exception as e:
        log_job_failure("calendar_images.generate_calendar_images", e)

    print("Running backblast reminders")
    try:
        backblast_reminders.send_backblast_reminders()
    except Exception as e:
        log_job_failure("backblast_reminders.send_backblast_reminders", e)

    print("Running preblast reminders")
    try:
        preblast_reminders.send_preblast_reminders()
    except Exception as e:
        log_job_failure("preblast_reminders.send_preblast_reminders", e)

    print("Running automated preblast send")
    try:
        auto_preblast_send.send_automated_preblasts()
    except Exception as e:
        log_job_failure("auto_preblast_send.send_automated_preblasts", e)

    print("Running Q lineups")
    try:
        q_lineups.send_lineups(force=force)
    except Exception as e:
        log_job_failure("q_lineups.send_lineups", e)

    print("Updating Slack users")
    try:
        update_slack_users.update_slack_users()
    except Exception as e:
        log_job_failure("update_slack_users.update_slack_users", e)

    print("Updating home regions for users")
    try:
        update_slack_users.update_home_regions()
    except Exception as e:
        log_job_failure("update_slack_users.update_home_regions", e)

    print("Running FNG reminders")
    try:
        fng_reminders.send_fng_reminders(force=force)
    except Exception as e:
        log_job_failure("fng_reminders.send_fng_reminders", e)

    print("Running home region nudge")
    try:
        home_region_nudge.send_home_region_nudges()
    except Exception as e:
        log_job_failure("home_region_nudge.send_home_region_nudges", e)

    print("Running F3versary announcements")
    try:
        f3versary_announcements.send_f3versary_announcements(force=force)
    except Exception as e:
        log_job_failure("f3versary_announcements.send_f3versary_announcements", e)

    if run_reporting:
        print("Running monthly reporting")
        try:
            monthly_reporting.cycle_all_orgs(run_org_id=reporting_org_id)
        except Exception as e:
            log_job_failure("monthly_reporting.cycle_all_orgs", e)

        print("Running Kotter reporting")
        try:
            kotter_reports.send_kotter_reports(force=force, run_org_id=reporting_org_id)
        except Exception as e:
            log_job_failure("kotter_reports.send_kotter_reports", e)

    print("Running achievements update")
    try:
        award_achievements.main()
    except Exception as e:
        log_job_failure("award_achievements.main", e)

    print("Notifying completion endpoint to update settings cache")
    try:
        requests.post(f"{APP_URL}/hourly-runner-complete")
    except Exception as e:
        log_job_failure("requests.post", e)

    print("Hourly scripts complete")


if __name__ == "__main__":
    configure_logging()
    parser = argparse.ArgumentParser(description="Run hourly scripts")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--skip-reporting", action="store_true")
    parser.add_argument("--reporting-org-id", type=int, default=None)
    args = parser.parse_args()

    run_all_hourly_scripts(
        force=args.force,
        run_reporting=not args.skip_reporting,
        reporting_org_id=args.reporting_org_id,
    )
