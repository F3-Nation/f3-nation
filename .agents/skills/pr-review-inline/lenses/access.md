Lane: access and data exposure. Can anyone read, change or trigger something they shouldn't?

Look for:

- Authorization: a handler that takes an id checks the caller against the org that owns the
  fetched row, and a move checks both source and destination.
- Anonymous reach: a public path that returns private, inactive or personal data, or an
  unbounded page.
- Credentials: a client-supplied claim, an unverified token, a replayed code or a non-atomic
  consume that grants access; a server-side key attached to a route that doesn't require a
  signed-in caller.
- Input that reaches SQL, a shell, HTML, a URL or a file path without validation, and
  validation that this PR loosens.
- Secrets, tokens or personal data in logs, error messages, fixtures, browser storage or a
  public client bundle.
- Workflows and scripts: a privileged workflow that runs PR-head code or interpolates
  untrusted input, and anything that now runs at install, build, test or CI time.

How to work:

1. List every entry point the diff adds or changes: API procedures, route handlers, proxies,
   server actions, scheduled jobs, workflows, scripts.
2. For each, say who can call it and what it returns or changes, then find the check that
   stops everyone else. No check you can point to is a finding.
3. Compare each with its sibling entry points. One that checks or filters differently from its
   siblings is a finding.
4. Apply every critical check in REVIEW.md whose area the diff touches, even when the PR says
   it is covered.
