import copy
import dataclasses
import hashlib
import io
import json
import logging
import os
import re
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime
from logging import Logger
from typing import Any, Dict, List, Tuple

import pytz
import requests
from f3_data_models.models import (
    Location,
    Org,
    Org_x_SlackSpace,
    Role,
    Role_x_User_x_Org,
    SlackSpace,
    SlackUser,
    User,
)
from f3_data_models.utils import DbManager, session_scope
from slack_bolt.oauth.oauth_settings import OAuthSettings
from slack_sdk.errors import SlackApiError
from slack_sdk.oauth.installation_store import FileInstallationStore
from slack_sdk.oauth.state_store import FileOAuthStateStore
from slack_sdk.web import SlackResponse, WebClient
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert

from utilities import constants, storage
from utilities.constants import LOCAL_DEVELOPMENT
from utilities.database.orm import SlackSettings

REGION_RECORDS: Dict[str, SlackSettings] = {}
SLACK_USERS: Dict[tuple[str, str], SlackUser] = {}


def get_location_display_name(location: Location) -> str:
    if location.name != "":
        return location.name
    elif location.description or "" != "":
        return location.description[:30]
    elif location.address_street or "" != "":
        return location.address_street[:30]
    else:
        return "Unnamed Location"


@dataclass
class MapUpdateData:
    eventId: int | None = None
    locationId: int | None = None
    orgId: int | None = None


@dataclass
class MapUpdate:
    """
    Sample payload:
    {
        "version": "1.0",
        "timestamp": "2025-05-07T19:45:12Z",
        "action": "map.updated", // OR map.created / map.deleted
        "data": {
            "eventId":   1123,   // may be null / omitted
            "locationId": 987,   // may be null / omitted
            "orgId":     null.   // may be null / omitted
        } // likely in the future I will send the actual data here too (like new address)
    }
    """

    version: str
    timestamp: str
    action: str
    source: str
    data: MapUpdateData


def trigger_map_revalidation(logger: Logger, action: str = None, map_update_data: MapUpdateData = None) -> bool:
    if action and map_update_data:
        update_info = MapUpdate(
            version="1.0",
            timestamp=datetime.now(pytz.utc).isoformat(),
            action=action,
            source="slackbot",
            data=map_update_data,
        )
    else:
        update_info = None

    if not os.environ.get("MAP_REVALIDATION_URL"):
        logger.info(
            f"Map revalidation URL not set. Would have sent: {dataclasses.asdict(update_info) if update_info else 'No data'}"  # noqa
        )
        return True

    try:
        response = requests.post(
            url=os.environ.get("MAP_REVALIDATION_URL"),
            headers={
                "Content-Type": "application/json",
                "x-api-key": os.environ.get("MAP_REVALIDATION_KEY"),
            },
            data=json.dumps(dataclasses.asdict(update_info)) if update_info else None,
        )
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"Error triggering map revalidation: {e}")
        return False
    return True


def get_oauth_settings():
    if LOCAL_DEVELOPMENT:
        return None
    else:
        return OAuthSettings(
            client_id=os.environ[constants.SLACK_CLIENT_ID],
            client_secret=os.environ[constants.SLACK_CLIENT_SECRET],
            scopes=os.environ[constants.SLACK_SCOPES].split(","),
            installation_store=FileInstallationStore(base_dir="/mnt/oauth_installations"),
            state_store=FileOAuthStateStore(expiration_seconds=600, base_dir="/mnt/oauth_states"),
        )


def safe_get(data, *keys):
    if data is None:
        return None
    try:
        result = data
        for k in keys:
            # List/tuple index access
            if isinstance(k, int) and isinstance(result, (list, tuple)):
                if 0 <= k < len(result):
                    result = result[k]
                else:
                    return None
                continue
            # SQLAlchemy Row index access (also supports integer indexing)
            if isinstance(k, int) and hasattr(result, "_mapping"):
                if 0 <= k < len(result):
                    result = result[k]
                else:
                    return None
                continue
            # Dict access
            elif isinstance(result, dict) or isinstance(result, SlackResponse):
                if k in result:
                    result = result[k]
                else:
                    return None
                continue
            # SQLAlchemy Row (mapping interface)
            elif hasattr(result, "_mapping"):
                mapping = result._mapping
                if k in mapping:
                    result = mapping[k]
                else:
                    return None
                continue
            # Fallback: attribute access
            elif hasattr(result, k):
                result = getattr(result, k)
            else:
                return None
        return result
    except (KeyError, IndexError, TypeError):
        return None


