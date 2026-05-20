"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@acme/ui/tabs";

import { AddPositionButton } from "./add-position-button";
import { AssignmentsTable } from "./assignments-table";
import Layout from "~/app/admin-layout";
import { PositionsTable } from "./positions-table";

const PositionsPage = () => {
  return (
    <Layout title="Positions">
      <div className="flex w-full flex-col">
        <Tabs defaultValue="positions">
          <div className="flex flex-row items-center justify-between">
            <TabsList>
              <TabsTrigger value="positions">Positions</TabsTrigger>
              <TabsTrigger value="assignments">Assignments</TabsTrigger>
            </TabsList>
            <div className="ml-auto flex flex-row items-center justify-start gap-2">
              <TabsContent value="positions" className="mt-0">
                <AddPositionButton />
              </TabsContent>
            </div>
          </div>
          <TabsContent value="positions">
            <div className="flex w-full flex-col overflow-hidden">
              <PositionsTable />
            </div>
          </TabsContent>
          <TabsContent value="assignments">
            <AssignmentsTable />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
};

export default PositionsPage;
