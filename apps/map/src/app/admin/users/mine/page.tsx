import { Suspense } from "react";

import Layout from "../../admin-layout";
import { GrantAccessButton } from "../[id]/grant-access-button";
import { MyUsersTable } from "./my-users-table";

const MyUsersPage = async () => {
  return (
    <Layout>
      <div className="flex w-full flex-col">
        <div className="flex flex-row items-center justify-between">
          <div className="flex flex-col">
            <h1 className="text-2xl font-bold">My Users</h1>
            <p className="text-sm text-muted-foreground">
              Users for organizations where you have admin or editor access.
              Includes email and phone fields.
            </p>
          </div>
          <GrantAccessButton />
        </div>
        <Suspense fallback={<div>Loading...</div>}>
          <div className="flex w-full flex-col overflow-hidden">
            <MyUsersTable />
          </div>
        </Suspense>
      </div>
    </Layout>
  );
};

export default MyUsersPage;
