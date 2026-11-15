import copy
import hashlib
import hmac
import json
import logging
import os
import secrets
import time
from datetime import datetime
from logging import Logger
from typing import Any, Dict, List
from urllib.parse import urlencode

import requests
from f3_data_models.models import SlackUser, User
from f3_data_models.utils import DbManager, session_scope
from flask import Request, Response
from slack_sdk import WebClient

from infrastructure.strava_credentials import (
    StravaNotConnectedError,
    StravaOwnershipConflict,
    get_access_token,
    save_connection,
)
from utilities import constants
from utilities.database.orm import SlackSettings
from utilities.helper_functions import parse_rich_block, replace_user_channel_ids, safe_get
from utilities.slack import actions, forms
from utilities.slack import orm as slack_orm

STRAVA_ACTIVITY_BUTTON_LABEL_MAX_LENGTH = 36
STRAVA_OAUTH_STATE_META_KEY = "strava_oauth_state"
STRAVA_OAUTH_STATE_TTL_SECONDS = 30 * 60
STRAVA_STATE_INVALID_MESSAGE = (
    "This Strava link is invalid or has expired. Reopen the Strava option in Slack and try again."
)
STRAVA_EXCHANGE_FAILED_MESSAGE = (
    "Strava did not complete the connection. Reopen the Strava option in Slack and try again."
)


def _hash_state_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def issue_strava_oauth_state(slack_user_pk: int) -> str:
    """Store a fresh single-use OAuth state on the Slack user and return the value to send to Strava.

    Only a hash of the random token is stored; issuing a new state replaces any earlier one.
    """
    token = secrets.token_urlsafe(32)
    with session_scope() as session:
        record = session.get(SlackUser, slack_user_pk, with_for_update=True)
        if record is None:
            raise ValueError("Slack user not found")
        meta = dict(record.meta or {})
        meta[STRAVA_OAUTH_STATE_META_KEY] = {
            "hash": _hash_state_token(token),
            "expires_at": int(time.time()) + STRAVA_OAUTH_STATE_TTL_SECONDS,
        }
        record.meta = meta
    return f"{slack_user_pk}.{token}"


def _reject_state(reason: str, slack_user_pk: int | None = None) -> None:
    # Never log the state, token or stored hash: only the reason and the numeric slack_users.id.
    logging.warning("slack.strava.oauth_state_rejected reason=%s slack_user_pk=%s", reason, slack_user_pk)
    return None


def consume_strava_oauth_state(state: str | None) -> int | None:
    """Validate and use up an OAuth state issued by `issue_strava_oauth_state`.

    Returns the F3 user id linked to the Slack user the state was issued to, or None when the state is
    missing, malformed, unknown, expired or already used. A wrong token leaves the stored state in place
    so a guess can't cancel someone else's pending link.
    """
    if not state:
        return _reject_state("missing")
    pk_str, sep, token = state.partition(".")
    # isdigit() alone accepts non-ASCII digits that int() rejects; 9 digits stays inside a Postgres integer.
    if not sep or not token or not (pk_str.isascii() and pk_str.isdigit()) or len(pk_str) > 9:
        return _reject_state("malformed")
    pk = int(pk_str)

    with session_scope() as session:
        record = session.get(SlackUser, pk, with_for_update=True)
        if record is None:
            return _reject_state("unknown_slack_user", pk)
        meta = dict(record.meta or {})
        pending = meta.get(STRAVA_OAUTH_STATE_META_KEY)
        if not isinstance(pending, dict) or not isinstance(pending.get("hash"), str):
            return _reject_state("no_pending_state", pk)
        if not hmac.compare_digest(pending["hash"], _hash_state_token(token)):
            return _reject_state("token_mismatch", pk)

        del meta[STRAVA_OAUTH_STATE_META_KEY]
        record.meta = meta
        expires_at = pending.get("expires_at")
        if not isinstance(expires_at, (int, float)) or expires_at < time.time():
            return _reject_state("expired", pk)
        if record.user_id is None:
            return _reject_state("slack_user_unlinked", pk)
        return record.user_id


