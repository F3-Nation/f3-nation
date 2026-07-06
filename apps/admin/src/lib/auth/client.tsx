"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import type { AdminSession } from "./session";

export type AdminSessionStatus =
  "loading" | "authenticated" | "unauthenticated";

interface AdminSessionContextValue {
  data: AdminSession | null;
  status: AdminSessionStatus;
  update: (
    session?: AdminSession | Partial<AdminSession> | null,
  ) => Promise<AdminSession | null>;
}

const AdminSessionContext = createContext<AdminSessionContextValue | null>(
  null,
);

async function fetchSession(): Promise<AdminSession | null> {
  const response = await fetch("/api/auth/me", {
    credentials: "include",
    cache: "no-store",
  });

  if (!response.ok) return null;

  const body = (await response.json()) as { user?: AdminSession | null };
  return body.user ?? null;
}

function getStatus(session: AdminSession | null): AdminSessionStatus {
  return session ? "authenticated" : "unauthenticated";
}

export function AdminSessionProvider({
  children,
  initialSession,
}: {
  children: React.ReactNode;
  initialSession: AdminSession | null;
}) {
  const [session, setSession] = useState<AdminSession | null>(initialSession);
  const [status, setStatus] = useState<AdminSessionStatus>(
    getStatus(initialSession),
  );

  const update = useCallback(
    async (nextSession?: AdminSession | Partial<AdminSession> | null) => {
      if (nextSession !== undefined) {
        const updatedSession =
          nextSession === null
            ? null
            : ({ ...session, ...nextSession } as AdminSession);
        setSession(updatedSession);
        setStatus(getStatus(updatedSession));
        return updatedSession;
      }

      setStatus("loading");
      const fetchedSession = await fetchSession();
      setSession(fetchedSession);
      setStatus(getStatus(fetchedSession));
      return fetchedSession;
    },
    [session],
  );

  const value = useMemo(
    () => ({
      data: session,
      status,
      update,
    }),
    [session, status, update],
  );

  return (
    <AdminSessionContext.Provider value={value}>
      {children}
    </AdminSessionContext.Provider>
  );
}

export function useAdminSession() {
  const context = useContext(AdminSessionContext);
  if (!context) {
    throw new Error("useAdminSession must be used inside AdminSessionProvider");
  }

  return context;
}

export function navigateToSsoLogin(returnTo = "/") {
  window.location.assign(
    `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
  );
}

export function navigateToSsoLogout() {
  window.location.assign("/api/auth/logout");
}
