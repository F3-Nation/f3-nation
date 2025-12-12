import { Suspense } from "react";

import { client } from "~/orpc/client";
import Layout from "../admin-layout";
import { AddAreaButton } from "./[id]/add-area-button";
import { AreasTable } from "./areas-table";

const AreasPage = async () => {
  const { orgs: areas } = await client.org.all({ orgTypes: ["area"] });
  const { orgs: sectors } = await client.org.all({ orgTypes: ["sector"] });
  return (
    <Layout>
      <div className="flex w-full  flex-col">
        <div className="flex flex-row items-center justify-between">
          <h1 className="text-2xl font-bold">Areas</h1>
          <div className="flex flex-row items-center justify-start gap-2">
            <AddAreaButton />
          </div>
        </div>
        <Suspense fallback={<div>Loading...</div>}>
          <div className="flex w-full flex-col overflow-hidden">
            <AreasTable areas={areas} sectors={sectors} />
          </div>
        </Suspense>
      </div>
    </Layout>
  );
};

export default AreasPage;
