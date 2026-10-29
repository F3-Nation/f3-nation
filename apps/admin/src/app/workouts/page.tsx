import { Suspense } from "react";

import { TableSkeleton } from "@acme/ui/page-skeleton";

import Layout from "../admin-layout";
import { AddWorkoutButton } from "./[id]/add-workout-button";
import { WorkoutsTable } from "./workouts-table";

const WorkoutsPage = async () => {
  return (
    <Layout title="Events">
      <div className="flex flex-col">
        <div className="flex flex-row items-center justify-between">
          <h1 className="hidden text-2xl font-bold lg:block">Events</h1>
          <div className="ml-auto flex flex-row items-center justify-start gap-2">
            <AddWorkoutButton />
          </div>
        </div>
        <Suspense fallback={<TableSkeleton />}>
          <div className="flex flex-col overflow-auto">
            <WorkoutsTable />
          </div>
        </Suspense>
      </div>
    </Layout>
  );
};

export default WorkoutsPage;
