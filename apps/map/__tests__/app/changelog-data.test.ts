/**
 * Tests for `getChangelog`, which reshapes the map's Release-Please
 * CHANGELOG.md into what /changelog renders: internal-only items, dependency
 * sections and releases left empty are dropped, and bullets lose their
 * conventional-commit scope, links and bold markers.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getChangelog } from "~/app/changelog/changelog-data";

vi.mock("fs", () => ({ readFileSync: vi.fn() }));

const mockedRead = vi.mocked(readFileSync);

function withChangelog(markdown: string) {
  mockedRead.mockReturnValue(markdown);
}

beforeEach(() => {
  mockedRead.mockReset();
});

describe("getChangelog", () => {
  it("reads CHANGELOG.md from the working directory", () => {
    withChangelog("");
    getChangelog();
    expect(mockedRead).toHaveBeenCalledWith(
      join(process.cwd(), "CHANGELOG.md"),
      "utf8",
    );
  });

  it("parses versions, dates, sections and cleaned items", () => {
    withChangelog(
      [
        "# Changelog",
        "",
        "## [7.9.0](https://github.com/x/compare/a...b) (2026-10-29)",
        "",
        "### Features",
        "",
        "* **map,shared:** add a table view ([#1705](https://github.com/x/issues/1705)) ([abc1234](https://github.com/x/commit/abc1234))",
        "- **map:** show [the docs](https://example.com) in **bold** help",
        "",
        "### Bug Fixes",
        "",
        "* **map:** stop the map crashing ([#1](https://github.com/x/issues/1))",
      ].join("\n"),
    );

    expect(getChangelog()).toEqual([
      {
        version: "7.9.0",
        date: "2026-10-29",
        sections: [
          {
            title: "Features",
            items: ["add a table view", "show the docs in bold help"],
          },
          { title: "Bug Fixes", items: ["stop the map crashing"] },
        ],
      },
    ]);
  });

  it("drops infra-only items but keeps ones touching a product area", () => {
    withChangelog(
      [
        "## [1.0.0](u) (2026-01-01)",
        "### Bug Fixes",
        "* **repo,ci:** tidy the workflow",
        "* **deps:** bump things",
        "* **map,repo:** fix the map and the repo",
        "* unscoped fix",
      ].join("\n"),
    );

    expect(getChangelog()[0]?.sections[0]?.items).toEqual([
      "fix the map and the repo",
      "unscoped fix",
    ]);
  });

  it("skips Dependencies sections and the ⚠ prefix on breaking-change titles", () => {
    withChangelog(
      [
        "## [2.0.0](u) (2026-02-02)",
        "### ⚠ BREAKING CHANGES",
        "* **map:** new URL scheme",
        "### Dependencies",
        "* The following workspace dependencies were updated",
        "  * @acme/api bumped to 0.16.0",
      ].join("\n"),
    );

    expect(getChangelog()).toEqual([
      {
        version: "2.0.0",
        date: "2026-02-02",
        sections: [{ title: "BREAKING CHANGES", items: ["new URL scheme"] }],
      },
    ]);
  });

  it("drops releases with nothing user-facing and ignores text before the first release", () => {
    withChangelog(
      [
        "* stray bullet before any release",
        "### Features",
        "* also before any release",
        "## [3.0.1](u) (2026-03-03)",
        "### Dependencies",
        "* @acme/ui bumped to 0.3.0",
        "## [3.0.0](u) (2026-03-01)",
        "### Bug Fixes",
        "* **ci:** only CI",
        "### Features",
        "* **map:** a real feature",
        "not a list item",
        "*   ",
      ].join("\n"),
    );

    expect(getChangelog()).toEqual([
      {
        version: "3.0.0",
        date: "2026-03-01",
        sections: [{ title: "Features", items: ["a real feature"] }],
      },
    ]);
  });

  it("ignores list items under a version before any section heading", () => {
    withChangelog(
      ["## [4.0.0](u) (2026-04-04)", "* orphan item", "### Features"].join(
        "\n",
      ),
    );

    expect(getChangelog()).toEqual([]);
  });
});
