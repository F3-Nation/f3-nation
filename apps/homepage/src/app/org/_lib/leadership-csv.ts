import { orgTypeDisplay } from "@acme/shared/app/org-hierarchy";

import type { TableRow } from "./leadership-table";
import { isEmptyOrgRow } from "./leadership-table";

/** Shown in place of a PAX and a title for an org with nobody listed. */
export const NO_PAX_LISTED = "NO PAX LISTED";
export const NO_POSITIONS_FILLED = "NO POSITIONS FILLED";

const HEADERS = [
  "Org",
  "Level",
  "PAX",
  "Home Region",
  "Position/Role",
  "Type",
] as const;

/**
 * One CSV field. Values starting with a formula character are prefixed with
 * an apostrophe so spreadsheet apps show them as text instead of running them;
 * fields with commas, quotes, or line breaks are quoted.
 */
function field(value: string | null): string {
  let text = value ?? "";
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The rows as CSV, in the order given (the table's current order). */
export function leadershipCsv(rows: readonly TableRow[]): string {
  const lines = [
    HEADERS.join(","),
    ...rows.map((row) =>
      [
        row.org.name,
        orgTypeDisplay[row.org.orgType].label,
        ...(isEmptyOrgRow(row)
          ? [NO_PAX_LISTED, null, NO_POSITIONS_FILLED, null]
          : [
              row.f3Name ?? "Unknown",
              row.homeRegionName,
              row.title,
              row.kind === "position" ? "Position" : "Role",
            ]),
      ]
        .map(field)
        .join(","),
    ),
  ];
  return `${lines.join("\r\n")}\r\n`;
}

/** e.g. "f3-positions-and-roles-2026-11-09.csv", using the local date. */
export function leadershipCsvFilename(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `f3-positions-and-roles-${date}.csv`;
}

/** Save `csv` as a file through a temporary download link. */
export function downloadCsv(csv: string, filename: string): void {
  // A BOM so Excel reads the file as UTF-8 (names with accents, emoji).
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
