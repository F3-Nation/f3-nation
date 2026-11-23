Lane: tests. Would the tests in this PR fail if the change were wrong or reverted?

Method informed by the `pr-test-analyzer` agent in Anthropic's pr-review-toolkit plugin
(Apache-2.0).

Look for:

- New or changed logic with no test that would fail if it were deleted or reverted.
- A test that cannot fail: it asserts only a status or that something is defined, asserts on
  its own mock, or passes for a reason other than the line it claims to guard.
- A guard tested on one side only. Every permission check needs a case where access is
  refused, including a caller from another org.
- Tests this PR deletes, skips, weakens, or moves behind a switch that CI never sets.
- Error paths, boundary values and concurrent cases on the risky parts of the change (data
  writes, migrations, permissions, money or identity) with no coverage.
- Tests tied to implementation details that will break on a harmless refactor.

How to work:

1. For each behavior in the change inventory, find the test that covers it. Name the test, or
   say there is none.
2. For each new condition, mentally delete it or flip it and ask which test fails. If none
   does, that is the finding, and the fix names the missing case.
3. Check how the changed test files are run: whether CI collects them, and under which
   environment switches.
4. Rate a gap by what could break unnoticed. Don't ask for a test of trivial code, for
   coverage for its own sake, or for a stronger assertion on a test that already fails when
   the line it guards is deleted.
