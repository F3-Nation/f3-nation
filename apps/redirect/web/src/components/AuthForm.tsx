"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn, signUp } from "@/lib/auth-client";

// TEMPORARY prototyping auth: email + password. (Google / passkeys later.)
export function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res =
        mode === "signup"
          ? await signUp.email({
              email,
              password,
              name: email.split("@")[0] ?? email,
            })
          : await signIn.email({ email, password });
      if (res.error) {
        setError(res.error.message ?? "authentication failed");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      // signIn/signUp can throw (network/parse) — surface it instead of failing
      // silently with the form stuck.
      setError(e instanceof Error ? e.message : "authentication failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="email">Email</label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <label htmlFor="password">Password</label>
      <input
        id="password"
        type="password"
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <div
        style={{
          marginTop: "0.9rem",
          display: "flex",
          gap: "0.75rem",
          alignItems: "center",
        }}
      >
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>
        <button
          type="button"
          className="linkbtn muted"
          onClick={() => {
            setMode(mode === "signup" ? "signin" : "signup");
            setError(null);
          }}
        >
          {mode === "signup"
            ? "have an account? sign in"
            : "new here? create an account"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      {mode === "signin" && (
        <div
          style={{
            marginTop: "0.9rem",
            borderTop: "1px solid #21262d",
            paddingTop: "0.9rem",
          }}
        >
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setError(null);
              setBusy(true);
              try {
                const res = await signIn.passkey();
                if (res?.error) {
                  setError(res.error.message ?? "passkey sign-in failed");
                  return;
                }
                router.push("/dashboard");
                router.refresh();
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "passkey sign-in failed",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Sign in with a passkey
          </button>
          <span className="muted" style={{ marginLeft: "0.6rem" }}>
            if you&apos;ve added one
          </span>
        </div>
      )}
    </form>
  );
}
