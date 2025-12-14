import { Suspense } from "react";

import Layout from "../admin-layout";
import { RequestsTable } from "./requests-table";

const RequestsPage = async () => {
  return (
    <Layout>
      <div className="flex h-full w-full flex-col">
        <div className="flex flex-row items-center justify-between">
          <h1 className="text-2xl font-bold">Requests</h1>
        </div>
        <Suspense fallback={<div>Loading...</div>}>
          <RequestsTable />
        </Suspense>
      </div>
    </Layout>
  );
};

export default RequestsPage;
