"""Calendar Home with sample events: a member's view, the filters open, an admin's view, and no events."""

import datetime
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from f3_data_models.models import Series_Exception

from features.calendar.home import build_home_form
from tools.preview_view import capture_payload
from utilities.helper_functions import current_date_cst
from utilities.slack import actions

AOS = [
    SimpleNamespace(id=100 + i, name=name)
    for i, name in enumerate(["Brickyard", "Convergence", "Iron Mountain", "Lake Loop", "The Forge"])
]
EVENT_TYPES = [SimpleNamespace(id=1 + i, name=name) for i, name in enumerate(["Bootcamp", "Run", "Ruck"])]


def _event(
    event_id: int,
    days_ahead: int,
    ao: str,
    *,
    start_time: str = "0530",
    event_types: tuple[str, ...] = ("Bootcamp",),
    planned_qs: str | None = "Chip",
    hc_count: int = 4,
    user_attending: bool = False,
    user_q: bool = False,
    preblast: bool = False,
    highlight: bool = False,
    name: str | None = None,
    closed: bool = False,
    series: str | None = None,
) -> SimpleNamespace:
    """One row shaped like `CalendarHomeQuery`, dated relative to today in US/Central, as the view compares it."""
    return SimpleNamespace(
        event=SimpleNamespace(
            id=event_id,
            name=name or f"Event {event_id}",
            start_date=current_date_cst() + datetime.timedelta(days=days_ahead),
            start_time=start_time,
            series_exception=Series_Exception.closed if closed else None,
            highlight=highlight,
            preblast_rich={"blocks": []} if preblast else None,
        ),
        org=SimpleNamespace(name=ao),
        event_types=[SimpleNamespace(name=t) for t in event_types],
        series=SimpleNamespace(name=series) if series else None,
        planned_qs=planned_qs,
        user_q=user_q,
        user_attending=user_attending,
        hc_count=hc_count,
    )


def _events() -> list[SimpleNamespace]:
    """Every row state the list draws: open Q, the viewer as Q or going, preblast, closed, special, named series."""
    return [
        _event(1, 1, "The Forge", hc_count=7, user_attending=True, preblast=True),
        _event(2, 1, "Brickyard", start_time="0545", event_types=("Run",), planned_qs=None, hc_count=2),
        _event(3, 1, "Iron Mountain", start_time="0600", event_types=("Ruck", "Bootcamp"),
               planned_qs="Moneyball", user_q=True, preblast=True),
        _event(4, 2, "The Forge", planned_qs=None, hc_count=0),
        _event(5, 2, "Lake Loop", start_time="0515", event_types=("Run",), closed=True),
        _event(6, 3, "Convergence", start_time="0700", planned_qs="Nantan", hc_count=31, highlight=True, preblast=True,
               name="Q1 Convergence + Coffeeteria"),
        _event(7, 3, "Brickyard", start_time="0630", event_types=("Run",), planned_qs="Sparky", hc_count=3,
               series="Saturday Long Run"),
    ]  # fmt: skip


SAMPLE_RECORDS = {"Org": AOS, "EventType": EVENT_TYPES, "Location": []}


def _find_records(model, *_args, **_kwargs) -> list:
    if model.__name__ not in SAMPLE_RECORDS:
        raise KeyError(f"The calendar-home preview has no sample {model.__name__} rows; add them to SAMPLE_RECORDS.")
    # A copy, because the view builder extends and sorts the list it gets back.
    return list(SAMPLE_RECORDS[model.__name__])


def _render(body: dict, *, admin: bool = False, events: list | None = None) -> dict:
    region = SimpleNamespace(org_id=1, team_id="T_PREVIEW", calendar_group_by_option="ao")
    with (
        patch("features.calendar.home.get_user", return_value=SimpleNamespace(user_id=1)),
        patch("features.calendar.home.get_admin_users", return_value=[]),
        patch("features.calendar.home.get_aoq_users", return_value=[]),
        patch("features.calendar.home.constants.ALL_USERS_ARE_ADMINS", admin),
        patch("features.calendar.home.DbManager.find_records", side_effect=_find_records),
        patch("features.calendar.home.DbManager.find_join_records2", return_value=[]),
        patch("features.calendar.home.home_schedule_query", return_value=_events() if events is None else events),
    ):
        return capture_payload(
            lambda client: build_home_form(
                body=body, client=client, logger=MagicMock(), context={}, region_record=region, update_view_id=None
            )
        )


# Every way of opening Calendar Home first shows a loading modal, which the view builder then updates.
OPENED = {"user": {"id": "U_PREVIEW"}, "trigger_id": "TRIGGER", actions.LOADING_ID: "V_LOADING"}


def filters_open() -> dict:
    """The Filters button pressed with two AOs already chosen, so the inputs show and the summary counts them."""
    chosen = (AOS[0], AOS[4])
    stored = {"filters": {actions.CALENDAR_HOME_AO_FILTER: [str(ao.id) for ao in chosen]}}
    body = {
        "user": {"id": "U_PREVIEW"},
        "actions": [{"action_id": actions.CALENDAR_HOME_FILTERS}],
        "view": {"id": "V_PREVIEW", "private_metadata": json.dumps(stored), "blocks": [], "state": {"values": {}}},
    }
    # The query is mocked, so apply the AO filter to the sample rows here, as the real query would.
    return _render(body, events=[e for e in _events() if e.org.name in {ao.name for ao in chosen}])


SCENARIOS = {
    "member": lambda: _render(OPENED),
    "filters": filters_open,
    "admin": lambda: _render(OPENED, admin=True),
    "empty": lambda: _render(OPENED, events=[]),
}
