"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import Image from "next/image";

export default function EmailLoginPage() {
  return (
    <Suspense>
      <EmailLoginForm />
    </Suspense>
  );
}

function EmailLoginForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";

  const isValidEmail = (value: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (!isValidEmail(email)) {
      setError("Please enter a valid email address.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, action: "send", callbackUrl }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Failed to send code");
        return;
      }

      // Redirect to verify page
      const params = new URLSearchParams({
        email,
        callbackUrl,
      });
      router.push(`/login/email/verify?${params.toString()}`);
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
          <Image
            src="/f3nation.svg"
            alt="F3 Nation Logo"
            width={100}
            height={100}
            priority
          />
          <h1 className="text-3xl font-bold">Sign in with Email</h1>
          <p className="text-base text-muted-foreground">
            We&apos;ll send you a verification code
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          <div>
            <label htmlFor="email" className="mb-2 block text-base font-medium">
              Email address
            </label>
            <input
              id="email"
              type="text"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-md border bg-background px-4 py-3 text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {error && <p className="text-base text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-primary px-4 py-3 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? "Sending..." : "Send Code"}
          </button>
        </form>
      </div>
    </div>
  );
}
