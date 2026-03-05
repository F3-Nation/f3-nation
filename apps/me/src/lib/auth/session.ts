import { createHmac, timingSafeEqual } from "crypto";
import { SESSION_COOKIE_MAX_AGE } from "@/lib/auth/constants";

export interface SessionPayload {
  sub: string;
  email: string;
  name?: string;
  iat: number;
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET env var is required");
  return secret;
}

function sign(data: string): string {
  return createHmac("sha256", getSecret()).update(data).digest("base64url");
}

export function createSessionValue(
  payload: Omit<SessionPayload, "iat">,
): string {
  const full: SessionPayload = {
    ...payload,
    iat: Math.floor(Date.now() / 1000),
  };
  const json = Buffer.from(JSON.stringify(full)).toString("base64url");
  const signature = sign(json);
  return `${json}.${signature}`;
}

export function verifySessionValue(cookie: string): SessionPayload | null {
  const dotIdx = cookie.lastIndexOf(".");
  if (dotIdx === -1) return null;

  const json = cookie.slice(0, dotIdx);
  const signature = cookie.slice(dotIdx + 1);

  const expected = sign(json);
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(json, "base64url").toString("utf-8"),
    ) as SessionPayload;

    const age = Math.floor(Date.now() / 1000) - payload.iat;
    if (age > SESSION_COOKIE_MAX_AGE) return null;

    return payload;
  } catch {
    return null;
  }
}
