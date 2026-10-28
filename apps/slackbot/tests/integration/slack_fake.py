"""A stand-in for Slack on both sides of the app, for integration tests.

``FakeSlackApi`` is a local HTTP server that answers Slack Web API calls the way
Slack would and records every call, so a test can assert on what the bot sent.
Point a ``WebClient`` at it with ``base_url=fake.base_url``.

``SlackDriver`` plays the user: it builds slash-command, button-click and
modal-submit payloads shaped like Slack's, signs them with the app's signing
secret, and dispatches them through the real Bolt app.
"""

from __future__ import annotations

import itertools
import json
import threading
import time
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse

from slack_bolt import App, BoltRequest, BoltResponse
from slack_sdk.signature import SignatureVerifier

BOT_USER_ID = "U_BOT"
BOT_ID = "B_BOT"


@dataclass
class SlackCall:
    method: str
    args: dict[str, Any]
    response: dict[str, Any]


@dataclass
class FakeSlackApi:
    """Records Web API calls and keeps the state Slack would (open views, posted messages)."""

    team_id: str = "T_DEFAULT"
    calls: list[SlackCall] = field(default_factory=list)
    views: dict[str, dict] = field(default_factory=dict)
    _ids = itertools.count(1)
    _lock = threading.Lock()

    def start(self) -> None:
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self._handle(parse_qs(urlparse(self.path).query))

            def do_POST(self):
                raw = self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode()
                if self.headers.get("Content-Type", "").startswith("application/json"):
                    args = json.loads(raw or "{}")
                else:
                    args = parse_qs(raw)
                self._handle(args)

            def _handle(self, args: dict) -> None:
                method = urlparse(self.path).path.rsplit("/", 1)[-1]
                # Form and query encodings arrive as lists and JSON-encoded strings; normalize both.
                args = {k: v[0] if isinstance(v, list) and len(v) == 1 else v for k, v in args.items()}
                for key in ("view", "blocks", "metadata"):
                    if isinstance(args.get(key), str):
                        args[key] = json.loads(args[key])
                payload = json.dumps(fake.respond(method, args)).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, fmt, *args):
                return

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self._server.serve_forever, daemon=True).start()

    def stop(self) -> None:
        self._server.shutdown()

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self._server.server_port}/api/"

    def reset(self, team_id: str) -> None:
        self.team_id = team_id
        self.calls.clear()
        self.views.clear()

    def respond(self, method: str, args: dict) -> dict:
        with self._lock:
            response = self._respond(method, args, next(self._ids))
            self.calls.append(SlackCall(method, args, response))
            return response

    def _respond(self, method: str, args: dict, n: int) -> dict:
        if method == "auth.test":
            return {"ok": True, "user_id": BOT_USER_ID, "bot_id": BOT_ID, "team_id": self.team_id}
        if method in ("views.open", "views.push"):
            view_id = f"V{n:06d}"
            self.views[view_id] = {**args["view"], "id": view_id}
            return {"ok": True, "view": self.views[view_id]}
        if method == "views.update":
            view_id = args["view_id"]
            self.views[view_id] = {**args["view"], "id": view_id}
            return {"ok": True, "view": self.views[view_id]}
        if method in ("chat.postMessage", "chat.update"):
            ts = args.get("ts") or f"{1_700_000_000 + n}.000100"
            return {"ok": True, "channel": args.get("channel"), "ts": ts, "message": args}
        if method == "users.info":
            user = args["user"]
            return {
                "ok": True,
                "user": {
                    "id": user,
                    "team_id": self.team_id,
                    "name": user.lower(),
                    "is_bot": False,
                    "profile": {
                        "display_name": f"PAX {user}",
                        "real_name": f"PAX {user}",
                        "email": f"{user.lower()}@example.test",
                        "image_192": f"https://example.test/{user}.png",
                    },
                },
            }
        if method == "team.info":
            return {"ok": True, "team": {"id": self.team_id, "name": "Integration Test", "domain": "it"}}
        return {"ok": True}

    def calls_to(self, method: str) -> list[SlackCall]:
        return [c for c in self.calls if c.method == method]


