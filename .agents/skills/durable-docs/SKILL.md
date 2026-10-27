---
name: durable-docs
description: Rules for documentation that still makes sense in three months — inline comments and markdown that say what something does and why it protects or prevents, never change history, GitHub issue/PR links, or one-time instructions. Use whenever writing or editing code comments or any markdown in this repo (docs/, READMEs, specs, .agents/skills, app AGENTS.md), or whenever a PR touches comments or docs — even if durability is never mentioned. Audit mode, which rewrites existing files in bulk, runs only when the user explicitly asks to audit or sweep existing docs; a casual "clean up" or "make the docs less stale" means apply these rules to the text at hand, not run an audit.
---

# Durable docs and comments

A committed file outlives the change that motivated it. Months later the PR is
merged and forgotten, the incident is a blur, and the only reader — often an
AI — has none of that context. Documentation is durable when it still explains
itself after everything outside the file is deleted.

**The test every comment and doc must pass:** a reader with no memory of the
change, no PR, no issue, no Slack thread — does the text still say (1) what
the thing does, where the code doesn't make that obvious, and (2) why it is
that way: what it protects or prevents? If any meaning lives outside the file,
or stops being true as the system changes, the text isn't durable.

Three modes: **writing** new code, **reviewing** a PR, **auditing** what
exists. The rules are the same in all three; only the audit's extra procedure
differs, and it lives in [`audit.md`](audit.md).

These rules govern text you write or touch. There is no repo-wide migration:
loading this skill never implies rewriting existing files. Existing text
changes either when normal work already has you editing it, or in **audit
mode** ([`audit.md`](audit.md)), which runs only on an explicit request.

## What durable text contains

- **What it does** — only where the code doesn't already say it plainly. A
  comment that restates `while (attempts < 3)` is noise: delete it rather than
  keep it.
- **Why, as a standing reason** — the constraint it protects against or the
  failure it prevents, in present tense. The durable part of a "why" is the
  general condition, never the event that revealed it.

  ```ts
  // Not durable — a history book. Meaningful only to people who remember June
  // and can find the issue: "Came out of the 6/12 Akamai outage, see issue
  // #<n>."
  const retries = 2;

  // Durable — what + standing why, complete in itself: "Two attempts max: the
  // upstream abuse filter bans the shared key for an hour after ~3 failures in
  // a minute, so retrying more costs more than failing."
  const retries = 2;
  ```

- **Names, not pointers** — cite a function, table, config key, or file path:
  symbols that live in the repo and resolve by reading. Markdown links to
  other files **in this repo** are durable too (use relative paths).

## Never in a committed file

Each of these is a form of the same failure: meaning that exists only outside
the file, or meaning that won't be true later.

- **Change narrative** — "Added in May…", "Updated to handle…", "Previously X
  now Y", dated entries, version tables, "temporary until PR #<n>". Git
  history and the release changelog already record what changed; a file that
  narrates its own edits forces every future reader to reconstruct history to
  understand the present.
- **GitHub issue/PR links or numbers** — `#<n>`, `…/pull/<n>`. Issues and PRs
  are edited, closed, and deleted; the reader may not even have permission to
  open them. The reference direction is fixed: **issues and PRs point at code,
  never code at issues.** If a fact from a discussion is worth keeping, put
  the fact itself in the file. Links to _external_ references (MDN, vendor
  docs, RFCs) are fine — those are references, not records.
- **Allusions** — "as discussed", "per @someone's request", "as agreed in the
  thread". Anything the reader can't resolve from the file alone gets cut.
- **One-time instructions** — run-once scripts, "on staging run X then Y"
  written for a single upcoming change, "delete after backfill". See below.

### Exceptions: content that stays

Not everything that looks transient belongs in an issue. Content the reader
needs to act correctly — or whose removal would change what the file
guarantees — stays:

- **Dates the constraint depends on** — a deprecation deadline, an SLA
  window, an incident date an availability limit is measured from. The anchor
  is the "why"; keep it and cut only the narrative around it.
