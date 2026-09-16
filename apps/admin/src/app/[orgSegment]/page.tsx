import { Suspense } from "react";
import { notFound } from "next/navigation";
import { orgTypeDisplay } from "@acme/shared/app/org-hierarchy";
import Layout from "../admin-layout";
import { AddOrgButton } from "../_components/org/add-org-button";
import { OrgTable } from "../_components/org/org-table";
import {
  orgAdminConfig,
  resolveOrgSegment,
} from "../_components/org/org-admin-config";

// The root layout reads headers/session for every request. Keep organization
// pages request-rendered, with list queries in the client (including AOs).
export const dynamic = "force-dynamic";

export default async function OrgPage({
  params,
}: {
  params: Promise<{ orgSegment: string }>;
}) {
  const { orgSegment } = await params;
  const orgType = resolveOrgSegment(orgSegment);
  if (!orgType) notFound();
  const config = orgAdminConfig[orgType];
  const heading = config.heading ?? orgTypeDisplay[orgType].pluralLabel;
  return (
    <Layout title={heading}>
      <div className="flex w-full flex-col">
        <div className="flex flex-row items-center justify-between">
          <h1 className="hidden text-2xl font-bold lg:block">{heading}</h1>
          {config.add && (
            <div className="ml-auto flex flex-row items-center justify-start gap-2">
              <AddOrgButton orgType={orgType} />
            </div>
          )}
        </div>
        <Suspense fallback={<div>Loading...</div>}>
          <div className="flex w-full flex-col overflow-hidden">
            <OrgTable key={orgType} orgType={orgType} />
          </div>
        </Suspense>
      </div>
    </Layout>
  );
}
