import { Suspense } from "react";

import ErrorComponent from "./error-component";

export default async function ErrorPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ErrorComponent />
    </Suspense>
  );
}
