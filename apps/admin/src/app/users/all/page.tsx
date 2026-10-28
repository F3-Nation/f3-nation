import { Suspense } from "react";

import { TableSkeleton } from "@acme/ui/page-skeleton";

import Layout from "../../admin-layout";
import { ManageAccessButton } from "../[id]/manage-access-button";
import { AllUsersTable } from "./all-users-table";

const AllUsersPage = async () => {
  return (
    <Layout title="All Users">
      <div className="flex w-full flex-col">
        <div className="flex flex-row items-center justify-between">
          <h1 className="hidden text-2xl font-bold lg:block">All Users</h1>
          <div className="ml-auto">
            <ManageAccessButton />
          </div>
        </div>
        <Suspense fallback={<TableSkeleton />}>
          <div className="flex w-full flex-col overflow-hidden">
            <AllUsersTable />
          </div>
        </Suspense>
      </div>
    </Layout>
  );
};

export default AllUsersPage;
