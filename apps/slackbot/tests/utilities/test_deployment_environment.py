import pytest

from utilities.constants import is_production_deployment


@pytest.mark.parametrize("environment", ["local", "staging", "test"])
def test_nonproduction_environments(environment, monkeypatch):
    monkeypatch.setenv("SLACKBOT_ENV", environment)

    assert is_production_deployment() is False


def test_production_requires_explicit_production_value(monkeypatch):
    monkeypatch.setenv("SLACKBOT_ENV", "production")

    assert is_production_deployment() is True


def test_missing_environment_defaults_to_nonproduction_even_with_local_development(monkeypatch):
    monkeypatch.delenv("SLACKBOT_ENV", raising=False)
    monkeypatch.setenv("LOCAL_DEVELOPMENT", "false")

    assert is_production_deployment() is False


@pytest.mark.parametrize("environment", ["", "prod", "Production", "invalid"])
def test_invalid_environment_raises_value_error(environment, monkeypatch):
    monkeypatch.setenv("SLACKBOT_ENV", environment)

    with pytest.raises(ValueError, match="SLACKBOT_ENV"):
        is_production_deployment()


def test_local_development_does_not_disable_explicit_production(monkeypatch):
    monkeypatch.setenv("SLACKBOT_ENV", "production")
    monkeypatch.setenv("LOCAL_DEVELOPMENT", "true")

    assert is_production_deployment() is True
