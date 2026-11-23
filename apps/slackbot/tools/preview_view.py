"""Render a Slack view from the working-tree code with sample data and print a Block Kit Builder link.

Run from apps/slackbot:

    uv run python -m tools.preview_view --list
    uv run python -m tools.preview_view calendar-home filters --team T0123456789 --out /tmp/view.json

Each preview calls the real view builder with the database queries and the Slack client mocked, so it needs no
database, Slack app or network access. Add a preview by writing a module in `tools/previews/` with a `SCENARIOS` dict
and registering it in `PREVIEWS` below.
"""

import argparse
import json
import os
import sys
import urllib.parse
from collections.abc import Callable
from unittest.mock import MagicMock

# Match the test suite: don't start the debugger or use the local GCS emulator from the developer's .env.
os.environ["ENABLE_DEBUGGING"] = "false"
os.environ["GCS_EMULATOR_HOST"] = ""

BUILDER_URL = "https://app.slack.com/block-kit-builder"
# Slack client methods whose payload a preview can show, checked in this order.
VIEW_METHODS = ("views_open", "views_update", "views_push", "views_publish")
MESSAGE_METHODS = ("chat_postMessage", "chat_postEphemeral", "chat_update")
# Top-level view fields Block Kit Builder renders; ids, callback ids and metadata are left out.
VIEW_FIELDS = ("type", "title", "close", "submit", "blocks")


def capture_payload(render: Callable[[MagicMock], object]) -> dict:
    """Call `render` with a mock Slack client and return the first view or message it sent, ready for the Builder."""
    client = MagicMock()
    for method in (*VIEW_METHODS, *MESSAGE_METHODS):
        getattr(client, method).return_value = {"ok": True, "ts": "1700000000.000100"}
    render(client)
    for method in VIEW_METHODS:
        call = getattr(client, method).call_args
        if call:
            view = call.kwargs["view"]
            return {key: view[key] for key in VIEW_FIELDS if key in view}
    for method in MESSAGE_METHODS:
        call = getattr(client, method).call_args
        if call:
            return {"blocks": call.kwargs["blocks"]}
    raise RuntimeError("The preview sent no view or message to the Slack client.")


def builder_url(payload: dict, team_id: str | None = None) -> str:
    """A Block Kit Builder link that opens with `payload` loaded; a team id keeps it through Slack's sign-in."""
    base = f"{BUILDER_URL}/{team_id}" if team_id else BUILDER_URL
    return f"{base}#{urllib.parse.quote(json.dumps(payload, separators=(',', ':')), safe='')}"


def _previews() -> dict[str, dict[str, Callable[[], dict]]]:
    from tools.previews import calendar_home

    return {"calendar-home": calendar_home.SCENARIOS}


def main(argv: list[str] | None = None) -> int:
    previews = _previews()
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("view", nargs="?", choices=sorted(previews))
    parser.add_argument("scenario", nargs="?", help="sample-data scenario; defaults to the view's first one")
    parser.add_argument("--team", help="Slack team id (T…) of a workspace you're signed in to in the browser")
    parser.add_argument("--out", help="also write the payload as indented JSON to this file")
    parser.add_argument("--list", action="store_true", help="list every view and its scenarios")
    args = parser.parse_args(argv)

    if args.list or not args.view:
        for view, scenarios in sorted(previews.items()):
            print(f"{view}: {', '.join(scenarios)}")
        return 0
    scenarios = previews[args.view]
    scenario = args.scenario or next(iter(scenarios))
    if scenario not in scenarios:
        parser.error(f"unknown scenario {scenario!r} for {args.view}; choose from {', '.join(scenarios)}")

    payload = scenarios[scenario]()
    if args.out:
        with open(args.out, "w") as file:
            json.dump(payload, file, indent=2)
            file.write("\n")
    print(f"{args.view} / {scenario}: {len(payload['blocks'])} blocks", file=sys.stderr)
    print(builder_url(payload, args.team))
    return 0


if __name__ == "__main__":
    sys.exit(main())
