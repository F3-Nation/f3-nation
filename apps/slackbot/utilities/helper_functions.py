import copy
import dataclasses
import json
import os
import re
from dataclasses import dataclass
from datetime import date, datetime
from logging import Logger
from typing import Any, Dict, List, Tuple

import pytz
import requests
from f3_data_models.models import (
    Location,
    Org,
    Org_Type,
    Org_x_SlackSpace,
    Role,
    Role_x_User_x_Org,
    SlackSpace,
    SlackUser,
    User,
)
from f3_data_models.utils import DbManager
from slack_bolt.oauth.oauth_settings import OAuthSettings
from slack_sdk.oauth.installation_store import FileInstallationStore
from slack_sdk.oauth.state_store import FileOAuthStateStore
from slack_sdk.web import SlackResponse, WebClient

from utilities import constants
from utilities.constants import LOCAL_DEVELOPMENT
from utilities.database.orm import SlackSettings

REGION_RECORDS: Dict[str, SlackSettings] = {}
SLACK_USERS: Dict[str, SlackUser] = {}


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


def trigger_map_revalidation(action: str = None, map_update_data: MapUpdateData = None) -> bool:
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
        print(
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
):
    names = []
    urls = []

    for user_id in array_of_user_ids:
        user: SlackUser = safe_get(SLACK_USERS, user_id)
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


def get_user(slack_user_id: str, region_record: SlackSettings, client: WebClient, logger: Logger) -> SlackUser:
    if not SLACK_USERS:
        update_local_slack_users()

    user: SlackUser | None = safe_get(SLACK_USERS, slack_user_id)
    if not user:
        try:
            # check to see if this user's email is already in the db
            user_info = client.users_info(user=slack_user_id)
            slack_user_record = create_user(user_info["user"], region_record.org_id)

            # Update SLACK_USERS with the new id
            SLACK_USERS[slack_user_id] = slack_user_record
            return slack_user_record
        except Exception as e:
            raise e
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


def create_user(slack_user_info: dict, home_region_id: int | None = None) -> SlackUser:
    email = safe_get(slack_user_info, "profile", "email")
    email = email or safe_get(slack_user_info, "id")  # this means it's a bot
    email = email.lower()
    user_name = safe_get(slack_user_info, "profile", "display_name") or safe_get(
        slack_user_info, "profile", "real_name"
    )
    avatar_url = safe_get(slack_user_info, "profile", "image_192")
    user_record = safe_get(DbManager.find_records(User, filters=[User.email == email]), 0)

    # If not, create a new user record
    if not user_record:
        user_record = DbManager.create_record(
            User(
                email=email,
                f3_name=user_name,
                home_region_id=home_region_id,
            )
        )

    slack_user_record = safe_get(
        DbManager.find_records(SlackUser, filters=[SlackUser.slack_id == slack_user_info.get("id")]), 0
    )
    if not slack_user_record:
        # Create a new slack user record
        slack_user_record = DbManager.create_record(
            SlackUser(
                user_id=safe_get(user_record, "id"),
                slack_id=slack_user_info.get("id"),
                email=email,
                user_name=user_name,
                avatar_url=avatar_url,
                is_admin=safe_get(slack_user_info, "is_admin") or False,
                is_owner=safe_get(slack_user_info, "is_owner") or False,
                is_bot=safe_get(slack_user_info, "is_bot") or False,
                slack_updated=safe_convert(slack_user_info.get("updated"), int),
                slack_team_id=safe_get(slack_user_info, "team_id") or "NOT FOUND",
            )
        )
    elif not safe_get(slack_user_record, "user_id"):
        DbManager.update_record(SlackUser, slack_user_record.id, {SlackUser.user_id: safe_get(user_record, "id")})
        slack_user_record.user_id = safe_get(user_record, "id")

    # Update SLACK_USERS with the new id
    SLACK_USERS[slack_user_info.get("id")] = slack_user_record
    return slack_user_record


