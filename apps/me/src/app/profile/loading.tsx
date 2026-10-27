import { FormSkeleton } from "@acme/ui/page-skeleton";

export default function Loading() {
  return (
    <div className="mx-auto grid max-w-5xl gap-6 p-4 pb-12 lg:grid-cols-2">
      <FormSkeleton fields={4} />
      <FormSkeleton fields={4} />
    </div>
  );
}