- **Constraints in force now** — a pending rollout gate, exit criterion, or
  "X must land before Y". Hiding one in an issue puts the constraint where
  the reader of the file will never look, so state the condition itself in
  present tense — never an issue number. A permanent constraint stays; an
  expiring one (a phase gate) is cut once its phase ships, because after
  that it is only narrative. A plan with no present constraint ("Phase 2
  will add …") is not a constraint: that goes to an issue or milestone,
  never the file.
- **Records** — merged ADRs and their `Date`/`Author(s)` headers are
  append-only (see [`audit.md`](audit.md) step 5); rewriting one falsifies
  the record.

## Transient content: PR and issue bodies, not the repo

A committed file is for what remains true or remains needed. Everything else
has a body-shaped home:

| Content                                               | Home                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| What this particular change did and why               | PR body                                                                  |
| One-time data fix / backfill script, run-once runbook | PR body that performs it; an issue body if no PR will carry it           |
| Plan or roadmap for upcoming work                     | An **issue or milestone**, closed when the work ships                    |
| We tried X and it failed — worth remembering          | An **issue that quotes the file path and symbol**, then closed as record |
| Schema migration `.sql`                               | **Stays** — versioned schema history in `packages/db/drizzle/`           |
| How to run migrations, ever                           | `docs/db-migrations.md` (standing process)                               |

If you catch yourself wanting to record history in a comment ("we should note
that we tried this and it broke"), that is the signal to write the issue or PR
body instead — after it exists, the committed file still says only what is
true today. Filing issues: the repo's [GitHub write rules](../../../AGENTS.md#writing-to-github).

## Mode: writing new code or docs

1. Write the code first; let it speak. Comment only the non-obvious what and
   the standing why — what a reader would spend minutes of reading, or one
   wrong change, rediscovering.
2. Before committing, run the test at the top on every comment and doc line
   you added. Cut what fails; move the memory to a PR/issue body.
3. Docs in `docs/` describe how the system **is**, not what just changed.
   Specs remain the source of truth for what a feature does and how it's
   verified (see [`AGENTS.md`](../../../AGENTS.md)); this skill governs how those
   words are phrased.
4. Writing an ADR: same rules, on top of the prescribed sections in
   [`docs/adr/`](../../../docs/adr/README.md) — no issue links, no dated
   narrative inside Context/Decision.

## Mode: PR review

When a PR adds or edits comments or markdown, review the text like code:

- Flag every item under **Never in a committed file** and every text that
  fails the test — each with a one-line reason and a rewrite you've actually
  written. A suggested rewrite beats a rule citation; the author should be
  able to paste it.
- **Instructional examples are not violations.** A phrase quoted inside a
  rule that bans it — this skill's own ban list included — illustrates the
  pattern; its numeric examples use `#<n>` placeholders, so neither this
  skill's examples nor any file's quoted rule text count as real references.
- Mechanical follow-ups (draft PRs, reply etiquette, attribution) belong to
  the repo's [GitHub write rules](../../../AGENTS.md#writing-to-github).

## Mode: periodic audit

Audit mode runs only on an explicit request to audit or sweep — never from a
casual "clean up", and never from merely loading this skill. Read
[`audit.md`](audit.md) before starting one: it carries the scope, base-branch,
search, rewrite, and hand-over procedure, and it changes none of the rules
above.

## What to leave out of this skill's work

- Spelling, tone, grammar, and doc structure — not what this is about.
- Dead _external_ links: outside-repo link rot is a different problem.
- Generated or vendored files: every `CHANGELOG.md`, `.claude/skills/` (copied
  from `.agents/skills/`), `node_modules/`.
- This skill's own files — `SKILL.md` and `audit.md` — during an audit: their
  `#<n>` placeholders and quoted ban-list phrases are illustrations, and the
  seeded searches exclude the directory so the audit doesn't self-flag.
- Merged ADRs, and the `Date`/`Author(s)` header of any ADR — records keep
  their identity.
- Deleting `packages/db/drizzle/*.sql` migration history — never.
- Anything outside the scope they confirmed in [`audit.md`](audit.md) step 1.