def _json_response(status: int, body: dict) -> Response:
    return Response(json.dumps(body), status=status, content_type="application/json")


def build_strava_auth_blocks(slack_user_record: SlackUser | None) -> list:
    if not (os.environ.get(constants.STRAVA_CLIENT_ID) and os.environ.get(constants.STRAVA_CLIENT_SECRET)):
        return [
            slack_orm.SectionBlock(
                label="Strava client ID and secret are not configured.",  # noqa
            )
        ]
    if slack_user_record is None:
        return [
            slack_orm.SectionBlock(
                label="We couldn't find your F3 profile for this workspace yet. Please try again later.",
            )
        ]

    APP_URL = os.environ.get("APP_URL", "")
    # Built by hand: requests_oauthlib logs the state at DEBUG, and the state is a bearer secret.
    authorization_url = "https://www.strava.com/oauth/authorize?" + urlencode(
        {
            "response_type": "code",
            "client_id": os.environ[constants.STRAVA_CLIENT_ID],
            "redirect_uri": f"{APP_URL}/exchange_token",
            "scope": "read,activity:read,activity:write",
            "state": issue_strava_oauth_state(slack_user_record.id),
        }
    )
    return [
        slack_orm.ImageBlock(
            image_url="https://slackblast-images.s3.amazonaws.com/btn_strava_connectwith_orange.png",
            alt_text="Connect with Strava",
        ),
        slack_orm.ActionsBlock(
            elements=[
                slack_orm.ButtonElement(
                    label="Connect",
                    action=actions.STRAVA_CONNECT_BUTTON,
                    url=authorization_url,
                )
            ]
        ),
        slack_orm.ContextBlock(
            element=slack_orm.ContextElement(
                initial_value="Opens in a new window",
            ),
            action="context",
        ),
    ]


def format_strava_activity_button_label(date_fmt: str, activity_name: str) -> str:
    prefix = f"{date_fmt} - "
    available_name_length = STRAVA_ACTIVITY_BUTTON_LABEL_MAX_LENGTH - len(prefix)
    if len(activity_name) > available_name_length:
        activity_name = f"{activity_name[: available_name_length - 1].rstrip()}…"
    return f"{prefix}{activity_name}"


def build_strava_activity_blocks(
    activities: List[Dict],
    channel_id: str,
    backblast_ts: str,
    backblast_title: str,
) -> List[slack_orm.ActionsBlock]:
    button_elements = []
    for activity in activities:
        date = datetime.strptime(activity["start_date_local"], "%Y-%m-%dT%H:%M:%SZ")
        date_fmt = date.strftime("%m-%d %H:%M")
        button_elements.append(
            slack_orm.ButtonElement(
                label=format_strava_activity_button_label(date_fmt, str(activity["name"])),
                action="-".join([actions.STRAVA_ACTIVITY_BUTTON, str(activity["id"])]),
                value=json.dumps(
                    {
                        actions.STRAVA_ACTIVITY_ID: activity["id"],
                        actions.STRAVA_CHANNEL_ID: channel_id,
                        actions.STRAVA_BACKBLAST_TS: backblast_ts,
                        actions.STRAVA_BACKBLAST_TITLE: backblast_title,
                    }
                ),
            )
        )
    return [slack_orm.ActionsBlock(elements=button_elements)]


