# Architecture Decision Records

An ADR is a short written record of one important, hard-to-reverse
technical decision — what we decided, why, and what else we considered.
The goal is simple: when someone (including an AI) touches this part of
the system in six months, they can find out _why_ it's built this way
before they change it.

**Not every decision needs one.** Write an ADR when a choice would be
genuinely disruptive to reverse later — swapping a framework, changing
how authorization works, restructuring the database. Everyday
implementation choices don't need one.

**ADRs vs. specs:** if you're documenting _how the system is built_, it's
an ADR (this folder). If you're documenting _what a feature does and how
it's verified_, that belongs in [`/specs`](../../specs) instead.

## Writing one

1. Copy [`TEMPLATE.md`](TEMPLATE.md) to a new file named
   `NNNN-short-kebab-title.md`, using the next sequential number (check
   the existing files for the highest one in use).
2. Fill in each section. It's fine to keep it short — a simple decision
   deserves a simple ADR. Look at the existing files in this folder for
   examples of the level of detail.
3. Open a pull request like any other change, so it gets reviewed.

## Status

Every ADR has one of these:

- **Proposed** — up for discussion, not yet final.
- **Accepted** — this is the decision; the codebase should follow it.
- **Superseded by ADR-NNNN** — a later ADR replaced this one.

## ADRs don't get rewritten

Once an ADR is Accepted, don't edit its Decision or Consequences later,
even if things change. If a decision gets reversed, write a **new** ADR
explaining the change, then come back and update the _old_ one's Status
to point at it. This keeps the history honest — you can always see what
was decided and when, not just what's true today.
