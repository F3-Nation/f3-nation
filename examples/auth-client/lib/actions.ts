'use server';

import { AuthClient, type AuthClientConfig } from 'f3-nation-auth-sdk';

interface OauthClient {
  CLIENT_ID: string;
  REDIRECT_URI: string;
  AUTH_SERVER_URL: string;
}

interface TokenExchangeParams {
  code: string;
}

// Create AuthClient configuration from environment variables
// This client only knows about itself - no other client secrets needed
const authConfig: AuthClientConfig = {
  client: {
    CLIENT_ID: process.env.OAUTH_CLIENT_ID || '',
    CLIENT_SECRET: process.env.OAUTH_CLIENT_SECRET || '',
    REDIRECT_URI: process.env.OAUTH_REDIRECT_URI || '',
    AUTH_SERVER_URL: process.env.AUTH_PROVIDER_URL || '',
  },
};

// Create AuthClient instance
const authClient = new AuthClient(authConfig);

export async function getOAuthConfig(): Promise<OauthClient> {
  return authClient.getOAuthConfig();
}

export async function exchangeCodeForToken(params: TokenExchangeParams) {
  return authClient.exchangeCodeForToken(params);
}