def build_strava_form(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    user_id = safe_get(body, "user_id") or safe_get(body, "user", "id")
    team_id = safe_get(body, "team_id") or safe_get(body, "team", "id")
    channel_id = safe_get(body, "channel_id") or safe_get(body, "channel", "id")

    backblast_ts = body["message"]["ts"]
    backblast_meta = safe_get(body, "message", "metadata", "event_payload") or json.loads(
        safe_get(body, "message", "blocks", -1, "elements", 0, "value") or "{}"
    )
    moleskine = body["message"]["blocks"][1]
    moleskine_text = replace_user_channel_ids(parse_rich_block(moleskine), region_record, client, logger)
    if "COT:" in moleskine_text:
        moleskine_text = moleskine_text.split("COT:")[0]
    elif "Announcements" in moleskine_text:
        moleskine_text = moleskine_text.split("Announcements")[0]

    # allow_strava: bool = (
    #     (user_id == backblast_meta[actions.BACKBLAST_Q])
    #     or (user_id in (backblast_meta[actions.BACKBLAST_COQ] or []))
    #     or (user_id in (backblast_meta[actions.BACKBLAST_PAX] or []))
    #     or (user_id in (backblast_meta[actions.BACKBLAST_OP] or []))
    # )
    allow_strava = True

    if allow_strava:
        update_view_id = safe_get(body, actions.LOADING_ID)
        user_records: List[SlackUser] = DbManager.find_records(
            SlackUser, filters=[SlackUser.slack_id == user_id, SlackUser.slack_team_id == team_id]
        )

        if len(user_records) == 0:
            title_text = "Connect Strava"
            strava_blocks = build_strava_auth_blocks(None)
        else:
            title_text = "Choose Activity"
            slack_user_record = user_records[0]
            user: User = DbManager.get(User, slack_user_record.user_id)
            strava_recent_activities = get_strava_activities(user) if user else []

            logger.info("Strava activity lookup completed")
            if len(strava_recent_activities) == 0:
                strava_blocks = [
                    slack_orm.SectionBlock(
                        label="Strava is not connected or no recent activities were found. Log an activity in Strava, or use the button below to connect.",  # noqa
                    ),
                    *build_strava_auth_blocks(slack_user_record),
                ]
            else:
                strava_blocks = build_strava_activity_blocks(
                    activities=strava_recent_activities,
                    channel_id=channel_id,
                    backblast_ts=backblast_ts,
                    backblast_title=backblast_meta["title"],
                )

        strava_form = slack_orm.BlockView(blocks=strava_blocks)

        strava_form.update_modal(
            client=client,
            view_id=update_view_id,
            callback_id=actions.STRAVA_CALLBACK_ID,
            title_text=title_text,
            submit_button_text="None",
            parent_metadata={actions.STRAVA_BACKBLAST_MOLESKINE: moleskine_text[:2500]},
        )
    else:
        client.chat_postEphemeral(
            text="Connecting Strava to this Slackblast is only allowed for the tagged PAX."
            "Please contact one of them to make changes.",
            channel=channel_id,
            user=user_id,
        )


def build_strava_modify_form(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    strava_metadata = json.loads(safe_get(body, "actions", 0, "value") or "{}")
    private_metadata = json.loads(safe_get(body, "view", "private_metadata") or "{}")
    strava_activity_id = strava_metadata[actions.STRAVA_ACTIVITY_ID]
    channel_id = strava_metadata[actions.STRAVA_CHANNEL_ID]
    backblast_ts = strava_metadata[actions.STRAVA_BACKBLAST_TS]
    backblast_title = strava_metadata[actions.STRAVA_BACKBLAST_TITLE]
    backblast_moleskine = private_metadata[actions.STRAVA_BACKBLAST_MOLESKINE]

    view_id = safe_get(body, "container", "view_id")
    backblast_metadata = {
        "strava_activity_id": strava_activity_id,
        "channel_id": channel_id,
        "backblast_ts": backblast_ts,
    }

    activity_description = backblast_moleskine.replace("*", "")
    # remove all text after `COT:` or `COT :` if it exists
    if "COT:" in activity_description:
        activity_description = activity_description.split("COT:")[0]
    activity_description += "\n\nLearn more about F3 at https://f3nation.com"

    modify_form = copy.deepcopy(forms.STRAVA_ACTIVITY_MODIFY_FORM)
    modify_form.set_initial_values(
        {
            actions.STRAVA_ACTIVITY_TITLE: backblast_title,
            actions.STRAVA_ACTIVITY_DESCRIPTION: activity_description,
        }
    )

    modify_form.update_modal(
        client=client,
        view_id=view_id,
        title_text="Modify Strava Activity",
        callback_id=actions.STRAVA_MODIFY_CALLBACK_ID,
        parent_metadata=backblast_metadata,
        submit_button_text="Modify Strava activity",
        close_button_text="Close without modifying",
        notify_on_close=True,
    )


def strava_exchange_token(request: Request) -> Response:
    """Exchanges a Strava auth code for tokens and stores them on the user the OAuth state was issued to."""
    if not os.environ.get(constants.STRAVA_CLIENT_ID) or not os.environ.get(constants.STRAVA_CLIENT_SECRET):
        return _json_response(500, {"error": "Strava client ID or secret not configured."})

    user_id = consume_strava_oauth_state(request.args.get("state"))
    if user_id is None:
        return _json_response(400, {"error": STRAVA_STATE_INVALID_MESSAGE})

    code = request.args.get("code")
    if not code:
        return _json_response(400, {"error": "No code provided."})

    try:
        response = requests.post(
            url="https://www.strava.com/oauth/token",
            data={
                "client_id": os.environ[constants.STRAVA_CLIENT_ID],
                "client_secret": os.environ[constants.STRAVA_CLIENT_SECRET],
                "code": code,
                "grant_type": "authorization_code",
            },
            timeout=10,
        )
        response.raise_for_status()
        response_json = response.json()
    except (requests.RequestException, ValueError) as exc:
        # The response body can hold tokens; log only the failure type and HTTP status.
        status = getattr(getattr(exc, "response", None), "status_code", None)
        logging.warning("slack.strava.token_exchange.failed error_type=%s status=%s", type(exc).__name__, status)
        return _json_response(502, {"error": STRAVA_EXCHANGE_FAILED_MESSAGE})

    try:
        saved = save_connection(user_id, response_json)
    except StravaOwnershipConflict:
        return _json_response(
            409,
            {
                "message": (
                    "This Strava account is already connected to another F3 profile. "
                    "The existing connection has not changed. Please contact support for help."
                )
            },
        )
    except ValueError:
        logging.error("strava.exchange.invalid_provider_response")
        saved = False
    except RuntimeError:
        saved = False
    if not saved:
        return _json_response(503, {"message": "Strava could not be connected right now. Please try again later."})

    return _json_response(200, {"message": "Authorization successful! You can return to Slack."})


def check_and_refresh_strava_token(user: User) -> str | None:
    """Use the isolated connection, refreshing its complete bundle when expired."""

    def refresh(refresh_token: str) -> dict:
        if not os.environ.get(constants.STRAVA_CLIENT_ID) or not os.environ.get(constants.STRAVA_CLIENT_SECRET):
            raise ValueError("Strava application credentials are not configured")
        res = requests.post(
            "https://www.strava.com/api/v3/oauth/token",
            data={
                "client_id": os.environ[constants.STRAVA_CLIENT_ID],
                "client_secret": os.environ[constants.STRAVA_CLIENT_SECRET],
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
            timeout=10,
        )
        res.raise_for_status()
        return res.json()

    return get_access_token(user.id, refresh)


def get_strava_activities(user: User) -> List[Dict]:
    """Get a list of Strava activities for a user."""
    access_token = check_and_refresh_strava_token(user)
    if access_token is None:
        return []
    request_url = "https://www.strava.com/api/v3/athlete/activities"
    res = requests.get(request_url, headers={"Authorization": f"Bearer {access_token}"}, params={"per_page": 10})
    res.raise_for_status()
    data = res.json()
    return data


def update_strava_activity(
    strava_activity_id: str,
    user_id: str,
    team_id: str,
    backblast_title: str,
    backblast_moleskine: str,
) -> Dict[str, Any]:
    """Update a Strava activity.

    Args:
        strava_activity_id (str): Strava activity ID
        user_id (str): Slack user ID
        team_id (str): Slack team ID
        backblast_title (str): Backblast title (used for updating activity name)
        backblast_moleskine (str): Backblast Moleskine (used for updating activity description)

    Returns:
        dict: Updated Strava activity data
    """
    slack_user_records: List[SlackUser] = DbManager.find_records(
        SlackUser, filters=[SlackUser.slack_id == user_id, SlackUser.slack_team_id == team_id]
    )
    slack_user_record = slack_user_records[0]
    user: User = DbManager.get(User, slack_user_record.user_id)

    access_token = check_and_refresh_strava_token(user)
    if access_token is None:
        raise StravaNotConnectedError(
            "Your Strava connection was not found. Use the Strava button on the backblast to reconnect."
        )
    request_url = f"https://www.strava.com/api/v3/activities/{strava_activity_id}"
    res = requests.put(
        request_url,
        headers={"Authorization": f"Bearer {access_token}"},
        json={
            "name": backblast_title,
            "description": backblast_moleskine,
        },
        # data={
        #     "name": backblast_title,
        #     "description": backblast_moleskine,
        # },
    )
    res.raise_for_status()
    data = res.json()
    return data


def get_strava_activity(
    strava_activity_id: str,
    user_id: str,
    team_id: str,
) -> Dict[str, Any]:
    """Get a Strava activity.

    Args:
        strava_activity_id (str): Strava activity ID

    Returns:
        dict: Strava activity data
    """
    slack_user_records: List[SlackUser] = DbManager.find_records(
        SlackUser, filters=[SlackUser.slack_id == user_id, SlackUser.slack_team_id == team_id]
    )
    slack_user_record = slack_user_records[0]
    user: User = DbManager.get(User, slack_user_record.user_id)

    access_token = check_and_refresh_strava_token(user)
    if access_token is None:
        raise StravaNotConnectedError(
            "Your Strava connection was not found. Use the Strava button on the backblast to reconnect."
        )

    request_url = f"https://www.strava.com/api/v3/activities/{strava_activity_id}"
    res = requests.get(
        request_url,
        headers={"Authorization": f"Bearer {access_token}"},
    )
    res.raise_for_status()
    data = res.json()
    return data


def handle_strava_modify(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    strava_data: dict = forms.STRAVA_ACTIVITY_MODIFY_FORM.get_selected_values(body)
    event_type = safe_get(body, "type")
    metadata = json.loads(body["view"]["private_metadata"])
    strava_activity_id = metadata["strava_activity_id"]
    channel_id = metadata["channel_id"]
    backblast_ts = metadata["backblast_ts"]
    user_id = safe_get(body, "user_id") or safe_get(body, "user", "id")
    team_id = safe_get(body, "team_id") or safe_get(body, "team", "id")

    if (event_type != "view_closed") and strava_data:
        activity_data = update_strava_activity(
            strava_activity_id=strava_activity_id,
            user_id=user_id,
            team_id=team_id,
            backblast_title=strava_data[actions.STRAVA_ACTIVITY_TITLE],
            backblast_moleskine=strava_data[actions.STRAVA_ACTIVITY_DESCRIPTION],
        )
    else:
        activity_data = get_strava_activity(strava_activity_id=strava_activity_id, user_id=user_id, team_id=team_id)

    msg = f"<@{user_id}> has connected this backblast to a Strava activity (<https://www.strava.com/activities/{strava_activity_id}|view on Strava>)!"  # noqa
    if (safe_get(activity_data, "calories") is not None) & (safe_get(activity_data, "distance") is not None):
        msg += f" He traveled {round(activity_data['distance'] * 0.00062137, 1)} miles :runner: and burned "
        msg += f"{activity_data['calories']} calories :fire:."
    elif safe_get(activity_data, "calories"):
        msg += f" He burned {activity_data['calories']} calories :fire:."
    elif safe_get(activity_data, "distance"):
        msg += f" He traveled {round(activity_data['distance'] * 0.00062137, 1)} miles :runner:."

    blocks = [
        slack_orm.SectionBlock(
            label=msg,
        ).as_form_field(),
        slack_orm.ImageBlock(
            image_url="https://slackblast-images.s3.amazonaws.com/api_logo_pwrdBy_strava_stack_light.png",
            alt_text="Powered by Strava",
        ).as_form_field(),
    ]

    client.chat_postMessage(
        channel=channel_id,
        thread_ts=backblast_ts,
        text=msg,
        blocks=blocks,
    )
