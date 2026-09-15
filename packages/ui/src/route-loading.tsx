import { Loader } from "./loader";

/**
 * Shared body for a route's `loading.tsx`. A centered spinner is enough to
 * turn a blank screen into visible pending feedback during a server-component
 * data fetch - see the app's own `AGENTS.md`/route for anything that needs a
 * bespoke skeleton shape instead.
 */
export function RouteLoading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Loader />
    </div>
  );
}