class SlackDriver:
    """Sends the requests Slack would send when a user works through the app."""

    def __init__(self, app: App, signing_secret: str, team_id: str, user_id: str):
        self.app = app
        self.verifier = SignatureVerifier(signing_secret)
        self.team_id = team_id
        self.user_id = user_id
        self._triggers = itertools.count(1)

    def _dispatch(self, raw_body: str, content_type: str) -> BoltResponse:
        timestamp = str(int(time.time()))
        headers = {
            "content-type": [content_type],
            "x-slack-request-timestamp": [timestamp],
            "x-slack-signature": [self.verifier.generate_signature(timestamp=timestamp, body=raw_body)],
        }
        return self.app.dispatch(BoltRequest(body=raw_body, headers=headers))

    def _interaction(self, payload: dict) -> BoltResponse:
        payload = {
            "team": {"id": self.team_id, "domain": "it"},
            "user": {"id": self.user_id, "team_id": self.team_id},
            "api_app_id": "A_IT",
            "trigger_id": self._trigger_id(),
            **payload,
        }
        return self._dispatch(urlencode({"payload": json.dumps(payload)}), "application/x-www-form-urlencoded")

    def _trigger_id(self) -> str:
        return f"trigger.{next(self._triggers)}"

    def command(self, command: str, text: str = "", channel_id: str = "C_COMMAND") -> BoltResponse:
        body = {
            "command": command,
            "text": text,
            "team_id": self.team_id,
            "team_domain": "it",
            "user_id": self.user_id,
            "channel_id": channel_id,
            "api_app_id": "A_IT",
            "trigger_id": self._trigger_id(),
        }
        return self._dispatch(urlencode(body), "application/x-www-form-urlencoded")

    def click_button(self, view: dict, action_id: str) -> BoltResponse:
        """Click the button with ``action_id`` in an open modal."""
        block, button = _find_element(view, action_id)
        return self._interaction(
            {
                "type": "block_actions",
                "container": {"type": "view", "view_id": view["id"]},
                "view": {**view, "state": {"values": {}}},
                "actions": [
                    {
                        "type": "button",
                        "action_id": action_id,
                        "block_id": block.get("block_id", ""),
                        "value": button.get("value", ""),
                        "action_ts": str(time.time()),
                    }
                ],
            }
        )

    def submit_view(self, view: dict, values: dict[str, Any] | None = None) -> BoltResponse:
        """Submit a modal as the user, keeping each input's initial value unless ``values`` overrides it.

        ``values`` maps block_id to what the user entered, in the shape Slack reports for that element
        type: a string for text inputs, an option value for selects and radios, a list for multi-selects.
        """
        return self._interaction(
            {
                "type": "view_submission",
                "view": {**view, "state": {"values": _view_state(view, values or {})}},
            }
        )


def _find_element(view: dict, action_id: str) -> tuple[dict, dict]:
    for block in view.get("blocks", []):
        for element in block.get("elements", []) + [block.get("accessory") or {}, block.get("element") or {}]:
            if element.get("action_id") == action_id:
                return block, element
    raise AssertionError(f"No element with action_id {action_id!r} in view {view.get('callback_id')!r}")


def _option(element: dict, value: str) -> dict:
    option = next((o for o in element.get("options", []) if o["value"] == value), None)
    if option is None:
        raise AssertionError(f"{value!r} is not an option of {element['action_id']!r}")
    return option


def _view_state(view: dict, values: dict[str, Any]) -> dict:
    """Build ``view.state.values`` the way Slack does on submit."""
    state: dict[str, dict] = {}
    for block in view.get("blocks", []):
        element = block.get("element")
        if block.get("type") != "input" or not element:
            continue
        kind = element["type"]
        given = block["block_id"] in values
        value = values.get(block["block_id"])
        entry: dict[str, Any] = {"type": kind}

        if kind in ("plain_text_input", "email_text_input", "url_text_input", "number_input"):
            entry["value"] = value if given else element.get("initial_value")
        elif kind == "rich_text_input":
            entry["rich_text_value"] = value if given else element.get("initial_value")
        elif kind == "timepicker":
            entry["selected_time"] = value if given else element.get("initial_time")
        elif kind == "datepicker":
            entry["selected_date"] = value if given else element.get("initial_date")
        elif kind in ("static_select", "radio_buttons"):
            entry["selected_option"] = _option(element, value) if given else element.get("initial_option")
        elif kind in ("multi_static_select", "checkboxes"):
            entry["selected_options"] = (
                [_option(element, v) for v in value] if given else element.get("initial_options", [])
            )
        elif kind == "users_select":
            entry["selected_user"] = value if given else element.get("initial_user")
        elif kind == "multi_users_select":
            entry["selected_users"] = value if given else element.get("initial_users", [])
        elif kind in ("conversations_select", "channels_select"):
            key = "selected_channel" if kind == "channels_select" else "selected_conversation"
            entry[key] = value if given else element.get("initial_channel") or element.get("initial_conversation")
        elif kind == "file_input":
            entry["files"] = value if given else []
        else:
            raise AssertionError(f"_view_state does not know how Slack reports {kind!r} inputs yet")

        state[block["block_id"]] = {element["action_id"]: entry}
    return state
