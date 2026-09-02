/**
 * Bounds recursive hierarchy queries if malformed data contains a cycle.
 * Twenty leaves substantial headroom above today's five-level tree; lowering
 * this below the real hierarchy depth would silently truncate authorization
 * and visibility results.
 */
export const ORG_TREE_MAX_DEPTH = 20;
