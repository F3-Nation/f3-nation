import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "@playwright/test";

/**
 * Update-request RBAC — BLOCKING tier, API-only (no browser).
 *
 * Exercises the submission/review authorization matrix of
 * specs/map-update-request-flow.md §5 directly against the API app
 * (E2E_API_URL) using the seeded local API keys as principals. The browser
 * suite (tests/e2e/update-request.spec.ts) cannot cover these paths because
 * the local dev-mode credentials provider always yields a nation-admin
 * session.
 *
 * Test → AC mapping:
 *   - "non-editor submit is recorded pending with no live change"   → AC-8
 *   - "nation editor submit is auto-applied"                        → AC-9
 *     (API half: status `approved` + the event exists in live data)
 *   - "non-editor cannot reject and the request stays pending"      → §5 reject
 *     row (editorProcedure denies role-less principals)
 *   - "cross-region editor cannot reject; same editor can reject in
 *      their own region"                                            → AC-15
 *   - "unauthenticated submit is rejected"                          → §5 submit
 *     row (protectedProcedure → UNAUTHORIZED)
 *
 * Principals (seeded by pnpm db:seed:local —
 * packages/db/src/local-seed-lib/data.ts LOCAL_API_KEYS):
 *   - local-slackbot-key     admin on F3 Nation (used only for verification reads)
 *   - local-api-key          editor on F3 Nation → auto-apply everywhere
 *   - local-boone-editor-key editor scoped to the Boone REGION only
 *   - local-map-key          no role (read-only tier) → submits go pending
 *
 * Requests authenticate with `Authorization: Bearer <key>` plus a
 * `client: e2e` header — any non-oRPC client value routes to the OpenAPI
 * handler (apps/api/src/app/[[...rest]]/route.ts) and marks the bearer as an
 * API key rather than a JWT.
 *
 * REST paths come from packages/api/src/root.ts (prefix /v1, router prefix
 * /request) plus each procedure's .route() in
 * packages/api/src/router/request.ts:
 *   POST /v1/request/create-event-request   (protectedProcedure)
 *   POST /v1/request/reject-submission      (editorProcedure)
 *   GET  /v1/request/id/{id}                (editorProcedure)
 *
 * DATA ASSUMPTIONS (deterministic local seed):
 *   - Regions "Boone" and "F3 Charlotte" exist.
 *   - Boone AOs "The Dark Tower" / "The Viaduct"; Charlotte AOs "The Foundry" /
 *     "The Colosseum" / "South End Station"; every AO has one weekly
 *     "<AO name> Bootcamp" event, Monday 05:30 AM.
 *   - Event type "Bootcamp" exists.
 *   All ids are resolved at runtime via API reads — never hardcoded. Created
 *   events use unique name suffixes and Monday 05:30 AM so reruns never
 *   collide and browse-suite determinism holds.
 *
 * Local-dev caveat: requests with NO Authorization header at all get the
 * dev-mode mock session on a development API server
 * (packages/api/src/shared.ts getDevMockSession), so the deterministic
 * "unauthenticated" principal here is an invalid bearer token — a credential
 * that resolves to no session in every environment.
 */

const E2E_API_URL = process.env.E2E_API_URL;
if (!E2E_API_URL) {
  throw new Error(
    "E2E_API_URL is required but not set. Point it at the API app under " +
      "test, e.g. E2E_API_URL=http://localhost:3001",
  );
}
const API = E2E_API_URL.replace(/\/$/, "");

const KEYS = {
  nationAdmin: "local-slackbot-key",
  nationEditor: "local-api-key",
  booneEditor: "local-boone-editor-key",
  readOnly: "local-map-key",
} as const;

const headers = (key: string) => ({
  Authorization: `Bearer ${key}`,
  client: "e2e",
});

const uniqueSuffix = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

interface SeedRefs {
  booneRegionId: number;
  charlotteRegionId: number;
  boone: { aoId: number; locationId: number };
  charlotte: { aoId: number; locationId: number };
  bootcampEventTypeId: number;
}

let seedRefs: SeedRefs | null = null;

