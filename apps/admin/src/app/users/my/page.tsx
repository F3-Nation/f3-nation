import { Suspense } from "react";

import Layout from "../../admin-layout";
import { AddUserButton } from "../[id]/add-user-button";
import { ManageAccessButton } from "../[id]/manage-access-button";
import { MyUsersTable } from "../mine/my-users-table";

const MyUsersPage = async () => {
  return (
    <Layout title="My Users">
      <div className="flex w-full flex-col">
        <div className="flex flex-row items-center justify-between">
          <div className="flex flex-col">
            <h1 className="hidden text-2xl font-bold lg:block">My Users</h1>
            <p className="text-sm text-muted-foreground">
              Users for organizations where you are an admin. Includes PII
              fields (email, phone) for users in your organizations.
            </p>
          </div>
          <div className="ml-auto flex flex-row items-center justify-start gap-2">
            <AddUserButton />
            <ManageAccessButton />
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
