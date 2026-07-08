import os
import sys
from datetime import date, datetime
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from scripts import hourly_runner, kotter_reports
from utilities.database.orm import SlackSettings


def settings(**overrides):
    values = {"team_id": "T1", "org_id": 1, "bot_token": "xoxb-token"}
    values.update(overrides)
    return SlackSettings(**values)


def config(**overrides):
    values = {
        "enabled": True,
        "org_id": 1,
        "team_id": "T1",
        "bot_token": "xoxb-token",
        "fallback_conversation": "C1",
        "recipient_users": [],
        "include_admins": False,
        "include_site_qs": False,
        "send_mode": "group",
        "split_site_qs": False,
        "day": 0,
        "hour_cst": 8,
        "no_post_weeks": 4,
        "remove_weeks": None,
        "home_ao_weeks": 8,
        "no_q_weeks": 12,
        "no_q_posts": 4,
    }
    values.update(overrides)
    return kotter_reports.KotterConfig(**values)


def row(user_id=1, ao_id=10, ao_name="The AO"):
    return kotter_reports.KotterRow(
        user_id=user_id,
        f3_name=f"PAX {user_id}",
        slack_user_id=f"U{user_id}",
        last_post_date=date(2026, 1, 1),
        recent_post_count=5,
        recent_q_count=0,
        home_ao_org_id=ao_id,
        home_ao_name=ao_name,
        reasons=["inactive", "posting_not_qing"],
    )


def test_get_kotter_config_enablement_and_legacy_fallback():
    assert kotter_reports.get_kotter_config(settings(kotter_reports_enabled=True)).enabled is True
    assert (
        kotter_reports.get_kotter_config(
            settings(kotter_reports_enabled=False, send_aoq_reports=1, default_siteq="C1")
        ).enabled
        is False
    )
    assert kotter_reports.get_kotter_config(settings(send_aoq_reports=1, default_siteq="C1")).enabled is True
    assert kotter_reports.get_kotter_config(settings(send_aoq_reports=1, default_siteq=None)).enabled is False
    assert kotter_reports.get_kotter_config(settings(kotter_reports_enabled=True, bot_token=None)).enabled is False
    assert kotter_reports.get_kotter_config(settings(kotter_reports_enabled=True, org_id=None)).enabled is False


def test_get_kotter_config_thresholds_and_recipients():
    cfg = kotter_reports.get_kotter_config(
        settings(
            kotter_reports_enabled=True,
            NO_POST_THRESHOLD=0,
            REMINDER_WEEKS=None,
            kotter_report_recipient_users=["U1", "", "  ", None, "U1", " U2 "],
        )
    )
    assert cfg.no_post_weeks == kotter_reports.DEFAULT_NO_POST_WEEKS
    assert cfg.remove_weeks is None
    assert cfg.recipient_users == ["U1", "U2"]
    assert (
        kotter_reports.get_kotter_config(
            settings(kotter_reports_enabled=True, kotter_report_recipient_users="U1")
        ).recipient_users
        == []
    )

    for value in [0, -1, "invalid"]:
        assert (
            kotter_reports.get_kotter_config(settings(kotter_reports_enabled=True, REMINDER_WEEKS=value)).remove_weeks
            is None
        )
    assert (
        kotter_reports.get_kotter_config(
            settings(kotter_reports_enabled=True, NO_POST_THRESHOLD=4, REMINDER_WEEKS=4)
        ).remove_weeks
        is None
    )
    assert (
        kotter_reports.get_kotter_config(
            settings(kotter_reports_enabled=True, NO_POST_THRESHOLD=4, REMINDER_WEEKS=5)
        ).remove_weeks
        == 5
    )


def test_resolve_group_and_individual_deliveries(monkeypatch):
    rows = [row(1)]
    assert [
        d.destination
        for d in kotter_reports.resolve_kotter_deliveries(config(send_mode="group", fallback_conversation="C1"), rows)
    ] == ["C1"]

    monkeypatch.setattr(
        kotter_reports, "get_admin_users", lambda org_id, team_id: [(None, SimpleNamespace(slack_id="UADMIN"))]
    )
    deliveries = kotter_reports.resolve_kotter_deliveries(
        config(send_mode="individual", fallback_conversation="C1", recipient_users=["U1", "U1"], include_admins=True),
        rows,
    )
    assert [d.destination for d in deliveries] == ["C1", "U1", "UADMIN"]


def test_resolve_split_routing(monkeypatch):
    rows = [row(1, 10, "AO 10"), row(2, 20, "AO 20")]
    monkeypatch.setattr(kotter_reports, "get_site_q_slack_ids_by_ao", lambda ao_ids, team_id: {10: ["USITE"]})
    deliveries = kotter_reports.resolve_kotter_deliveries(
        config(split_site_qs=True, include_site_qs=True, fallback_conversation="C1"), rows
    )
    assert any(d.destination == "USITE" and [r.user_id for r in d.rows] == [1] for d in deliveries)
    assert any(d.destination == "C1" and [r.user_id for r in d.rows] == [2] and not d.summary_only for d in deliveries)

    monkeypatch.setattr(kotter_reports, "get_site_q_slack_ids_by_ao", lambda ao_ids, team_id: {})
    deliveries = kotter_reports.resolve_kotter_deliveries(
        config(split_site_qs=True, include_site_qs=True, fallback_conversation="C1"), rows
    )
    assert any(d.destination == "C1" and len(d.rows) == 2 and not d.summary_only for d in deliveries)


