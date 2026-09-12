"use client";

import dynamic from "next/dynamic";

const OrgMap = dynamic(() => import("./org-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center bg-[#f6f3ea]">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  ),
});

export function OrgMapLoader() {
  return <OrgMap />;
}
