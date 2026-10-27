import { TableSkeleton } from "@acme/ui/page-skeleton";

import Layout from "./admin-layout";

export default function Loading() {
  return (
    <Layout>
      <TableSkeleton />
    </Layout>
  );
}
