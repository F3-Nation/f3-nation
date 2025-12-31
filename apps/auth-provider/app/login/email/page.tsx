'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import ThemeImage from '../../components/ThemeImage';

function EmailLoginContent() {
  const [mounted, setMounted] = useState(false);
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/';
  const googlePending = searchParams.get('google_pending') === 'true';
  const prefilledEmail = searchParams.get('email') || '';

  useEffect(() => {
    setMounted(true);
    // Pre-fill email if coming from Google redirect
    if (prefilledEmail) {
      setEmail(prefilledEmail);
    }
  }, [prefilledEmail]);

  if (!mounted) {
    return (
      <div className="flex flex-col items-center gap-8">
        <div className="w-24 h-24 bg-gray-200 rounded-full animate-pulse" />
        <div className="h-8 w-64 bg-gray-200 rounded animate-pulse" />
        <div className="h-4 w-80 bg-gray-200 rounded animate-pulse" />
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    if (!email) {
      setError('Email is required');
      setIsLoading(false);
      return;
    }

    try {
      // Send verification email via dedicated API endpoint
      const response = await fetch('/api/send-verification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, callbackUrl }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to send verification email');
      } else {
        // Redirect to verification page
        window.location.href = `/login/email/verify?email=${encodeURIComponent(email)}&callbackUrl=${encodeURIComponent(callbackUrl)}`;
      }
    } catch {
      setError('Failed to send verification email. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-8">
      <ThemeImage src="/f3nation.svg" alt="F3 Nation Logo" width={96} height={96} priority />
      <h1 className="text-2xl font-bold">Sign in with Email</h1>
      {googlePending ? (
        <div className="text-center max-w-md">
          <p className="text-blue-600 font-medium mb-2">
            We found an existing account with this email address.
          </p>
          <p className="text-gray-600">
            Please verify your email to continue. After signing in, you&#39;ll have the option to
            link your Google account.
          </p>
        </div>
      ) : (
        <p className="text-center max-w-md">
          Enter your email address and we&#39;ll send you a verification code
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full max-w-xs">
        <input
          type="email"
          placeholder="Enter your email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
          disabled={isLoading}
        />

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={isLoading}
          className="bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg"
        >
          {isLoading ? 'Sending...' : 'Send Verification Code'}
        </button>

        <button
          type="button"
          onClick={() =>
            (window.location.href = `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`)
          }
          className="text-gray-600 hover:text-gray-800 text-sm"
        >
          Back to login options
        </button>
      </form>
    </div>
  );
}

export default function EmailLogin() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <EmailLoginContent />
    </Suspense>
  );
}