/** Resolve seeded org/AO/location/event-type ids at runtime (memoized). */
async function resolveSeedRefs(request: APIRequestContext): Promise<SeedRefs> {
  if (seedRefs) return seedRefs;

  const getRegionId = async (name: string) => {
    const res = await request.get(`${API}/v1/org`, {
      params: { orgTypes: "region", searchTerm: name },
      headers: headers(KEYS.readOnly),
    });
    expect(res.ok()).toBe(true);
    const { orgs } = (await res.json()) as {
      orgs: { id: number; name: string }[];
    };
    const region = orgs.find((o) => o.name === name);
    expect(region, `seeded region "${name}" should exist`).toBeTruthy();
    if (!region) throw new Error(`region ${name} not found`);
    return region.id;
  };

  // The seeded "<AO name> Bootcamp" event carries both the AO (parent) id and
  // the location id.
  const getAoRefs = async (aoName: string) => {
    const res = await request.get(`${API}/v1/event`, {
      params: { searchTerm: `${aoName} Bootcamp` },
      headers: headers(KEYS.readOnly),
    });
    expect(res.ok()).toBe(true);
    const { events } = (await res.json()) as {
      events: {
        name: string;
        locationId: number;
        parents: { parentId: number }[];
      }[];
    };
    const event = events.find((e) => e.name === `${aoName} Bootcamp`);
    expect(
      event,
      `seeded event "${aoName} Bootcamp" should exist`,
    ).toBeTruthy();
    if (!event?.parents[0]) throw new Error(`event for ${aoName} not found`);
    return { aoId: event.parents[0].parentId, locationId: event.locationId };
  };

  const eventTypesRes = await request.get(`${API}/v1/event-type`, {
    headers: headers(KEYS.readOnly),
  });
  expect(eventTypesRes.ok()).toBe(true);
  const { eventTypes } = (await eventTypesRes.json()) as {
    eventTypes: { id: number; name: string }[];
  };
  const bootcamp = eventTypes.find((t) => t.name === "Bootcamp");
  expect(bootcamp, 'event type "Bootcamp" should exist').toBeTruthy();
  if (!bootcamp) throw new Error("Bootcamp event type not found");

  seedRefs = {
    booneRegionId: await getRegionId("Boone"),
    charlotteRegionId: await getRegionId("F3 Charlotte"),
    boone: await getAoRefs("The Dark Tower"),
    charlotte: await getAoRefs("The Foundry"),
    bootcampEventTypeId: bootcamp.id,
  };
  return seedRefs;
}

/** Build a valid create_event payload against the given region/AO. */
function createEventPayload(params: {
  refs: SeedRefs;
  region: "boone" | "charlotte";
  eventName: string;
}) {
  const { refs, region, eventName } = params;
  const target = region === "boone" ? refs.boone : refs.charlotte;
  return {
    id: crypto.randomUUID(),
    requestType: "create_event",
    submittedBy: "e2e-rbac@f3local.dev",
    originalRegionId:
      region === "boone" ? refs.booneRegionId : refs.charlotteRegionId,
    originalAoId: target.aoId,
    originalLocationId: target.locationId,
    eventName,
    eventDayOfWeek: "monday",
    // Monday 05:30 AM to preserve browse-suite determinism assumptions.
    eventStartTime: "0530",
    eventEndTime: "0615",
    eventTypeIds: [refs.bootcampEventTypeId],
  };
}

async function submitCreateEvent(
  request: APIRequestContext,
  key: string,
  payload: ReturnType<typeof createEventPayload>,
) {
  return request.post(`${API}/v1/request/create-event-request`, {
    headers: headers(key),
    data: payload,
  });
}

/** Read a request's status back with a principal that can always see it. */
async function getRequestStatus(request: APIRequestContext, id: string) {
  const res = await request.get(`${API}/v1/request/id/${id}`, {
    headers: headers(KEYS.nationAdmin),
  });
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as {
    request: { status: string } | null;
  };
  expect(body.request, `request ${id} should exist`).toBeTruthy();
  return body.request?.status;
}

async function rejectRequest(
  request: APIRequestContext,
  key: string,
  id: string,
) {
  return request.post(`${API}/v1/request/reject-submission`, {
    headers: headers(key),
    data: { id },
  });
}

/** Whether an event with this exact name exists in live data. */
async function liveEventExists(request: APIRequestContext, name: string) {
  const res = await request.get(`${API}/v1/event`, {
    params: { searchTerm: name },
    headers: headers(KEYS.readOnly),
  });
  expect(res.ok()).toBe(true);
  const { events } = (await res.json()) as { events: { name: string }[] };
  return events.some((e) => e.name === name);
}

