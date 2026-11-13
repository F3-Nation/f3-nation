"""Encryption for the Slack refresh token stored in `slack_spaces`.

`SLACK_TOKEN_ENCRYPTION_KEY` holds comma-separated Fernet keys, newest first.
Encryption uses the first key; decryption tries each, so a key can be rotated
by prepending a new one and re-encrypting rows before dropping the old one.

Failures raise `TokenDecryptError` with a fixed message and no chained cause,
so key material and ciphertext never reach logs or tracebacks.
"""

import logging
import os

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from utilities import constants

logger = logging.getLogger(__name__)

_ENV_VAR = "SLACK_TOKEN_ENCRYPTION_KEY"


class TokenDecryptError(Exception):
    """The refresh token could not be encrypted or decrypted."""


def _fernets() -> list[Fernet]:
    keys = [k.strip() for k in os.environ.get(_ENV_VAR, "").split(",") if k.strip()]
    if not keys:
        raise TokenDecryptError(f"{_ENV_VAR} is not set")
    try:
        return [Fernet(k) for k in keys]
    except (ValueError, TypeError):
        pass
    # Raised outside the except block so the key error is not chained.
    raise TokenDecryptError(f"{_ENV_VAR} contains an invalid Fernet key")


def _cipher() -> MultiFernet:
    return MultiFernet(_fernets())


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


def check_encryption_key() -> bool:
    """Log `slack.token.encryption_key_invalid` at ERROR if the key list is unset or unparseable.

    Called where the app and the hourly job start, so a missing or broken key
    shows up at deploy time instead of at the first refresh. Skipped in local
    development, where the key is optional. Never logs key material.
    """
    if constants.LOCAL_DEVELOPMENT:
        return True
    try:
        _cipher()
    except TokenDecryptError:
        event = "slack.token.encryption_key_invalid"
        logger.error(event, extra={"json_fields": {"event": event}})
        return False
    return True


def reencrypt_refresh_token(ciphertext: str) -> str:
    """Re-encrypt with the newest key, decrypting with whichever listed key matches.

    The plaintext is never returned.
    """
    cipher = _cipher()
    try:
        return cipher.rotate(ciphertext.encode()).decode()
    except (InvalidToken, ValueError, TypeError):
        pass
    raise TokenDecryptError("refresh token could not be decrypted")


def decrypts_with_primary_key(ciphertext: str) -> bool:
    """True when the newest key alone decrypts the ciphertext."""
    try:
        _fernets()[0].decrypt(ciphertext.encode())
    except (InvalidToken, ValueError, TypeError):
        return False
    return True
