'use client';
import { signOut } from 'next-auth/react';

export default function SignOutButton() {
  const handleSignOut = async () => {
    await signOut({ callbackUrl: '/login' });
  };

  return (
    <button
      onClick={handleSignOut}
      className="w-full py-2 px-4 bg-red-500 hover:bg-red-600 text-white font-medium rounded-lg"
    >
      Sign Out
    </button>
  );
}
