# AI Tooling Guide for F3 Nation Developers

> Prepared for the F3 Nation developer huddle. This is a living document — update it as the team learns.

## Table of Contents

- [What AI Is Good At (and Not)](#what-ai-is-good-at-and-not)
- [Our AI Config Files](#our-ai-config-files)
- [Recommended Workflows](#recommended-workflows)
- [Quality Guardrails](#quality-guardrails)
- [Keeping Documentation Current](#keeping-documentation-current)
- [Tool-Specific Tips](#tool-specific-tips)
- [Getting Started Checklist](#getting-started-checklist)

---

## What AI Is Good At (and Not)

### AI Excels At

| Task                            | Notes                                                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Boilerplate generation**      | New oRPC routers, Zod schemas, React components, test files — AI can scaffold these in seconds if given the right patterns |
| **Code completion in context**  | Filling in function bodies, completing Tailwind classes, writing type signatures                                           |
| **Understanding existing code** | "Explain this permission check" / "What does this Drizzle query do?"                                                       |
| **Writing tests**               | Generating unit tests from existing functions, suggesting edge cases                                                       |
| **Refactoring**                 | Renaming, extracting components, converting callbacks to async/await                                                       |
| **Debugging**                   | Analyzing error messages, suggesting fixes for type errors, tracing data flow                                              |
| **Documentation**               | Generating JSDoc, README sections, API docs from code                                                                      |
| **SQL/Drizzle queries**         | Complex JOINs, aggregations, migration scripts                                                                             |
| **Regex and validation**        | Writing and explaining Zod schemas, regex patterns                                                                         |

### AI Struggles With

| Task                            | Mitigation                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Inventing architecture**      | Don't let AI choose between oRPC vs tRPC, or design the org hierarchy. We've made those choices — teach AI our patterns via AGENTS.md |
| **Permission logic**            | AI doesn't intuitively understand our org hierarchy (Nation → Sector → Region → AO). Always verify permission checks manually         |
| **Cross-package consistency**   | AI may not know a validator already exists in `@acme/validators`. Always search first                                                 |
| **Migration safety**            | AI can generate Drizzle schema changes but won't know if a column drop destroys production data. Review migrations manually           |
| **Business domain knowledge**   | AI doesn't know what a "Q" or "PAX" or "AO" means in F3 context. The AGENTS.md domain section helps but isn't exhaustive              |
| **Environment-specific config** | Auth cookies, Sentry keys, Doppler secrets — AI guesses wrong here. Always verify                                                     |
| **Multi-step workflows**        | Anything spanning multiple PRs or requiring coordination across packages needs human orchestration                                    |

### Rules of Thumb

1. **Trust AI for syntax, verify AI for semantics** — it'll write correct TypeScript but may misunderstand your intent
2. **The more context you give, the better** — paste error messages, link to files, explain the domain
3. **AI is a first draft machine** — treat output as a starting point, not a finished product
4. **If it looks too clever, it's probably wrong** — simple, boring code that follows existing patterns is better

---

## Our AI Config Files

We maintain config files that teach AI tools about our codebase. Here's what each file does and which tools read it:

| File                        | Purpose                                                                             | Read By                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                 | **Single source of truth** — full architecture, conventions, domain model, commands | Copilot, Claude, Cursor, Windsurf, and most AI coding tools (see [agents.md](https://agents.md/)) |
| `.vscode/skills/*/SKILL.md` | Task-specific deep-dive guides                                                      | Copilot Agent (auto-loaded when relevant)                                                         |

### Skill Files

Skills are specialized instructions that activate for specific tasks:

| Skill               | Location                                      | When It Activates                   |
| ------------------- | --------------------------------------------- | ----------------------------------- |
| API Routes          | `.vscode/skills/api-routes/SKILL.md`          | Creating/modifying oRPC routers     |
| Database Schema     | `.vscode/skills/database-schema/SKILL.md`     | Drizzle schema changes, migrations  |
| Frontend Components | `.vscode/skills/frontend-components/SKILL.md` | React components, pages in apps/map |
| Testing             | `.vscode/skills/testing/SKILL.md`             | Writing Vitest or Playwright tests  |

### Keeping Config Files in Sync

`AGENTS.md` is the **single source of truth**. It's an open standard supported by Copilot, Claude, Cursor, Windsurf, and dozens of other AI tools. You only need to update one file when conventions change. Consider adding a skill file if a new domain/pattern emerges.

---

## Recommended Workflows

### Workflow 1: Feature Development with AI

```
1. Create a branch
2. Describe the feature to AI with context:
   - Which package/app it touches
   - Related existing files (paste snippets or reference paths)
   - Expected behavior
3. Let AI generate the first draft
4. Review for:
   - Correct imports (oRPC not tRPC, Drizzle not Prisma)
   - Permission checks if touching API
   - Existing components/validators reused
5. Run quality checks: pnpm lint && pnpm format && pnpm typecheck
6. Add/update tests
7. Run: pnpm test
8. Open PR with AI-assisted description
```

### Workflow 2: Bug Fixing with AI

```
1. Paste the error message / describe the bug
2. Ask AI to trace the data flow through the relevant files
3. Have AI suggest a fix + test that reproduces the bug
4. Verify the fix doesn't break existing tests
5. Run full CI: pnpm ci:local
```

### Workflow 3: Code Review Assistance

```
1. Ask AI to review a diff for:
   - Missing error handling
   - Permission check gaps
   - Breaking changes to shared packages
   - Test coverage gaps
2. Use AI to generate review comments
3. Human reviewer makes final judgment
```

### Workflow 4: Documentation Generation

```
1. Point AI at a file or directory
2. Ask it to generate/update documentation
3. Review for accuracy (AI may hallucinate API endpoints or config values)
4. Commit alongside the code it documents
```

---

## Quality Guardrails

### What's Already in Place

- **CI pipeline** (`.github/workflows/ci.yml`): format → lint → typecheck → build on every push
- **Playwright E2E** (`.github/workflows/playwright.yml`): End-to-end tests
- **PR template** (`.github/PULL_REQUEST_TEMPLATE.md`): Structured PR descriptions
- **CODEOWNERS** (`.github/CODEOWNERS`): Required reviewers for all PRs
- **Local CI**: `pnpm ci:local` runs the full pipeline locally

### Recommended Additions

#### 1. Pre-commit Hook (lint-staged + husky)

Catches issues before they reach CI. Add to `package.json`:

```bash
# Install
pnpm add -Dw husky lint-staged

# Setup
npx husky init
echo 'npx lint-staged' > .husky/pre-commit
```

Add to `package.json`:

```json
{
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix --cache", "prettier --write"],
    "*.{json,md,yml,yaml}": ["prettier --write"]
  }
}
```

**Tradeoff**: Slows down commits by ~5-10 seconds but catches 90% of formatting/lint issues before push. Recommended for this team since CI runs are slower.

#### 2. PR Review Checklist for AI-Generated Code

The rules in the "AI-Specific Guidelines" section of `AGENTS.md` are enforced by AI tools automatically. For human reviewers, the main things to verify are:

- [ ] AI followed the patterns in `AGENTS.md` (correct packages, env access, permissions)
- [ ] Tests added or updated
- [ ] Migrations generated if schema changed
- [ ] No new dependencies added without team discussion

#### 3. AI-Assisted PR Reviews

GitHub Copilot can review PRs. On any pull request, select **Copilot** from the **Reviewers** dropdown.

- It catches type issues, security concerns, and pattern violations
- It's a supplement to human review, not a replacement
- For automatic reviews on every PR, see [Configuring automatic code review](https://docs.github.com/en/copilot/how-tos/agents/copilot-code-review/automatic-code-review)

#### 4. Branch Protection

**Current state** (verified via GitHub rulesets API):

| Branch    | Protected? | Rules                                                                           |
| --------- | ---------- | ------------------------------------------------------------------------------- |
| `dev`     | Yes        | PRs required, 1 approval, CODEOWNER review, squash-only, no deletion/force-push |
| `staging` | **No**     | No protection — direct pushes allowed                                           |
| `main`    | **No**     | No protection — direct pushes allowed                                           |

**Gaps to address:**

- [ ] Add `staging` and `main` to the same ruleset (or create new ones) with at least the same rules as `dev`
- [ ] Add required status checks (CI passing) to all three branches — currently no branch enforces CI before merge
- [ ] Consider enabling "dismiss stale reviews on push" (currently off on `dev`)

---

## Keeping Documentation Current

### Strategy: Documentation-as-Code

Documentation that's generated from or lives alongside source code stays current. Documentation in wikis or separate repos gets stale.

### What to Automate

| Documentation         | How                                                                                       | Where          |
| --------------------- | ----------------------------------------------------------------------------------------- | -------------- |
| **API docs**          | Already automated — OpenAPI/Swagger at `apps/api/docs` route, generated from oRPC schemas | Self-updating  |
| **AGENTS.md**         | Manual but critical — update when conventions change                                      | Repo root      |
| **Changelog**         | Use `release-it` (already configured in `tooling/release-it/`)                            | Auto-generated |
| **Type docs**         | TypeScript types ARE the documentation — keep them explicit                               | In source      |
| **Component catalog** | Consider Storybook for `@acme/ui` (future)                                                | N/A yet        |

### What NOT to Automate

- Architecture decision records (ADRs) — these need human reasoning
- Onboarding guides — these need human empathy
- Domain glossary (F3 terms) — this needs community input

### Keeping AGENTS.md Fresh

Make it part of the PR process: if a PR changes conventions (new package, new pattern, new command), the PR should also update AGENTS.md. Add this to the PR template.

---

## Tool-Specific Tips

### GitHub Copilot (VS Code)

**Setup:**

- Install GitHub Copilot + Copilot Chat extensions
- Copilot reads `AGENTS.md` automatically
- Skills in `.vscode/skills/` activate contextually in agent mode

**Best Practices:**

- Use **Agent mode** (`@workspace`) for multi-file tasks — it reads AGENTS.md and skills automatically
- Use **Inline Chat** (Ctrl+I) for single-function edits
- Use **Chat** for questions about the codebase
- Reference files with `#file:path/to/file.ts` in chat for precise context
- Use `/fix` command on errors for quick fixes

### Claude (Claude Code / claude.ai)

**Setup:**

- Claude reads `AGENTS.md` automatically (both Claude Code and claude.ai Projects)

**Best Practices:**

- Paste relevant file contents when asking about specific code
- Use Projects feature to upload AGENTS.md as project knowledge
- Claude Opus is strongest at complex reasoning — use it for architecture questions, tricky type issues, and permission logic
- For large refactors, break into smaller tasks and verify each step

### Cursor

**Setup:**

- Cursor reads `AGENTS.md` automatically

**Best Practices:**

- Use `@codebase` to search the full repo
- Use `@file` to reference specific files
- Cursor Composer mode is good for multi-file edits

### General Tips (All Tools)

1. **Start with context**: "I'm working in `packages/api/src/router/`. I need to add an endpoint that..."
2. **Reference existing code**: "Follow the pattern in `user.ts` for this new router"
3. **Be specific about what you want**: "Write a Vitest test, not Jest" / "Use Drizzle, not Prisma"
4. **Verify imports**: AI frequently uses the wrong package. Check `@acme/*` aliases
5. **Run quality checks**: Always `pnpm lint && pnpm format && pnpm typecheck` before committing

---

## Getting Started Checklist

For each team member:

- [ ] Install your preferred AI tool (Copilot, Claude, Cursor)
- [ ] Verify AGENTS.md is being read (ask your AI tool about the project — it should know about oRPC, Drizzle, the org hierarchy, etc.)
- [ ] Try the feature development workflow on a small task
- [ ] Run `pnpm ci:local` to verify the quality pipeline works on your machine
- [ ] Read through the AGENTS.md file to understand what AI "knows" about our repo
- [ ] Bookmark this guide for reference

---

## Action Items from Huddle

> Fill these in during/after your meeting:

- [ ] _Decision: pre-commit hooks — yes/no?_
- [ ] _Decision: Copilot PR reviews — enable?_
- [ ] _Decision: Storybook for component catalog — prioritize?_
- [ ] _Owner for keeping AGENTS.md updated_
- [ ] _Schedule for reviewing AI config effectiveness (monthly?)_
- [ ] _Any additional skills to create?_

---

## Appendix: File Inventory

Files created/modified in this initiative:

| File                                          | Status      | Purpose                                 |
| --------------------------------------------- | ----------- | --------------------------------------- |
| `AGENTS.md`                                   | **Updated** | Single source of truth for all AI tools |
| `.vscode/skills/api-routes/SKILL.md`          | **New**     | Skill: oRPC router development          |
| `.vscode/skills/database-schema/SKILL.md`     | **New**     | Skill: Drizzle schema + migrations      |
| `.vscode/skills/frontend-components/SKILL.md` | **New**     | Skill: React/Next.js components         |
| `.vscode/skills/testing/SKILL.md`             | **New**     | Skill: Vitest + Playwright tests        |
| `docs/AI_GUIDE.md`                            | **New**     | This document — team guidance           |
