import { FormSkeleton } from "@acme/ui/page-skeleton";

// Keeps the root loading.tsx (admin sidebar + table) off the public sign-in
// pages while they wait on the session.
export default function AuthLoading() {
  return (
    <div className="w-full max-w-md">
      <FormSkeleton fields={2} />
    </div>
  );
}
