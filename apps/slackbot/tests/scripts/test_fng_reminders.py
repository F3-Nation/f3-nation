import os
import sys
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
import pytz

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from scripts import fng_reminders

NOW = pytz.timezone("US/Central").localize(datetime(2026, 10, 26, 17, 0))
INVITE_LINK = "https://join.slack.com/t/f3boone/shared_invite/abc"


def fng_created_days_ago(days, **overrides):
    created = NOW.astimezone(pytz.utc).replace(tzinfo=None) - timedelta(days=days)
    fields = {"id": 42, "first_name": "John", "last_name": "Smith", "f3_name": "Chip", "created": created}
    fields.update(phone="828-555-0100", email="john@example.com")
    fields.update({"meta": {"battle_buddy": 7}}, **overrides)
    return SimpleNamespace(**fields)


def space(team_id="T1", **settings):
    return SimpleNamespace(
        team_id=team_id,
        settings={"team_id": team_id, "bot_token": "xoxb", "downrange_invite_link": INVITE_LINK, **settings},
    )


def run(
    monkeypatch, fngs, joined=False, force=False, now=NOW, delivered=(7,), spaces=None, dm_side_effect=None, **settings
):
    class FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return now.astimezone(tz) if tz else now.replace(tzinfo=None)

    spaces = spaces or [space(**settings)]
    monkeypatch.setattr(fng_reminders, "datetime", FakeDatetime)
    monkeypatch.setattr(
        fng_reminders.DbManager,
        "find_join_records2",
        MagicMock(return_value=[(s, SimpleNamespace(org_id=8)) for s in spaces]),
    )
    monkeypatch.setattr(fng_reminders.DbManager, "find_records", MagicMock(return_value=fngs))
    monkeypatch.setattr(
        fng_reminders.DbManager, "find_first_record", MagicMock(return_value=SimpleNamespace() if joined else None)
    )
    monkeypatch.setattr(fng_reminders.DbManager, "update_record", MagicMock())
    dm = MagicMock(return_value=list(delivered), side_effect=dm_side_effect)
    monkeypatch.setattr(fng_reminders, "dm_fng_contacts", dm)
    monkeypatch.setattr(fng_reminders, "WebClient", MagicMock())
    monkeypatch.setattr(fng_reminders, "logger", MagicMock())
    fng_reminders.send_fng_reminders(force=force)
    return dm


@pytest.mark.parametrize("days", [3, 6])
def test_reminds_every_interval_until_he_joins(monkeypatch, days):
    dm = run(monkeypatch, [fng_created_days_ago(days)])

    text = dm.call_args.args[3]
    assert f"*Chip (John S.)* hasn't joined Slack with the email from /fng yet, {days} days later." in text
    assert INVITE_LINK in text and "last reminder" not in text
    assert "A text or call from you might help: 828-555-0100 · john@example.com." in text


def test_reminder_without_contact_details_leaves_them_out(monkeypatch):
    text = run(monkeypatch, [fng_created_days_ago(3, phone=None, email=None)]).call_args.args[3]
    assert "A text from you might help. Here's the invite link" in text


def test_third_reminder_is_the_last(monkeypatch):
    assert "This is the last reminder." in run(monkeypatch, [fng_created_days_ago(9)]).call_args.args[3]


def test_days_count_in_central_dates_across_a_dst_change(monkeypatch):
    # Created 23:30 CST the night before DST starts; a fixed CDT offset would put it on day 2 instead of 3.
    central = pytz.timezone("US/Central")
    created = central.localize(datetime(2026, 3, 7, 23, 30)).astimezone(pytz.utc).replace(tzinfo=None)
    now = central.localize(datetime(2026, 3, 10, 17, 0))
    assert run(monkeypatch, [fng_created_days_ago(0, created=created)], now=now).called


@pytest.mark.parametrize("days, already_sent", [(0, 0), (2, 0), (3, 1), (4, 1), (9, 3), (12, 3)])
def test_no_reminder_until_the_next_one_is_due(monkeypatch, days, already_sent):
    fng = fng_created_days_ago(days, meta={"battle_buddy": 7, "fng_reminders_sent": {"7": already_sent}})
    run(monkeypatch, [fng]).assert_not_called()


def test_sent_reminder_is_recorded_so_a_rerun_sends_nothing(monkeypatch):
    run(monkeypatch, [fng_created_days_ago(6, meta={"battle_buddy": 7, "fng_reminders_sent": {"7": 1}})])

    fng_reminders.DbManager.update_record.assert_called_once_with(
        fng_reminders.User, 42, {fng_reminders.User.meta: {"battle_buddy": 7, "fng_reminders_sent": {"7": 2}}}
    )


def test_missed_reminder_goes_out_the_next_day_once(monkeypatch):
    text = run(monkeypatch, [fng_created_days_ago(7)]).call_args.args[3]

    assert "7 days later" in text
    meta = fng_reminders.DbManager.update_record.call_args.args[2][fng_reminders.User.meta]
    assert meta["fng_reminders_sent"] == {"7": 2}


