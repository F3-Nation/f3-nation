"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type Channel = "local" | "ci" | "branch" | "dev" | "staging" | "prod";

// Shape returned by /api/runtime-config.
interface RuntimeConfigData {
  channel: Channel;
  googleApiKey: string;
  adminUrl: string;
}

// Status of the runtime config fetch: transient load apart from a persistent failure.
export type RuntimeConfigStatus = "loading" | "ready" | "error";

interface RuntimeConfig extends RuntimeConfigData {
  status: RuntimeConfigStatus;
}

// Consecutive failures to tolerate before showing an error instead of the loader.
const ERROR_AFTER_ATTEMPTS = 3;

// Loading default used before /api/runtime-config resolves on the client. The
// page tree still renders (and caches) with these values; the only consumer that
// must wait for the real key is the Google Maps APIProvider, which gates on it.
const DEFAULT_CONFIG: RuntimeConfig = {
  channel: "local",
  googleApiKey: "",
  adminUrl: "",
  status: "loading",
};

// `null` distinguishes "no provider mounted" from the provider's own loading
// state (DEFAULT_CONFIG), so useRuntimeConfig can still catch wiring mistakes.
const RuntimeConfigContext = createContext<RuntimeConfig | null>(null);

// Mirror of the latest config for non-React callers (e.g. places utils) that
// read the key synchronously. Populated once the fetch resolves; those callers
// only fire on user interaction, well after the provider has mounted.
let _runtimeConfig: RuntimeConfig = DEFAULT_CONFIG;

export function RuntimeConfigProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [config, setConfig] = useState<RuntimeConfig>(_runtimeConfig);

  useEffect(() => {
    let cancelled = false;
    // Retry with exponential backoff so a transient failure doesn't leave the
    // app stuck on DEFAULT_CONFIG (an empty googleApiKey blocks map rendering).
    void (async () => {
      const MAX_DELAY = 30_000;
      for (let attempt = 0; !cancelled; attempt++) {
        try {
          const res = await fetch("/api/runtime-config");
          if (!res.ok) throw new Error(`runtime-config ${res.status}`);
          const data = (await res.json()) as RuntimeConfigData;
          if (cancelled) return;
          const resolved: RuntimeConfig = { ...data, status: "ready" };
          _runtimeConfig = resolved;
          setConfig(resolved);
          return;
        } catch (err) {
          // Avoid spamming the browser console indefinitely during a prolonged outage.
          if (process.env.NODE_ENV !== "production") {
            console.error("Failed to load runtime config", err);
          }
          // Surface an error after enough failures so the UI stops looping on the loader.
          if (!cancelled && attempt + 1 >= ERROR_AFTER_ATTEMPTS) {
            setConfig((prev) => ({ ...prev, status: "error" }));
          }
          const delay = Math.min(1000 * 2 ** attempt, MAX_DELAY);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <RuntimeConfigContext.Provider value={config}>
      {children}
    </RuntimeConfigContext.Provider>
  );
}

export function useRuntimeConfig(): RuntimeConfig {
  const ctx = useContext(RuntimeConfigContext);
  if (ctx === null) {
    throw new Error(
      "useRuntimeConfig must be used within a RuntimeConfigProvider",
    );
  }
  return ctx;
}

export function getGoogleApiKey(): string {
  return _runtimeConfig.googleApiKey;
}
