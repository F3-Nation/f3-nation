import { SESSION_COOKIE_MAX_AGE } from "./constants";

const encoder = new TextEncoder();

async function getKey(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function base64UrlEncode(data: Uint8Array): string {
  return Buffer.from(data)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  return new Uint8Array(Buffer.from(padded, "base64"));
}

export interface SessionPayload {
  sub: string;
  email: string;
  name?: string;
  iat: number;
}

export async function signSession(payload: SessionPayload): Promise<string> {
  const key = await getKey();
  const payloadStr = JSON.stringify(payload);
  const payloadBytes = encoder.encode(payloadStr);
  const payloadB64 = base64UrlEncode(payloadBytes);

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payloadB64),
  );
  const sigB64 = base64UrlEncode(new Uint8Array(signature));

  return `${payloadB64}.${sigB64}`;
}

export async function verifySession(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const [payloadB64, sigB64] = token.split(".");
    if (!payloadB64 || !sigB64) return null;

    const key = await getKey();
    const expectedSig = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(payloadB64),
    );
    const expectedSigB64 = base64UrlEncode(new Uint8Array(expectedSig));

    // Timing-safe comparison
    if (sigB64.length !== expectedSigB64.length) return null;
    const a = encoder.encode(sigB64);
    const b = encoder.encode(expectedSigB64);
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
    }
    if (diff !== 0) return null;

    const payloadBytes = base64UrlDecode(payloadB64);
    const payload = JSON.parse(
      new TextDecoder().decode(payloadBytes),
    ) as SessionPayload;

    // Check expiry
    const age = Math.floor(Date.now() / 1000) - payload.iat;
    if (age > SESSION_COOKIE_MAX_AGE) return null;

    return payload;
  } catch {
    return null;
  }
}
