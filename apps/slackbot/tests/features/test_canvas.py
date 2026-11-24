import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from features import canvas


def _region(region_id, team_id):
    settings = {"team_id": team_id, "canvas_channel": "C_CANVAS", "special_events_enabled": True}
    return SimpleNamespace(id=region_id, name=f"Region {region_id}", slack_space=SimpleNamespace(settings=settings))


def test_update_all_canvases_continues_after_a_client_lookup_error(monkeypatch):
    monkeypatch.setattr(
        canvas.DbManager, "find_records", lambda *args, **kwargs: [_region(1, "T_FIRST"), _region(2, "T_SECOND")]
    )
    second_client = MagicMock()

    def client_for_team(team_id):
        if team_id == "T_FIRST":
            raise RuntimeError("lookup failed")
        return second_client

    monkeypatch.setattr(canvas, "slack_client_for_team", client_for_team)
    update_canvas = MagicMock()
    monkeypatch.setattr(canvas, "update_canvas", update_canvas)

    canvas.update_all_canvases()

    update_canvas.assert_called_once()
    assert update_canvas.call_args.args[1] is second_client
