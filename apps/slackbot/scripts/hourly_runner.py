import os
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

import argparse

import requests

# from features import canvas
from scripts import (
    auto_preblast_send,
    award_achievements,
    backblast_reminders,
    calendar_images,
    home_region_nudge,
    monthly_reporting,
    preblast_reminders,
    q_lineups,
    update_slack_users,
)

APP_URL = os.getenv("APP_URL", "http://localhost:8080")


def run_all_hourly_scripts(force: bool = False, run_reporting: bool = True, reporting_org_id: int | None = None):
    print("Running hourly scripts")

    print("Running calendar images")
    try:
        calendar_images.generate_calendar_images(force=force)
    except Exception as e:
        print(f"Error generating calendar images: {e}")

    print("Running backblast reminders")
    try:
        backblast_reminders.send_backblast_reminders()
    except Exception as e:
        print(f"Error sending backblast reminders: {e}")

    print("Running preblast reminders")
    try:
        preblast_reminders.send_preblast_reminders()
    except Exception as e:
        print(f"Error sending preblast reminders: {e}")

    print("Running automated preblast send")
    try:
        auto_preblast_send.send_automated_preblasts()
    except Exception as e:
        print(f"Error sending automated preblasts: {e}")

    print("Running Q lineups")
    try:
        q_lineups.send_lineups(force=force)
    except Exception as e:
        print(f"Error sending Q lineups: {e}")

    print("Updating Slack users")
    try:
        update_slack_users.update_slack_users()
    except Exception as e:
        print(f"Error updating Slack users: {e}")

    print("Updating home regions for users")
    try:
        update_slack_users.update_home_regions()
    except Exception as e:
        print(f"Error updating home regions for users: {e}")

    print("Running home region nudge")
    try:
        home_region_nudge.send_home_region_nudges()
    except Exception as e:
        print(f"Error running home region nudge: {e}")

    if run_reporting:
        print("Running monthly reporting")
        try:
            monthly_reporting.cycle_all_orgs(run_org_id=reporting_org_id)
        except Exception as e:
            print(f"Error running monthly reporting: {e}")

    print("Running achievements update")
    try:
        award_achievements.main()
    except Exception as e:
        print(f"Error awarding achievements: {e}")

    print("Notifying completion endpoint to update settings cache")
    try:
        requests.post(f"{APP_URL}/hourly-runner-complete")
    except Exception as e:
        print(f"Error notifying completion endpoint: {e}")

    print("Hourly scripts complete")


if __name__ == "__main__":
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
