import type { OrgChartItem, OrgDetail } from "./types";

function getApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (process.env.NEXT_PUBLIC_LOCAL_DEV === "true")
    return "http://localhost:3001";
  return "https://api.f3nation.com";
}

// The org-chart endpoints are protectedProcedure, so requests carry a
// read-only API key sourced from an env var (like apps/map). Because this is a
// static export the key is a NEXT_PUBLIC var baked into the bundle and visible
// in devtools — it grants nothing beyond the public org-chart directory reads.
const ORG_MAP_CLIENT = "https://apps.f3nation.com";

async function orgMapFetch<T>(path: string): Promise<T> {
  const url = `${getApiBase()}/v1${path}`;
  const apiKey = process.env.NEXT_PUBLIC_ORG_MAP_API_KEY;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const headers: Record<string, string> = { client: ORG_MAP_CLIENT };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(url, { signal: controller.signal, headers });
    if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchOrgChart(): Promise<OrgChartItem[]> {
  const data = await orgMapFetch<{ orgs: (OrgChartItem | null)[] }>(
    "/org-chart",
  );
  return data.orgs.filter((o): o is OrgChartItem => o !== null);
}

export async function fetchOrgById(id: number): Promise<OrgDetail> {
  return orgMapFetch<OrgDetail>(`/org-chart/${id}`);
}
