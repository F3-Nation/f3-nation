import { Suspense } from "react";

import Layout from "../admin-layout";
import { AddLocationButton } from "./[id]/add-location-button";
import { LocationsTable } from "./locations-table";

const LocationsPage = async () => {
  return (
    <Layout>
      <div className="flex w-full  flex-col">
        <div className="flex flex-row items-center justify-between">
          <h1 className="text-2xl font-bold">Locations</h1>
          <div className="flex flex-row items-center justify-start gap-2">
            <AddLocationButton />
          </div>
        </div>
        <Suspense fallback={<div>Loading...</div>}>
          <div className="flex w-full flex-col overflow-hidden">
            <LocationsTable />
          </div>
        </Suspense>
      </div>
    </Layout>
  );
};

export default LocationsPage;