def is_deactivated_slack_user(slack_user_info: dict) -> bool:
    """Return True when a Slack user payload represents a deactivated account."""
    return bool(safe_get(slack_user_info, "deleted"))


def get_pax(pax):
    p = ""
    for x in pax:
        p += "<@" + x + "> "
    return p


def get_channel_names(
    array_of_channel_ids,
    logger: Logger,
    client: WebClient,
):
    names = []
    channel_records = client.conversations_list().get("channels")

    for channel_id in array_of_channel_ids:
        channel = [u for u in channel_records if u.get("id") == channel_id]
        if channel:
            channel_name = channel[0].get("name")
        else:
            channel_info_dict = client.conversations_info(channel=channel_id)
            channel_name = safe_get(channel_info_dict, "channel", "name") or None
        if channel_name:
            names.append(channel_name)

    return names


def get_channel_id(name, logger, client):
    channel_info_dict = client.conversations_list()
    channels = channel_info_dict["channels"]
    for channel in channels:
        if channel["name"] == name:
            return channel["id"]
    return None


def get_user_names(
    array_of_user_ids,
    logger,
    client: WebClient,
    return_urls=False,
    *,
    team_id: str,
):
    names = []
    urls = []

    for user_id in array_of_user_ids:
        user: SlackUser = SLACK_USERS.get((team_id, user_id))
        if user:
            names.append(user.user_name)
            urls.append(user.avatar_url)
        else:
            names.append(user_id)
            urls.append(None)

    if return_urls:
        return names, urls
    else:
        return names


def slack_identity_error_context(team_id: str, error: Exception) -> dict[str, str]:
    slack_error = None
    if isinstance(error, SlackApiError):
        try:
            response = error.response
            data = getattr(response, "data", response)
            slack_error = data.get("error") if isinstance(data, Mapping) else None
        except Exception:
            # Diagnostics must not replace the caller's recovery path with another failure.
            slack_error = None
    if slack_error not in (
        "invalid_auth",
        "token_revoked",
        "ratelimited",
        "missing_scope",
        "user_not_found",
        "account_inactive",
        "not_authed",
    ):
        slack_error = "other"
    error_type = type(error).__name__
    return {
        "team_id": team_id if isinstance(team_id, str) and re.fullmatch(r"T[A-Z0-9_]{1,63}", team_id) else "other",
        "error_type": error_type if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", error_type) else "Exception",
        "slack_error": slack_error,
    }


def get_user(slack_user_id: str, region_record: SlackSettings, client: WebClient, logger: Logger) -> SlackUser:
    if not slack_user_id:
        raise ValueError("Slack user ID is required")
    team_id = safe_get(region_record, "team_id")
    if not team_id:
        raise ValueError("Slack team ID is required")
    if not constants.is_production_deployment():
        if not SLACK_USERS:
            update_local_slack_users()
        cached_user: SlackUser | None = SLACK_USERS.get((team_id, slack_user_id))
        if cached_user and safe_get(cached_user, "user_id"):
            return cached_user
        return create_user({"id": slack_user_id}, region_record.org_id, team_id=team_id)

    if not SLACK_USERS:
        update_local_slack_users()

    user: SlackUser | None = SLACK_USERS.get((team_id, slack_user_id))
    # A cached row with no user_id has no F3 user yet; resolve it like a new member so create_user links it.
    if not user or not safe_get(user, "user_id"):
        try:
            user_info = client.users_info(user=slack_user_id)
            # Slack may send "profile": null, which setdefault would keep.
            profile = user_info["user"]["profile"] = user_info["user"].get("profile") or {}
            # Carry a cached non-bot member’s email into identity resolution when Slack omits it,
            # preserving email-based matching.
            if user and not safe_get(user, "is_bot") and safe_get(user, "email") and not safe_get(profile, "email"):
                profile["email"] = safe_get(user, "email")
            slack_user_record = create_user(user_info["user"], region_record.org_id, team_id=team_id)
        except Exception as error:
            if user:
                # A Slack or database failure here must not break requests that used to get this cached row.
                # It is still unlinked, so callers must cope with user_id being None.
                context = slack_identity_error_context(team_id, error)
                logging.getLogger(__name__).warning(
                    "slack.identity.cached_link_failed team_id=%s error_type=%s slack_error=%s",
                    context["team_id"],
                    context["error_type"],
                    context["slack_error"],
                    extra={"json_fields": {"event": "slack.identity.cached_link_failed", **context}},
                )
                return user
            raise

        SLACK_USERS[(team_id, slack_user_id)] = slack_user_record
        return slack_user_record
    else:
        return user


