"use client";

import { createContext, useContext } from "react";

export type Channel = "local" | "ci" | "branch" | "dev" | "staging" | "prod";

interface RuntimeConfig {
  channel: Channel;
  googleApiKey: string;
  adminUrl: string;
}

const RuntimeConfigContext = createContext<RuntimeConfig | null>(null);

let _runtimeConfig: RuntimeConfig | null = null;

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
  _runtimeConfig = { channel, googleApiKey, adminUrl };
  return (
    <RuntimeConfigContext.Provider value={_runtimeConfig}>
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

export function getGoogleApiKey(): string {
  if (!_runtimeConfig) {
    throw new Error("RuntimeConfigProvider has not rendered yet");
  }
  return _runtimeConfig.googleApiKey;
}
