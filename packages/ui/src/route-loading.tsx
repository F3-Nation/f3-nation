import { Loader } from "./loader";

/**
 * Shared body for a route's `loading.tsx`. A centered spinner is enough to
 * turn a blank screen into visible pending feedback during a server-component
 * data fetch - see the app's own `AGENTS.md`/route for anything that needs a
 * bespoke skeleton shape instead.
 *
 * The wrapper is a polite live region with visually hidden text so screen
 * readers announce the pending state; the spinner itself is decorative.
 */
export function RouteLoading() {
  return (
    <div
      role="status"
      className="flex min-h-[50vh] items-center justify-center"
    >
      <span aria-hidden="true">
        <Loader />
      </span>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
