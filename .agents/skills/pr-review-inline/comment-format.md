# Inline comment format

The body of every inline comment pr-review-inline posts. Each surviving finding is one comment
in this exact shape, so every comment serves two readers: a human who may not read the code,
and an AI agent that is handed this one comment and nothing else. The signature line is the
one the repo's [GitHub write rules](../../../AGENTS.md#writing-to-github) require.

````markdown
**🔴 Critical** · failure-paths

This catch block swallows the error, so a failed user sync looks like a success. Nobody is
alerted, and the affected users just silently stop being updated.

## For the coding agent

In `<repo-relative path>`, log the failure and rethrow so callers and monitoring see it:

```suggestion
} catch (err) {
  logError("user.sync.failed", { userId }, err);
  throw err;
}
```

Verify: the `<named test file or suite>` tests still pass, and add a test that a failing
sync rejects instead of resolving.

<!-- pr-review-inline -->

_written by <model name>_
````

- Header: emoji + text severity, then `· <source>`.
- No heading on the plain-language section — it is the paragraph right under the header.
  Only the agent section gets a heading, spelled exactly `## For the coding agent`.

## Plain-language section

- Say what is wrong in terms of outcomes: what breaks, for whom, and how likely. 2–4 sentences.
- Gloss any jargon on first use. Don't over-explain or talk down — write for a smart reader
  who doesn't read the diff.
- If you couldn't verify a claim (tests not run, no DB available), say so here and make
  confirming it step 1 of the agent section.
- Don't hard-wrap prose. GitHub renders single newlines as `<br>`, so break only at paragraph
  boundaries.

## `## For the coding agent` section

- Fully self-contained. Never write "see above" or "as in the other comment" — the agent may
  be handed this one comment alone.
- Give exact repo-relative paths and exact content. Number the steps when order matters.
- Give a verification step for every change. Use only commands you have confirmed exist in
  this repo; if unsure, name the test file or suite instead of guessing a command.
- Before narrowing a test command to one file (`pnpm test -- <file>`), read what the `test`
  script actually runs. If it always collects coverage with enforced thresholds (e.g.
  `vitest --run --coverage`), a single-file run fails those thresholds even when the test
  passes — give the full-suite command instead.
- Call out any step that must not be skipped (e.g. "run the mutation check before
  strengthening the test").
- Suggested code comments must be terse and contain no issue or PR numbers.
- Put a ```suggestion block here **only when** it is a concrete drop-in replacement for the
  exact commented line(s), so the author can one-click apply. Otherwise use numbered prose
  steps.
- When there are several viable fixes, list the preferred one first and say why.

## Small findings

A one-line nit still gets both sections, kept proportionate: the plain-language part is one
sentence, and the agent section can be just the suggestion block plus one verification line.
Never omit a section, so every comment has the same shape.

## Marker and signature

- Just above the signature, on its own line, add the hidden marker `<!-- pr-review-inline -->`
  (`<!-- pr-review-inline-incomplete -->` on a run that left a lane unreviewed). GitHub doesn't
  render it; `--rereview` and triage tooling use it to find this skill's comments.
- On a run with an unreviewed lane, end the plain-language section with one line naming the
  unreviewed lanes.
- End with the repo's signature, exactly once, as the last line.
