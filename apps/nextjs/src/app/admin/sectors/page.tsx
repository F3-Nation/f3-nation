import { Suspense } from "react";

import { api } from "~/trpc/server";
import Layout from "../admin-layout";
import { AddSectorButton } from "./[id]/add-sector-button";
import { SectorsTable } from "./sectors-table";

const SectorsPage = async () => {
  const { orgs: sectors } = await api.org.all({ orgTypes: ["sector"] });

  return (
    <Layout>
      <div className="flex w-full  flex-col">
        <div className="flex flex-row items-center justify-between">
          <h1 className="text-2xl font-bold">Sectors</h1>
          <div className="flex flex-row items-center justify-start gap-2">
            <AddSectorButton />
          </div>
        </div>
        <Suspense fallback={<div>Loading...</div>}>
          <div className="flex w-full flex-col overflow-hidden">
            <SectorsTable sectors={sectors} />
          </div>
        </Suspense>
      </div>
    </Layout>
  );
};

export default SectorsPage;
