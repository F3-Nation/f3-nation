"""Encryption for the Slack refresh token stored in `slack_spaces`.

`SLACK_TOKEN_ENCRYPTION_KEY` holds comma-separated Fernet keys, newest first.
Encryption uses the first key; decryption tries each, so a key can be rotated
by prepending a new one and re-encrypting rows before dropping the old one.

Failures raise `TokenDecryptError` with a fixed message and no chained cause,
so key material and ciphertext never reach logs or tracebacks.
"""

import os

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

_ENV_VAR = "SLACK_TOKEN_ENCRYPTION_KEY"


class TokenDecryptError(Exception):
    """The refresh token could not be encrypted or decrypted."""


def _cipher() -> MultiFernet:
    keys = [k.strip() for k in os.environ.get(_ENV_VAR, "").split(",") if k.strip()]
    if not keys:
        raise TokenDecryptError(f"{_ENV_VAR} is not set")
    try:
        return MultiFernet([Fernet(k) for k in keys])
    except (ValueError, TypeError):
        pass
    # Raised outside the except block so the key error is not chained.
    raise TokenDecryptError(f"{_ENV_VAR} contains an invalid Fernet key")


def encrypt_refresh_token(plaintext: str) -> str:
    """Encrypt with the newest key."""
    return _cipher().encrypt(plaintext.encode()).decode()


def decrypt_refresh_token(ciphertext: str) -> str:
    """Decrypt with any configured key."""
    cipher = _cipher()
    try:
        return cipher.decrypt(ciphertext.encode()).decode()
    except (InvalidToken, ValueError, TypeError):
        pass
    raise TokenDecryptError("refresh token could not be decrypted")
