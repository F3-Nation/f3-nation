import { afterEach, describe, expect, it, vi } from "vitest";

import type { App, AppGroup } from "./apps";
import { APP_GROUPS, resolveHref, selectAppGroups } from "./apps";
import { getChannel, getDefaultApiBase, getSiteOrigin } from "./channel";

afterEach(() => {
  vi.unstubAllEnvs();
});

/** name -> href for every card in a directory, in render order. */
function links(groups: { apps: App[] }[]): [string, string | undefined][] {
  return groups.flatMap((g) =>
    g.apps.map((a): [string, string | undefined] => [a.name, a.href]),
  );
}

// The production directory exactly as it shipped before the staging channel
// existed. Any change here is a change to apps.f3nation.com.
const PROD_LINKS: [string, string | undefined][] = [
  ["F3 Map", "https://map.f3nation.com"],
  ["F3 Near Me", "https://f3near.me"],
  ["F3 Me", "https://me.f3nation.com"],
  ["PAX Vault", "https://pax-vault.f3nation.com"],
  ["The Codex", "https://codex.f3nation.com"],
  ["Org Chart", "https://apps.f3nation.com/org"],
  ["Admin", "https://admin.f3nation.com"],
  ["Region Pages", "https://regions.f3nation.com"],
  [
    "Slack Bot",
    "https://docs.google.com/document/d/1e7tmuY3irKDt9oy1URQVcxPwxyet1ZY_bVZhGvhESEw",
  ],
  [
    "SyncBot",
    "https://github.com/F3-Nation/syncbot/blob/main/docs/USER_GUIDE.md",
  ],
  ["Auth", undefined],
  ["API", "https://api.f3nation.com"],
  ["Status", "https://apps.f3nation.com/status/"],
];

describe("getChannel", () => {
  it("defaults to prod when NEXT_PUBLIC_CHANNEL is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_CHANNEL", undefined);
    expect(getChannel()).toBe("prod");
  });

  it("reads staging from NEXT_PUBLIC_CHANNEL", () => {
    vi.stubEnv("NEXT_PUBLIC_CHANNEL", "staging");
    expect(getChannel()).toBe("staging");
  });

  it.each(["prod", "ci", "local", "dev", "branch", "", "STAGING"])(
    "treats %j as prod",
    (value) => {
      expect(getChannel(value)).toBe("prod");
    },
  );
});

describe("channel hosts", () => {
  it("points prod at the production site and API", () => {
    expect(getSiteOrigin("prod")).toBe("https://apps.f3nation.com");
    expect(getDefaultApiBase("prod")).toBe("https://api.f3nation.com");
  });

  it("points staging at the staging site and API", () => {
    expect(getSiteOrigin("staging")).toBe("https://staging.apps.f3nation.com");
    expect(getDefaultApiBase("staging")).toBe(
      "https://staging.api.f3nation.com",
    );
  });

  it("follows NEXT_PUBLIC_CHANNEL when no channel is passed", () => {
    vi.stubEnv("NEXT_PUBLIC_CHANNEL", "staging");
    expect(getSiteOrigin()).toBe("https://staging.apps.f3nation.com");
    expect(getDefaultApiBase()).toBe("https://staging.api.f3nation.com");
  });
});

describe("selectAppGroups — prod", () => {
  it("returns the production directory unchanged by default", () => {
    vi.stubEnv("NEXT_PUBLIC_CHANNEL", undefined);
    const groups = selectAppGroups();
    expect(groups).toBe(APP_GROUPS);
    expect(groups.map((g) => g.title)).toEqual([
      "Everyday Use",
      "Region Admins",
      "Developers",
    ]);
    expect(links(groups)).toEqual(PROD_LINKS);
  });

  it("links no staging host", () => {
    const hrefs = links(selectAppGroups("prod")).map(([, href]) => href);
    expect(hrefs.some((href) => href?.includes("staging."))).toBe(false);
  });
});

describe("selectAppGroups — staging", () => {
  it("links every card to its staging host", () => {
    vi.stubEnv("NEXT_PUBLIC_CHANNEL", "staging");
    expect(links(selectAppGroups())).toEqual([
      ["F3 Map", "https://staging.map.f3nation.com"],
      ["F3 Me", "https://staging.me.f3nation.com"],
      ["Org Chart", "https://staging.apps.f3nation.com/org"],
      ["Admin", "https://staging.admin.f3nation.com"],
      ["Auth", undefined],
      ["API", "https://staging.api.f3nation.com"],
      ["Status", "https://staging.apps.f3nation.com/status/"],
    ]);
  });

  it("hides apps that have no staging site", () => {
    const names = selectAppGroups("staging").flatMap((g) =>
      g.apps.map((a) => a.name),
    );
    for (const hidden of [
      "PAX Vault",
      "The Codex",
      "Region Pages",
      "F3 Near Me",
      "Slack Bot",
      "SyncBot",
    ]) {
      expect(names).not.toContain(hidden);
    }
  });

  it("never links a production host", () => {
    for (const [, href] of links(selectAppGroups("staging"))) {
      if (href === undefined) continue;
      expect(new URL(href).hostname).toMatch(/^staging\./);
    }
  });

  it("keeps informational cards and the group order", () => {
    const groups = selectAppGroups("staging");
    expect(groups.map((g) => g.title)).toEqual([
      "Everyday Use",
      "Region Admins",
      "Developers",
    ]);
    expect(groups[2]?.apps.find((a) => a.name === "Auth")).toBeDefined();
  });

  it("drops a group left with no staging apps", () => {
    const groups: AppGroup[] = [
      {
        title: "External",
        description: "No staging sites here.",
        apps: [{ name: "Elsewhere", description: "x", href: "https://x.test" }],
      },
      {
        title: "Ours",
        description: "Has a staging site.",
        apps: [
          {
            name: "Ours",
            description: "y",
            href: "https://y.test",
            stagingHref: "https://staging.y.test",
          },
        ],
      },
    ];
    expect(selectAppGroups("staging", groups)).toEqual([
      {
        title: "Ours",
        description: "Has a staging site.",
        apps: [
          {
            name: "Ours",
            description: "y",
            href: "https://staging.y.test",
            stagingHref: "https://staging.y.test",
          },
        ],
      },
    ]);
  });

  it("does not mutate the source groups", () => {
    selectAppGroups("staging");
    expect(links(APP_GROUPS)).toEqual(PROD_LINKS);
  });
});

describe("resolveHref", () => {
  const app: App = {
    name: "A",
    description: "a",
    href: "https://a.test",
    localHref: "http://localhost:1",
  };

  it("uses href outside local dev", () => {
    expect(resolveHref(app, false)).toBe("https://a.test");
  });

  it("prefers localHref in local dev", () => {
    expect(resolveHref(app, true)).toBe("http://localhost:1");
  });

  it("falls back to href in local dev without a localHref", () => {
    expect(
      resolveHref(
        { name: "B", description: "b", href: "https://b.test" },
        true,
      ),
    ).toBe("https://b.test");
  });

  it("returns undefined for informational cards", () => {
    expect(resolveHref({ name: "C", description: "c" }, true)).toBeUndefined();
  });
});
