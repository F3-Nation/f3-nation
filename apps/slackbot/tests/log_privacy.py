"""Synthetic sensitive errors and the checks that a caught error left none of their payload in the output."""

import logging

from slack_sdk.errors import SlackApiError
from slack_sdk.web import SlackResponse
from sqlalchemy.exc import StatementError

SENSITIVE_MARKERS = ["member@example.invalid", "xoxb-synthetic-token", "SELECT private_data", "Synthetic Member Name"]
SENSITIVE_TEXT = " ".join(SENSITIVE_MARKERS)


def slack_error(code: str = "channel_not_found") -> SlackApiError:
    """A Slack rejection whose message, request and response all carry sensitive markers."""
    response = SlackResponse(
        client=None,
        http_verb="POST",
        api_url="https://slack.com/api/chat.postMessage",
        req_args={"json": {"text": SENSITIVE_TEXT}},
        data={"ok": False, "error": code, "detail": SENSITIVE_TEXT},
        headers={},
        status_code=200,
    )
    return SlackApiError(SENSITIVE_TEXT, response)


def database_error() -> StatementError:
    """A SQLAlchemy error carrying the statement and its bound parameters."""
    return StatementError(
        "query failed", "SELECT private_data", {"email": "member@example.invalid"}, RuntimeError(SENSITIVE_TEXT)
    )


def assert_private(caplog, capsys) -> str:
    """Fail if any marker reached stdout, stderr or a log record; return the captured output for further checks."""
    captured = capsys.readouterr()
    output = captured.out + captured.err + caplog.text + "".join(repr(r.__dict__) for r in caplog.records)
    for marker in SENSITIVE_MARKERS:
        assert marker not in output
    assert "Traceback" not in output
    assert all(record.exc_info is None for record in caplog.records)
    return output


def error_events(caplog, event: str, level: int = logging.ERROR) -> list[logging.LogRecord]:
    """The records for `event` at `level`, so callers assert the count and the IDs each carries."""
    return [
        record
        for record in caplog.records
        if getattr(record, "json_fields", {}).get("event") == event and record.levelno == level
    ]
