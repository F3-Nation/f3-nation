import { Suspense } from "react";

import Layout from "../../admin-layout";
import { AddUserButton } from "../[id]/add-user-button";
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
              Users for organizations where you are an admin. Includes email and
              phone fields for users in your organizations.
            </p>
          </div>
          <div className="flex flex-row items-center justify-start gap-2">
            <AddUserButton />
            <GrantAccessButton />
          </div>
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
