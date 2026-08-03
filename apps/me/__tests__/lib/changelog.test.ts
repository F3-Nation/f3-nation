import { describe, it, expect } from "vitest";

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

  it("returns empty array for empty input", () => {
    expect(parseChangelog("")).toEqual([]);
  });
});
