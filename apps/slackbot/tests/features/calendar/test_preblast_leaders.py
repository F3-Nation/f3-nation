"""The preblast finds the Q and Co-Qs in the records `build_preblast_info` returns.

Those records are `AttendanceData.model_dump()` dicts, so each test builds them the same way:
a PAX, then a Co-Q, then a Q, so "the first record" is never the Q by accident.
"""

from unittest.mock import MagicMock, patch

import pytest
from f3_data_models.models import Attendance_Type

from application.attendance import AttendanceData
from application.event_instance import EventInstanceData
from application.preblast import PostMode, PreblastPostDecision
from features.calendar import event_preblast
from utilities.slack import actions

EVENT_ID = 42
Q_USER, CO_Q_USER, PAX_USER = 10, 11, 12
SLACK_IDS = {Q_USER: "U10", CO_Q_USER: "U11", PAX_USER: "U12"}
SENDER = "U_SENDER"


def _records(*members: tuple[int, Attendance_Type]) -> list[dict]:
    return [
        AttendanceData(id=n, event_instance_id=EVENT_ID, user_id=user_id, attendance_type=attendance_type).model_dump()
        for n, (user_id, attendance_type) in enumerate(members, start=1)
    ]


WITH_LEADERS = [(PAX_USER, Attendance_Type.pax), (CO_Q_USER, Attendance_Type.co_q), (Q_USER, Attendance_Type.q)]
PAX_ONLY = [(PAX_USER, Attendance_Type.pax)]


def _info(members, preblast_ts=None) -> event_preblast.PreblastInfo:
    return event_preblast.PreblastInfo(
        event_record=EventInstanceData(
            id=EVENT_ID,
            name="The Grind",
            org_id=10,
            start_date="2026-11-02",
            start_time="0530",
            end_time="0615",
            event_type_ids=[5],
            event_tag_ids=[],
            meta={},
            preblast_ts=preblast_ts,
        ),
        attendance_records=_records(*members),
        preblast_blocks=[{"type": "section", "text": {"type": "mrkdwn", "text": "Preblast"}}],
        action_blocks=[],
        attendance_slack_dict=SLACK_IDS,
    )


@pytest.mark.parametrize(
    ("members", "qs", "sent_as"),
    [(WITH_LEADERS, [CO_Q_USER, Q_USER], SLACK_IDS[Q_USER]), (PAX_ONLY, [], SENDER)],
)
def test_send_preblast_posts_as_the_q_and_records_the_leaders(members, qs, sent_as):
    client = MagicMock()
    client.chat_postMessage.return_value = {"ts": "1761800000.000100"}
    svc = MagicMock()
    svc.decide_post_mode.return_value = PreblastPostDecision(
        mode=PostMode.POST_NEW, desired_channel_id="C_AO", posted_channel_id="C_AO", existing_preblast_ts=None
    )

    with (
        patch.object(event_preblast, "build_preblast_info", return_value=_info(members)),
        patch.object(event_preblast, "_build_preblast_service", return_value=svc),
        patch.object(event_preblast, "get_preblast_channel", return_value="C_AO"),
        patch.object(event_preblast, "get_user_names", return_value=(["Q"], [None])) as names,
        patch.object(event_preblast, "get_preblast_action_blocks", return_value=[]) as buttons,
        patch.object(event_preblast, "post_bot_log"),
        patch.object(event_preblast, "update_submission_wait_view"),
    ):
        event_preblast.send_preblast(
            body={"user": {"id": SENDER}, "view": {"id": "V_SUBMIT"}},
            client=client,
            logger=MagicMock(),
            region_record=MagicMock(team_id="T1"),
            event_instance_id=EVENT_ID,
        )

    assert names.call_args.args[0] == [sent_as]
    assert buttons.call_args.kwargs["has_q"] is bool(qs)
    assert client.chat_postMessage.call_args.kwargs["metadata"]["event_payload"]["qs"] == qs


@pytest.mark.parametrize(("members", "qs"), [(WITH_LEADERS, [CO_Q_USER, Q_USER]), (PAX_ONLY, [])])
def test_hc_refresh_records_the_leaders(members, qs):
    client = MagicMock()
    body = {
        "actions": [{"action_id": actions.EVENT_PREBLAST_HC_UN_HC}],
        "user": {"id": SENDER},
        "message": {
            "ts": "1761800000.000100",
            "metadata": {"event_payload": {"event_instance_id": EVENT_ID, "attendees": [], "qs": []}},
        },
    }

    with (
        patch.object(event_preblast, "get_user", return_value=MagicMock(user_id=PAX_USER)),
        patch.object(event_preblast, "_user_is_q", return_value=False),
        patch.object(event_preblast, "_build_preblast_service", return_value=MagicMock()),
        patch.object(event_preblast, "build_preblast_info", return_value=_info(members, 1761800000.0001)),
        patch.object(event_preblast, "get_user_names", return_value=(["Q"], [None])),
        patch.object(event_preblast, "get_preblast_channel", return_value="C_AO"),
        patch.object(event_preblast, "get_preblast_action_blocks", return_value=[]) as buttons,
        patch.object(event_preblast, "post_hc_thread_reply"),
        patch.object(event_preblast, "build_event_preblast_form"),
    ):
        event_preblast.handle_event_preblast_action(body, client, MagicMock(), {}, MagicMock())

    assert buttons.call_args.kwargs["has_q"] is bool(qs)
    assert client.chat_update.call_args.kwargs["metadata"]["event_payload"]["qs"] == qs
