import { Suspense } from "react";

import { api } from "~/trpc/server";
import Layout from "../admin-layout";
import { NationsTable } from "./nations-table";

const NationsPage = async () => {
  const { orgs: nations } = await api.org.all({ orgTypes: ["nation"] });

  return (
    <Layout>
      <div className="flex w-full  flex-col">
        <div className="flex flex-row items-center justify-between">
          <h1 className="text-2xl font-bold">Nations</h1>
        </div>
        <Suspense fallback={<div>Loading...</div>}>
          <div className="flex w-full flex-col overflow-hidden">
            <NationsTable nations={nations} />
          </div>
        </Suspense>
      </div>
    </Layout>
  );
};

export default NationsPage;
