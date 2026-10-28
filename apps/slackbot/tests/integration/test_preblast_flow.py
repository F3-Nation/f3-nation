"""A Q posts a preblast from /preblast, end to end: real Bolt app, real F3 API, real database, fake Slack."""

import json

from sqlalchemy import text

from utilities.slack import actions


def _rich_text(message: str) -> dict:
    return {
        "type": "rich_text",
        "elements": [{"type": "rich_text_section", "elements": [{"type": "text", "text": message}]}],
    }


def test_q_posts_preblast_for_upcoming_event(f3_stack, fake_slack, slack, workspace, seed_q_event):
    event_id = seed_q_event(days_out=3)

    # /preblast opens a modal listing the events this user is Q for.
    assert slack.command("/preblast").status == 200
    (opened,) = fake_slack.calls_to("views.open")
    view_id = opened.response["view"]["id"]
    selector = fake_slack.views[view_id]
    assert selector["callback_id"] == actions.EVENT_PREBLAST_SELECT_CALLBACK_ID

    # Picking the event replaces the selector with the preblast form, loaded through the API.
    assert slack.click_button(selector, f"{actions.EVENT_PREBLAST_FILL_BUTTON}_{event_id}").status == 200
    form = fake_slack.views[view_id]
    assert form["callback_id"] == actions.EVENT_PREBLAST_CALLBACK_ID
    assert json.loads(form["private_metadata"])["event_instance_id"] == event_id

    # Submitting with "Send now" swaps in a wait view, then posts to the region's preblast channel.
    response = slack.submit_view(
        form,
        {
            actions.EVENT_PREBLAST_SEND_OPTIONS: "Send now",
            actions.EVENT_PREBLAST_MOLESKINE_EDIT: _rich_text("Bring a coupon. We run at 0530 sharp."),
        },
    )
    assert response.status == 200
    assert json.loads(response.body)["response_action"] == "update"

    (post,) = [c for c in fake_slack.calls_to("chat.postMessage") if c.args["channel"] == workspace.preblast_channel]
    assert post.args["metadata"]["event_payload"]["event_instance_id"] == event_id
    assert "Bring a coupon" in json.dumps(post.args["blocks"])

    # The API saved the preblast text and the posted message's ts on the event.
    with f3_stack.engine.connect() as conn:
        saved = conn.execute(
            text("SELECT preblast, preblast_ts FROM event_instances WHERE id = :id"), {"id": event_id}
        ).one()
    assert "Bring a coupon" in saved.preblast
    assert saved.preblast_ts == float(post.response["ts"])

    # The user is told it worked.
    assert fake_slack.views[view_id]["title"]["text"] == "Complete!"
