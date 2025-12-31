'use client';
import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import ThemeImage from '../components/ThemeImage';

function LoginContent() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams?.get('callbackUrl') || process.env.NEXT_PUBLIC_NEXTAUTH_URL!;
  const [mounted, setMounted] = useState(false);

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

  return (
    <div className="flex flex-col items-center gap-8">
      <ThemeImage
        src="/f3nation.svg"
        alt="F3 Nation Logo"
        width={120}
        height={120}
        className="mx-auto mb-8"
      />
      <h1 className="text-2xl font-bold">F3 Nation Auth Provider</h1>
      <p className="text-center max-w-md">
        Central authentication service for F3 Nation applications
      </p>
      <div className="flex flex-col gap-4 w-full max-w-xs">
        <button
          onClick={() =>
            (window.location.href = `/login/email?callbackUrl=${encodeURIComponent(callbackUrl)}`)
          }
          className="bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-lg flex items-center gap-2"
        >
          Sign in with Email
        </button>
      </div>
    </div>
  );
}

export default function Login() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoginContent />
    </Suspense>
  );
}
