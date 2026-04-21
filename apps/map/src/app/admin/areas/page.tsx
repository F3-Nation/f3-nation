export const dynamic = "force-dynamic";

import { Suspense } from "react";

import Layout from "../admin-layout";
import { AddAreaButton } from "./[id]/add-area-button";
import { AreasTable } from "./areas-table";

const AreasPage = async () => {
  return (
    <Layout title="Areas">
      <div className="flex w-full  flex-col">
        <div className="flex flex-row items-center justify-between">
          <h1 className="hidden text-2xl font-bold lg:block">Areas</h1>
          <div className="ml-auto flex flex-row items-center justify-start gap-2">
            <AddAreaButton />
          </div>
        </div>
        <Suspense fallback={<div>Loading...</div>}>
          <div className="flex w-full flex-col overflow-hidden">
            <AreasTable />
          </div>
        </Suspense>
      </div>
    </Layout>
  );
};

export default AreasPage;
