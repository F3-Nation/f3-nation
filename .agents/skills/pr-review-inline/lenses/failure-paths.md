Lane: failure paths. When something goes wrong in the changed code, does anyone find out?

Method informed by the `silent-failure-hunter` agent in Anthropic's pr-review-toolkit plugin
(Apache-2.0).

Look for:

- A `catch` or `except` that swallows the error, logs and carries on, or returns a default.
- A catch broad enough to hide errors unrelated to the one it was written for.
- A fallback that hides an outage: a default value, an empty list, cached or mock data, or
  optional chaining that skips the operation, with nothing logged.
- A response whose status is never checked, and a failure treated as an empty result or a
  success.
- A script that exits 0 on failure, and a gate or check that passes after checking nothing.
- A loop over many items where one bad item stops the rest, or where failures are dropped
  without the item's id.
- A cancelled request treated as an outage, and an async call started without `await` whose
  early throw nobody catches.
- A step that fails halfway and leaves partial state behind.

How to work:

1. List every place the diff adds or changes error handling: try/catch, promise rejections,
   status checks, error callbacks, fallbacks and defaults, early returns on a bad value, exit
   codes.
2. Then list the calls the diff adds that can fail (network, database, file, parse, a child
   process) and have no handling at all.
3. For each, answer three questions: which errors can reach this point, including ones the
   author didn't have in mind; what the user sees; and what the operator sees in logs or
   alerts. "Nothing" to the last two is a finding.
4. Check the logging against the repo's logging rules in the root AGENTS.md.
