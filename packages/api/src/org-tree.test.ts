import { beforeEach, describe, expect, it, vi } from "vitest";
import * as loggerModule from "./logger";

vi.mock("./logger", { spy: true });

const mockLogError = vi.mocked(loggerModule.logError);

import { logIfOrgTreeExceedsMaxDepth, ORG_TREE_MAX_DEPTH } from "./org-tree";
import type { Context } from "./shared";

describe("logIfOrgTreeExceedsMaxDepth", () => {
  beforeEach(() => {
    mockLogError.mockClear();
  });

  const dbReturning = (rows: unknown[]) =>
    ({ execute: vi.fn().mockResolvedValue(rows) }) as unknown as Context["db"];

  it("logs api.org_tree.depth_limit_reached when the scan finds a chain beyond the cap", async () => {
    await logIfOrgTreeExceedsMaxDepth(dbReturning([{ hit: 1 }]));

    expect(mockLogError).toHaveBeenCalledExactlyOnceWith(
      "api.org_tree.depth_limit_reached",
      { maxDepth: ORG_TREE_MAX_DEPTH, source: "map_ancestor_active_check" },
    );
  });

  it("does not log when the scan finds no chain beyond the cap", async () => {
    await logIfOrgTreeExceedsMaxDepth(dbReturning([]));

    expect(mockLogError).not.toHaveBeenCalled();
  });

  it("logs api.org_tree.depth_scan_failed and never rejects when the query itself fails", async () => {
    const db = {
      execute: vi.fn().mockRejectedValue(new Error("connection reset")),
    } as unknown as Context["db"];

    await expect(logIfOrgTreeExceedsMaxDepth(db)).resolves.toBeUndefined();

    expect(mockLogError).toHaveBeenCalledExactlyOnceWith(
      "api.org_tree.depth_scan_failed",
      {},
      expect.any(Error),
    );
  });
});