def _parse_view_private_metadata(body: dict) -> dict:
    """Slack may send private_metadata as a dict, JSON string, or double-encoded JSON string."""
    raw = safe_get(body, "view", "private_metadata")

    if raw in (None, "", {}):
        return {}

    if isinstance(raw, dict):
        return raw

    value = raw
    try:
        # Try up to 2 decoding passes (handles values like "\"{\\\"event_instance_id\\\": 441}\"").
        for _ in range(2):
            if isinstance(value, str):
                value = json.loads(value)
            else:
                break
    except (TypeError, json.JSONDecodeError):
        return {}

    return value if isinstance(value, dict) else {}


def create_user(slack_user_info: dict, home_region_id: int | None = None, team_id: str | None = None) -> SlackUser:
    slack_id = safe_get(slack_user_info, "id")
    if not slack_id:
        raise ValueError("Slack user ID is required")
    resolved_team_id = team_id or safe_get(slack_user_info, "team_id")
    if not resolved_team_id:
        raise ValueError("Slack team ID is required")

    pair = json.dumps([resolved_team_id, slack_id], separators=(",", ":"))
    lock_key = int.from_bytes(hashlib.sha256(pair.encode("utf-8")).digest()[:8], "big", signed=True)
    with session_scope() as session:
        session.execute(text("SELECT pg_advisory_xact_lock(:lock_key)"), {"lock_key": lock_key})
        pair_query = (
            select(SlackUser)
            .where(SlackUser.slack_id == slack_id, SlackUser.slack_team_id == resolved_team_id)
            .order_by(SlackUser.slack_updated.desc().nulls_last(), SlackUser.id.asc())
        )
        slack_user_record = session.scalars(pair_query).first()
        if not slack_user_record or slack_user_record.user_id is None:
            if not constants.is_production_deployment():
                # The provisional address contains no Slack-supplied data and is
                # finalized in the same transaction as the identity link.
                provisional_email = f"dev.staging-email-sink+pending-{uuid.uuid4().hex}@f3nation.com"
                user_record = User(email=provisional_email, f3_name="F3 pending", home_region_id=home_region_id)
                session.add(user_record)
                session.flush()
                user_record.email = f"dev.staging-email-sink+{user_record.id}@f3nation.com"
                user_record.f3_name = f"F3 {user_record.id}"
                identity_fields = {
                    "email": user_record.email,
                    "user_name": user_record.f3_name,
                    "avatar_url": None,
                    "is_admin": False,
                    "is_owner": False,
                    "is_bot": False,
                }
            else:
                email = safe_get(slack_user_info, "profile", "email")
                if not email and slack_user_record and not slack_user_record.is_bot:
                    email = slack_user_record.email
                email = (email or slack_id).lower()
                user_name = safe_get(slack_user_info, "profile", "display_name") or safe_get(
                    slack_user_info, "profile", "real_name"
                )
                # Different workspace pairs can concurrently identify the same F3
                # user; CIText uniqueness arbitrates before the following select.
                session.execute(
                    insert(User)
                    .values(email=email, f3_name=user_name, home_region_id=home_region_id)
                    .on_conflict_do_nothing(index_elements=[User.email])
                )
                user_record = session.scalars(select(User).where(User.email == email)).one()
                identity_fields = {
                    "email": email,
                    "user_name": user_name,
                    "avatar_url": safe_get(slack_user_info, "profile", "image_192"),
                    "is_admin": safe_get(slack_user_info, "is_admin") or False,
                    "is_owner": safe_get(slack_user_info, "is_owner") or False,
                    "is_bot": safe_get(slack_user_info, "is_bot") or False,
                    "slack_updated": safe_convert(slack_user_info.get("updated"), int),
                }

            if not slack_user_record:
                session.execute(
                    insert(SlackUser)
                    .values(slack_id=slack_id, slack_team_id=resolved_team_id, **identity_fields)
                    .on_conflict_do_nothing(index_elements=[SlackUser.slack_id, SlackUser.slack_team_id])
                )
                slack_user_record = session.scalars(pair_query).one()
            if slack_user_record.user_id is None:
                slack_user_record.user_id = user_record.id
                if not constants.is_production_deployment():
                    for field in ("email", "user_name", "avatar_url"):
                        setattr(slack_user_record, field, identity_fields[field])
            session.flush()
            session.expunge(user_record)

        # Detach before commit expires attributes; only a successful commit may
        # publish the resolved identity to the process-local cache.
        session.expunge(slack_user_record)

    SLACK_USERS[(resolved_team_id, slack_id)] = slack_user_record
    return slack_user_record


