import { Suspense } from "react";

import Layout from "../admin-layout";
import { AddEventTypeButton } from "./add-event-type-button";
import { EventTypesTable } from "./event-types-table";

const EventTypesPage = async () => {
  return (
    <Layout>
      <div className="flex w-full  flex-col">
        <div className="flex flex-row items-center justify-between">
          <h1 className="text-2xl font-bold">Event Types</h1>
          <div className="flex flex-row items-center justify-start gap-2">
            <AddEventTypeButton />
          </div>
        </div>
        <Suspense fallback={<div>Loading...</div>}>
          <div className="flex w-full flex-col overflow-hidden">
            <EventTypesTable />
          </div>
        </Suspense>
      </div>
    </Layout>
  );
};

export default EventTypesPage;
