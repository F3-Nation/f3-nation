"use client";

import { useState } from "react";
import { orgTypeDisplay } from "@acme/shared/app/org-hierarchy";

import type { TableRow } from "../_lib/leadership-table";
import { NO_PAX_LISTED, NO_POSITIONS_FILLED } from "../_lib/leadership-csv";
import { groupRowsByOrg, isEmptyOrgRow } from "../_lib/leadership-table";
import { Avatar, EmptyLabel, KindTag } from "./leader-parts";

/**
 * The Table view on portrait phones: one collapsible section per org, each
 * person on a single line. The first org with anyone listed starts open.
 * Remount (via `key`) to reset which sections are open.
 */
export function OrgAccordion({ rows }: { rows: readonly TableRow[] }) {
  const groups = groupRowsByOrg(rows);
  const [openIds, setOpenIds] = useState<ReadonlySet<number>>(() => {
    const first = groups.find((g) => !g.empty);
    return new Set(first ? [first.org.id] : []);
  });

  const toggle = (orgId: number) =>
    setOpenIds((ids) => {
      const next = new Set(ids);
      if (!next.delete(orgId)) next.add(orgId);
      return next;
    });

  return (
    <ul aria-label="Positions and roles by org">
      {groups.map(({ org, rows: orgRows }) => {
        const open = openIds.has(org.id);
        const panelId = `org-accordion-${org.id}`;
        return (
          <li key={org.id} className="border-t border-border first:border-t-0">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => toggle(org.id)}
              className="flex w-full items-center gap-2 px-4 py-3 text-left font-semibold hover:bg-muted"
            >
              <span aria-hidden="true" className="w-3 text-muted-foreground">
                {open ? "▼" : "▶"}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {org.name}{" "}
                <span className="font-normal text-muted-foreground">
                  ({orgTypeDisplay[org.orgType].label})
                </span>
              </span>
            </button>
            {open && (
              <ul id={panelId} className="pb-2">
                {orgRows.map((row) =>
                  isEmptyOrgRow(row) ? (
                    <li
                      key={row.key}
                      data-empty-org=""
                      className="mx-3 flex items-center gap-2 overflow-hidden rounded-md bg-[#faf7ef] px-2 py-2 whitespace-nowrap"
                    >
                      <EmptyLabel>{NO_PAX_LISTED}</EmptyLabel>
                      <span aria-hidden="true" className="text-[#c9bfa6]">
                        ·
                      </span>
                      <EmptyLabel>{NO_POSITIONS_FILLED}</EmptyLabel>
                    </li>
                  ) : (
                    <li
                      key={row.key}
                      className="flex items-center gap-2 px-4 py-1.5 text-sm whitespace-nowrap"
                    >
                      <Avatar row={row} small />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-semibold">
                          {row.f3Name ?? "Unknown"}
                        </span>
                        {row.homeRegionName && (
                          <span className="text-muted-foreground">
                            {" "}
                            ({row.homeRegionName})
                          </span>
                        )}
                      </span>
                      <span className="flex max-w-[50%] min-w-0 items-center">
                        <span className="truncate">{row.title}</span>
                        <KindTag kind={row.kind} />
                      </span>
                    </li>
                  ),
                )}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
