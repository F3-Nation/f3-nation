from __future__ import annotations

import sys
from types import SimpleNamespace

import google.cloud.storage
import pytest

import analytics.cli as cli
from analytics.publication import CatalogConflictError
from analytics.settings import CatalogSettings, SettingsError


def test_rollback_command_requires_explicit_pinned_manifest_and_cas(monkeypatch):
    calls = []
    events = []

    class Publisher:
        @classmethod
        def from_catalog(cls, client, settings):
            calls.append((client, settings))
            return cls()

        def rollback_catalog(self, metageneration, *, release_manifest_uri, release_manifest_generation, emit=None):
            calls.append((metageneration, release_manifest_uri, release_manifest_generation))
            if emit:
                emit("analytics.etl.catalog_committed_unconfirmed", {"operation": "rollback"})

    monkeypatch.setenv("ANALYTICS_ENVIRONMENT", "nonprod")
    monkeypatch.setenv("ANALYTICS_CATALOG_BUCKET", "f3-analytics-nonprod")
    monkeypatch.setattr(
        cli,
        "JsonLogger",
        lambda: SimpleNamespace(
            info=lambda event, **context: events.append((event, context)), error=lambda *args, **kwargs: None
        ),
    )
    monkeypatch.setattr(cli, "RunId", SimpleNamespace(create=lambda: "run"))
    monkeypatch.setattr(cli, "select_materializations", lambda _names: ())
    monkeypatch.setattr(cli, "GcsPublisher", Publisher, raising=False)
    monkeypatch.setattr(google.cloud.storage, "Client", lambda: "storage")
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "analytics-etl",
            "rollback-catalog",
            "--release-manifest-uri",
            "gs://bucket/release.json",
            "--release-manifest-generation",
            "42",
            "--catalog-metageneration",
            "7",
        ],
    )

    assert cli.main() == 0
    assert calls[0][1] == CatalogSettings("nonprod", "f3-analytics-nonprod")
    assert calls[1] == ("7", "gs://bucket/release.json", "42")
    assert events[0] == ("analytics.etl.catalog_committed_unconfirmed", {"operation": "rollback"})


def test_rollback_command_returns_failure_on_catalog_cas_conflict(monkeypatch):
    class Publisher:
        @classmethod
        def from_catalog(cls, *_args):
            return cls()

        def rollback_catalog(self, *_args, **_kwargs):
            raise CatalogConflictError({"stage": "catalog_rollback"})

    monkeypatch.setenv("ANALYTICS_ENVIRONMENT", "nonprod")
    monkeypatch.setenv("ANALYTICS_CATALOG_BUCKET", "f3-analytics-nonprod")
    monkeypatch.setattr(
        cli,
        "JsonLogger",
        lambda: SimpleNamespace(info=lambda *args, **kwargs: None, error=lambda *args, **kwargs: None),
    )
    monkeypatch.setattr(cli, "RunId", SimpleNamespace(create=lambda: "run"))
    monkeypatch.setattr(cli, "select_materializations", lambda _names: ())
    monkeypatch.setattr(cli, "GcsPublisher", Publisher, raising=False)
    monkeypatch.setattr(google.cloud.storage, "Client", lambda: "storage")
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "analytics-etl",
            "rollback-catalog",
            "--release-manifest-uri",
            "u",
            "--release-manifest-generation",
            "1",
            "--catalog-metageneration",
            "2",
        ],
    )

    assert cli.main() == 1


def test_catalog_settings_reject_missing_or_wrong_target_without_database_config():
    with pytest.raises(SettingsError, match="ANALYTICS_CATALOG_BUCKET"):
        CatalogSettings.from_env({"ANALYTICS_ENVIRONMENT": "nonprod"})
    with pytest.raises(SettingsError, match="does not match"):
        CatalogSettings.from_env(
            {"ANALYTICS_ENVIRONMENT": "production", "ANALYTICS_CATALOG_BUCKET": "f3-analytics-nonprod"}
        )
    assert (
        CatalogSettings.from_env(
            {"ANALYTICS_ENVIRONMENT": "nonprod", "ANALYTICS_CATALOG_BUCKET": "f3-analytics-nonprod"}
        ).catalog_object
        == "parquets/catalog.json"
    )
