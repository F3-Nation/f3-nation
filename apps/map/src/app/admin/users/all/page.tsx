import { Suspense } from "react";

import Layout from "../../admin-layout";
import { AddUserButton } from "../[id]/add-user-button";
import { GrantAccessButton } from "../[id]/grant-access-button";
import { AllUsersTable } from "./all-users-table";

const AllUsersPage = async () => {
  return (
    <Layout>
      <div className="flex w-full flex-col">
        <div className="flex flex-row items-center justify-between">
          <h1 className="text-2xl font-bold">All Users</h1>
          <div className="flex flex-row items-center justify-start gap-2">
            <AddUserButton />
            <GrantAccessButton />
          </div>
        </div>
        <Suspense fallback={<div>Loading...</div>}>
          <div className="flex w-full flex-col overflow-hidden">
            <AllUsersTable />
          </div>
        </Suspense>
      </div>
    </Layout>
  );
};

export default AllUsersPage;