def update_local_slack_users(slack_user: SlackUser = None) -> None:
    print("Updating local slack users...")

    if slack_user:
        SLACK_USERS[(slack_user.slack_team_id, slack_user.slack_id)] = slack_user
        return
    slack_users: List[SlackUser] = DbManager.find_records(SlackUser, filters=[True])
    selected = {}
    for user in sorted(
        slack_users,
        key=lambda user: (
            safe_get(user, "slack_updated") is None,
            -(safe_get(user, "slack_updated") or 0),
            safe_get(user, "id") or 0,
        ),
    ):
        selected.setdefault((user.slack_team_id, user.slack_id), user)
    SLACK_USERS.clear()
    SLACK_USERS.update(selected)


def get_region_record(team_id: str, body, context, client, logger) -> SlackSettings:
    if not REGION_RECORDS:
        update_local_region_records()

    region_record: SlackSettings | None = safe_get(REGION_RECORDS, team_id)
    team_domain = safe_get(body, "team", "domain")

    if not region_record:
        try:
            team_info = client.team_info()
            team_name = team_info["team"]["name"]
        except Exception:
            team_name = team_domain

        org_record = DbManager.find_first_record(
            Org, [Org.slack_space.has(SlackSpace.team_id == team_id)], joinedloads=[Org.slack_space]
        )

        settings_starters = {
            "team_id": team_id,
            "bot_token": context["bot_token"],
            "workspace_name": team_name,
        }
        region_record = SlackSettings(**settings_starters)
        if org_record:
            settings_starters.update({"org_id": org_record.id})
            region_record = SlackSettings(**settings_starters)

        slack_space_record = SlackSpace(
            team_id=team_id,
            workspace_name=team_name,
            bot_token=context["bot_token"],
            settings=region_record.__dict__,
        )
        slack_space_record: SlackSpace = DbManager.create_record(slack_space_record)

        if org_record and LOCAL_DEVELOPMENT:
            # Connect the org to the slack space
            DbManager.create_record(
                Org_x_SlackSpace(
                    org_id=org_record.id,
                    slack_space_id=slack_space_record.id,
                )
            )
            # Make the current user an admin of the org
            user_id = get_user(
                safe_get(body, "user_id") or safe_get(body, "user", "id"), region_record, client, logger
            ).user_id
            admin_role_id = DbManager.find_first_record(Role, filters=[Role.name == "admin"]).id
            DbManager.create_record(
                Role_x_User_x_Org(
                    user_id=user_id,
                    org_id=org_record.id,
                    role_id=admin_role_id,
                )
            )

        REGION_RECORDS[team_id] = region_record

        org_id = org_record.id if org_record else None
        populate_users(client, team_id, org_id)

    else:
        # Update the bot token if it has changed
        if context.get("bot_token") and context.get("bot_token") != region_record.bot_token:
            region_record.bot_token = context["bot_token"]
            DbManager.update_record(
                SlackSpace,
                safe_get(DbManager.find_first_record(SlackSpace, filters=[SlackSpace.team_id == team_id]), "id"),
                {SlackSpace.settings: region_record.__dict__, SlackSpace.bot_token: context["bot_token"]},
            )
            REGION_RECORDS[team_id] = region_record

    return region_record


def populate_users(client: WebClient, team_id: str, org_id: int = None) -> None:
    if not constants.is_production_deployment():
        return
    if not team_id:
        raise ValueError("Slack team ID is required")

    users = client.users_list().get("members") or []
    active_users = []
    for u in users:
        user_id = safe_get(u, "id")
        if not user_id or user_id == "USLACKBOT":
            continue
        if is_deactivated_slack_user(u):
            continue
        active_users.append(u)

    user_list = [
        User(
            f3_name=u["profile"]["display_name"] or u["profile"]["real_name"],
            email=u["profile"].get("email") or u["id"],
            avatar_url=u["profile"].get("image_192"),
            home_region_id=org_id,
        )
        for u in active_users
    ]
    DbManager.create_or_ignore(User, user_list)

    users_all: List[User] = DbManager.find_records(User, filters=[True])
    users_dict = {u.email.lower(): u.id for u in users_all}

    slack_user_list = [
        SlackUser(
            slack_id=u["id"],
            user_id=users_dict.get((u["profile"].get("email") or u["id"]).lower()),
            user_name=u["profile"]["display_name"] or u["profile"]["real_name"],
            email=u["profile"].get("email") or u["id"],
            avatar_url=u["profile"]["image_192"],
            slack_team_id=team_id,
            is_admin=u.get("is_admin") or False,
            is_owner=u.get("is_owner") or False,
            is_bot=u.get("is_bot") or False,
            slack_updated=safe_convert(safe_get(u, "updated"), int),
        )
        for u in active_users
    ]
    DbManager.create_or_ignore(SlackUser, slack_user_list)
    update_local_slack_users()


