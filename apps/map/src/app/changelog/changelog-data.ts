import { readFileSync } from "fs";
import { join } from "path";

// The /changelog page is sourced automatically from the map app's
// Release-Please changelog (apps/map/CHANGELOG.md) so it never drifts out of
// sync with what actually ships. This module reads and reshapes that file at
// build time (the route is statically generated) into the structure the page
// renders. Because it reads apps/map/CHANGELOG.md, it is inherently map-only.

export interface ChangelogSection {
  title: string;
  items: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  sections: ChangelogSection[];
}

// Release-Please sections that carry nothing a reader of the map would care
// about.
const SKIP_SECTIONS = new Set(["Dependencies"]);

// Conventional-commit scopes that are purely internal. An item whose scope is
// entirely one or more of these is dropped; anything touching a product area
// (e.g. "map,shared" or "map,api,repo") is kept.
const INFRA_SCOPES = new Set([
  "repo",
  "ci",
  "build",
  "deps",
  "test",
  "chore",
  "style",
  "tooling",
  "docs",
]);

const VERSION_HEADING = /^##\s+\[([^\]]+)\]\([^)]*\)\s+\((\d{4}-\d{2}-\d{2})\)/;
const SECTION_HEADING = /^###\s+(.+?)\s*$/;
const LIST_ITEM = /^\s*[-*]\s+/;
const SCOPE_PREFIX = /\*\*([a-z0-9,\-]+):\*\*/;

function scopes(raw: string): string[] {
  const captured = SCOPE_PREFIX.exec(raw)?.[1];
  return captured ? captured.split(",") : [];
}

function isInfraOnly(raw: string): boolean {
  const found = scopes(raw);
  return found.length > 0 && found.every((s) => INFRA_SCOPES.has(s));
}

// Turn a Release-Please bullet into plain, readable text: drop the leading
// marker, the conventional-commit scope prefix, markdown links (PR/commit
// refs), and bold markers.
function cleanItem(raw: string): string {
  return raw
    .replace(LIST_ITEM, "")
    .replace(/\s*\(\[[^\]]+\]\([^)]*\)\)/g, "") // ( [#123](url) ) / ( [sha](url) )
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // remaining [text](url) -> text
    .replace(/\*\*([^*]+)\*\*/g, "$1") // **text** -> text
    .replace(/^[a-z0-9][a-z0-9,\-]*:\s+/, "") // scope prefix, e.g. "map,shared: "
    .trim();
}

export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let entry: ChangelogEntry | null = null;
  let section: ChangelogSection | null = null;

  for (const line of markdown.split("\n")) {
    const versionMatch = VERSION_HEADING.exec(line);
    if (versionMatch?.[1] && versionMatch[2]) {
      entry = { version: versionMatch[1], date: versionMatch[2], sections: [] };
      section = null;
      entries.push(entry);
      continue;
    }
    if (!entry) continue;

    const sectionMatch = SECTION_HEADING.exec(line);
    if (sectionMatch?.[1]) {
      const title = sectionMatch[1].replace(/^[⚠\s]+/, "").trim();
      section = SKIP_SECTIONS.has(title) ? null : { title, items: [] };
      if (section) entry.sections.push(section);
      continue;
    }

    if (section && LIST_ITEM.test(line) && !isInfraOnly(line)) {
      const item = cleanItem(line);
      if (item) section.items.push(item);
    }
  }

  // Drop empty sections and releases with nothing user-facing left (e.g.
  // dependency-only version bumps).
  for (const e of entries) {
    e.sections = e.sections.filter((s) => s.items.length > 0);
  }
  return entries.filter((e) => e.sections.length > 0);
}

export function getChangelog(): ChangelogEntry[] {
  const file = join(process.cwd(), "CHANGELOG.md");
  return parseChangelog(readFileSync(file, "utf8"));
}
