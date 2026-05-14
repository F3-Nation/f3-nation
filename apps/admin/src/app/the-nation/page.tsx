export const dynamic = "force-dynamic";

import { Suspense } from "react";

import Layout from "../admin-layout";
import { NationsTable } from "./nations-table";

const NationsPage = async () => {
  return (
    <Layout title="Nations">
      <div className="flex w-full flex-col">
        <div className="flex flex-row items-center justify-between">
          <h1 className="hidden text-2xl font-bold lg:block">Nations</h1>
        </div>
        <Suspense fallback={<div>Loading...</div>}>
          <div className="flex w-full flex-col overflow-hidden">
            <NationsTable />
          </div>
        </Suspense>
      </div>
    </Layout>
  );
};

export default NationsPage;
