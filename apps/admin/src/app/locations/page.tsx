import { Suspense } from "react";

import { TableSkeleton } from "@acme/ui/page-skeleton";

import Layout from "../admin-layout";
import { AddLocationButton } from "./[id]/add-location-button";
import { LocationsTable } from "./locations-table";

const LocationsPage = async () => {
  return (
    <Layout title="Locations">
      <div className="flex w-full flex-col">
        <div className="flex flex-row items-center justify-between">
          <h1 className="hidden text-2xl font-bold lg:block">Locations</h1>
          <div className="ml-auto flex flex-row items-center justify-start gap-2">
            <AddLocationButton />
          </div>
        </div>
        <Suspense fallback={<TableSkeleton />}>
          <div className="flex w-full flex-col overflow-hidden">
            <LocationsTable />
          </div>
        </Suspense>
      </div>
    </Layout>
  );
};

export default LocationsPage;
