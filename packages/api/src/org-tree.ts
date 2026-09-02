/**
 * Caps worst-case work for recursive hierarchy queries on unusually deep
 * trees. Each query handles cycles separately with a visited-path guard.
 * Twenty leaves substantial headroom above today's five-level tree; lowering
 * this below the real hierarchy depth would deny authorization or omit visible
 * results and emit api.org_tree.depth_limit_reached.
 */
export const ORG_TREE_MAX_DEPTH = 20;
