'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import ThemeImage from '../components/ThemeImage';

function OnboardingForm() {
  const [mounted, setMounted] = useState(false);
  const searchParams = useSearchParams();
  const [f3Name, setF3Name] = useState('');
  const [hospitalName, setHospitalName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingGoogleLink, setPendingGoogleLink] = useState<{
    name: string;
    email: string;
    image?: string;
    googleId: string;
  } | null>(null);
  const [showGoogleLinking, setShowGoogleLinking] = useState(false);
  const { data: session, update } = useSession();
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const checkSessionData = async () => {
      try {
        const response = await fetch('/api/session');
        if (response.ok) {
          const sessionData = await response.json();

          if (sessionData.user?.pendingGoogleLink) {
            const googleData = JSON.parse(sessionData.user.pendingGoogleLink);
            setPendingGoogleLink(googleData);
            if (googleData.name && !hospitalName) {
              setHospitalName(googleData.name);
            }
          } else if (sessionData.user?.name && !hospitalName) {
            setHospitalName(sessionData.user.name);
          }
        }
      } catch (error) {
        console.error('Error checking session data:', error);
      }
    };
    checkSessionData();
  }, [mounted, hospitalName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f3Name.trim() || !hospitalName.trim()) {
      setError(f3Name.trim() ? 'Hospital name is required' : 'F3 name is required');
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      const response = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ f3Name: f3Name.trim(), hospitalName: hospitalName.trim() }),
      });

      if (!response.ok) throw new Error('Failed to complete onboarding');

      await update({ ...session, user: { ...session?.user, name: f3Name.trim() } });

      if (pendingGoogleLink) {
        setShowGoogleLinking(true);
      } else {
        const callbackUrl = searchParams?.get('callbackUrl');
        router.push(callbackUrl || '/');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete onboarding');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLinkGoogle = async () => {
    setIsLoading(true);
    setError('');
    try {
      const response = await fetch('/api/link-google', { method: 'POST' });
      if (!response.ok) throw new Error('Failed to link Google account');
      router.push(searchParams?.get('callbackUrl') || '/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link Google account');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSkipGoogleLink = async () => {
    setIsLoading(true);
    setError('');
    try {
      const response = await fetch('/api/link-google', { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to skip Google linking');
      router.push(searchParams?.get('callbackUrl') || '/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to skip Google linking');
    } finally {
      setIsLoading(false);
    }
  };

  if (showGoogleLinking && pendingGoogleLink) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="flex flex-col items-center space-y-4">
            {session?.user?.image ? (
              <Image
                src={session.user.image}
                alt="Profile Picture"
                width={96}
                height={96}
                priority
                className="rounded-full"
              />
            ) : (
              <ThemeImage
                src="/f3nation.svg"
                alt="F3 Nation Logo"
                width={96}
                height={96}
                priority
              />
            )}
            <h1 className="text-2xl font-bold text-center">Link Your Google Account</h1>
            <p className="text-gray-600 text-center">
              We found that you tried to sign in with Google. Would you like to link your Google
              account to make future logins easier?
            </p>
          </div>

          <div className="bg-gray-50 rounded-lg p-4 space-y-3">
            <div className="flex items-center space-x-3">
              {pendingGoogleLink.image && (
                <Image
                  src={pendingGoogleLink.image}
                  alt="Google Profile"
                  width={40}
                  height={40}
                  className="rounded-full"
                />
              )}
              <div>
                <p className="font-medium">{pendingGoogleLink.name}</p>
                <p className="text-sm text-gray-600">{pendingGoogleLink.email}</p>
              </div>
            </div>
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="space-y-3">
            <button
              onClick={handleLinkGoogle}
              disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg flex items-center justify-center gap-2"
            >
              <Image
                src="https://authjs.dev/img/providers/google.svg"
                alt="Google Logo"
                width={20}
                height={20}
              />
              {isLoading ? 'Linking...' : 'Link Google Account'}
            </button>

            <button
              onClick={handleSkipGoogleLink}
              disabled={isLoading}
              className="w-full bg-gray-300 hover:bg-gray-400 disabled:bg-gray-200 text-gray-700 font-medium py-2 px-4 rounded-lg"
            >
              {isLoading ? 'Skipping...' : 'Skip for Now'}
            </button>
          </div>

          <p className="text-xs text-gray-500 text-center">
            You can always link your Google account later in your profile settings.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center space-y-4">
          {session?.user?.image ? (
            <Image
              src={session.user.image}
              alt="Profile Picture"
              width={96}
              height={96}
              priority
              className="rounded-full"
            />
          ) : (
            <ThemeImage src="/f3nation.svg" alt="F3 Nation Logo" width={96} height={96} priority />
          )}
          <h1 className="text-2xl font-bold text-center">Welcome to F3 Nation!</h1>
          <p className="text-gray-600 text-center">
            To complete your registration, please provide your F3 name and hospital name.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="f3Name" className="block text-sm font-medium text-gray-700 mb-1">
              F3 Name
            </label>
            <input
              type="text"
              id="f3Name"
              value={f3Name}
              onChange={e => setF3Name(e.target.value)}
              placeholder="Enter your F3 name"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
              disabled={isLoading}
              required
            />
          </div>

          <div>
            <label htmlFor="hospitalName" className="block text-sm font-medium text-gray-700 mb-1">
              Hospital Name
            </label>
            <input
              type="text"
              id="hospitalName"
              value={hospitalName}
              onChange={e => setHospitalName(e.target.value)}
              placeholder="Enter your hospital name"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
              disabled={isLoading}
              required
            />
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={isLoading || !f3Name.trim() || !hospitalName.trim()}
            className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg"
          >
            {isLoading ? 'Completing...' : 'Complete Registration'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function Onboarding() {
  return (
    <Suspense
      fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}
    >
      <OnboardingForm />
    </Suspense>
  );
}