def test_undelivered_reminder_is_retried(monkeypatch):
    assert run(monkeypatch, [fng_created_days_ago(3)], delivered=()).called
    fng_reminders.DbManager.update_record.assert_not_called()
    fng_reminders.logger.warning.assert_called_once()
    assert fng_reminders.logger.warning.call_args.args[0] == "fng.reminder_undeliverable"


def test_contact_whose_dm_failed_is_retried_without_repeating_it_to_the_other(monkeypatch):
    both = {"battle_buddy": 7, "brought_by": 9}
    dm = run(monkeypatch, [fng_created_days_ago(3, meta=both)], delivered=(9,))

    assert dm.call_args.kwargs["contact_ids"] == [7, 9]
    meta = fng_reminders.DbManager.update_record.call_args.args[2][fng_reminders.User.meta]
    assert meta["fng_reminders_sent"] == {"9": 1}

    dm = run(monkeypatch, [fng_created_days_ago(4, meta=meta)], delivered=(7,))

    assert dm.call_args.kwargs["contact_ids"] == [7]
    meta = fng_reminders.DbManager.update_record.call_args.args[2][fng_reminders.User.meta]
    assert meta["fng_reminders_sent"] == {"9": 1, "7": 1}


def test_failed_last_reminder_is_retried_the_next_day(monkeypatch):
    # Created at 09:00 Central, so at the day-10 run he is more than 10 x 24 hours old.
    central = pytz.timezone("US/Central")
    created = central.localize(datetime(2026, 10, 16, 9, 0)).astimezone(pytz.utc).replace(tzinfo=None)
    fng = fng_created_days_ago(0, created=created, meta={"battle_buddy": 7, "fng_reminders_sent": {"7": 2}})

    dm = run(monkeypatch, [fng])

    assert "This is the last reminder." in dm.call_args.args[3]
    cutoff = fng_reminders.DbManager.find_records.call_args.kwargs["filters"][1].right.value
    assert cutoff <= created


def test_region_frequency_is_used(monkeypatch):
    run(monkeypatch, [fng_created_days_ago(3)], fng_reminder_days=7).assert_not_called()
    assert run(monkeypatch, [fng_created_days_ago(7)], fng_reminder_days=7).called


def test_off_sends_nothing(monkeypatch):
    run(monkeypatch, [fng_created_days_ago(3)], fng_reminder_days=0).assert_not_called()


@pytest.mark.parametrize("created, included", [((10, 9, 0), True), ((10, 0, 0), True), ((9, 23, 0), False)])
def test_last_catch_up_day_is_a_whole_central_day(monkeypatch, created, included):
    # Every 3 days: last due on day 9, retried through day 16 (Oct 26 is day 16 for anything created Oct 10).
    day, hour, minute = created
    central = pytz.timezone("US/Central")
    created_utc = central.localize(datetime(2026, 10, day, hour, minute)).astimezone(pytz.utc).replace(tzinfo=None)

    run(monkeypatch, [])

    cutoff = fng_reminders.DbManager.find_records.call_args.kwargs["filters"][1].right.value
    assert (created_utc >= cutoff) is included


def test_no_reminder_once_he_joined(monkeypatch):
    run(monkeypatch, [fng_created_days_ago(3)], joined=True).assert_not_called()


def test_joined_means_a_slack_user_in_this_workspace(monkeypatch):
    run(monkeypatch, [fng_created_days_ago(3)])

    filters = fng_reminders.DbManager.find_first_record.call_args.kwargs["filters"]
    assert [f.right.value for f in filters] == [42, "T1"]


def test_a_failing_region_does_not_stop_the_next_one(monkeypatch):
    broken = SimpleNamespace(team_id="T0", settings={"team_id": "T0", "not_a_setting": 1})

    dm = run(monkeypatch, [fng_created_days_ago(3)], spaces=[broken, space()])

    dm.assert_called_once()
    assert dm.call_args.args[1] == "T1"
    assert fng_reminders.logger.error.call_args.args[0].startswith("fng.reminders_region_failed")


def test_a_failing_fng_does_not_stop_the_next_one(monkeypatch):
    fngs = [fng_created_days_ago(3), fng_created_days_ago(3, id=43)]

    dm = run(monkeypatch, fngs, dm_side_effect=[RuntimeError("slack timeout"), [7]])

    assert [c.args[2].id for c in dm.call_args_list] == [42, 43]
    fng_reminders.DbManager.update_record.assert_called_once()
    fng_reminders.logger.error.assert_called_once()
    assert fng_reminders.logger.error.call_args.args[0].startswith("fng.reminder_failed")


def test_users_not_added_with_fng_are_ignored(monkeypatch):
    run(monkeypatch, [fng_created_days_ago(3, meta=None)]).assert_not_called()


def test_runs_only_at_the_reminder_hour_unless_forced(monkeypatch):
    morning = NOW.replace(hour=9)
    run(monkeypatch, [fng_created_days_ago(3)], now=morning).assert_not_called()
    assert run(monkeypatch, [fng_created_days_ago(3)], now=morning, force=True).called


def test_without_invite_link_the_reminder_still_goes_out(monkeypatch):
    text = run(monkeypatch, [fng_created_days_ago(3)], downrange_invite_link=None).call_args.args[3]
    assert text.endswith("might help: 828-555-0100 · john@example.com.")