def update_local_slack_users(slack_user: SlackUser = None) -> None:
    print("Updating local slack users...")
    global SLACK_USERS

    if slack_user:
        SLACK_USERS[slack_user.slack_id] = slack_user
        return
    slack_users: List[SlackUser] = DbManager.find_records(SlackUser, filters=[True])

    SLACK_USERS.clear()
    SLACK_USERS.update({slack_user.slack_id: slack_user for slack_user in slack_users})


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
        if not org_record:
            if LOCAL_DEVELOPMENT:
                org_record = DbManager.create_record(
                    Org(
                        name="My Region",
                        org_type=Org_Type.region,
                        is_active=True,
                    )
                )
                region_record.org_id = org_record.id
        else:
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
    users = client.users_list().get("members")
    user_list = [
        User(
            f3_name=u["profile"]["display_name"] or u["profile"]["real_name"],
            email=u["profile"].get("email") or u["id"],
            avatar_url=u["profile"].get("image_192"),
            home_region_id=org_id,
        )
        for u in users
    ]
    DbManager.create_or_ignore(User, user_list)

    users_all: List[User] = DbManager.find_records(User, filters=[True])
    users_dict = {u.email: u.id for u in users_all}

    slack_user_list = [
        SlackUser(
            slack_id=u["id"],
            user_id=users_dict.get(u["profile"].get("email") or u["id"]),
            user_name=u["profile"]["display_name"] or u["profile"]["real_name"],
            email=u["profile"].get("email") or u["id"],
            avatar_url=u["profile"]["image_192"],
            slack_team_id=team_id or "NOT FOUND",
            is_admin=u.get("is_admin") or False,
            is_owner=u.get("is_owner") or False,
            is_bot=u.get("is_bot") or False,
            slack_updated=safe_convert(safe_get(u, "user", "updated"), int),
        )
        for u in users
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
    region_records = [SlackSettings(**s.settings) for s in slack_space_records]
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
) -> str:
    """Extracts the plain text representation from a rich text block.

    Args:
        client (WebClient): Slack client
        logger (Logger): Logger
        block (Dict[str, Any]): Block to parse
        parse_users (bool, optional): If True, user mentions will be parsed to their name. Defaults to True.
        parse_channels (bool, optional): If True, channel mentions will be parsed to its name. Defaults to True.

    Returns:
        str: Extracted plain text
    """

    def process_text_element(text, element):
        msg = ""
        if element["type"] == "rich_text_quote":
            msg += '"'
        if text["type"] == "text":
            msg += text["text"]
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
    slack_user_names = get_user_names(slack_user_ids, logger, client, return_urls=False)
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
                    user_name = get_user_names([text["user_id"]], logger, client, return_urls=False)[0]
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
    file_list = []
    file_send_list = []
    file_ids = [file["id"] for file in files]
    low_res_file_list = []
    from PIL import Image

    bucket_name = bucket_name or "backblast-images"

    for file in files or []:
        try:
            r_full = requests.get(file["url_private_download"], headers={"Authorization": f"Bearer {client.token}"})
            r_full.raise_for_status()

            file_id = file_name or file["id"]
            current_file_name = f"{file_id}.{file['filetype']}"
            file_path = f"/mnt/{bucket_name}/{current_file_name}"
            file_mimetype = file["mimetype"]

            # Determine the highest thumbnail size possible
            thumb_sizes = [64, 80, 160, 360, 480, 720, 800, 960, 1024]
            # Find the largest thumbnail that actually exists in the file object
            available_thumbs = [size for size in thumb_sizes if f"thumb_{size}" in file]
            thumb_size = max(available_thumbs) if available_thumbs else None

            with open(file_path, "wb") as f:
                f.write(r_full.content)

            if thumb_size is not None:
                r_low_res = requests.get(
                    file[f"thumb_{thumb_size}"],
                    headers={"Authorization": f"Bearer {client.token}"},
                    params={"width": constants.LOW_REZ_IMAGE_SIZE, "height": constants.LOW_REZ_IMAGE_SIZE},
                )
                file_name_low_res = f"{file_id}_low_res.png"
                file_path_low_res = f"/mnt/{bucket_name}/{file_name_low_res}"

                with open(file_path_low_res, "wb") as f:
                    f.write(r_low_res.content)

                low_res_file_list.append(
                    f"https://storage.googleapis.com/{constants.FILE_BUCKET_PREFIX}/{bucket_name}/{file_name_low_res}"
                )

            change_to_png = enforce_png and file["filetype"] != "png"
            if enforce_square or max_height or change_to_png:
                img = None
                if file_mimetype.startswith("image/"):
                    try:
                        img = Image.open(file_path)
                    except Exception as e:
                        logger.error(f"Error opening image: {e}")

                # If we have an image, apply enforce_square and max_height
                if img is not None:
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
                    # Save the possibly modified image
                    img_format = "PNG" if file["filetype"] == "heic" or change_to_png else img.format
                    if img_format == "PNG" and not current_file_name.endswith(".png"):
                        old_path = file_path
                        current_file_name = f"{file_id}.png"
                        file_path = f"/mnt/{bucket_name}/{current_file_name}"
                        file_mimetype = "image/png"
                    else:
                        old_path = None
                    img.save(file_path, format=img_format, quality=95, optimize=True)
                    if old_path and old_path != file_path:
                        os.remove(old_path)

                # TODO: if LOCAL_DEVELOPMENT, upload to google storage

            file_list.append(
                f"https://storage.googleapis.com/{constants.FILE_BUCKET_PREFIX}/{bucket_name}/{current_file_name}"
            )
            file_send_list.append(
                {
                    "filepath": file_path,
                    "meta": {
                        "filename": current_file_name,
                        "maintype": file_mimetype.split("/")[0],
                        "subtype": file_mimetype.split("/")[1],
                    },
                }
            )
        except Exception as e:
            logger.error(f"Error uploading file: {e}")

    return file_list, file_send_list, file_ids, low_res_file_list


