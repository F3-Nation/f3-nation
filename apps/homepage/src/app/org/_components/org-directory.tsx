"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";

import type { DirectoryView } from "../_lib/url-state";
import {
  readOrgIdFromUrl,
  readTableOrgIdsFromUrl,
  readViewFromUrl,
  writeMapFocusUrl,
  writeTableUrlState,
} from "../_lib/url-state";
import { DirectorySpinner } from "./directory-spinner";
import { OrgTable } from "./org-table";
import { ViewSwitcher } from "./view-switcher";

// Leaflet touches `window` on import, so the map loads client-side only.
const OrgMap = dynamic(() => import("./org-map"), {
  ssr: false,
  loading: () => <DirectorySpinner />,
});

/**
 * Hosts the Map (default) and Table views behind one switcher. The URL holds
 * each view's state, so a refresh reopens the same view and selections, and
 * switching carries the selection across: Map → Table checks the Map's org in
 * the filters; Table → Map opens the org chosen by `mapFocusOrgId`.
 */
export function OrgDirectory() {
  const [view, setView] = useState<DirectoryView>(readViewFromUrl);
  // The Table's ids to check on load: from the URL, or from the Map on switch.
  const [tableOrgIds, setTableOrgIds] = useState(readTableOrgIdsFromUrl);
  // Where the Map should open when leaving the Table; kept current by it.
  const mapFocusRef = useRef<number | null>(null);

  function changeView(next: DirectoryView) {
    if (next === "table") {
      const orgId = readOrgIdFromUrl();
      const ids = orgId == null ? [] : [orgId];
      // Start from the Map's org, so leaving before the Table publishes a
      // focus (still loading, or failed) returns there, not to an older visit.
      mapFocusRef.current = orgId;
      writeTableUrlState(ids);
      setTableOrgIds(ids);
    } else {
      writeMapFocusUrl(mapFocusRef.current);
    }
    setView(next);
  }

  const switcher = <ViewSwitcher view={view} onChange={changeView} />;
  return view === "map" ? (
    <OrgMap viewSwitcher={switcher} />
  ) : (
    <OrgTable
      viewSwitcher={switcher}
      initialOrgIds={tableOrgIds}
      onMapFocusChange={(orgId) => {
        mapFocusRef.current = orgId;
      }}
    />
  );
}
