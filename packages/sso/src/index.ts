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

export interface OauthClient {
  clientId: string;
  redirectUri: string;
  authServerUrl: string;
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
  getOAuthConfig(): OauthClient {
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
