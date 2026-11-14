from f3_data_models.models import UserStravaCredential


def test_credential_serialization_excludes_tokens():
    row = UserStravaCredential(
        user_id=1,
        athlete_id=2,
        access_token="synthetic-access",
        refresh_token="synthetic-refresh",
        expires_at=2000000000,
    )
    assert row.to_json() == {"user_id": 1, "athlete_id": 2}
    assert "synthetic-access" not in repr(row)
    assert "synthetic-refresh" not in str(row)
