import { Suspense } from "react";

import Layout from "../admin-layout";
import { AddEventInstanceButton } from "./add-event-instance-button";
import { EventInstancesTable } from "./event-instances-table";

const EventInstancesPage = () => {
  return (
    <Layout title="Event instances">
      <div className="flex w-full flex-col">
        <div className="flex flex-row items-center justify-between">
          <h1 className="hidden text-2xl font-bold lg:block">
            Event instances
          </h1>
          <div className="ml-auto flex flex-row items-end gap-2">
            <AddEventInstanceButton />
          </div>
        </div>
        <Suspense fallback={<div>Loading...</div>}>
          <div className="flex w-full flex-col overflow-hidden">
            <EventInstancesTable />
          </div>
        </Suspense>
      </div>
    </Layout>
  );
};

export default EventInstancesPage;
