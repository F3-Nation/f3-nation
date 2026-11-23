import json
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

import pytest

from tools import preview_view
from tools.previews import calendar_home

SLACK_MODAL_BLOCK_LIMIT = 100
ALL_SCENARIOS = [(view, name) for view, scenarios in preview_view._previews().items() for name in scenarios]


@pytest.mark.parametrize(("view", "scenario"), ALL_SCENARIOS)
def test_every_scenario_renders_a_modal_within_slack_limits(view, scenario):
    payload = preview_view._previews()[view][scenario]()

    assert payload["type"] == "modal"
    assert 0 < len(payload["blocks"]) <= SLACK_MODAL_BLOCK_LIMIT
    assert set(payload) <= set(preview_view.VIEW_FIELDS)


def test_calendar_home_scenarios_show_their_distinct_states():
    def texts(payload):
        return json.dumps(payload["blocks"])

    member, filters, admin, empty = (calendar_home.SCENARIOS[s]() for s in ("member", "filters", "admin", "empty"))

    assert "Hide filters" in texts(filters) and "Showing: 2 AOs" in texts(filters)
    assert "Hide filters" not in texts(member)
    assert "Assign Q" in texts(admin) and "Assign Q" not in texts(member)
    assert "No upcoming events match these filters." in texts(empty)


def test_capture_payload_returns_message_blocks():
    blocks = [{"type": "section", "text": {"type": "mrkdwn", "text": "hi"}}]

    payload = preview_view.capture_payload(lambda client: client.chat_postMessage(channel="C1", blocks=blocks))

    assert payload == {"blocks": blocks}


def test_capture_payload_raises_when_nothing_is_sent():
    with pytest.raises(RuntimeError, match="no view or message"):
        preview_view.capture_payload(lambda client: None)


@pytest.mark.parametrize(("team", "prefix"), [(None, "/block-kit-builder#"), ("T123", "/block-kit-builder/T123#")])
def test_builder_url_round_trips_the_payload(team, prefix):
    payload = {"blocks": [{"type": "divider"}], "note": "a # & ? b"}

    url = preview_view.builder_url(payload, team)

    assert prefix in url
    assert json.loads(urllib.parse.unquote(url.split("#", 1)[1])) == payload


def test_main_prints_builder_url_and_writes_out_file(tmp_path, capsys):
    out = tmp_path / "view.json"

    assert preview_view.main(["calendar-home", "empty", "--team", "T123", "--out", str(out)]) == 0

    url = capsys.readouterr().out.strip()
    assert url.startswith("https://app.slack.com/block-kit-builder/T123#")
    assert json.loads(out.read_text()) == calendar_home.SCENARIOS["empty"]()


def test_main_rejects_unknown_scenario():
    with pytest.raises(SystemExit):
        preview_view.main(["calendar-home", "nope"])
