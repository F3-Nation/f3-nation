'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Image from 'next/image';
import { useTheme } from 'next-themes';

function LinkAccountsContent() {
  const { theme, systemTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const searchParams = useSearchParams();
  const linkType = searchParams.get('type'); // "google" or "email"
  const { data: session } = useSession();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex flex-col items-center gap-8">
        <div className="w-24 h-24 bg-gray-200 rounded-full animate-pulse" />
        <div className="h-8 w-64 bg-gray-200 rounded animate-pulse" />
        <div className="h-4 w-80 bg-gray-200 rounded animate-pulse" />
      </div>
    );
  }

  const currentTheme = theme === 'system' ? systemTheme : theme;

  const handleLinkAccount = async () => {
    setIsLoading(true);
    setError('');

    try {
      const endpoint = linkType === 'google' ? '/api/link-google' : '/api/link-email';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to link account');
      }

      setSuccess(true);
      // Redirect to home page after successful linking
      setTimeout(() => {
        window.location.href = '/';
      }, 2000);
    } catch (err) {
      console.error('Link account error:', err);
      setError(err instanceof Error ? err.message : 'Failed to link account');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDecline = async () => {
    setIsLoading(true);
    setError('');

    try {
      const endpoint = linkType === 'google' ? '/api/link-google' : '/api/link-email';
      const response = await fetch(endpoint, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to decline linking');
      }

      // Redirect to home page after declining
      window.location.href = '/';
    } catch (err) {
      console.error('Decline link error:', err);
      setError(err instanceof Error ? err.message : 'Failed to decline linking');
    } finally {
      setIsLoading(false);
    }
  };

  if (!linkType || (linkType !== 'google' && linkType !== 'email')) {
    return (
      <div className="flex flex-col items-center gap-8">
        <p className="text-red-500">Invalid link type</p>
        <button
          onClick={() => (window.location.href = '/')}
          className="bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-lg"
        >
          Go Home
        </button>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex flex-col items-center gap-8">
        <Image
          src={currentTheme === 'dark' ? '/f3nation-white.svg' : '/f3nation.svg'}
          alt="F3 Nation Logo"
          width={96}
          height={96}
          priority
        />
        <h1 className="text-2xl font-bold text-green-600">Account Linked Successfully!</h1>
        <p className="text-center max-w-md">
          Your {linkType === 'google' ? 'Google' : 'email'} authentication method has been linked to
          your account. You can now use both methods to sign in.
        </p>
        <p className="text-gray-600">Redirecting you to the home page...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-8">
      <Image
        src={currentTheme === 'dark' ? '/f3nation-white.svg' : '/f3nation.svg'}
        alt="F3 Nation Logo"
        width={96}
        height={96}
        priority
      />
      <h1 className="text-2xl font-bold">Link Authentication Methods</h1>

      <div className="text-center max-w-md space-y-4">
        {linkType === 'google' ? (
          <>
            <p className="text-blue-600 font-medium">
              We found that you previously verified your email address with this account.
            </p>
            <p className="text-gray-600">
              Would you like to link your Google account so you can sign in using either Google or
              email verification in the future?
            </p>
          </>
        ) : (
          <>
            <p className="text-blue-600 font-medium">
              We found that you previously verified your email address for this account.
            </p>
            <p className="text-gray-600">
              Would you like to link your email verification so you can sign in using either Google
              or email verification in the future?
            </p>
          </>
        )}
        <p className="font-semibold text-lg">{session?.user?.email}</p>
      </div>

      <div className="flex flex-col gap-4 w-full max-w-xs">
        <button
          onClick={handleLinkAccount}
          disabled={isLoading}
          className="bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg"
        >
          {isLoading ? 'Linking...' : `Link ${linkType === 'google' ? 'Google' : 'Email'} Account`}
        </button>

        {error && <p className="text-red-500 text-sm text-center">{error}</p>}

        <button
          type="button"
          onClick={handleDecline}
          disabled={isLoading}
          className="text-gray-600 hover:text-gray-800 text-sm"
        >
          No thanks, continue without linking
        </button>
      </div>
    </div>
  );
}

export default function LinkAccounts() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LinkAccountsContent />
    </Suspense>
  );
}
