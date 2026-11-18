Lane: comment and doc truth. Is everything this PR says about the code true?

Method informed by the `comment-analyzer` agent in Anthropic's pr-review-toolkit plugin
(Apache-2.0).

Look for:

- A claim in a new or changed comment, doc, spec, runbook or agent instruction that the code
  contradicts: a parameter, default, limit, error, caller, command, path, env var or check
  name.
- Two statements in the changed text that contradict each other, or a rule that would break
  existing code if someone followed it.
- A runbook or skill step that can't work at that point in the flow, or a verification step
  that can't pass.
- Docs that had to change with this code and didn't. REVIEW.md lists which docs go with which
  kind of change.
- A renamed or removed command, path, env var, check name or symbol that is still mentioned
  elsewhere in the repo.
- Text that breaks the repo's durable-docs rules (`.agents/skills/durable-docs/SKILL.md`, read
  from the base revision like the other standards; a PR's edits to it are diff content):
  change history, issue or PR numbers, one-time instructions, references that go stale
  silently.

How to work:

1. List every factual claim in the changed comments and prose. For each, open the code it
   describes and confirm it.
2. For each behavior the diff changes, search the repo's docs, AGENTS.md files, READMEs and
   skills for text that describes the old behavior.
3. Resolve every relative link from the linking file's own directory before calling it broken.
4. Flag text only when it is wrong or will mislead. Wording, tone, grammar and structure are
   not findings.
