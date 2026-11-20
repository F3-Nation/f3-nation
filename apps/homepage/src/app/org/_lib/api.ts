import type {
  AoSearchResult,
  LeaderEntry,
  LocationDetail,
  Org,
  OrgChartItem,
  OrgDetail,
} from "./types";
import { normalizeOrgType } from "./org-chart";

function getApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (process.env.NEXT_PUBLIC_LOCAL_DEV === "true")
    return "http://localhost:3001";
  return "https://api.f3nation.com";
}

// The org-chart endpoints are public reads, so requests normally carry no
// credential. NEXT_PUBLIC_ORG_MAP_API_KEY, when set at build time, is sent as a
// Bearer key for an API that still requires one on these reads; it is baked
// into the static bundle and visible in devtools, so it must be a role-less key.
const ORG_MAP_CLIENT = "https://apps.f3nation.com";

async function orgMapFetch<T>(path: string, signal?: AbortSignal): Promise<T> {
  const url = `${getApiBase()}/v1${path}`;
  const apiKey = process.env.NEXT_PUBLIC_ORG_MAP_API_KEY;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  // Abort if the caller's signal fires (e.g. a superseded debounced search).
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    const headers: Record<string, string> = { client: ORG_MAP_CLIENT };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(url, { signal: controller.signal, headers });
    if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function fetchOrgChart(): Promise<OrgChartItem[]> {
  const data = await orgMapFetch<{ orgs: (OrgChartItem | null)[] }>(
    "/org-chart",
  );
  return data.orgs.filter((o): o is OrgChartItem => o !== null);
}

// The chart shows who to contact, so it lists only the roles allowed here. Any
// other role is an access grant and stays hidden, including roles added later.
// The org-chart endpoint already returns only admin and editor roles; this
// filter keeps the page to that list even if the endpoint's list widens.
const VISIBLE_ROLES: ReadonlySet<string> = new Set(["admin", "editor"]);

export async function fetchOrgById(id: number): Promise<OrgDetail> {
  const detail = await orgMapFetch<OrgDetail>(`/org-chart/${id}`);
  return {
    ...detail,
    roles: detail.roles.filter((r) => VISIBLE_ROLES.has(r.title)),
  };
}

interface ApiOrg {
  id: number;
  name: string | null;
  orgType: unknown;
  parentId: number | null;
}

/**
 * The orgs with a known type. An org whose parent has an unknown type (a tier
 * added to the API before this page knows it) is re-linked to its nearest
 * known ancestor, so filtering on that ancestor still reaches it.
 */
function recognizedOrgs(raw: readonly ApiOrg[]): Org[] {
  const byId = new Map(raw.map((o) => [o.id, o]));
  const known = (o: ApiOrg | undefined) =>
    o != null && normalizeOrgType(o.orgType) != null;
  return raw.flatMap((org) => {
    const orgType = normalizeOrgType(org.orgType);
    if (!orgType) return [];
    let parentId = org.parentId;
    const seen = new Set([org.id]);
    while (parentId != null && !known(byId.get(parentId))) {
      const parent = byId.get(parentId);
      // Missing from the list, or a cycle: keep the id as it is.
      if (!parent || seen.has(parentId)) break;
      seen.add(parentId);
      parentId = parent.parentId;
    }
    return [
      { id: org.id, name: org.name ?? `Org ${org.id}`, orgType, parentId },
    ];
  });
}

/**
 * Every active non-AO org (with or without active locations) and every
 * position and role holder at those orgs, in one request.
 */
export async function fetchLeadership(): Promise<{
  orgs: Org[];
  leaders: LeaderEntry[];
}> {
  const data = await orgMapFetch<{
    orgs: ApiOrg[];
    leaders: LeaderEntry[];
  }>("/org-chart/leadership");
  return {
    orgs: recognizedOrgs(data.orgs),
    leaders: data.leaders.filter(
      (l) => l.kind === "position" || VISIBLE_ROLES.has(l.title),
    ),
  };
}

export async function fetchLocationById(
  locationId: number,
): Promise<LocationDetail> {
  return orgMapFetch<LocationDetail>(`/org-chart/location/${locationId}`);
}

export async function searchAos(
  searchTerm: string,
  signal?: AbortSignal,
): Promise<AoSearchResult[]> {
  const data = await orgMapFetch<{ aos: AoSearchResult[] }>(
    `/org-chart/aos?searchTerm=${encodeURIComponent(searchTerm)}`,
    signal,
  );
  return data.aos;
}
