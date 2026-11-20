"use client";

import dynamic from "next/dynamic";

import { DirectorySpinner } from "./directory-spinner";

// The directory reads its view and selections from the URL on first render,
// which the static export can't know at build time, so it renders client-only.
const OrgDirectory = dynamic(
  () => import("./org-directory").then((m) => m.OrgDirectory),
  { ssr: false, loading: () => <DirectorySpinner /> },
);

export function OrgMapLoader() {
  return <OrgDirectory />;
}
