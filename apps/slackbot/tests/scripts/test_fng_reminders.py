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


def run(monkeypatch, fngs, joined=False, force=False, now=NOW, **settings):
    class FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return now.astimezone(tz) if tz else now.replace(tzinfo=None)

    space = SimpleNamespace(
        team_id="T1",
        settings={"team_id": "T1", "bot_token": "xoxb", "downrange_invite_link": INVITE_LINK, **settings},
    )
    monkeypatch.setattr(fng_reminders, "datetime", FakeDatetime)
    monkeypatch.setattr(
        fng_reminders.DbManager, "find_join_records2", MagicMock(return_value=[(space, SimpleNamespace(org_id=8))])
    )
    monkeypatch.setattr(fng_reminders.DbManager, "find_records", MagicMock(return_value=fngs))
    monkeypatch.setattr(
        fng_reminders.DbManager, "find_first_record", MagicMock(return_value=SimpleNamespace() if joined else None)
    )
    dm = MagicMock(return_value=1)
    monkeypatch.setattr(fng_reminders, "dm_fng_contacts", dm)
    monkeypatch.setattr(fng_reminders, "WebClient", MagicMock())
    fng_reminders.send_fng_reminders(force=force)
    return dm


@pytest.mark.parametrize("days", [3, 6])
def test_reminds_every_interval_until_he_joins(monkeypatch, days):
    dm = run(monkeypatch, [fng_created_days_ago(days)])

    text = dm.call_args.args[3]
    assert f"*Chip (John S.)* still hasn't joined Slack, {days} days after /fng." in text
    assert INVITE_LINK in text and "last reminder" not in text
    assert "A text or call from you might help: 828-555-0100 · john@example.com." in text


def test_reminder_without_contact_details_leaves_them_out(monkeypatch):
    text = run(monkeypatch, [fng_created_days_ago(3, phone=None, email=None)]).call_args.args[3]
    assert "A text from you might help. Here's the invite link" in text


def test_third_reminder_is_the_last(monkeypatch):
    assert "This is the last reminder." in run(monkeypatch, [fng_created_days_ago(9)]).call_args.args[3]


@pytest.mark.parametrize("days", [0, 2, 4, 12])
def test_no_reminder_off_schedule(monkeypatch, days):
    run(monkeypatch, [fng_created_days_ago(days)]).assert_not_called()


def test_region_frequency_is_used(monkeypatch):
    run(monkeypatch, [fng_created_days_ago(3)], fng_reminder_days=7).assert_not_called()
    assert run(monkeypatch, [fng_created_days_ago(7)], fng_reminder_days=7).called


def test_off_sends_nothing(monkeypatch):
    run(monkeypatch, [fng_created_days_ago(3)], fng_reminder_days=0).assert_not_called()


def test_no_reminder_once_he_joined(monkeypatch):
    run(monkeypatch, [fng_created_days_ago(3)], joined=True).assert_not_called()


def test_users_not_added_with_fng_are_ignored(monkeypatch):
    run(monkeypatch, [fng_created_days_ago(3, meta=None)]).assert_not_called()


def test_runs_only_at_the_reminder_hour_unless_forced(monkeypatch):
    morning = NOW.replace(hour=9)
    run(monkeypatch, [fng_created_days_ago(3)], now=morning).assert_not_called()
    assert run(monkeypatch, [fng_created_days_ago(3)], now=morning, force=True).called


def test_without_invite_link_the_reminder_still_goes_out(monkeypatch):
    text = run(monkeypatch, [fng_created_days_ago(3)], downrange_invite_link=None).call_args.args[3]
    assert text.endswith("might help: 828-555-0100 · john@example.com.")
