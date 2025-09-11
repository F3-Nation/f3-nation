import { Suspense } from "react";

import Layout from "../admin-layout";
import { AddWorkoutButton } from "./[id]/add-workout-button";
import { WorkoutsTable } from "./workouts-table";

const WorkoutsPage = async () => {
  return (
    <Layout>
      <div className="flex flex-col">
        <div className="flex flex-row items-center justify-between">
          <h1 className="text-2xl font-bold">Events</h1>
          <div className="flex flex-row items-center justify-start gap-2">
            <AddWorkoutButton />
          </div>
        </div>
        <Suspense fallback={<div>Loading...</div>}>
          <div className="flex flex-col overflow-auto">
            <WorkoutsTable />
          </div>
        </Suspense>
      </div>
    </Layout>
  );
};

export default WorkoutsPage;
