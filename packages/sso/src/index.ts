// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authServerUrl: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
  scope?: string;
}

export interface AuthUser {
  sub: number;
  name?: string;
  email?: string;
  emailVerified?: boolean;
  picture?: string;
}

export interface OAuthClient {
  clientId: string;
  redirectUri: string;
  authServerUrl: string;
}

export interface OAuthStatePayload {
  csrfToken: string;
  returnTo: string;
  timestamp: number;
}

export interface OAuthLoginFlowArtifacts {
  csrfToken: string;
  codeVerifier: string;
  codeChallenge: string;
  state: string;
}

// ---------------------------------------------------------------------------
// SDK Error
// ---------------------------------------------------------------------------

export class AuthError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

// ---------------------------------------------------------------------------
// AuthClient
// ---------------------------------------------------------------------------

export class AuthClient {
  private config: AuthClientConfig;

  constructor(config: AuthClientConfig) {
    this.config = config;
  }

  /** Returns public OAuth config (no secrets). Safe for client-side use. */
  getOAuthConfig(): OAuthClient {
    return {
      clientId: this.config.clientId,
      redirectUri: this.config.redirectUri,
      authServerUrl: this.config.authServerUrl,
    };
  }

  /** Build the authorization URL to redirect users to. */
  getAuthorizationUrl(params?: {
    scope?: string;
    state?: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
  }): string {
    const url = new URL("/api/oauth/authorize", this.config.authServerUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("scope", params?.scope ?? "openid profile email");
    if (params?.state) url.searchParams.set("state", params.state);
    if (params?.codeChallenge) {
      url.searchParams.set("code_challenge", params.codeChallenge);
      url.searchParams.set(
        "code_challenge_method",
        params.codeChallengeMethod ?? "S256",
      );
    }
    return url.toString();
  }

  /** Exchanges an authorization code for access + refresh tokens. Server-side only. */
  async exchangeCodeForToken(params: {
    code: string;
    codeVerifier?: string;
  }): Promise<AuthTokens> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });
    if (params.codeVerifier) {
      body.set("code_verifier", params.codeVerifier);
    }

    const res = await fetch(`${this.config.authServerUrl}/api/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const data = (await res.json()) as Record<string, unknown>;

    if (!res.ok) {
      throw new AuthError(
        (data.error_description as string) ??
          (data.error as string) ??
          "Token exchange failed",
        (data.error as string) ?? "unknown",
        res.status,
      );
    }

    return {
      accessToken: data.access_token as string,
      refreshToken: data.refresh_token as string | undefined,
      expiresIn: data.expires_in as number | undefined,
      tokenType: data.token_type as string | undefined,
      scope: data.scope as string | undefined,
    };
  }

  /** Uses a refresh token to get a new access token. Server-side only. */
  async refreshToken(params: { refreshToken: string }): Promise<AuthTokens> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: params.refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    const res = await fetch(`${this.config.authServerUrl}/api/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const data = (await res.json()) as Record<string, unknown>;

    if (!res.ok) {
      throw new AuthError(
        (data.error_description as string) ??
          (data.error as string) ??
          "Token refresh failed",
        (data.error as string) ?? "unknown",
        res.status,
      );
    }

    return {
      accessToken: data.access_token as string,
      refreshToken: data.refresh_token as string | undefined,
      expiresIn: data.expires_in as number | undefined,
      tokenType: data.token_type as string | undefined,
      scope: data.scope as string | undefined,
    };
  }

  /** Fetches user profile from the userinfo endpoint. Server-side only. */
  async getUserInfo(accessToken: string): Promise<AuthUser> {
    const res = await fetch(`${this.config.authServerUrl}/api/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const data = (await res.json()) as Record<string, unknown>;

    if (!res.ok) {
      throw new AuthError(
        (data.error as string) ?? "Failed to fetch user info",
        (data.error as string) ?? "unknown",
        res.status,
      );
    }

    return {
      sub: data.sub as number,
      name: data.name as string | undefined,
      email: data.email as string | undefined,
      emailVerified: data.email_verified as boolean | undefined,
      picture: data.picture as string | undefined,
    };
  }

  /** Revokes an access or refresh token. Server-side only. */
  async revokeToken(token: string): Promise<void> {
    const body = new URLSearchParams({ token });

    const res = await fetch(`${this.config.authServerUrl}/api/oauth/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      throw new AuthError(
        (data.error as string) ?? "Token revocation failed",
        (data.error as string) ?? "unknown",
        res.status,
      );
    }
  }
}

function getCrypto(): Crypto {
  if (!globalThis.crypto) {
    throw new AuthError(
      "Web Crypto API is not available",
      "crypto_unavailable",
    );
  }

  return globalThis.crypto;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  if (typeof btoa !== "function") {
    throw new AuthError(
      "Base64 encoding is not available",
      "base64_unavailable",
    );
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(base64, "base64"));
  }

  if (typeof atob !== "function") {
    throw new AuthError(
      "Base64 decoding is not available",
      "base64_unavailable",
    );
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function toBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return base64ToBytes(padded);
}

function randomBase64Url(bytesLength: number): string {
  const bytes = new Uint8Array(bytesLength);
  getCrypto().getRandomValues(bytes);
  return toBase64Url(bytes);
}

export function isSafeReturnPath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//") || path.startsWith("/\\")) return false;
  if (/[\\\r\n\t]/.test(path)) return false;
  return true;
}

export function sanitizeReturnPath(
  path: string | null | undefined,
  fallbackPath: string,
): string {
  if (!path) return fallbackPath;
  return isSafeReturnPath(path) ? path : fallbackPath;
}

export function createOAuthState(payload: OAuthStatePayload): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  return toBase64Url(bytes);
}

export function parseOAuthState(stateParam: string): OAuthStatePayload | null {
  try {
    const bytes = fromBase64Url(stateParam);
    const state = JSON.parse(new TextDecoder().decode(bytes)) as unknown;

    if (typeof state !== "object" || state === null) return null;

    const candidate = state as Partial<OAuthStatePayload>;
    if (
      typeof candidate.csrfToken !== "string" ||
      typeof candidate.returnTo !== "string" ||
      typeof candidate.timestamp !== "number" ||
      !Number.isFinite(candidate.timestamp)
    ) {
      return null;
    }

    return {
      csrfToken: candidate.csrfToken,
      returnTo: candidate.returnTo,
      timestamp: candidate.timestamp,
    };
  } catch {
    return null;
  }
}

export function isOAuthStateExpired(
  state: Pick<OAuthStatePayload, "timestamp">,
  maxAgeMs = 600_000,
  nowMs = Date.now(),
): boolean {
  return nowMs - state.timestamp > maxAgeMs;
}

export async function createOAuthLoginFlowArtifacts(params: {
  returnTo: string;
  timestamp?: number;
}): Promise<OAuthLoginFlowArtifacts> {
  const csrfToken = getCrypto().randomUUID();
  const codeVerifier = randomBase64Url(32);
  const digest = await getCrypto().subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier),
  );
  const codeChallenge = toBase64Url(new Uint8Array(digest));

  const state = createOAuthState({
    csrfToken,
    returnTo: params.returnTo,
    timestamp: params.timestamp ?? Date.now(),
  });

  return {
    csrfToken,
    codeVerifier,
    codeChallenge,
    state,
  };
}
