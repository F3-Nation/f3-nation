import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// server-only is mocked globally in vitest.setup.ts
import { parseChangelog } from "@/lib/changelog";

const SAMPLE = `
## [1.2.0](https://example.com) (2024-06-01)

### Features

- **me:** add profile avatar upload
- **me:** support emergency contact editing

### Bug Fixes

- **me:** fix avatar crop on mobile

### Dependencies

- bump vitest to 4.0

## [1.1.0](https://example.com) (2024-05-01)

### Features

- **repo:** update turbo pipeline

## [1.0.0](https://example.com) (2024-04-01)

### Features

- **me:** initial release
`;

describe("parseChangelog", () => {
  it("parses version entries and dates", () => {
    const entries = parseChangelog(SAMPLE);
    expect(entries[0]?.version).toBe("1.2.0");
    expect(entries[0]?.date).toBe("2024-06-01");
  });

  it("excludes Dependencies sections", () => {
    const entries = parseChangelog(SAMPLE);
    const v120 = entries.find((e) => e.version === "1.2.0")!;
    expect(v120.sections.map((s) => s.title)).not.toContain("Dependencies");
  });

  it("excludes entries where all commits are infra-only", () => {
    const entries = parseChangelog(SAMPLE);
    // v1.1.0 only has a repo-scoped feature — should be filtered out
    expect(entries.find((e) => e.version === "1.1.0")).toBeUndefined();
  });

  it("includes user-facing feature items", () => {
    const entries = parseChangelog(SAMPLE);
    const v120 = entries.find((e) => e.version === "1.2.0")!;
    const features = v120.sections.find((s) => s.title === "Features")!;
    expect(features.items).toContain("add profile avatar upload");
    expect(features.items).toContain("support emergency contact editing");
  });

  it("strips markdown links and bold scope prefixes from items", () => {
    const entries = parseChangelog(SAMPLE);
    const v120 = entries.find((e) => e.version === "1.2.0")!;
    const fixes = v120.sections.find((s) => s.title === "Bug Fixes")!;
    expect(fixes.items[0]).toBe("fix avatar crop on mobile");
  });

  it("strips PR and commit reference links from Release-Please items", () => {
    const md = `
## [1.0.0](https://example.com) (2024-01-01)

### Bug Fixes

- **me:** fix avatar crop on mobile ([#662](https://github.com/F3-Nation/f3-nation/issues/662)) ([70375fc](https://github.com/F3-Nation/f3-nation/commit/70375fc0b396b9f8f0aefd74b407a4ba9aae3b7f))
`;
    const entries = parseChangelog(md);
    const fixes = entries[0]!.sections.find((s) => s.title === "Bug Fixes")!;
    expect(fixes.items[0]).toBe("fix avatar crop on mobile");
  });

  it("returns empty array for empty input", () => {
    expect(parseChangelog("")).toEqual([]);
  });
});

describe("getChangelog", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed entries when CHANGELOG.md is readable", async () => {
    const { getChangelog } = await import("@/lib/changelog");
    const result = getChangelog();
    expect(result.length).toBeGreaterThan(0);
    expect(typeof result[0]?.version).toBe("string");
    expect(typeof result[0]?.date).toBe("string");
  });

  it("caches result and does not re-read the file on subsequent calls", async () => {
    const { getChangelog } = await import("@/lib/changelog");
    const first = getChangelog();
    const second = getChangelog();
    expect(first).toBe(second);
  });

  it("returns empty array and caches it when CHANGELOG.md is missing", async () => {
    vi.spyOn(process, "cwd").mockReturnValue("/nonexistent-path-xyz");
    const { getChangelog } = await import("@/lib/changelog");
    const first = getChangelog();
    const second = getChangelog();
    expect(first).toEqual([]);
    expect(second).toBe(first);
  });
});
