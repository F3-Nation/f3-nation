import { Suspense } from "react";

import { TableSkeleton } from "@acme/ui/page-skeleton";

import Layout from "../../admin-layout";
import { ManageAccessButton } from "../[id]/manage-access-button";
import { MyUsersTable } from "./my-users-table";

const MyUsersPage = async () => {
  return (
    <Layout title="My Users">
      <div className="flex w-full flex-col">
        <div className="flex flex-row items-center justify-between">
          <div className="flex flex-col">
            <h1 className="hidden text-2xl font-bold lg:block">My Users</h1>
            <p className="text-sm text-muted-foreground">
              Users for organizations where you have admin or editor access.
              Includes email and phone fields.
            </p>
          </div>
          <div className="ml-auto">
            <ManageAccessButton />
          </div>
        </div>
        <Suspense fallback={<TableSkeleton />}>
          <div className="flex w-full flex-col overflow-hidden">
            <MyUsersTable />
          </div>
        </Suspense>
      </div>
    </Layout>
  );
};

export default MyUsersPage;
