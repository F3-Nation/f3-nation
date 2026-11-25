import os
import sys
from contextlib import contextmanager
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from scripts import backblast_reminders, home_region_nudge, monthly_reporting, preblast_reminders, q_lineups
from utilities.database.orm import SlackSettings
from utilities.helper_functions import current_date_cst


def _item(team_id: str, user_id: str, **extra):
    return SimpleNamespace(
        event=SimpleNamespace(id=1, start_date=current_date_cst(), meta={}, series_exception=None),
        event_type=SimpleNamespace(name="Bootcamp"),
        org=SimpleNamespace(name="AO"),
        parent_org=SimpleNamespace(name="Region"),
        q_name="Q",
        slack_user_id=user_id,
        slack_settings=SlackSettings(team_id=team_id),
        **extra,
    )


@pytest.mark.parametrize("first_lookup", ["uninstalled", "raises"])
@pytest.mark.parametrize(
    "module, list_class, send",
    [
        (preblast_reminders, "PreblastList", preblast_reminders.send_preblast_reminders),
        (backblast_reminders, "BackblastList", backblast_reminders.send_backblast_reminders),
    ],
)
def test_reminders_skip_a_workspace_without_a_client(monkeypatch, module, list_class, send, first_lookup):
    items = [_item("T1", "U1"), _item("T2", "U2")]
    if module is preblast_reminders:
        for item in items:
            item.q_name = "Q"
            item.q_avatar_url = None
            item.slack_avatar_url = None

    def pull_data(self, *args, **kwargs):
        self.items = items

    monkeypatch.setattr(getattr(module, list_class), "pull_data", pull_data)
    installed_client = MagicMock()

    def client_for_team(team_id, **kwargs):
        if team_id == "T2":
            return installed_client
        if first_lookup == "raises":
            raise RuntimeError("lookup failed")
        return None

    monkeypatch.setattr(module, "slack_client_for_team", client_for_team)
    if module is preblast_reminders:
        monkeypatch.setattr(module, "datetime", SimpleNamespace(now=lambda tz: datetime(2026, 9, 1, 10)))

    if first_lookup == "raises":
        with pytest.raises(RuntimeError, match="skipped for 1 workspace"):
            send(force=True)
    else:
        send(force=True)

    installed_client.chat_postMessage.assert_called_once()
    assert installed_client.chat_postMessage.call_args.kwargs["channel"] == "U2"


def _client_for(installed_client):
    """T1's token lookup raises; T2 has an installation."""

    def client_for_team(team_id, **kwargs):
        if team_id == "T1":
            raise RuntimeError("lookup failed")
        return installed_client

    return client_for_team


class _Query:
    """Stands in for the nudge's SQLAlchemy query chain: every builder call returns itself."""

    def __init__(self, rows):
        self._rows = rows

    def __getattr__(self, name):
        return lambda *args, **kwargs: self

    def all(self):
        return self._rows


def test_home_region_nudge_serves_next_workspace_then_reports_failure(monkeypatch):
    rows = [
        SimpleNamespace(user_id=user_id, home_region_id=home, region_id=200, posts_30=10, posts_90=10)
        for user_id, home in ((1, 100), (2, 101))
    ]

    @contextmanager
    def session():
        yield SimpleNamespace(query=lambda *args: _Query(rows))

    db = home_region_nudge.DbManager
    monkeypatch.setattr(home_region_nudge, "get_session", session)
    monkeypatch.setattr(
        db,
        "find_join_records2",
        lambda *args, **kwargs: [
            (SimpleNamespace(team_id="T1"), SimpleNamespace(org_id=100)),
            (SimpleNamespace(team_id="T2"), SimpleNamespace(org_id=101)),
        ],
    )
    monkeypatch.setattr(db, "find_records", lambda *args, **kwargs: [])
    monkeypatch.setattr(db, "get", lambda cls, record_id: SimpleNamespace(meta={}, f3_name="PAX"))
    monkeypatch.setattr(
        db,
        "find_first_record",
        lambda *args, **kwargs: SimpleNamespace(slack_id="U_NEXT", user_name=None),
    )
    installed_client = MagicMock()
    monkeypatch.setattr(home_region_nudge, "slack_client_for_team", _client_for(installed_client))

    with pytest.raises(RuntimeError, match="skipped for 1 workspace"):
        home_region_nudge.send_home_region_nudges(force=True)

    installed_client.chat_postMessage.assert_called_once()
    assert installed_client.chat_postMessage.call_args.kwargs["channel"] == "U_NEXT"


def test_q_lineups_serve_next_region_then_report_failure(monkeypatch):
    spaces = [
        SimpleNamespace(
            settings={
                "team_id": team_id,
                "org_id": org_id,
                "send_q_lineups": True,
                "send_q_lineups_method": "yes_for_all",
                "send_q_lineups_channel": f"C{org_id}",
            }
        )
        for team_id, org_id in (("T1", 1), ("T2", 2))
    ]
    db = q_lineups.DbManager
    monkeypatch.setattr(db, "find_records", lambda *args, **kwargs: spaces)
    monkeypatch.setattr(db, "get", lambda cls, org_id: SimpleNamespace(id=org_id, name="Region", meta={}))
    monkeypatch.setattr(db, "update_record", MagicMock())
    monkeypatch.setattr(q_lineups.PreblastList, "pull_data", lambda self, *args, **kwargs: None)
    installed_client = MagicMock()
    monkeypatch.setattr(q_lineups, "slack_client_for_team", _client_for(installed_client))

    with pytest.raises(RuntimeError, match="skipped for 1 workspace"):
        q_lineups.send_lineups(force=True)

    installed_client.chat_postMessage.assert_called_once()
    assert installed_client.chat_postMessage.call_args.kwargs["channel"] == "C2"


def test_monthly_reporting_serves_next_region_then_reports_failure(monkeypatch, tmp_path):
    chart = tmp_path / "summary.png"
    chart.write_bytes(b"png")
    records = [
        (
            None,
            SimpleNamespace(id=org_id, name="Region"),
            SimpleNamespace(
                settings={
                    "team_id": team_id,
                    "reporting_region_monthly_summary_enabled": True,
                    "reporting_region_channel": f"C{org_id}",
                }
            ),
        )
        for team_id, org_id in (("T1", 1), ("T2", 2))
    ]

    class ReportDay:
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 11, 2, 20, tzinfo=tz)

    monkeypatch.setattr(monthly_reporting, "datetime", ReportDay)
    monkeypatch.setattr(monthly_reporting.DbManager, "find_join_records3", lambda *args, **kwargs: records)
    monkeypatch.setattr(monthly_reporting, "pull_org_summary_data", lambda: {1: object(), 2: object()})
    monkeypatch.setattr(monthly_reporting, "create_org_monthly_summary", lambda data: str(chart))
    installed_client = MagicMock()
    monkeypatch.setattr(monthly_reporting, "slack_client_for_team", _client_for(installed_client))

    with pytest.raises(RuntimeError, match="skipped for 1 region"):
        monthly_reporting.cycle_all_orgs()

    installed_client.files_upload_v2.assert_called_once()
    assert installed_client.files_upload_v2.call_args.kwargs["channel"] == "C2"
