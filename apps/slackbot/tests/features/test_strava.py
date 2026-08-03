import json

from features.strava import STRAVA_ACTIVITY_BUTTON_LABEL_MAX_LENGTH, build_strava_activity_blocks
from utilities.slack import actions


def test_activity_buttons_truncate_names_and_preserve_selection_payloads() -> None:
    long_name = "Michael took Loki for a walk around the neighborhood before the morning workout"
    activities = [
        {
            "id": 1000 + index,
            "name": long_name if index == 0 else f"Morning Activity {index}",
            "start_date_local": f"2026-08-{index + 1:02d}T05:30:00Z",
        }
        for index in range(10)
    ]

    blocks = build_strava_activity_blocks(
        activities=activities,
        channel_id="C123",
        backblast_ts="1234.5678",
        backblast_title="Test Backblast",
    )
    actions_block = blocks[0].as_form_field()

    assert len(blocks) == 1
    assert actions_block["type"] == "actions"
    assert len(actions_block["elements"]) == 10
    assert all(
        len(button["text"]["text"]) <= STRAVA_ACTIVITY_BUTTON_LABEL_MAX_LENGTH for button in actions_block["elements"]
    )
    assert actions_block["elements"][0]["text"]["text"] == "08-01 05:30 - Michael took Loki for…"
    assert actions_block["elements"][1]["text"]["text"] == "08-02 05:30 - Morning Activity 1"

    first_button = actions_block["elements"][0]
    assert first_button["action_id"] == f"{actions.STRAVA_ACTIVITY_BUTTON}-1000"
    assert json.loads(first_button["value"]) == {
        actions.STRAVA_ACTIVITY_ID: 1000,
        actions.STRAVA_CHANNEL_ID: "C123",
        actions.STRAVA_BACKBLAST_TS: "1234.5678",
        actions.STRAVA_BACKBLAST_TITLE: "Test Backblast",
    }
