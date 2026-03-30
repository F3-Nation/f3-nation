import { Suspense } from "react";

import Layout from "../admin-layout";
import { AddEventTagButton } from "./add-event-tag-button";
import { EventTagsTable } from "./event-tags-table";

const EventTagsPage = () => {
  return (
    <Layout title="Event tags">
      <div className="flex w-full flex-col">
        <div className="flex flex-row items-center justify-between">
          <h1 className="hidden text-2xl font-bold lg:block">Event tags</h1>
          <div className="ml-auto flex flex-row items-end gap-2">
            <AddEventTagButton />
          </div>
        </div>
        <Suspense fallback={<div>Loading...</div>}>
          <div className="flex w-full flex-col overflow-hidden">
            <EventTagsTable />
          </div>
        </Suspense>
      </div>
    </Layout>
  );
};

export default EventTagsPage;
