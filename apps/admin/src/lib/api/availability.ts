/**
 * Upper bound on the server-side profile lookup that loads a session's roles.
 * Without it, an API that accepts connections but never answers (e.g. its
 * database is down) leaves admin pages hanging indefinitely.
 */
export const API_REQUEST_TIMEOUT_MS = 8_000;
