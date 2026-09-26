"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import Image from "next/image";

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingForm />
    </Suspense>
  );
}

function OnboardingForm() {
  const [f3Name, setF3Name] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [loading, setLoading] = useState(false);
  const [prefilling, setPrefilling] = useState(true);
  const [isExistingUser, setIsExistingUser] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";

  // Always fetch on mount rather than gating on NextAuth's useSession() —
  // that hook is NextAuth-only and stays empty for a Better Auth session
  // (see apps/auth/src/lib/current-session.ts), which skipped this prefill
  // entirely with AUTH_USE_BETTER_AUTH on. /api/onboarding itself reads
  // getCurrentSession() and already returns 401 with no session.
  useEffect(() => {
    let redirecting = false;
    fetch("/api/onboarding")
      .then((res) => {
        if (res.status === 401) {
          // /login itself doesn't read callbackUrl (it's a static landing
          // page) — go straight to /login/email so a session that expired
          // mid-onboarding still resumes the OAuth flow that sent the user
          // here, instead of landing back on "/" after re-login.
          redirecting = true;
          router.push(
            `/login/email?callbackUrl=${encodeURIComponent(`/onboarding?callbackUrl=${encodeURIComponent(callbackUrl)}`)}`,
          );
          return;
        }
        if (!res.ok) return;
        return res.json();
      })
      .then(
        (data?: {
          f3Name?: string;
          firstName?: string;
          lastName?: string;
          isExistingUser?: boolean;
        }) => {
          if (!data) return;
          if (data.f3Name) setF3Name(data.f3Name);
          if (data.firstName) setFirstName(data.firstName);
          if (data.lastName) setLastName(data.lastName);
          if (data.isExistingUser) setIsExistingUser(true);
        },
      )
      .catch(() => {
        // Ignore — fields will just be empty
      })
      .finally(() => {
        // Keep the "Loading..." state up through the 401 redirect above —
        // otherwise this branch still reaches `finally` and briefly renders
        // (and lets the user submit) an empty onboarding form.
        if (!redirecting) setPrefilling(false);
      });
  }, [router, callbackUrl]);

  if (prefilling) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ f3Name, firstName, lastName }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Failed to complete onboarding");
        return;
      }

      // Redirect back to the original flow
      router.push(callbackUrl);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <div className="w-full max-w-lg space-y-8 rounded-lg border bg-card p-10 shadow-xs">
        <div className="flex flex-col items-center space-y-4">
          <Image
            src="/f3nation.svg"
            alt="F3 Nation Logo"
            width={96}
            height={96}
            priority
          />
          <h1 className="text-3xl font-bold">
            {isExistingUser ? "Welcome Back!" : "Welcome to F3 Nation!"}
          </h1>
          <p className="text-base text-muted-foreground">
            {isExistingUser
              ? "Since this is your first time logging in with F3 Nation SSO, please take this opportunity to confirm your details."
              : "Let\u2019s get you set up since this is your first time."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="f3Name"
              className="mb-2 block text-base font-medium"
            >
              F3 Name
            </label>
            <input
              id="f3Name"
              type="text"
              required
              value={f3Name}
              onChange={(e) => setF3Name(e.target.value)}
              placeholder="Your F3 name (e.g. Dredd)"
              className="w-full rounded-md border bg-background px-4 py-3 text-base outline-hidden focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label
              htmlFor="firstName"
              className="mb-2 block text-base font-medium"
            >
              First Name
            </label>
            <input
              id="firstName"
              type="text"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="John"
              className="w-full rounded-md border bg-background px-4 py-3 text-base outline-hidden focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label
              htmlFor="lastName"
              className="mb-2 block text-base font-medium"
            >
              Last Name
            </label>
            <input
              id="lastName"
              type="text"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Doe"
              className="w-full rounded-md border bg-background px-4 py-3 text-base outline-hidden focus:ring-2 focus:ring-ring"
            />
          </div>

          {error && <p className="text-base text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-primary px-4 py-3 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? "Saving..." : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
