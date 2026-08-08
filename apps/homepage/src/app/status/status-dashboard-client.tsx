"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { StatusCard } from "@/app/status/status-card";
import type { StatusResult } from "@f3nation/health";

interface StatusApiResponse {
  generatedAt: string;
  ttlSeconds: number;
  results: StatusResult[];
}

const FALLBACK_TTL_SECONDS = 60;

function getApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  if (process.env.NEXT_PUBLIC_LOCAL_DEV === "true") {
    return "http://localhost:3001";
  }

  return "https://api.f3nation.com";
}

function statusEndpointUrl(): string {
  return `${getApiBaseUrl()}/v1/status`;
}

export function StatusDashboardClient() {
  const searchParams = useSearchParams();
  const showDetail = searchParams.has("detail");
  const [data, setData] = useState<StatusApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshMs = useMemo(() => {
    const ttl = data?.ttlSeconds;
    const validTtl =
      typeof ttl === "number" && Number.isFinite(ttl) && ttl > 0
        ? ttl
        : FALLBACK_TTL_SECONDS;
    return validTtl * 1000;
  }, [data?.ttlSeconds]);

  useEffect(() => {
    let isMounted = true;

    async function loadStatus() {
      const endpoint = statusEndpointUrl();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

      try {
        const response = await fetch(endpoint, {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`${endpoint} returned HTTP ${response.status}`);
        }

        const json = (await response.json()) as unknown;

        if (
          typeof json !== "object" ||
          json === null ||
          !Array.isArray((json as Record<string, unknown>).results)
        ) {
          throw new Error(`Unexpected response shape from ${endpoint}`);
        }

        if (!isMounted) return;
        setData(json as StatusApiResponse);
        setError(null);
      } catch (err) {
        if (!isMounted) return;

        if (err instanceof Error) {
          setError(`Unable to load status data: ${err.message}`);
        } else {
          setError(`Unable to load status data from ${endpoint}.`);
        }
      } finally {
        clearTimeout(timeoutId);
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadStatus();
    const interval = window.setInterval(() => {
      void loadStatus();
    }, refreshMs);

    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, [refreshMs]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {data
          ? `Data as of ${new Date(data.generatedAt).toLocaleString()} · auto-refreshes every ${data.ttlSeconds}s`
          : "Fetching latest status..."}
      </p>

      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {isLoading && !data
          ? null
          : data?.results.map((result) => (
              <StatusCard
                key={result.target.id}
                result={result}
                showDetail={showDetail}
              />
            ))}
      </div>
    </div>
  );
}
