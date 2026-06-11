class F3ApiError(Exception):
    """Raised when the F3 Nation API returns a non-2xx status."""

    def __init__(self, status_code: int, message: str) -> None:
        self.status_code = status_code
        super().__init__(f"F3 API error {status_code}: {message}")


class F3ApiNotFoundError(F3ApiError):
    """Raised when the API returns 404."""


class F3ApiAuthError(F3ApiError):
    """Raised when the API returns 401 or 403."""
