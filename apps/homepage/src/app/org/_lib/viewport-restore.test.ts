import { describe, expect, it } from "vitest";

import type { ViewportRestore } from "./viewport-restore";
import { viewportAction } from "./viewport-restore";

const viewport = { lat: 35, lng: -80, zoom: 9 };

describe("viewportAction", () => {
  it("restores the saved view on the first draw", () => {
    expect(viewportAction({ viewport, path: null }, [1])).toBe("restore");
  });

  it("keeps the view when the same path array is redrawn", () => {
    const path = [1, 2];
    const restore: ViewportRestore<number[]> = { viewport, path };
    expect(viewportAction(restore, path)).toBe("keep");
  });

  it("fits a navigation to a new array with the same ids", () => {
    const restore: ViewportRestore<number[]> = { viewport, path: [1, 2] };
    expect(viewportAction(restore, [1, 2])).toBe("fit");
  });

  it("fits when nothing was saved", () => {
    expect(viewportAction(null, [])).toBe("fit");
  });
});