def get_request_type(body: dict) -> Tuple[str]:
    from utilities import routing

    request_type = safe_get(body, "type")
    if request_type == "event_callback":
        return ("event_callback", safe_get(body, "event", "type"))
    elif request_type == "block_actions":
        block_action = safe_get(body, "actions", 0, "action_id")
        for action in routing.ACTION_PREFIXES:
            if block_action[: len(action)] == action:
                return ("block_actions", action)
        return ("block_actions", block_action)
    elif request_type == "view_submission":
        return ("view_submission", safe_get(body, "view", "callback_id"))
    elif not request_type and "command" in body:
        return ("command", safe_get(body, "command"))
    elif request_type == "view_closed":
        return ("view_closed", safe_get(body, "view", "callback_id"))
    elif request_type == "block_suggestion":
        return ("block_suggestion", safe_get(body, "action_id"))
    elif request_type == "shortcut":
        return ("shortcut", safe_get(body, "callback_id"))
    else:
        return ("unknown", "unknown")


def update_local_region_records() -> None:
    print("Updating local region records...")
    slack_space_records: List[SlackSpace] = DbManager.find_records(SlackSpace, filters=[True])
    region_records = []
    for slack_space in slack_space_records:
        settings = safe_get(slack_space, "settings")
        if isinstance(settings, str):
            try:
                settings = json.loads(settings)
            except (TypeError, json.JSONDecodeError):
                settings = None

        team_id = safe_get(slack_space, "team_id")
        if not isinstance(settings, Mapping) or not settings.get("team_id") or settings.get("team_id") != team_id:
            logging.getLogger(__name__).warning("Skipping Slack workspace with invalid settings")
            continue

        try:
            region_records.append(SlackSettings(**settings))
        except (TypeError, ValueError):
            logging.getLogger(__name__).warning("Skipping Slack workspace with invalid settings")

    global REGION_RECORDS
    REGION_RECORDS.clear()
    REGION_RECORDS.update({region.team_id: region for region in region_records})


def parse_rich_block(
    # client: WebClient,
    # logger: Logger,
    block: Dict[str, Any],
    # parse_users: bool = True,
    # parse_channels: bool = True,
    # region_record: Region = None,
    *,
    escape_text: bool = False,
) -> str:
    """Extracts the plain text representation from a rich text block.

    Args:
        client (WebClient): Slack client
        logger (Logger): Logger
        block (Dict[str, Any]): Block to parse
        parse_users (bool, optional): If True, user mentions will be parsed to their name. Defaults to True.
        parse_channels (bool, optional): If True, channel mentions will be parsed to its name. Defaults to True.
        escape_text (bool, optional): If True, literal text is escaped with ``escape_mrkdwn``, so a typed
            ``<!channel>`` stays literal when the result is sent as mrkdwn; user and channel elements
            still become working mentions. Defaults to False.

    Returns:
        str: Extracted plain text
    """

    def process_text_element(text, element):
        msg = ""
        if element["type"] == "rich_text_quote":
            msg += '"'
        if text["type"] == "text":
            msg += escape_mrkdwn(text["text"]) if escape_text else text["text"]
        if text["type"] == "emoji":
            msg += f":{text['name']}:"
        if text["type"] == "link":
            msg += text["url"]
        if text["type"] == "user":
            msg += f"<@{text['user_id']}>"
        if text["type"] == "channel":
            msg += f"<#{text['channel_id']}>"
        if element["type"] == "rich_text_quote":
            msg += '"'
        return msg

    # user_list = []
    # channel_list = []
    # user_index = 0
    # channel_index = 0

    msg = ""

    for element in safe_get(block, "elements") or []:
        if element["type"] in ["rich_text_section", "rich_text_preformatted", "rich_text_quote"]:
            for text in element["elements"]:
                msg += process_text_element(text, element)
        elif element["type"] == "rich_text_list":
            for list_num, item in enumerate(element["elements"]):
                line_msg = ""
                for text in item["elements"]:
                    line_msg += process_text_element(text, item)
                line_start = f"{list_num + 1}. " if element["style"] == "ordered" else "- "  # TODO: handle nested lists
                msg += f"{line_start}{line_msg}\n"
    return msg


