"""Utility for posting bot action log messages to a designated Slack channel.

Usage::

    from utilities.bot_logger import post_bot_log

    post_bot_log(client, region_record, "✏️ Event edited: My Event by <@U12345>", logger)

If ``region_record.bot_log_channel`` is not set, or the configured channel is
inaccessible (archived, deleted, private, etc.), the bot will automatically
create (or locate) a public channel named ``#nation_bot_logs``, join it,
persist the channel ID back to the database, and post there.

All errors are caught and logged as warnings so that this utility can never
interrupt the feature that called it.
"""

from __future__ import annotations

from logging import Logger

from f3_data_models.models import SlackSpace
from f3_data_models.utils import DbManager
from slack_sdk.errors import SlackApiError
from slack_sdk.web import WebClient

from utilities.database.orm import SlackSettings


def _find_or_create_log_channel(client: WebClient, logger: Logger) -> str | None:
    """Return the channel ID for ``#nation_bot_logs``, creating it if needed.

    Returns ``None`` if the channel cannot be found or created.
    """
    channel_name = "nation_bot_logs"

    # Try to create the channel first — fastest path.
    try:
        resp = client.conversations_create(name=channel_name, is_private=False)
        channel_id: str = resp["channel"]["id"]
        logger.info(f"bot_logger: created #{channel_name} ({channel_id})")
        return channel_id
    except SlackApiError as exc:
        if exc.response.get("error") != "name_taken":
            logger.warning(f"bot_logger: conversations_create failed: {exc.response.get('error')}")
            return None
        # Channel already exists — find it by paginating conversations_list.
        logger.info(f"bot_logger: #{channel_name} already exists, searching for it…")

    try:
        cursor = None
        while True:
            kwargs: dict = {"exclude_archived": True, "types": "public_channel", "limit": 200}
            if cursor:
                kwargs["cursor"] = cursor
            list_resp = client.conversations_list(**kwargs)
            for channel in list_resp.get("channels", []):
                if channel.get("name") == channel_name:
                    return channel["id"]
            cursor = list_resp.get("response_metadata", {}).get("next_cursor")
            if not cursor:
                break
    except SlackApiError as exc:
        logger.warning(f"bot_logger: conversations_list failed: {exc.response.get('error')}")

    return None


def _ensure_bot_in_channel(client: WebClient, channel_id: str, logger: Logger) -> bool:
    """Join the channel if the bot is not already a member. Returns True on success."""
    try:
        client.conversations_join(channel=channel_id)
        return True
    except SlackApiError as exc:
        error = exc.response.get("error", "")
        # already_in_channel is not actually an error — treat it as success.
        if error in ("already_in_channel", "method_not_supported_for_channel_type"):
            return True
        logger.warning(f"bot_logger: conversations_join failed for {channel_id}: {error}")
        return False


def _persist_channel(region_record: SlackSettings, channel_id: str, logger: Logger) -> None:
    """Save the resolved channel ID back to the database and update the cache."""
    # Import here to avoid circular-import issues at module load time.
    from utilities.helper_functions import update_local_region_records  # noqa: PLC0415

    try:
        region_record.bot_log_channel = channel_id
        DbManager.update_records(
            cls=SlackSpace,
            filters=[SlackSpace.team_id == region_record.team_id],
            fields={SlackSpace.settings: region_record.__dict__},
        )
        update_local_region_records()
        logger.info(f"bot_logger: persisted bot_log_channel={channel_id} for team {region_record.team_id}")
    except Exception as exc:  # pragma: no cover
        logger.warning(f"bot_logger: failed to persist bot_log_channel: {exc}")


def post_bot_log(
    client: WebClient,
    region_record: SlackSettings,
    text: str,
    logger: Logger,
) -> None:
    """Post *text* to the workspace's bot log channel.

    The function is entirely fail-safe: any error is swallowed and emitted as a
    ``logger.warning`` so that the calling feature is never interrupted.
    """
    try:
        channel_id: str | None = region_record.bot_log_channel

        if channel_id:
            try:
                client.chat_postMessage(channel=channel_id, text=text)
                return
            except SlackApiError as exc:
                error = exc.response.get("error", "")
                logger.warning(
                    f"bot_logger: post to configured channel {channel_id} failed ({error}); "
                    "falling back to #nation_bot_logs"
                )
                channel_id = None  # Fall through to auto-create logic below.

        # No channel configured (or the configured one is inaccessible).
        channel_id = _find_or_create_log_channel(client, logger)
        if not channel_id:
            logger.warning("bot_logger: could not find or create #nation_bot_logs; skipping log")
            return

        if not _ensure_bot_in_channel(client, channel_id, logger):
            logger.warning(f"bot_logger: bot cannot join channel {channel_id}; skipping log")
            return

        _persist_channel(region_record, channel_id, logger)

        client.chat_postMessage(channel=channel_id, text=text)

    except Exception as exc:  # pragma: no cover — last-resort safety net
        logger.warning(f"bot_logger: unexpected error posting log: {exc}")
