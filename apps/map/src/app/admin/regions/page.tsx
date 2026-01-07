export const dynamic = "force-dynamic";

import { Suspense } from "react";

import Layout from "../admin-layout";
import { AddRegionButton } from "./[id]/add-region-button";
import { RegionsTable } from "./regions-table";

const RegionsPage = async () => {
  return (
    <Layout>
      <div className="flex w-full flex-col">
        <div className="flex flex-row items-center justify-between">
          <h1 className="text-2xl font-bold">Regions</h1>
          <div className="flex flex-row items-center justify-start gap-2">
            <AddRegionButton />
          </div>
        </div>
        <Suspense fallback={<div>Loading...</div>}>
          <div className="flex w-full flex-col overflow-hidden">
            <RegionsTable />
          </div>
        </Suspense>
      </div>
    </Layout>
  );
};

export default RegionsPage;
