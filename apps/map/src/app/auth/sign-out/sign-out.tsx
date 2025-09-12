"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";

import type { Session } from "@acme/auth";

import { AuthWrapper } from "../components/auth-components";

interface SignOutProps {
  session: Session | null;
}
export const SignOut = (params: SignOutProps) => {
  const router = useRouter();
  return (
    <AuthWrapper>
      <div className="flex flex-col items-center text-center">
        <Image
          src="/f3_logo.png"
          height={100}
          width={100}
          alt="F3 Nation Logo"
        />
        {params.session ? (
          <>
            <h2 className="mt-2 text-2xl font-semibold">Sign out</h2>
            <p className="mt-2">Are you sure you want to sign out?</p>
            <button
              onClick={() => {
                void signOut({ redirect: false }).finally(() => {
                  router.refresh();
                });
              }}
              className="mt-4 w-full rounded-md bg-foreground px-4 py-2 text-background"
            >
              Sign out
            </button>
          </>
        ) : (
          // We have now logged out
          <>
            <h2 className="mt-2 text-2xl font-semibold">
              Successfully signed out!
            </h2>
            <Link
              className="mt-4 w-full rounded-md bg-foreground px-4 py-2 text-background"
              href="/api/auth/signin?callbackUrl=%2Fdashboard"
            >
              Sign in again
            </Link>
          </>
        )}
      </div>
    </AuthWrapper>
  );
};