def highest_resolution_thumb(file: Dict[str, Any]) -> str:
    thumb_sizes = [64, 80, 160, 360, 480, 720, 800, 960, 1024]
    available_thumbs = [size for size in thumb_sizes if f"thumb_{size}" in file]
    if not available_thumbs:
        return None
    thumb_size = max(available_thumbs)
    return file[f"thumb_{thumb_size}"]


def reupload_file_as_bot(
    file: Dict[str, Any],
    client: WebClient,
    logger: Logger,
    region_record: SlackSettings = None,
    filename: str = None,
) -> str | None:
    """Download a user-uploaded Slack file and re-upload it as the bot to the bot log channel.

    Uploading to the public bot log channel ensures the file is accessible workspace-wide,
    allowing it to be referenced in slack_file image blocks in channel messages.

    Returns the bot-owned file ID, or None on failure.
    """
    from utilities.bot_logger import _ensure_bot_in_channel, _find_or_create_log_channel  # noqa: PLC0415

    try:
        r = requests.get(file["url_private_download"], headers={"Authorization": f"Bearer {client.token}"})
        r.raise_for_status()
        fname = filename or f"{file['id']}.{file.get('filetype', 'bin')}"

        # Resolve the bot log channel so the uploaded file is publicly accessible workspace-wide
        channel_id = region_record.bot_log_channel if region_record else None
        if not channel_id:
            channel_id = _find_or_create_log_channel(client, logger)
            if channel_id:
                _ensure_bot_in_channel(client, channel_id, logger)

        response = client.files_upload_v2(
            filename=fname,
            file=r.content,
            channel=channel_id,
        )
        print(f"Re-uploaded file {file['id']} as bot with new file ID {safe_get(response, 'file', 'id')}")
        print(f"Response from Slack API: {response}")
        return safe_get(response, "files", 0, "id")
    except Exception as e:
        logger.error(f"Error re-uploading file {safe_get(file, 'id')} as bot: {e}")
        return None


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
