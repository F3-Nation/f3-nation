import logging

import pytest
from cryptography.fernet import Fernet

from utilities import constants
from utilities.slack_tokens.crypto import (
    TokenDecryptError,
    check_encryption_key,
    decrypt_refresh_token,
    decrypts_with_primary_key,
    encrypt_refresh_token,
    reencrypt_refresh_token,
)

ENV = "SLACK_TOKEN_ENCRYPTION_KEY"


def _key() -> str:
    return Fernet.generate_key().decode()


def test_round_trip(monkeypatch):
    monkeypatch.setenv(ENV, _key())
    ciphertext = encrypt_refresh_token("xoxe-1-abc")
    assert "xoxe" not in ciphertext
    assert decrypt_refresh_token(ciphertext) == "xoxe-1-abc"


def test_previous_key_still_decrypts(monkeypatch):
    key_a, key_b = _key(), _key()
    monkeypatch.setenv(ENV, key_a)
    old = encrypt_refresh_token("xoxe-1-abc")

    monkeypatch.setenv(ENV, f"{key_b},{key_a}")
    assert decrypt_refresh_token(old) == "xoxe-1-abc"

    rekeyed = encrypt_refresh_token(decrypt_refresh_token(old))
    monkeypatch.setenv(ENV, key_b)
    assert decrypt_refresh_token(rekeyed) == "xoxe-1-abc"
    with pytest.raises(TokenDecryptError):
        decrypt_refresh_token(old)


def test_keys_are_stripped(monkeypatch):
    key_a, key_b = _key(), _key()
    monkeypatch.setenv(ENV, key_a)
    old = encrypt_refresh_token("xoxe-1-abc")
    monkeypatch.setenv(ENV, f" {key_b} , {key_a} ")
    assert decrypt_refresh_token(old) == "xoxe-1-abc"


@pytest.mark.parametrize("value", [None, "", "  "])
def test_missing_key_raises(monkeypatch, value):
    if value is None:
        monkeypatch.delenv(ENV, raising=False)
    else:
        monkeypatch.setenv(ENV, value)
    with pytest.raises(TokenDecryptError):
        encrypt_refresh_token("xoxe-1-abc")
    with pytest.raises(TokenDecryptError):
        decrypt_refresh_token("anything")


def test_wrong_key_raises(monkeypatch):
    monkeypatch.setenv(ENV, _key())
    ciphertext = encrypt_refresh_token("xoxe-1-abc")
    monkeypatch.setenv(ENV, _key())
    with pytest.raises(TokenDecryptError):
        decrypt_refresh_token(ciphertext)


def test_garbage_ciphertext_raises(monkeypatch):
    monkeypatch.setenv(ENV, _key())
    with pytest.raises(TokenDecryptError):
        decrypt_refresh_token("not-a-token")


def test_malformed_key_raises_without_leaking_it(monkeypatch):
    monkeypatch.setenv(ENV, "super-secret-not-a-fernet-key")
    with pytest.raises(TokenDecryptError) as exc:
        encrypt_refresh_token("xoxe-1-abc")
    assert "super-secret" not in str(exc.value)
    assert exc.value.__cause__ is None


def _key_invalid_records(caplog):
    return [r for r in caplog.records if r.getMessage() == "slack.token.encryption_key_invalid"]


@pytest.mark.parametrize("value", [None, "", "set-yourself", "not-a-key,also-not"])
def test_check_encryption_key_logs_error_when_unset_or_unparseable(monkeypatch, caplog, value):
    monkeypatch.setattr(constants, "LOCAL_DEVELOPMENT", False)
    if value is None:
        monkeypatch.delenv(ENV, raising=False)
    else:
        monkeypatch.setenv(ENV, value)

    with caplog.at_level(logging.ERROR):
        assert check_encryption_key() is False

    [record] = _key_invalid_records(caplog)
    assert record.levelno == logging.ERROR
    assert record.json_fields == {"event": "slack.token.encryption_key_invalid"}
    if value:
        assert value not in caplog.text


def test_check_encryption_key_accepts_a_key_list(monkeypatch, caplog):
    monkeypatch.setattr(constants, "LOCAL_DEVELOPMENT", False)
    monkeypatch.setenv(ENV, f"{_key()},{_key()}")

    assert check_encryption_key() is True
    assert _key_invalid_records(caplog) == []


def test_check_encryption_key_is_skipped_in_local_development(monkeypatch, caplog):
    monkeypatch.setattr(constants, "LOCAL_DEVELOPMENT", True)
    monkeypatch.delenv(ENV, raising=False)

    assert check_encryption_key() is True
    assert _key_invalid_records(caplog) == []


def test_reencrypt_moves_to_primary_key(monkeypatch):
    key_a, key_b = _key(), _key()
    monkeypatch.setenv(ENV, key_a)
    old = encrypt_refresh_token("xoxe-1-abc")

    monkeypatch.setenv(ENV, f"{key_b},{key_a}")
    new = reencrypt_refresh_token(old)

    monkeypatch.setenv(ENV, key_b)
    assert decrypt_refresh_token(new) == "xoxe-1-abc"


def test_reencrypt_fails_when_no_key_decrypts(monkeypatch):
    monkeypatch.setenv(ENV, _key())
    old = encrypt_refresh_token("xoxe-1-abc")

    monkeypatch.setenv(ENV, f"{_key()},{_key()}")
    with pytest.raises(TokenDecryptError) as raised:
        reencrypt_refresh_token(old)
    assert old not in str(raised.value)


def test_decrypts_with_primary_key(monkeypatch):
    key_a, key_b = _key(), _key()
    monkeypatch.setenv(ENV, key_a)
    old = encrypt_refresh_token("xoxe-1-abc")

    monkeypatch.setenv(ENV, f"{key_b},{key_a}")
    assert decrypts_with_primary_key(old) is False
    assert decrypts_with_primary_key(reencrypt_refresh_token(old)) is True
    assert decrypts_with_primary_key("not-a-token") is False
