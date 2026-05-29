import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Control the "signed-in" user per test.
const session = vi.hoisted(() => ({
  current: null as null | { user: { id: string; email: string } },
}));
vi.mock("@/auth", () => ({
  auth: { api: { getSession: async () => session.current } },
}));
// Route handlers call next/headers; outside a request scope it throws, so stub it.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { domain, user } from "@/db/schema";
import { GET, POST } from "./route";
import { DELETE, PUT } from "./[id]/route";

const UA = "itest-user-a";
const UB = "itest-user-b";
const HOSTS = ["itest-apex.example", "itest-sub.itest-apex.example"];

function post(body: unknown) {
  return new Request("http://t/api/domains", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function cleanup() {
  await db.delete(domain).where(inArray(domain.hostname, HOSTS));
  await db.delete(user).where(inArray(user.id, [UA, UB]));
}

beforeAll(async () => {
  await cleanup();
  await db.insert(user).values([
    { id: UA, name: "A", email: "itest-a@example.com", emailVerified: true },
    { id: UB, name: "B", email: "itest-b@example.com", emailVerified: true },
  ]);
});
afterAll(cleanup);
beforeEach(async () => {
  await db.delete(domain).where(inArray(domain.hostname, HOSTS));
  session.current = null;
});

describe("POST /api/domains", () => {
  it("401 when unauthenticated", async () => {
    const res = await POST(
      post({ hostname: HOSTS[0], destination: "https://x.com" }),
    );
    expect(res.status).toBe(401);
  });

  it("registers a domain and returns DNS records", async () => {
    session.current = { user: { id: UA, email: "itest-a@example.com" } };
    const res = await POST(
      post({ hostname: HOSTS[0], destination: "https://example.com/a" }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.domain.hostname).toBe(HOSTS[0]);
    expect(body.domain.dns[0].type).toBe("A");
    const rows = await db
      .select()
      .from(domain)
      .where(eq(domain.hostname, HOSTS[0]!));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(UA);
  });

  it("400 on invalid hostname", async () => {
    session.current = { user: { id: UA, email: "a" } };
    const res = await POST(
      post({ hostname: "nodot", destination: "https://x.com" }),
    );
    expect(res.status).toBe(400);
  });

  it("409 when the same user re-registers", async () => {
    session.current = { user: { id: UA, email: "a" } };
    await POST(post({ hostname: HOSTS[0], destination: "https://x.com" }));
    const res = await POST(
      post({ hostname: HOSTS[0], destination: "https://y.com" }),
    );
    expect(res.status).toBe(409);
  });

  it("409 when another account claims the same host", async () => {
    session.current = { user: { id: UA, email: "a" } };
    await POST(post({ hostname: HOSTS[0], destination: "https://x.com" }));
    session.current = { user: { id: UB, email: "b" } };
    const res = await POST(
      post({ hostname: HOSTS[0], destination: "https://hijack.com" }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/another account/i);
  });
});

describe("GET /api/domains", () => {
  it("lists only the caller's domains", async () => {
    session.current = { user: { id: UA, email: "a" } };
    await POST(post({ hostname: HOSTS[0], destination: "https://a.com" }));
    session.current = { user: { id: UB, email: "b" } };
    await POST(post({ hostname: HOSTS[1], destination: "https://b.com" }));
    const res = await GET();
    const body = await res.json();
    expect(body.domains).toHaveLength(1);
    expect(body.domains[0].hostname).toBe(HOSTS[1]);
  });
});

function put(id: string, body: unknown) {
  return [
    new Request("http://t", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  ] as const;
}

describe("PUT /api/domains/:id", () => {
  it("updates the destination for the owner", async () => {
    session.current = { user: { id: UA, email: "a" } };
    const created = await (
      await POST(post({ hostname: HOSTS[0], destination: "https://a.com/old" }))
    ).json();
    const id = created.domain.id;

    const res = await PUT(...put(id, { destination: "https://a.com/new" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.domain.destination).toBe("https://a.com/new");

    const rows = await db.select().from(domain).where(eq(domain.id, id));
    expect(rows[0]!.destinationUrl).toBe("https://a.com/new");
  });

  it("400 on an invalid destination", async () => {
    session.current = { user: { id: UA, email: "a" } };
    const created = await (
      await POST(post({ hostname: HOSTS[0], destination: "https://a.com" }))
    ).json();
    const res = await PUT(
      ...put(created.domain.id, { destination: "not-a-url" }),
    );
    expect(res.status).toBe(400);
  });

  it("404 when another account tries to edit it", async () => {
    session.current = { user: { id: UA, email: "a" } };
    const created = await (
      await POST(post({ hostname: HOSTS[0], destination: "https://a.com" }))
    ).json();
    session.current = { user: { id: UB, email: "b" } };
    const res = await PUT(
      ...put(created.domain.id, { destination: "https://hijack.com" }),
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/domains/:id", () => {
  it("removes only the caller's own domain", async () => {
    session.current = { user: { id: UA, email: "a" } };
    const created = await (
      await POST(post({ hostname: HOSTS[0], destination: "https://a.com" }))
    ).json();
    const id = created.domain.id;

    // another user cannot delete it
    session.current = { user: { id: UB, email: "b" } };
    const denied = await DELETE(new Request("http://t"), {
      params: Promise.resolve({ id }),
    });
    expect(denied.status).toBe(404);

    // owner can
    session.current = { user: { id: UA, email: "a" } };
    const ok = await DELETE(new Request("http://t"), {
      params: Promise.resolve({ id }),
    });
    expect(ok.status).toBe(200);
    const rows = await db
      .select()
      .from(domain)
      .where(eq(domain.hostname, HOSTS[0]!));
    expect(rows).toHaveLength(0);
  });
});
