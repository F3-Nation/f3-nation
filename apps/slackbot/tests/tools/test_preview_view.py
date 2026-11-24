import json
import os
import re
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
    assert "Moneyball" in texts(member) and "Moneyball" not in texts(filters)


def test_capture_payload_returns_message_blocks():
    blocks = [{"type": "section", "text": {"type": "mrkdwn", "text": "hi"}}]

    payload = preview_view.capture_payload(lambda client: client.chat_postMessage(channel="C1", blocks=blocks))

    assert payload == {"blocks": blocks}


def test_capture_payload_returns_the_last_view_sent():
    def render(client):
        client.views_open(trigger_id="T", view={"type": "modal", "blocks": [{"type": "divider"}]})
        client.views_update(view_id="V", view={"type": "modal", "blocks": [], "callback_id": "dropped"})

    assert preview_view.capture_payload(render) == {"type": "modal", "blocks": []}


def test_capture_payload_fails_when_the_preview_reaches_the_database():
    from f3_data_models.utils import get_session

    with pytest.raises(RuntimeError, match="reached the database"):
        preview_view.capture_payload(lambda client: get_session())


def test_capture_payload_raises_when_nothing_is_sent():
    with pytest.raises(RuntimeError, match="no view or message"):
        preview_view.capture_payload(lambda client: None)


@pytest.mark.parametrize(("team", "prefix"), [(None, "/block-kit-builder#"), ("T123", "/block-kit-builder/T123#")])
def test_builder_url_round_trips_the_payload(team, prefix):
    payload = {"blocks": [{"type": "divider"}], "note": "a # & ? b / 50%"}

    url = preview_view.builder_url(payload, team)

    assert prefix in url
    fragment = url.split("#", 1)[1]
    assert re.fullmatch(r"[A-Za-z0-9%._~-]*", fragment)
    assert json.loads(urllib.parse.unquote(fragment)) == payload


def test_main_prints_builder_url_and_writes_out_file(tmp_path, capsys):
    out = tmp_path / "view.json"

    assert preview_view.main(["calendar-home", "empty", "--team", "T123", "--out", str(out)]) == 0

    url = capsys.readouterr().out.strip()
    assert url.startswith("https://app.slack.com/block-kit-builder/T123#")
    assert json.loads(out.read_text()) == calendar_home.SCENARIOS["empty"]()


@pytest.mark.parametrize("argv", [[], ["--list"]])
def test_main_lists_views_and_scenarios(argv, capsys):
    assert preview_view.main(argv) == 0

    assert capsys.readouterr().out.strip() == "calendar-home: member, filters, admin, empty"


def test_main_defaults_to_the_first_scenario(capsys):
    assert preview_view.main(["calendar-home"]) == 0

    assert capsys.readouterr().err.startswith("calendar-home / member:")


def test_main_rejects_unknown_scenario():
    with pytest.raises(SystemExit):
        preview_view.main(["calendar-home", "nope"])
