"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type Channel = "local" | "ci" | "branch" | "dev" | "staging" | "prod";

interface RuntimeConfig {
  channel: Channel;
  googleApiKey: string;
  adminUrl: string;
}

// Loading default used before /api/runtime-config resolves on the client. The
// page tree still renders (and caches) with these values; the only consumer that
// must wait for the real key is the Google Maps APIProvider, which gates on it.
const DEFAULT_CONFIG: RuntimeConfig = {
  channel: "local",
  googleApiKey: "",
  adminUrl: "",
};

const RuntimeConfigContext = createContext<RuntimeConfig>(DEFAULT_CONFIG);

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
          const data = (await res.json()) as RuntimeConfig;
          if (cancelled) return;
          _runtimeConfig = data;
          setConfig(data);
          return;
        } catch (err) {
          console.error("Failed to load runtime config", err);
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
  return useContext(RuntimeConfigContext);
}

export function getGoogleApiKey(): string {
  return _runtimeConfig.googleApiKey;
}
