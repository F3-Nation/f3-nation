"use client";

import { createContext, useContext } from "react";

export type Channel = "local" | "ci" | "branch" | "dev" | "staging" | "prod";

interface RuntimeConfig {
  channel: Channel;
  googleApiKey: string;
  adminUrl: string;
}

const RuntimeConfigContext = createContext<RuntimeConfig | null>(null);

export function RuntimeConfigProvider({
  channel,
  googleApiKey,
  adminUrl,
  children,
}: {
  channel: Channel;
  googleApiKey: string;
  adminUrl: string;
  children: React.ReactNode;
}) {
  return (
    <RuntimeConfigContext.Provider value={{ channel, googleApiKey, adminUrl }}>
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
