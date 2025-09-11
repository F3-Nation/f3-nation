import { Suspense } from "react";

import { api } from "~/trpc/server";
import Layout from "../admin-layout";
import { AddRegionButton } from "./[id]/add-region-button";
import { RegionsTable } from "./regions-table";

const RegionsPage = async () => {
  const { orgs: regions } = await api.org.all({ orgTypes: ["region"] });
  const { orgs: sectors } = await api.org.all({
    orgTypes: ["sector"],
  });
  const { orgs: areas } = await api.org.all({
    orgTypes: ["area"],
  });

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
            <RegionsTable regions={regions} sectors={sectors} areas={areas} />
          </div>
        </Suspense>
      </div>
    </Layout>
  );
};

export default RegionsPage;