def test_build_kotter_message_table_summary_and_oversized():
    delivery = kotter_reports.Delivery(destination="C1", rows=[row(1)])
    text, blocks = kotter_reports.build_kotter_message(delivery)
    assert "None/stats" not in text
    assert any(block["type"] == "table" for block in blocks)
    text, blocks = kotter_reports.build_kotter_message(delivery, stats_url="https://example.test")
    assert "https://example.test/stats/pax/1" in text
    assert any("/stats/pax/1" in block.get("text", {}).get("text", "") for block in blocks)

    text, blocks = kotter_reports.build_kotter_message(
        kotter_reports.Delivery(destination="C1", rows=[row(1)], summary_only=True)
    )
    assert "•" not in text
    assert "Detailed AO/fallback reports" in text
    assert all(block["type"] != "table" for block in blocks)

    many_rows = [row(i) for i in range(kotter_reports.SLACK_TABLE_MAX_DATA_ROWS + 2)]
    text, blocks = kotter_reports.build_kotter_message(kotter_reports.Delivery(destination="C1", rows=many_rows))
    assert "+2 more" in text
    assert all(block["type"] != "table" for block in blocks)


def test_send_kotter_reports_schedule_guard(monkeypatch):
    org = SimpleNamespace(id=1, name="Region")
    slack = SimpleNamespace(
        settings=settings(kotter_reports_enabled=True, kotter_report_day=0, kotter_report_hour_cst=8).__dict__
    )
    monkeypatch.setattr(kotter_reports.DbManager, "find_join_records3", lambda *args, **kwargs: [(None, org, slack)])
    calls = {"rows": 0, "sent": 0}
    monkeypatch.setattr(
        kotter_reports,
        "get_kotter_rows",
        lambda *args, **kwargs: calls.__setitem__("rows", calls["rows"] + 1) or [row(1)],
    )
    monkeypatch.setattr(
        kotter_reports, "resolve_kotter_deliveries", lambda cfg, rows: [kotter_reports.Delivery("C1", rows)]
    )
    monkeypatch.setattr(
        kotter_reports, "_send_delivery", lambda *args, **kwargs: calls.__setitem__("sent", calls["sent"] + 1)
    )
    monkeypatch.setattr(kotter_reports, "WebClient", lambda *args, **kwargs: object())

    kotter_reports.send_kotter_reports(now_cst=datetime(2026, 7, 6, 9))
    assert calls == {"rows": 0, "sent": 0}

    kotter_reports.send_kotter_reports(now_cst=datetime(2026, 7, 6, 8))
    assert calls == {"rows": 1, "sent": 1}

    kotter_reports.send_kotter_reports(force=True, now_cst=datetime(2026, 7, 6, 9))
    assert calls == {"rows": 2, "sent": 2}


def test_hourly_runner_calls_kotter_only_when_reporting(monkeypatch):
    kotter_calls = []
    monkeypatch.setattr(hourly_runner.calendar_images, "generate_calendar_images", lambda *args, **kwargs: None)
    monkeypatch.setattr(hourly_runner.backblast_reminders, "send_backblast_reminders", lambda *args, **kwargs: None)
    monkeypatch.setattr(hourly_runner.preblast_reminders, "send_preblast_reminders", lambda *args, **kwargs: None)
    monkeypatch.setattr(hourly_runner.auto_preblast_send, "send_automated_preblasts", lambda *args, **kwargs: None)
    monkeypatch.setattr(hourly_runner.q_lineups, "send_lineups", lambda *args, **kwargs: None)
    monkeypatch.setattr(hourly_runner.update_slack_users, "update_slack_users", lambda *args, **kwargs: None)
    monkeypatch.setattr(hourly_runner.update_slack_users, "update_home_regions", lambda *args, **kwargs: None)
    monkeypatch.setattr(hourly_runner.home_region_nudge, "send_home_region_nudges", lambda *args, **kwargs: None)
    monkeypatch.setattr(hourly_runner.monthly_reporting, "cycle_all_orgs", lambda *args, **kwargs: None)
    monkeypatch.setattr(hourly_runner.award_achievements, "main", lambda *args, **kwargs: None)
    monkeypatch.setattr(hourly_runner.requests, "post", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        hourly_runner.kotter_reports,
        "send_kotter_reports",
        lambda *args, **kwargs: kotter_calls.append(kwargs),
    )

    hourly_runner.run_all_hourly_scripts(run_reporting=False)
    assert kotter_calls == []
    hourly_runner.run_all_hourly_scripts(force=True, run_reporting=True, reporting_org_id=123)
    assert kotter_calls == [{"force": True, "run_org_id": 123}]
