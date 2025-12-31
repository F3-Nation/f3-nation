import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { oauthClientRepository } from '@/db';
import {
  validateClient,
  validateRedirectUri,
  validateScopes,
  createAuthorizationCode,
  generateAuthorizationState,
  validateAuthorizationState,
  type AuthorizationRequest,
} from '@/lib/oauth';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  // Parse OAuth parameters
  const authRequest: AuthorizationRequest = {
    response_type: searchParams.get('response_type') || '',
    client_id: searchParams.get('client_id') || '',
    redirect_uri: searchParams.get('redirect_uri') || '',
    scope: searchParams.get('scope') || 'openid profile email',
    state: searchParams.get('state') || undefined,
    code_challenge: searchParams.get('code_challenge') || undefined,
    code_challenge_method: searchParams.get('code_challenge_method') || undefined,
  };

  // Validate required parameters
  if (!authRequest.response_type || !authRequest.client_id || !authRequest.redirect_uri) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Missing required parameters' },
      { status: 400 }
    );
  }

  // Only support authorization code flow
  if (authRequest.response_type !== 'code') {
    return NextResponse.json(
      {
        error: 'unsupported_response_type',
        error_description: 'Only authorization code flow is supported',
      },
      { status: 400 }
    );
  }

  try {
    // Validate client
    const client = await validateClient(authRequest.client_id);
    if (!client) {
      return NextResponse.json(
        { error: 'invalid_client', error_description: 'Invalid client_id' },
        { status: 400 }
      );
    }

    // Validate redirect URI
    if (!validateRedirectUri(client, authRequest.redirect_uri)) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'Invalid redirect_uri' },
        { status: 400 }
      );
    }

    // Validate scopes
    const requestedScopes = authRequest.scope?.split(' ') || ['openid'];
    if (!validateScopes(client, requestedScopes)) {
      const errorUrl = new URL(authRequest.redirect_uri);
      errorUrl.searchParams.set('error', 'invalid_scope');
      errorUrl.searchParams.set('error_description', 'Invalid scope requested');
      if (authRequest.state) {
        errorUrl.searchParams.set('state', authRequest.state);
      }
      return NextResponse.redirect(errorUrl.toString());
    }

    // Check if user is authenticated
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      // Redirect to login with OAuth parameters preserved
      // Always use NEXTAUTH_URL as the base URL for callback
      const baseUrl = process.env.NEXTAUTH_URL || 'https://auth.f3nation.com';
      const loginUrl = new URL('/login', baseUrl);

      // Construct callback URL with the proper external domain
      const callbackUrl = new URL(request.nextUrl.pathname, baseUrl);
      request.nextUrl.searchParams.forEach((value, key) => {
        callbackUrl.searchParams.set(key, value);
      });

      // Generate encoded state if not provided
      const state =
        authRequest.state ||
        generateAuthorizationState(
          crypto.randomUUID(),
          authRequest.client_id,
          authRequest.redirect_uri
        );

      loginUrl.searchParams.set('callbackUrl', callbackUrl.toString());
      loginUrl.searchParams.set('state', state);

      // Create a redirect response with proper headers for cross-origin requests
      const response = NextResponse.redirect(loginUrl.toString());
      const origin = request.headers.get('origin');
      if (origin) {
        const dbClient = await oauthClientRepository.findById(authRequest.client_id);
        if (dbClient && origin === dbClient.allowedOrigin) {
          response.headers.set('Access-Control-Allow-Origin', dbClient.allowedOrigin);
          response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
          response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          response.headers.set('Access-Control-Allow-Credentials', 'true');
        }
      }
      return response;
    }
    // Check if user has completed onboarding (has f3Name and hospitalName)
    if (!session.user.f3Name || !session.user.hospitalName || !session.user.onboardingCompleted) {
      // Redirect to onboarding with OAuth parameters preserved
      // Use NEXTAUTH_URL as the base URL to ensure consistency
      const baseUrl = process.env.NEXTAUTH_URL || request.nextUrl.origin;

      const onboardingUrl = new URL('/onboarding', baseUrl);
      // Construct callback URL without encoding (will be encoded by URL constructor)
      const callbackUrl = new URL(request.nextUrl.pathname, baseUrl);
      request.nextUrl.searchParams.forEach((value, key) => {
        callbackUrl.searchParams.set(key, value);
      });
      onboardingUrl.searchParams.set('callbackUrl', callbackUrl.toString());

      // Create a redirect response with proper headers for cross-origin requests
      const response = NextResponse.redirect(onboardingUrl.toString());
      const origin = request.headers.get('origin');
      if (origin) {
        response.headers.set('Access-Control-Allow-Origin', origin);
        response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
        response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        response.headers.set('Access-Control-Allow-Credentials', 'true');
      }
      return response;
    }

    // User is authenticated and has completed onboarding, create authorization code
    const code = await createAuthorizationCode(
      authRequest.client_id,
      session.user.id,
      authRequest.redirect_uri,
      requestedScopes,
      authRequest.code_challenge,
      authRequest.code_challenge_method
    );

    // Validate state if provided
    if (authRequest.state) {
      try {
        validateAuthorizationState(authRequest.state);
      } catch (error) {
        console.error('Invalid state parameter:', error);
        const errorUrl = new URL(authRequest.redirect_uri);
        errorUrl.searchParams.set('error', 'invalid_request');
        errorUrl.searchParams.set('error_description', 'Invalid state parameter');
        return NextResponse.redirect(errorUrl.toString());
      }
    }

    // Redirect back to client with authorization code
    const redirectUrl = new URL(authRequest.redirect_uri);
    redirectUrl.searchParams.set('code', code);
    if (authRequest.state) {
      redirectUrl.searchParams.set('state', authRequest.state);
    }

    const response = NextResponse.redirect(redirectUrl.toString());
    const origin = request.headers.get('origin');
    if (origin) {
      const dbClient = await oauthClientRepository.findById(authRequest.client_id);
      if (dbClient && origin === dbClient.allowedOrigin) {
        response.headers.set('Access-Control-Allow-Origin', dbClient.allowedOrigin);
        response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
        response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        response.headers.set('Access-Control-Allow-Credentials', 'true');
      }
    }
    return response;
  } catch (error) {
    console.error('OAuth authorization error:', error);

    // Try to redirect with error if we have a valid redirect_uri
    try {
      const errorUrl = new URL(authRequest.redirect_uri);
      errorUrl.searchParams.set('error', 'server_error');
      errorUrl.searchParams.set('error_description', 'Internal server error');
      if (authRequest.state) {
        errorUrl.searchParams.set('state', authRequest.state);
      }
      const response = NextResponse.redirect(errorUrl.toString());
      const origin = request.headers.get('origin');
      if (origin) {
        const dbClient = await oauthClientRepository.findById(authRequest.client_id);
        if (dbClient && origin === dbClient.allowedOrigin) {
          response.headers.set('Access-Control-Allow-Origin', dbClient.allowedOrigin);
          response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
          response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          response.headers.set('Access-Control-Allow-Credentials', 'true');
        }
      }
      return response;
    } catch {
      // If redirect_uri is invalid, return JSON error
      return NextResponse.json(
        { error: 'server_error', error_description: 'Internal server error' },
        { status: 500 }
      );
    }
  }
}
