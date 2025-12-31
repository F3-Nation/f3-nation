'use client';
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getOAuthConfig, exchangeCodeForToken } from '@/lib/actions';

interface OAuthConfig {
  CLIENT_ID: string;
  REDIRECT_URI: string;
  AUTH_SERVER_URL: string;
}

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [oauthConfig, setOauthConfig] = useState<OAuthConfig | null>(null);

  useEffect(() => {
    const initializeCallback = async () => {
      try {
        // Load OAuth configuration using server action
        // With the new SDK, this returns the single client configuration for this environment
        const config = await getOAuthConfig();
        setOauthConfig(config);
      } catch (err) {
        console.error('Failed to load OAuth configuration:', err);
        setError('Failed to load OAuth configuration');
      }
    };

    initializeCallback();
  }, []);

  useEffect(() => {
    if (!oauthConfig) return;

    const handleCallback = async () => {
      const code = searchParams?.get('code');
      const state = searchParams?.get('state');
      const errorParam = searchParams?.get('error');

      // Debug logging
      console.log('Callback debug:', {
        code: code ? 'present' : 'missing',
        state: state ? 'present' : 'missing',
        errorParam,
        url: window.location.href,
      });

      if (errorParam) {
        setError(`OAuth error: ${errorParam}`);
        return;
      }

      if (!code || !state) {
        // Check if this might be a CORS-related issue
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('code') && urlParams.has('state')) {
          // Parameters exist in URL but not accessible - likely CORS issue
          setError('Authentication processing error. Please try again.');
        } else {
          setError('Missing authorization code or state parameter');
        }
        return;
      }

      try {
        // Verify state parameter structure (handle cross-browser scenarios)
        const storedState = localStorage.getItem('oauth_state');
        console.log('State verification:', {
          receivedState: state,
          storedState: storedState ? 'present' : 'missing (cross-browser)',
        });

        // Decode and validate state parameter structure
        const decodeState = (state: string) => {
          try {
            return JSON.parse(decodeURIComponent(atob(state)));
          } catch (err) {
            console.error('Failed to decode state:', err);
            throw new Error('Invalid state parameter format');
          }
        };

        const receivedStateObj = decodeState(state);

        // Validate required fields in received state
        const requiredFields = ['csrfToken', 'clientId', 'returnTo', 'timestamp'];
        for (const field of requiredFields) {
          if (!receivedStateObj[field]) {
            throw new Error(`State missing required field: ${field}`);
          }
        }

        // Validate timestamp is not too old (10 minutes to account for email delays)
        const timestampDiff = Date.now() - receivedStateObj.timestamp;
        if (timestampDiff > 600000) {
          // 10 minutes in ms
          throw new Error('Expired state parameter');
        }

        // If we have stored state, validate it matches (same browser scenario)
        if (storedState) {
          try {
            const storedStateObj = decodeState(storedState);

            // Compare decoded state objects
            if (
              receivedStateObj.csrfToken !== storedStateObj.csrfToken ||
              receivedStateObj.clientId !== storedStateObj.clientId ||
              receivedStateObj.returnTo !== storedStateObj.returnTo
            ) {
              throw new Error('Invalid state parameter');
            }
          } catch (err) {
            console.warn('Stored state validation failed, continuing with server validation:', err);
          }
        }

        // Exchange authorization code for access token using server action
        const tokenData = await exchangeCodeForToken({
          code,
        });
        const accessToken = tokenData.access_token as string;

        // Get user info using access token
        const userInfoResponse = await fetch(`${oauthConfig.AUTH_SERVER_URL}/api/oauth/userinfo`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (!userInfoResponse.ok) {
          throw new Error('Failed to get user info');
        }

        const userData = await userInfoResponse.json();

        // Store user data and tokens in localStorage (in production, use secure storage)
        localStorage.setItem('user_info', JSON.stringify(userData));
        localStorage.setItem('access_token', accessToken);
        if (tokenData.refresh_token) {
          localStorage.setItem('refresh_token', tokenData.refresh_token as string);
        }

        // Clean up OAuth state
        localStorage.removeItem('oauth_state');

        // Redirect to main page
        router.push('/');
      } catch (err) {
        console.error('OAuth callback error:', err);
        setError(err instanceof Error ? err.message : 'An error occurred during authentication');
      }
    };

    handleCallback();
  }, [searchParams, router, oauthConfig]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md mx-auto bg-white rounded-lg shadow-md p-6">
          <div className="text-center">
            <div className="text-red-600 text-6xl mb-4">⚠️</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-4">Authentication Error</h1>
            <p className="text-red-600 mb-6">{error}</p>
            <button
              onClick={() => router.push('/')}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg"
            >
              Return to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Processing authentication...</p>
        <p className="text-sm text-gray-500 mt-2">Please wait while we complete your login</p>
      </div>
    </div>
  );
}

export default function CallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading...</p>
          </div>
        </div>
      }
    >
      <CallbackContent />
    </Suspense>
  );
}
