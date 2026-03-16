"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";

import ThemeImage from "~/app/components/ThemeImage";

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingForm />
    </Suspense>
  );
}

function OnboardingForm() {
  const { data: session } = useSession();
  const [f3Name, setF3Name] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";

  if (!session?.user) {
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
      <div className="w-full max-w-lg space-y-8 rounded-lg border bg-card p-10 shadow-sm">
        <div className="flex flex-col items-center space-y-4">
          <ThemeImage
            src="/f3nation.svg"
            alt="F3 Nation Logo"
            width={96}
            height={96}
            priority
          />
          <h1 className="text-3xl font-bold">Welcome to F3 Nation!</h1>
          <p className="text-base text-muted-foreground">
            Let&apos;s set up your profile before continuing
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="f3Name"
              className="block text-base font-medium mb-2"
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
              className="w-full rounded-md border bg-background px-4 py-3 text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label
              htmlFor="firstName"
              className="block text-base font-medium mb-2"
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
              className="w-full rounded-md border bg-background px-4 py-3 text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label
              htmlFor="lastName"
              className="block text-base font-medium mb-2"
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
              className="w-full rounded-md border bg-background px-4 py-3 text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {error && <p className="text-base text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-primary px-4 py-3 text-base font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading ? "Saving..." : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
