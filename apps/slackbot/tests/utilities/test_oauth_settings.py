from utilities import constants, helper_functions
from utilities.slack_tokens.store import SlackSpaceInstallationStore


def test_oauth_settings_use_db_store(monkeypatch):
    monkeypatch.setattr(helper_functions, "LOCAL_DEVELOPMENT", False)
    monkeypatch.setenv(constants.SLACK_CLIENT_ID, "id")
    monkeypatch.setenv(constants.SLACK_CLIENT_SECRET, "secret")
    monkeypatch.setenv(constants.SLACK_SCOPES, "chat:write,users:read")

    settings = helper_functions.get_oauth_settings()

    assert isinstance(settings.installation_store, SlackSpaceInstallationStore)
    assert settings.installation_store_bot_only is True
