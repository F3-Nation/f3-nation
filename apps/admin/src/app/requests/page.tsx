import { Suspense } from "react";

import Layout from "../admin-layout";
import { RequestsTable } from "./requests-table";

const RequestsPage = async () => {
  return (
    <Layout title="Requests">
      <div className="flex h-full w-full flex-col">
        <div className="flex flex-row items-center justify-between">
          <h1 className="hidden text-2xl font-bold lg:block">Requests</h1>
        </div>
        <Suspense fallback={<div>Loading...</div>}>
          <RequestsTable />
        </Suspense>
      </div>
    </Layout>
  );
};

export default RequestsPage;
