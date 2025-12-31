export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  [key: string]: unknown;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
  [key: string]: unknown;
}

export interface OauthClient {
  CLIENT_ID: string;
  REDIRECT_URI: string;
  AUTH_SERVER_URL: string;
}

export interface OauthClients {
  [key: string]: OauthClient;
}

export interface TokenExchangeParams {
  code: string;
}

export interface ClientConfig {
  CLIENT_ID: string;
  CLIENT_SECRET: string;
  REDIRECT_URI: string;
  AUTH_SERVER_URL: string;
}
