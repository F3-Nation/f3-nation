'use client';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import { getOAuthConfig } from '@/lib/actions';
import Logo from './components/Logo';

interface UserInfo {
  sub: string;
  name?: string;
  email?: string;
  picture?: string;
  email_verified?: boolean;
}

interface OAuthConfig {
  CLIENT_ID: string;
  REDIRECT_URI: string;
  AUTH_SERVER_URL: string;
}

export default function Home() {
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [oauthConfig, setOauthConfig] = useState<OAuthConfig | null>(null);

  const handleLogin = () => {
    if (!oauthConfig) {
      setError('OAuth configuration not loaded');
      return;
    }

    // Generate CSRF token and create state parameter in the format expected by auth-provider
    const csrfToken = crypto.randomUUID();
    const stateData = {
      csrfToken,
      clientId: oauthConfig.CLIENT_ID,
      returnTo: oauthConfig.REDIRECT_URI,
      timestamp: Date.now(),
    };

    // Encode state as base64-encoded JSON (matching auth-provider's expectation)
    const state = btoa(JSON.stringify(stateData));
    localStorage.setItem('oauth_state', state);

    window.location.href = `${oauthConfig.AUTH_SERVER_URL}/api/oauth/authorize?response_type=code&client_id=${oauthConfig.CLIENT_ID}&redirect_uri=${encodeURIComponent(oauthConfig.REDIRECT_URI)}&scope=openid%20profile%20email&state=${encodeURIComponent(state)}`;
  };

  // Load OAuth configuration and check for stored user info on component mount
  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Load OAuth configuration using server action
        // With the new SDK, this returns the single client configuration for this environment
        const config = await getOAuthConfig();
        setOauthConfig(config);

        // Check for stored user info
        const storedUserInfo = localStorage.getItem('user_info');
        if (storedUserInfo) {
          try {
            setUserInfo(JSON.parse(storedUserInfo));
          } catch (err) {
            console.error('Failed to parse stored user info:', err);
            localStorage.removeItem('user_info');
          }
        }
      } catch (err) {
        console.error('Failed to load OAuth configuration:', err);
        setError('Failed to load OAuth configuration');
      } finally {
        setLoading(false);
      }
    };

    initializeApp();
  }, []);

  const handleLogout = () => {
    // Clear all stored auth data
    localStorage.removeItem('user_info');
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('oauth_state');

    setUserInfo(null);
    setError(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p>Processing authentication...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-md p-6">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">F3 Auth Client Demo</h1>
          <p className="text-gray-600">Example client application using F3 Auth Provider</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-md">
            <p className="text-red-800 text-sm">{error}</p>
          </div>
        )}

        {!userInfo ? (
          <div className="text-center">
            <p className="text-gray-600 mb-6">
              Click the button below to authenticate with F3 Auth Provider
            </p>
            <button
              onClick={handleLogin}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors"
            >
              Login with F3 Auth
            </button>
          </div>
        ) : (
          <div className="text-center">
            <div className="mb-6">
              {userInfo.picture ? (
                <Image
                  src={userInfo.picture}
                  alt="Profile picture"
                  width={80}
                  height={80}
                  className="rounded-full mx-auto mb-4"
                />
              ) : (
                <div className="flex justify-center mb-4">
                  <Logo width={80} height={80} className="rounded-full mx-auto" />
                </div>
              )}
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                Welcome, {userInfo.name || 'User'}!
              </h2>
              {userInfo.email && <p className="text-gray-600 mb-1">{userInfo.email}</p>}
              <p className="text-sm text-gray-500">User ID: {userInfo.sub}</p>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <h3 className="font-medium text-gray-900 mb-2">User Information</h3>
              <pre className="text-xs text-gray-600 text-left overflow-x-auto">
                {JSON.stringify(userInfo, null, 2)}
              </pre>
            </div>

            <button
              onClick={handleLogout}
              className="w-full bg-gray-600 hover:bg-gray-700 text-white font-medium py-3 px-4 rounded-lg transition-colors"
            >
              Logout
            </button>
          </div>
        )}

        <div className="mt-8 pt-6 border-t border-gray-200">
          <h3 className="font-medium text-gray-900 mb-3">Setup Instructions</h3>
          <div className="text-sm text-gray-600 space-y-2">
            <p>1. Run the seed script to add OAuth clients:</p>
            <pre className="bg-gray-100 p-2 rounded text-xs overflow-x-auto">
              {`cd f3-auth-provider
npm run db:seed`}
            </pre>
            <p>2. Ensure both apps are running with HTTPS</p>
            <p>
              3. Current client uses: <code>{oauthConfig?.CLIENT_ID || 'Loading...'}</code>
            </p>
            <p>
              4. Auth server: <code>{oauthConfig?.AUTH_SERVER_URL || 'Loading...'}</code>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
