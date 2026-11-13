"""Transactional, server-only credential access. Never reads profile metadata."""

import logging
from collections.abc import Callable
from time import time

from f3_data_models.models import UserStravaCredential
from f3_data_models.utils import session_scope
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError, SQLAlchemyError


class StravaOwnershipConflict(Exception):
    """The athlete already belongs to another F3 profile; keep its owner."""


class StravaNotConnectedError(Exception):
    """No stored Strava connection; its message is safe to show to the member."""


def _diag(error: SQLAlchemyError) -> tuple[str, str | None, str | None]:
    original = getattr(error, "orig", None)
    return (
        type(original if original is not None else error).__name__,
        getattr(original, "pgcode", None),
        getattr(getattr(original, "diag", None), "constraint_name", None),
    )


def _missing_store(error: SQLAlchemyError) -> bool:
    original = getattr(error, "orig", None)
    primary = getattr(getattr(original, "diag", None), "message_primary", None)
    return getattr(original, "pgcode", None) == "42P01" and primary in {
        'relation "user_strava_credentials" does not exist',
        'relation "public.user_strava_credentials" does not exist',
    }


def _bundle(data: object) -> dict:
    if not isinstance(data, dict):
        raise ValueError("Invalid Strava credential bundle")
    access = data.get("access_token")
    refresh = data.get("refresh_token")
    expires = data.get("expires_at")
    if not (
        isinstance(access, str)
        and access
        and isinstance(refresh, str)
        and refresh
        and type(expires) is int
        and expires > 0
    ):
        raise ValueError("Invalid Strava credential bundle")
    return {"access_token": access, "refresh_token": refresh, "expires_at": expires}


def save_connection(user_id: int, data: dict) -> bool:
    bundle = _bundle(data)
    athlete_data = data.get("athlete")
    athlete = athlete_data.get("id") if isinstance(athlete_data, dict) else None
    if type(athlete) is not int or athlete <= 0:
        raise ValueError("Invalid Strava athlete")
    try:
        with session_scope(backend="postgresql") as session:
            statement = insert(UserStravaCredential).values(user_id=user_id, athlete_id=athlete, **bundle)
            session.execute(
                statement.on_conflict_do_update(
                    index_elements=[UserStravaCredential.user_id],
                    set_={"athlete_id": athlete, **bundle},
                )
            )
        logging.info("strava.credentials.saved")
        return True
    except SQLAlchemyError as error:
        # Only this missing relation means disconnected; other database errors
        # become value-free failures without SQL, parameters or chained causes.
        original = getattr(error, "orig", None)
        if (
            isinstance(error, IntegrityError)
            and getattr(original, "pgcode", None) == "23505"
            and getattr(getattr(original, "diag", None), "constraint_name", None)
            == "user_strava_credentials_athlete_id_key"
        ):
            logging.warning("strava.credentials.ownership_conflict user_id=%s", user_id)
            raise StravaOwnershipConflict("Strava account is already connected to another F3 profile") from None
        if _missing_store(error):
            logging.warning("strava.credentials.store_missing operation=save user_id=%s", user_id)
            return False
        logging.error(
            "strava.credentials.storage_failed operation=save user_id=%s error_class=%s pgcode=%s constraint=%s",
            user_id,
            *_diag(error),
        )
        raise RuntimeError("Strava credential storage failed") from None


def get_access_token(user_id: int, refresh: Callable[[str], dict], *, now: float | None = None) -> str | None:
    try:
        with session_scope(backend="postgresql") as session:
            # FOR UPDATE serializes refreshes with reconnect upserts, so a stale refresh
            # cannot overwrite a newer bundle. The lock is held during the provider call;
            # its timeout bounds each connect/read wait, not total request duration.
            row = session.scalar(
                select(UserStravaCredential).where(UserStravaCredential.user_id == user_id).with_for_update()
            )
            if row is None:
                return None
            if row.expires_at <= (time() if now is None else now):
                bundle = _bundle(refresh(row.refresh_token))
                row.access_token = bundle["access_token"]
                row.refresh_token = bundle["refresh_token"]
                row.expires_at = bundle["expires_at"]
            return row.access_token
    except SQLAlchemyError as error:
        if _missing_store(error):
            logging.warning("strava.credentials.store_missing operation=read user_id=%s", user_id)
            return None
        logging.error(
            "strava.credentials.storage_failed operation=read user_id=%s error_class=%s pgcode=%s constraint=%s",
            user_id,
            *_diag(error),
        )
        raise RuntimeError("Strava credential storage failed") from None
