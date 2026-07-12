# Architecture Decision Records

ADRs record significant, hard-to-reverse technical decisions with their
context and rejected alternatives, so future maintainers can understand _why_
the system is built the way it is before changing it.

Boundary: feature behavior specs belong in `/specs`; decisions about **how
the system is built** belong here.

Conventions:

- One decision per file, numbered sequentially:
  `NNNN-short-kebab-title.md`.
- Start from the structure of
  [`0001-api-server-framework.md`](0001-api-server-framework.md): Status /
  Date / Deciders header, then Context, Decision, Alternatives considered,
  Consequences.
- ADRs are immutable history. If a decision is later reversed or replaced,
  write a new ADR and update the old one's **Status** to point at it — don't
  rewrite the old record.
