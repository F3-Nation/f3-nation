"use client";

import { createContext, useContext } from "react";

interface F3Runtime {
  mapApiKey?: string;
  apiBaseUrl?: string;
  googleApiKey?: string;
  adminUrl?: string;
  channel?: string;
}
declare global {
  interface Window {
    __F3_RUNTIME__?: F3Runtime;
  }
}

export type Channel = "local" | "ci" | "branch" | "dev" | "staging" | "prod";

interface RuntimeConfig {
  channel: Channel;
  googleApiKey: string;
}

const RuntimeConfigContext = createContext<RuntimeConfig | null>(null);

export function RuntimeConfigProvider({
  channel,
  googleApiKey,
  children,
}: {
  channel: Channel;
  googleApiKey: string;
  children: React.ReactNode;
}) {
  return (
    <RuntimeConfigContext.Provider value={{ channel, googleApiKey }}>
      {children}
    </RuntimeConfigContext.Provider>
  );
}

export function useRuntimeConfig(): RuntimeConfig {
  const ctx = useContext(RuntimeConfigContext);
  if (!ctx) {
    throw new Error(
      "useRuntimeConfig must be used within RuntimeConfigProvider",
    );
  }
  return ctx;
}
