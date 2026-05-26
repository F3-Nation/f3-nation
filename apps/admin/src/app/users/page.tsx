import { Suspense } from "react";

import Layout from "../admin-layout";
import { AddUserButton } from "./[id]/add-user-button";
import { UserTable } from "./user-table";

const UsersPage = async () => {
  return (
    <Layout title="Users">
      <div className="flex w-full flex-col">
        <div className="flex flex-row items-center justify-between">
          <h1 className="hidden text-2xl font-bold lg:block">Users</h1>
          <div className="ml-auto flex flex-row items-center justify-start gap-2">
            <AddUserButton />
          </div>
        </div>
        <Suspense fallback={<div>Loading...</div>}>
          <div className="flex w-full flex-col overflow-hidden">
            <UserTable />
          </div>
        </Suspense>
      </div>
    </Layout>
  );
};

export default UsersPage;
