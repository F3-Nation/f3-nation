"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailForm />
    </Suspense>
  );
}

function VerifyEmailForm() {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";
  const prefillCode = searchParams.get("code");

  const handleVerify = useCallback(
    async (verifyCode: string) => {
      setLoading(true);
      setError("");

      const result = await signIn("email-mfa", {
        email,
        code: verifyCode,
        redirect: false,
      });

      if (result?.error) {
        setError("Invalid or expired code. Please try again.");
        setLoading(false);
        return;
      }

      // Success — redirect
      router.push(callbackUrl);
    },
    [email, callbackUrl, router],
  );

  // Auto-submit if code is in URL (magic link)
  useEffect(() => {
    if (prefillCode && email) {
      setCode(prefillCode);
      void handleVerify(prefillCode);
    }
  }, [prefillCode, email, handleVerify]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await handleVerify(code);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <div className="w-full max-w-md space-y-6 rounded-lg border bg-card p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">Enter your code</h1>
          <p className="text-sm text-muted-foreground">
            We sent a 6-digit code to{" "}
            <span className="font-medium text-foreground">{email}</span>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="code"
              className="block text-sm font-medium mb-1"
            >
              Verification code
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              className="w-full rounded-md border bg-background px-3 py-2 text-center text-2xl font-mono tracking-[0.5em] outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || code.length !== 6}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading ? "Verifying..." : "Verify"}
          </button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Didn&apos;t receive a code?{" "}
          <button
            type="button"
            onClick={() => router.push(`/login/email?callbackUrl=${encodeURIComponent(callbackUrl)}`)}
            className="text-primary underline hover:no-underline"
          >
            Try again
          </button>
        </p>
      </div>
    </div>
  );
}