def replace_user_channel_ids(
    text: str,
    region_record: SlackSettings,
    client: WebClient,
    logger: Logger,
) -> str:
    """Replace user and channel ids with their names

    Args:
        text (str): text with slack ids
        region_record (Region): region record
        client (WebClient): slack client
        logger (Logger): logger

    Returns:
        str: text with slack ids replaced
    """

    USER_PATTERN = r"<@([A-Z0-9]+)>"
    CHANNEL_PATTERN = r"<#([A-Z0-9]+)(?:\|[A-Za-z\d]+)?>"

    text = text.replace("{}", "")

    slack_user_ids = re.findall(USER_PATTERN, text or "")
    slack_user_names = get_user_names(slack_user_ids, logger, client, return_urls=False, team_id=region_record.team_id)
    text = re.sub(USER_PATTERN, "{}", text)
    text = text.format(*slack_user_names)

    slack_channel_ids = re.findall(CHANNEL_PATTERN, text or "")
    slack_channel_names = get_channel_names(slack_channel_ids, logger, client)

    text = re.sub(CHANNEL_PATTERN, "{}", text)
    text = text.format(*slack_channel_names)

    return text


def replace_rich_text_user_channel(
    block: Dict[str, Any],
    region_record: SlackSettings,
    client: WebClient,
    logger: Logger,
) -> Dict[str, Any]:
    """Replace user and channel ids with their names in a rich text block

    Args:
        block (Dict[str, Any]): rich text block with slack ids
        region_record (SlackSettings): region record
        client (WebClient): slack client
        logger (Logger): logger

    Returns:
        block (Dict[str, Any]): rich text block with slack ids replaced
    """
    new_block = copy.deepcopy(block)

    if not new_block or new_block.get("type") != "rich_text":
        return new_block

    for element in safe_get(new_block, "elements") or []:
        if element["type"] in ["rich_text_section", "rich_text_preformatted", "rich_text_quote"]:
            for text in element["elements"]:
                if text["type"] == "user":
                    user_name = get_user_names(
                        [text["user_id"]], logger, client, return_urls=False, team_id=region_record.team_id
                    )[0]
                    text["text"] = f"@{user_name}"
                    text["type"] = "text"
                    del text["user_id"]
                elif text["type"] == "channel":
                    channel_name = get_channel_names([text["channel_id"]], logger, client)[0]
                    text["text"] = f"#{channel_name}"
                    text["type"] = "text"
                    del text["channel_id"]

    return new_block


def fix_from_llm_tags(block: Dict[str, Any]) -> Dict[str, Any]:
    """Removes the 'from_llm' tag that Slack adds in the Android app to rich text blocks

    Args:
        block (Dict[str, Any]): rich text block with potential 'from_llm' tags

    Returns:
        Dict[str, Any]: rich text block with 'from_llm' tags removed
    """

    if not block or block.get("type") != "rich_text":
        return block

    for element in safe_get(block, "elements") or []:
        if element["type"] in ["rich_text_section", "rich_text_preformatted", "rich_text_quote"]:
            for text in element["elements"]:
                if text.get("from_llm") is not None:
                    del text["from_llm"]

    return block


def plain_text_to_rich_block(text: str) -> Dict[str, Any]:
    """Converts plain text to a rich text block

    Args:
        text (str): plain text

    Returns:
        Dict[str, Any]: rich text block
    """

    # split out bolded text using *
    split_text = re.split(r"(\*.*?\*)", text)
    text_elements = [
        (
            {"type": "text", "text": s.replace("*", ""), "style": {"bold": True}}
            if s.startswith("*")
            else {"type": "text", "text": s}
        )
        for s in split_text
    ]

    # now convert emojis
    final_text_elements = []
    for element in text_elements:
        if element["type"] == "text" and not element.get("style"):
            split_emoji_text = re.split(r"(:\S*?:)", element["text"])
            emoji_elements = [
                (
                    {"type": "emoji", "name": s.replace(":", "")}
                    if s.startswith(":") and s.endswith(":")
                    else {"type": "text", "text": s}
                )
                for s in split_emoji_text
            ]
            final_text_elements.extend(emoji_elements)
        else:
            final_text_elements.append(element)

    final_text_elements = [e for e in final_text_elements if e.get("text") != ""]

    return {
        "type": "rich_text",
        "elements": [
            {
                "type": "rich_text_section",
                "elements": final_text_elements,
            }
        ],
    }


