import importlib
import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import main


def test_import_does_not_create_slack_app():
    with patch.object(main, "create_slack_app") as create_slack_app:
        importlib.reload(main)

    create_slack_app.assert_not_called()
    assert main._app is None


def test_get_slack_app_is_a_singleton_and_registers_listeners():
    slack_app = MagicMock()

    with patch.object(main, "App", return_value=slack_app), patch.object(main, "get_oauth_settings", return_value={}):
        first = main.get_slack_app()
        second = main.get_slack_app()

    assert first is slack_app
    assert second is slack_app
    assert slack_app.action.call_count == 1
    assert slack_app.view.call_count == 1
    assert slack_app.command.call_count == 1
    assert slack_app.view_closed.call_count == 1
    assert slack_app.event.call_count == 1
    assert slack_app.options.call_count == 1
    assert slack_app.shortcut.call_count == 1


def _deployed_handler():
    """Reload main as a deployment (not local dev) to get the HTTP handler."""
    import google.cloud.logging_v2.handlers as gcl_handlers

    import utilities.constants

    # Keep the deployment-only structured log handler off the test process.
    with (
        patch.object(utilities.constants, "LOCAL_DEVELOPMENT", False),
        patch.object(gcl_handlers, "setup_logging"),
    ):
        importlib.reload(main)
    return main.handler


def _request(path, body=b""):
    from flask import Flask

    return Flask(__name__).test_request_context(path, method="POST", data=body).request


def test_gcp_event_route_is_not_served():
    handler = _deployed_handler()
    pubsub_body = b'{"message": {"data": "aG91cmx5"}}'  # base64 "hourly"

    with patch("scripts.hourly_runner.run_all_hourly_scripts") as run_all:
        response = handler(_request("/gcp_event", pubsub_body))

    assert response.status_code == 404
    run_all.assert_not_called()
    importlib.reload(main)


def test_health_route_is_still_served():
    handler = _deployed_handler()

    response = handler(_request("/"))

    assert response.status_code == 200
    importlib.reload(main)
