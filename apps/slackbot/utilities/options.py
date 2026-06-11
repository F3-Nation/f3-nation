from logging import Logger
from typing import Optional

from f3_data_models.models import Org, Org_Type, User
from f3_data_models.utils import DbManager
from slack_sdk import WebClient
from sqlalchemy import and_

from features import connect as connect_form
from features import paxminer_mapping
from features import user as user_form
from utilities.database.orm import SlackSettings
from utilities.helper_functions import safe_get
from utilities.slack import actions

USER_SEARCH_LIMIT = 50


def _parse_search_value(value: str) -> tuple[str, Optional[str]]:
    """Split a search string like 'rabbit (capi' into ('rabbit', 'capi').

    Returns (name_query, region_query) where region_query is None if no '(' present.
    The closing ')' is stripped if present.
    """
    if "(" in value:
        name_part, region_part = value.split("(", 1)
        return name_part.strip(), region_part.rstrip(")").strip()
    return value.strip(), None


def _relevance_score(f3_name: str, search_term: str) -> tuple[int, str]:
    """Return (score, f3_name) for sorting: exact=0, starts-with=1, contains=2."""
    name_lower = f3_name.lower()
    term_lower = search_term.lower()
    if name_lower == term_lower:
        return (0, f3_name)
    if name_lower.startswith(term_lower):
        return (1, f3_name)
    return (2, f3_name)


def _search_users(value: str, limit: int = USER_SEARCH_LIMIT) -> list[dict]:
    """Search users by f3_name with optional region filter via '(' syntax.

    Supports search terms like 'rabbit (capi' to filter by both name and home region.
    Results are sorted by relevance (exact > starts-with > contains), then alphabetically.
    """
    name_query, region_query = _parse_search_value(value)
    if not name_query:
        return []

    user_records = DbManager.find_records(
        cls=User,
        filters=[User.f3_name.ilike(f"%{name_query}%")],
        joinedloads=[User.home_region_org],
    )

    if region_query:
        region_lower = region_query.lower()
        user_records = [u for u in user_records if u.home_region_org and region_lower in u.home_region_org.name.lower()]

    user_records.sort(key=lambda u: _relevance_score(u.f3_name or "", name_query))

    options = []
    for user in user_records[:limit]:
        display_name = user.f3_name or "Unknown"
        if user.home_region_org:
            display_name += f" ({user.home_region_org.name})"
        options.append(
            {
                "text": {"type": "plain_text", "text": display_name},
                "value": str(user.id),
            }
        )
    return options


def handle_request(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    action_id = safe_get(body, "action_id")
    value = safe_get(body, "value")

    if action_id == actions.USER_OPTION_LOAD:
        return _search_users(value)
    elif action_id == user_form.USER_FORM_BROUGHT_BY:
        return _search_users(value)
    elif action_id in [
        user_form.USER_FORM_HOME_REGION,
        connect_form.SELECT_REGION,
        paxminer_mapping.PAXMINER_REGION,
        actions.DOWNRANGE_REGION_SELECT,
    ]:
        # Handle the home region selection
        org_records = DbManager.find_records(
            cls=Org,
            filters=[and_(Org.name.ilike(f"%{value}%"), Org.org_type == Org_Type.region)],
            # TODO: add area / sector as description
        )
        options = []
        for org in org_records[:USER_SEARCH_LIMIT]:
            display_name = org.name
            options.append(
                {
                    "text": {"type": "plain_text", "text": display_name},
                    "value": str(org.id),
                }
            )
        return options
    elif action_id == actions.EMERGENCY_DR_USER_SELECT:
        # Handle downrange emergency user search
        options = _search_users(value)
        # TODO: filter for users who have opted into DR sharing
        # options = [o for o in options if ...check meta for emergency.USER_EMERGENCY_INFO_DR_SHARING...]
        return options