test.describe("update-request RBAC (API)", () => {
  test("non-editor submit is recorded pending with no live change", async ({
    request,
  }) => {
    const refs = await resolveSeedRefs(request);
    const eventName = `E2E RBAC pending ${uniqueSuffix()}`;
    const res = await submitCreateEvent(
      request,
      KEYS.readOnly,
      createEventPayload({ refs, region: "charlotte", eventName }),
    );
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      status: string;
      updateRequest: { id: string };
    };

    // Recorded pending, not auto-applied…
    expect(body.status).toBe("pending");
    expect(await getRequestStatus(request, body.updateRequest.id)).toBe(
      "pending",
    );
    // …and no live map data changed.
    expect(await liveEventExists(request, eventName)).toBe(false);
  });

  test("nation editor submit is auto-applied", async ({ request }) => {
    const refs = await resolveSeedRefs(request);
    const eventName = `E2E RBAC applied ${uniqueSuffix()}`;
    const res = await submitCreateEvent(
      request,
      KEYS.nationEditor,
      createEventPayload({ refs, region: "charlotte", eventName }),
    );
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      status: string;
      updateRequest: { id: string };
    };

    // Approved immediately, and the change is live.
    expect(body.status).toBe("approved");
    expect(await getRequestStatus(request, body.updateRequest.id)).toBe(
      "approved",
    );
    expect(await liveEventExists(request, eventName)).toBe(true);
  });

  test("non-editor cannot reject and the request stays pending", async ({
    request,
  }) => {
    const refs = await resolveSeedRefs(request);
    const eventName = `E2E RBAC noreject ${uniqueSuffix()}`;
    const submitRes = await submitCreateEvent(
      request,
      KEYS.readOnly,
      createEventPayload({ refs, region: "charlotte", eventName }),
    );
    expect(submitRes.status()).toBe(200);
    const { updateRequest } = (await submitRes.json()) as {
      updateRequest: { id: string };
    };

    // editorProcedure denies principals without any editor/admin role.
    const rejectRes = await rejectRequest(
      request,
      KEYS.readOnly,
      updateRequest.id,
    );
    expect(rejectRes.status()).toBe(401);
    expect(await getRequestStatus(request, updateRequest.id)).toBe("pending");
  });

  test("cross-region editor cannot reject; same editor can reject in their own region (AC-15)", async ({
    request,
  }) => {
    const refs = await resolveSeedRefs(request);

    // A pending request in F3 Charlotte…
    const charlotteName = `E2E RBAC xregion ${uniqueSuffix()}`;
    const charlotteRes = await submitCreateEvent(
      request,
      KEYS.readOnly,
      createEventPayload({
        refs,
        region: "charlotte",
        eventName: charlotteName,
      }),
    );
    expect(charlotteRes.status()).toBe(200);
    const charlotteRequest = (
      (await charlotteRes.json()) as { updateRequest: { id: string } }
    ).updateRequest;

    // …cannot be rejected by an editor scoped to the Boone region only.
    const denied = await rejectRequest(
      request,
      KEYS.booneEditor,
      charlotteRequest.id,
    );
    expect(denied.status()).toBe(401);
    expect(await getRequestStatus(request, charlotteRequest.id)).toBe(
      "pending",
    );

    // Positive control: the same key CAN reject a Boone-region request.
    const booneName = `E2E RBAC boonereject ${uniqueSuffix()}`;
    const booneRes = await submitCreateEvent(
      request,
      KEYS.readOnly,
      createEventPayload({ refs, region: "boone", eventName: booneName }),
    );
    expect(booneRes.status()).toBe(200);
    const booneRequest = (
      (await booneRes.json()) as { updateRequest: { id: string } }
    ).updateRequest;

    const allowed = await rejectRequest(
      request,
      KEYS.booneEditor,
      booneRequest.id,
    );
    expect(allowed.status()).toBe(200);
    expect(((await allowed.json()) as { status: string }).status).toBe(
      "rejected",
    );
    expect(await getRequestStatus(request, booneRequest.id)).toBe("rejected");
    // Reject never applies the change.
    expect(await liveEventExists(request, booneName)).toBe(false);
  });

  test("unauthenticated submit is rejected", async ({ request }) => {
    const refs = await resolveSeedRefs(request);
    const eventName = `E2E RBAC unauthed ${uniqueSuffix()}`;
    // An invalid bearer resolves to no session (see the local-dev caveat in
    // the header about why this — not a missing header — is the deterministic
    // unauthenticated principal).
    const res = await submitCreateEvent(
      request,
      "not-a-real-key",
      createEventPayload({ refs, region: "charlotte", eventName }),
    );
    expect(res.status()).toBe(401);
    expect(await liveEventExists(request, eventName)).toBe(false);
  });
});