def remove_keys_from_dict(d, keys_to_remove):
    if isinstance(d, dict):
        return {
            key: remove_keys_from_dict(value, keys_to_remove) for key, value in d.items() if key not in keys_to_remove
        }
    elif isinstance(d, list):
        return [remove_keys_from_dict(item, keys_to_remove) for item in d]
    else:
        return d


def safe_convert(value: str | None, conversion, args: list = None, default=None):
    """
    Safely apply conversion to value.
    Returns default (None unless specified) when:
      - value is None or empty string
      - conversion raises TypeError or ValueError (e.g., int(""), json.loads(""))
    """
    if value is None or value == "":
        return default
    args = args or []
    try:
        return conversion(value, *args)
    except (TypeError, ValueError):
        return default


def time_int_to_str(time: int) -> str:
    return f"{time // 100:02d}:{time % 100:02d}"


def time_str_to_int(time: str) -> int:
    return int(time.replace(":", ""))


def current_date_cst() -> date:
    """Returns the current date in US/Central timezone."""
    return datetime.now(pytz.timezone("US/Central")).date()


def escape_mrkdwn(text: str) -> str:
    """Escape the characters Slack treats as control sequences in mrkdwn (`<!channel>`, `<@U…>`, links)."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def upload_files_to_storage(
    files: List[Dict[str, str]],
    client: WebClient,
    logger: Logger,
    enforce_square: bool = False,
    max_height: int = None,
    bucket_name: str = None,
    file_name: str = None,
    enforce_png: bool = False,
) -> Tuple[List[str], List[Dict[str, Any]], List[str], List[str]]:
    """Copy Slack-hosted files into storage under ``bucket_name`` (a storage directory).

    Returns the stored files' public URLs, email attachments (``content`` and ``meta``),
    the Slack file ids, and the public URLs of the low-resolution copies. A file that
    fails is logged and left out of every list except the Slack file ids, which hold
    every input file. Copies of it already stored are deleted only when ``file_name``
    is unset; under a caller-chosen ``file_name`` they stay, because they replace an
    object a saved URL may point to.
    """
    file_list = []
    file_send_list = []
    file_ids = [file["id"] for file in files]
    low_res_file_list = []
    from PIL import Image

    bucket_name = bucket_name or "backblast-images"

    for file in files or []:
        stored_names = []
        try:
            r_full = requests.get(file["url_private_download"], headers={"Authorization": f"Bearer {client.token}"})
            r_full.raise_for_status()

            file_id = file_name or file["id"]
            current_file_name = f"{file_id}.{file['filetype']}"
            file_mimetype = file["mimetype"]
            content = r_full.content

            # Determine the highest thumbnail size possible
            thumb_sizes = [64, 80, 160, 360, 480, 720, 800, 960, 1024]
            # Find the largest thumbnail that actually exists in the file object
            available_thumbs = [size for size in thumb_sizes if f"thumb_{size}" in file]
            thumb_size = max(available_thumbs) if available_thumbs else None

            low_res_content = None
            if thumb_size is not None:
                # The thumbnail is optional: a failed download still stores the full-size file.
                try:
                    r_low_res = requests.get(
                        file[f"thumb_{thumb_size}"],
                        headers={"Authorization": f"Bearer {client.token}"},
                        params={"width": constants.LOW_REZ_IMAGE_SIZE, "height": constants.LOW_REZ_IMAGE_SIZE},
                    )
                except requests.RequestException as e:
                    logger.error(f"Error downloading thumbnail for file {file['id']}: {e}")
                else:
                    if r_low_res.ok:
                        low_res_content = r_low_res.content
                    else:
                        logger.error(f"Error downloading thumbnail for file {file['id']}: HTTP {r_low_res.status_code}")

            change_to_png = enforce_png and file["filetype"] != "png"
            if enforce_square or max_height or change_to_png:
                img = None
                if file_mimetype.startswith("image/"):
                    try:
                        img = Image.open(io.BytesIO(content))
                    except Exception as e:
                        logger.error(f"Error opening image: {e}")

                # If we have an image, apply enforce_square and max_height
                if img is not None:
                    source_format = img.format
                    # Enforce square if requested
                    if enforce_square:
                        max_side = max(img.width, img.height)
                        new_img = Image.new("RGB", (max_side, max_side), (0, 0, 0))
                        paste_x = (max_side - img.width) // 2
                        paste_y = (max_side - img.height) // 2
                        new_img.paste(img, (paste_x, paste_y))
                        img = new_img
                    # Downscale to max_height if provided (after squaring)
                    if max_height is not None and img.height > max_height:
                        img = img.resize((max_height, max_height), Image.LANCZOS)
                    # Re-encode the possibly modified image
                    img_format = "PNG" if file["filetype"] == "heic" or change_to_png else source_format
                    if img_format == "PNG" and not current_file_name.endswith(".png"):
                        current_file_name = f"{file_id}.png"
                        file_mimetype = "image/png"
                    buffer = io.BytesIO()
                    img.save(buffer, format=img_format, quality=95, optimize=True)
                    content = buffer.getvalue()

            # Nothing is added to the returned lists until every copy is stored, so a
            # failure never returns a thumbnail without its full-size file.
            file_url = storage.write_bytes(bucket_name, current_file_name, content, file_mimetype)
            stored_names.append(current_file_name)
            low_res_url = None
            if low_res_content is not None:
                low_res_name = f"{file_id}_low_res.png"
                low_res_url = storage.write_bytes(bucket_name, low_res_name, low_res_content, "image/png")
                stored_names.append(low_res_name)

            file_list.append(file_url)
            if low_res_url is not None:
                low_res_file_list.append(low_res_url)
            file_send_list.append(
                {
                    "content": content,
                    "meta": {
                        "filename": current_file_name,
                        "maintype": file_mimetype.split("/")[0],
                        "subtype": file_mimetype.split("/")[1],
                    },
                }
            )
        except Exception as e:
            logger.error(f"Error uploading file: {e}")
            # A caller-chosen file_name replaces an object a saved URL may already point
            # to, so only per-upload names (Slack file IDs) are safe to delete.
            for name in stored_names if file_name is None else []:
                try:
                    storage.delete(bucket_name, name)
                except FileNotFoundError:
                    pass
                except Exception as cleanup_error:
                    logger.error(f"Error deleting partially uploaded file {name}: {cleanup_error}")

    return file_list, file_send_list, file_ids, low_res_file_list


def highest_resolution_thumb(file: Dict[str, Any]) -> str:
    thumb_sizes = [64, 80, 160, 360, 480, 720, 800, 960, 1024]
    available_thumbs = [size for size in thumb_sizes if f"thumb_{size}" in file]
    if not available_thumbs:
        return None
    thumb_size = max(available_thumbs)
    return file[f"thumb_{thumb_size}"]


# Helper function to sort by name, ignoring any prefixes we might want to ignore
# Example: The Name, should just be sorted as Name
def sort_by_name(extractor):
    prefixes = ("the ",)
    prefixes = tuple(p.casefold() for p in prefixes)

    def key(obj):
        value = (extractor(obj) or "").strip()
        folded = value.casefold()

        for p in prefixes:
            if folded.startswith(p):
                folded = folded[len(p) :]
                break

        return folded

    return key


def extract_state_values(body: dict) -> dict[str, Any]:
    """Extracts the state values from a Slack view submission payload.

    Args:
        body (dict): The Slack view submission payload.

    Returns:
        dict: A dictionary containing the state values.
    """

    # Extract form values from body
    state_values = safe_get(body, "view", "state", "values") or {}
    form_data: dict[str, Any] = {}
    for block_id, block_values in state_values.items():
        for _, state in block_values.items():
            element_type = state.get("type")
            if element_type in (
                "plain_text_input",
                "email_text_input",
                "url_text_input",
                "number_input",
            ):
                form_data[block_id] = state.get("value")
            # Pickers carry selected_date/selected_time, not value.
            elif element_type == "datepicker":
                form_data[block_id] = state.get("selected_date")
            elif element_type == "timepicker":
                form_data[block_id] = state.get("selected_time")
            elif element_type in ("users_select", "conversations_select", "channels_select"):
                form_data[block_id] = (
                    state.get("selected_user") or state.get("selected_conversation") or state.get("selected_channel")
                )
            elif element_type in ("multi_users_select", "multi_conversations_select", "multi_channels_select"):
                form_data[block_id] = (
                    state.get("selected_users") or state.get("selected_conversations") or state.get("selected_channels")
                )
            elif element_type in ("static_select", "external_select", "radio_buttons"):
                form_data[block_id] = (
                    (state.get("selected_option") or {}).get("value") if state.get("selected_option") else None
                )
            elif element_type in ("multi_static_select", "multi_external_select", "checkboxes"):
                form_data[block_id] = [o.get("value") for o in state.get("selected_options", [])]
            elif element_type == "rich_text_input":
                form_data[block_id] = state.get("rich_text_value")
            elif element_type == "file_input":
                form_data[block_id] = state.get("files")
    return form_data
