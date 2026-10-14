import { afterEach, describe, expect, it, vi } from "vitest";

async function loadModule() {
  vi.resetModules();
  return import("./local-docker");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("local Docker names", () => {
  it("uses the shared stack's defaults", async () => {
    vi.stubEnv("F3_CONTAINER_PREFIX", undefined);
    vi.stubEnv("F3_ADMIN_PORT", undefined);
    const { LOCAL_PG_CONTAINER, localAppOrigin } = await loadModule();

    expect(LOCAL_PG_CONTAINER).toBe("f3-postgres");
    expect(localAppOrigin("F3_ADMIN_PORT", 3002)).toBe("http://localhost:3002");
  });

  it("follows a worktree slot's overrides", async () => {
    vi.stubEnv("F3_CONTAINER_PREFIX", "f3-wt2");
    vi.stubEnv("F3_ME_PORT", "3203");
    const { LOCAL_PG_CONTAINER, localAppOrigin } = await loadModule();

    expect(LOCAL_PG_CONTAINER).toBe("f3-wt2-postgres");
    expect(localAppOrigin("F3_ME_PORT", 3003)).toBe("http://localhost:3203");
  });
});
