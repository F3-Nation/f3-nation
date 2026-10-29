import { FormSkeleton } from "@acme/ui/page-skeleton";

import Layout from "../../admin-layout";

export default function Loading() {
  return (
    <Layout title="User">
      <FormSkeleton />
    </Layout>
  );
}
