import pytest
from cryptography.fernet import Fernet

from utilities.slack_tokens.crypto import (
    TokenDecryptError,
    decrypt_refresh_token,
    encrypt_refresh_token,
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
