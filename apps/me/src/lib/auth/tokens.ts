interface AccessTokenPayload {
  sub: string;
  email?: string;
  exp?: number;
  iat?: number;
  scope?: string;
  client_id?: string;
}

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");

  if (typeof atob === "function") {
    return atob(padded);
  }

  return Buffer.from(padded, "base64").toString("utf-8");
}

export function parseAccessTokenPayload(
  token: string,
): AccessTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payloadPart = parts[1];
  if (!payloadPart) return null;

  try {
    const payload = JSON.parse(decodeBase64Url(payloadPart)) as unknown;
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as Record<string, unknown>).sub !== "string"
    ) {
      return null;
    }

    return payload as AccessTokenPayload;
  } catch {
    return null;
  }
}

export function isAccessTokenExpired(token: string, skewSeconds = 60): boolean {
  const payload = parseAccessTokenPayload(token);
  if (typeof payload?.exp !== "number" || !Number.isFinite(payload.exp)) {
    return true;
  }

  const now = Math.floor(Date.now() / 1000);
  return payload.exp <= now + skewSeconds;
}
