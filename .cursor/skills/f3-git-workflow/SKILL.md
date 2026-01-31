---
name: f3-git-workflow
description: Git workflow for f3-nation with feature branches and merge commits. Use when the user wants to merge changes to dev/staging, create feature branches, bump versions, or push to remotes.
---

# F3 Nation Git Workflow

This workflow uses feature branches with merge commits to maintain clear history.

## Branch Structure

- `main` - Production (merges from staging only)
- `staging` - Pre-production testing (merges from dev only)
- `dev` - Development integration (merges from feature branches)
- `feat/*`, `fix/*`, `bug/*` - Feature/fix branches (branch from dev)

## Remotes

- `md` (High-Country-Dev) - Always push here
- `f3` (F3-Nation client) - Push only when explicitly requested

## Complete Workflow

### 1. Create Feature Branch

```bash
# Ensure dev is up to date
git checkout dev
git pull md dev

# Create feature branch
git checkout -b feat/your-feature-name
```

### 2. Make Changes and Commit

Make your changes, then commit with clear messages:

```bash
git add -A
git commit -m "$(cat <<'EOF'
Short description of changes

- Detail 1
- Detail 2
EOF
)"
```

### 3. Run CI Checks on Feature Branch

**Before merging**, run all CI checks on the feature branch:

```bash
# Run all checks (continues even if one fails, so you see all errors)
pnpm run typecheck lint format test --continue
```

Or run individually:

```bash
pnpm typecheck  # Type checking
pnpm lint       # Linting
pnpm format     # Format checking
pnpm test       # Tests (requires test database)
```

**Fix any issues before proceeding to merge.** If tests require the database:

```bash
pnpm reset-test-db
pnpm test
```

### 4. Merge Feature into Dev

Use `--no-ff` to create a merge commit with two parents:

```bash
git checkout dev
git merge feat/your-feature-name --no-ff -m "$(cat <<'EOF'
Short description of changes

- Detail 1
- Detail 2
EOF
)"
```

### 5. Bump Version on Dev

Before merging to staging, bump the version:

**Files to update:**

- `package.json` (root)
- `apps/map/package.json`
- `apps/api/package.json`
- `packages/shared/src/app/changelog.ts`

```bash
# After updating files
git add -A
git commit -m "Bump to X.Y.Z"
```

**Version bump types:**

- Patch (3.6.1 → 3.6.2): Bug fixes, small improvements
- Minor (3.6.2 → 3.7.0): New features, larger changes
- Major (3.7.0 → 4.0.0): Breaking changes

### 6. Push Dev to Remote

```bash
# Normal push
git push md dev

# If history was rewritten (rebased/reset)
git push md dev --force-with-lease
```

### 7. Merge Dev into Staging

Use `--no-ff` with a descriptive message (NOT "Merge branch 'dev'"):

```bash
git checkout staging
git pull md staging
git merge dev --no-ff -m "$(cat <<'EOF'
X.Y.Z: Short description of changes

- Detail 1
- Detail 2
EOF
)"
```

### 8. Push Staging to Remote

```bash
# Normal push
git push md staging

# If history was rewritten
git push md staging --force-with-lease
```

### 9. (Optional) Push to Client Remote

Only when explicitly requested:

```bash
git push f3 dev
git push f3 staging
```

## Quick Reference

### Verify Merge Commit Parents

```bash
# Should show two parent commits
git log --oneline --graph -5
```

### View Branch Differences

```bash
# What's in dev but not staging
git log staging..dev --oneline

# What's in staging but not main
git log main..staging --oneline
```

### Reset Branch to Remote State

```bash
git checkout dev
git reset --hard md/dev
```

## Agent Instructions

When helping with this workflow:

1. **Run CI checks on feature branch** before merging (`pnpm run typecheck lint format test --continue`)
2. **Always use `--no-ff`** for merges to create merge commits
3. **Never use generic merge messages** like "Merge branch 'dev'" - always describe the changes
4. **Bump version on dev** before merging to staging
5. **Include version in staging merge message** (e.g., "3.6.2: Add feature X")
6. **Push to md remote** by default, only push to f3 when asked
7. **Use `--force-with-lease`** instead of `--force` when force pushing is needed

### Example: Complete Feature Merge

```bash
# 1. Create feature branch and make changes
git checkout dev && git pull md dev
git checkout -b feat/my-feature
# ... make changes ...
git add -A && git commit -m "Add shared errors constants for role management"

# 2. Run CI checks on feature branch
pnpm run typecheck lint format test --continue

# 3. Merge feature to dev
git checkout dev
git merge feat/my-feature --no-ff -m "Add shared errors constants for role management"

# 4. Bump version
# (edit package.json files and changelog.ts)
git add -A
git commit -m "Bump to 3.6.2"

# 5. Push dev
git push md dev

# 6. Merge dev to staging
git checkout staging && git pull md staging
git merge dev --no-ff -m "3.6.2: Add shared errors constants for role management"

# 7. Push staging
git push md staging
```
