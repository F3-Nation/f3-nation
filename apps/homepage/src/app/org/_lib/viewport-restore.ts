import type { MapViewport } from "./url-state";

/**
 * A center and zoom saved in the URL (?at=) that the map restores instead of
 * fitting. `path` is the `selectedPath` array it was restored for (null until
 * the first render uses it).
 */
export interface ViewportRestore<Path> {
  viewport: MapViewport;
  path: Path | null;
}

/**
 * What the map does with its viewport when it redraws:
 * - "restore": the first draw after a refresh goes back to the saved view.
 * - "keep": a redraw of that same view (React re-running the effect) keeps it.
 * - "fit": any navigation fits the new view. Every navigation sets a new
 *   `selectedPath` array, even one with the same orgs (clicking the current
 *   crumb), so array identity, not the ids, tells a navigation apart.
 */
export function viewportAction<Path extends object>(
  restore: ViewportRestore<Path> | null,
  selectedPath: Path,
): "restore" | "keep" | "fit" {
  if (restore?.path === null) return "restore";
  return restore?.path === selectedPath ? "keep" : "fit";
}
