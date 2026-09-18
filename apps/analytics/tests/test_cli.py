from __future__ import annotations

import sys
from types import SimpleNamespace

import google.cloud.storage
import pytest

import analytics.cli as cli
import analytics.diagnostics as diagnostics
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


def test_diagnostics_command_logs_completion_on_success(monkeypatch):
    settings = SimpleNamespace(environment="test")
    logger = SimpleNamespace(
        info=lambda event, **context: events.append((event, context)), error=lambda *args, **kwargs: None
    )
    events = []
    calls = []

    monkeypatch.setattr(cli, "JsonLogger", lambda: logger)
    monkeypatch.setattr(cli, "RunId", SimpleNamespace(create=lambda: "run"))
    monkeypatch.setattr(cli, "select_materializations", lambda _names: ())
    monkeypatch.setattr(cli.Settings, "from_env", lambda: calls.append("settings") or settings)
    monkeypatch.setattr(
        diagnostics,
        "run_diagnostics",
        lambda received_settings, *, logger: (
            calls.append((received_settings, logger)) or {"postgres_scan": {"status": "succeeded"}}
        ),
    )
    monkeypatch.setattr(sys, "argv", ["analytics-etl", "diagnostics"])

    assert cli.main() == 0
    assert calls == ["settings", (settings, logger)]
    assert events[0][0] == "analytics.etl.diagnostics_completed"
    assert events[0][1]["failed_count"] == 0


def test_diagnostics_command_logs_completion_and_returns_failure_for_partial_probe_failure(monkeypatch):
    settings = SimpleNamespace(environment="test")
    logger = SimpleNamespace(
        info=lambda event, **context: events.append((event, context)), error=lambda *args, **kwargs: None
    )
    events = []

    monkeypatch.setattr(cli, "JsonLogger", lambda: logger)
    monkeypatch.setattr(cli, "RunId", SimpleNamespace(create=lambda: "run"))
    monkeypatch.setattr(cli, "select_materializations", lambda _names: ())
    monkeypatch.setattr(cli.Settings, "from_env", lambda: settings)
    monkeypatch.setattr(
        diagnostics,
        "run_diagnostics",
        lambda received_settings, *, logger: {
            "postgres_scan": {"status": "succeeded"},
            "territory_count": {"status": "failed"},
        },
    )
    monkeypatch.setattr(sys, "argv", ["analytics-etl", "diagnostics"])

    assert cli.main() == 1
    assert events[0][0] == "analytics.etl.diagnostics_completed"
    assert events[0][1]["failed_count"] == 1


def test_full_query_diagnostics_command_isolated_success_without_gcs_or_selectors(monkeypatch):
    settings = SimpleNamespace(environment="test")
    events = []
    logger = SimpleNamespace(
        info=lambda event, **context: events.append((event, context)), error=lambda *args, **kwargs: None
    )
    calls = []

    monkeypatch.setattr(cli, "JsonLogger", lambda: logger)
    monkeypatch.setattr(cli, "RunId", SimpleNamespace(create=lambda: "run"))
    monkeypatch.setattr(cli.Settings, "from_env", lambda: settings)
    monkeypatch.setattr(cli, "select_materializations", lambda _names: (_ for _ in ()).throw(AssertionError()))
    monkeypatch.setattr(cli, "_storage_client", lambda: (_ for _ in ()).throw(AssertionError("GCS")))
    monkeypatch.setattr(
        diagnostics,
        "run_full_query_diagnostics",
        lambda received_settings, *, logger, scanner_mode: (
            calls.append((received_settings, logger)),
            {"pv_kotter": {"status": "succeeded"}, "pv_events": {"status": "succeeded"}},
        )[1],
    )
    monkeypatch.setattr(sys, "argv", ["analytics-etl", "diagnostics-full-query"])

    assert cli.main() == 0
    assert calls == [(settings, logger)]
    assert events == [
        (
            "analytics.etl.diagnostics_full_query_completed",
            {
                "run_id": "run",
                "environment": "test",
                "dataset_count": 2,
                "failed_count": 0,
                "scanner_mode": "binary-copy",
            },
        )
    ]


def test_full_query_diagnostics_forwards_text_copy_scanner_mode(monkeypatch):
    settings = SimpleNamespace(environment="test")
    events = []
    scanner_modes = []
    logger = SimpleNamespace(
        info=lambda event, **context: events.append((event, context)), error=lambda *args, **kwargs: None
    )
    monkeypatch.setattr(cli, "JsonLogger", lambda: logger)
    monkeypatch.setattr(cli, "RunId", SimpleNamespace(create=lambda: "run"))
    monkeypatch.setattr(cli.Settings, "from_env", lambda: settings)
    monkeypatch.setattr(
        diagnostics,
        "run_full_query_diagnostics",
        lambda _settings, *, logger, scanner_mode: (
            scanner_modes.append(scanner_mode),
            {"pv_kotter": {"status": "succeeded"}, "pv_events": {"status": "succeeded"}},
        )[1],
    )
    monkeypatch.setattr(
        sys,
        "argv",
        ["analytics-etl", "diagnostics-full-query", "--scanner-mode=text-copy"],
    )

    assert cli.main() == 0
    assert scanner_modes == ["text-copy"]
    assert events[-1][1]["scanner_mode"] == "text-copy"


def test_full_query_diagnostics_command_returns_failure_and_rejects_selector(monkeypatch):
    settings = SimpleNamespace(environment="test")
    events = []
    logger = SimpleNamespace(
        info=lambda event, **context: events.append((event, context)), error=lambda *args, **kwargs: None
    )
    monkeypatch.setattr(cli, "JsonLogger", lambda: logger)
    monkeypatch.setattr(cli, "RunId", SimpleNamespace(create=lambda: "run"))
    monkeypatch.setattr(cli.Settings, "from_env", lambda: settings)
    monkeypatch.setattr(
        diagnostics,
        "run_full_query_diagnostics",
        lambda _settings, *, logger, scanner_mode: {
            "pv_kotter": {"status": "failed"},
            "pv_events": {"status": "succeeded"},
        },
    )
    monkeypatch.setattr(sys, "argv", ["analytics-etl", "diagnostics-full-query"])
    assert cli.main() == 1
    assert events[0][0] == "analytics.etl.diagnostics_full_query_completed"
    assert events[0][1]["failed_count"] == 1
    assert events[0][1]["scanner_mode"] == "binary-copy"

    monkeypatch.setattr(sys, "argv", ["analytics-etl", "diagnostics-full-query", "--materialization", "pv_events"])
    with pytest.raises(SystemExit):
        cli.main()

    monkeypatch.setattr(sys, "argv", ["analytics-etl", "diagnostics-full-query", "--scanner-mode", "invalid"])
    with pytest.raises(SystemExit):
        cli.main()
