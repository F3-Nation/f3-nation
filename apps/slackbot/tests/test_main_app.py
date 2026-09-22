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
