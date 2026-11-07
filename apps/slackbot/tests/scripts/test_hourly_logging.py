import io
import json
import logging

import pytest
from google.cloud.logging_v2.handlers import StructuredLogHandler

from scripts import hourly_runner


@pytest.mark.parametrize("local", [False, True])
@pytest.mark.parametrize("level", ["INFO", "DEBUG"])
def test_hourly_logging_configuration(monkeypatch, local, level):
    monkeypatch.setattr(hourly_runner, "LOCAL_DEVELOPMENT", local)
    monkeypatch.setenv("LOG_LEVEL", level)
    root = logging.getLogger()
    previous_handlers, previous_level = root.handlers[:], root.level
    stream = io.StringIO()
    try:
        hourly_runner.configure_logging()
        assert root.level == getattr(logging, level)
        assert len(root.handlers) == 1
        handler = root.handlers[0]
        assert isinstance(handler, logging.StreamHandler if local else StructuredLogHandler)
        handler.setStream(stream)
        logging.getLogger("scripts.update_slack_users").error(
            "slack.identity.sync_failed", extra={"json_fields": {"event": "slack.identity.sync_failed"}}
        )
        if local:
            assert "slack.identity.sync_failed" in stream.getvalue()
        else:
            payloads = [json.loads(line) for line in stream.getvalue().splitlines() if line.strip()]
            payload = next(value for value in payloads if value.get("event") == "slack.identity.sync_failed")
            assert payload["severity"] == "ERROR"
    finally:
        for handler in root.handlers:
            if handler not in previous_handlers:
                handler.close()
        root.handlers[:] = previous_handlers
        root.setLevel(previous_level)
