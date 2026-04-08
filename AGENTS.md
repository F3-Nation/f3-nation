# Repository Guidelines

## Project Structure & Module Organization

- Use Node >=20.19 (see `.nvmrc`), pnpm 8.15.1, and Turborepo for workspace orchestration.
- The `apps/map` directory contains the Next.js 15 map UI (port 3000).
- Shared code is organized in `packages/`: `api` (tRPC routers), `auth` (auth helpers), `db` (Drizzle schema/migrations), `ui` (shared components), `validators` (Zod schemas), and `shared` (utilities).
- Configuration files are in `tooling/`; pnpm patches go in `patches/`; Turbo generators live in `turbo/`.

## Build, Test, and Development Commands

- Install dependencies with `pnpm install`. You can scope installations with `--filter <workspace>`.
- Start development: `pnpm dev --filter f3-nation-map` for the map app, or `pnpm dev` to run all watch tasks.
- Ensure a populated root `.env` file is present for any scripts relying on `with-env`.
- Build with `pnpm build` (or `pnpm build --filter apps/map`), and start production with `pnpm -C apps/map start`.
- Code quality: always run `pnpm lint` (or `pnpm lint --filter apps/map`) and `pnpm format:fix` to ensure your code passes all lint and formatting checks. Also run `pnpm typecheck` to validate types.
- Testing:
  - Run all tests with `pnpm test` (via the Turbo pipeline).
  - Run targeted tests: `pnpm -C apps/map test`, `pnpm -C apps/map test:e2e`.
  - Database helpers: `pnpm db:pull`, `pnpm db:push`, and `pnpm reset-test-db`.

## Coding Style & Naming Conventions

- Use Prettier (`@acme/prettier-config`) and ESLint (`@acme/eslint-config` base/next/react) as the source of truth.
- Always autofix issues with `pnpm lint:fix` and confirm changes with `pnpm lint` and `pnpm format` before committing.
- Code should use two-space indentation by default.
- Prioritize TypeScript; use `.ts`/`.tsx` with explicit typings.
- Name React components in PascalCase, prefix hooks with `use`, and use kebab-case for files/directories (e.g., `apps/map/src`).
- Co-locate feature-specific assets and tests near their sources (e.g., `apps/map/src/app/(feature)/`).

## Testing Guidelines

- Use Vitest for unit and integration tests; name test files `*.test.ts[x]` and place under or near source code or in `__tests__`.
- Use Playwright for e2e in `apps/map`; generate reports via `pnpm -C apps/map test:e2e:report`.
- Reset databases before any suite that mutates data (`pnpm reset-test-db` or `pnpm -C packages/db reset-test-db`).
- Prefer fixtures in `apps/map/tests` or `packages/*/__mocks__` instead of live service calls.

## Commit & Pull Request Guidelines

### Conventional Commits (enforced)

All commits and PR titles **must** follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.
CI will automatically reject any PR whose title or commits do not comply.

**Format:** `<type>(<optional scope>): <short description>`

| Type       | When to use                                              |
| ---------- | -------------------------------------------------------- |
| `feat`     | A new feature                                            |
| `fix`      | A bug fix                                                |
| `docs`     | Documentation changes only                               |
| `style`    | Formatting, whitespace — no logic change                 |
| `refactor` | Code change that is neither a fix nor a feature          |
| `perf`     | A code change that improves performance                  |
| `test`     | Adding or fixing tests                                   |
| `build`    | Changes to build system or external dependencies         |
| `ci`       | Changes to CI/CD configuration                           |
| `chore`    | Other changes that don't modify src or test files        |
| `revert`   | Reverts a previous commit                                |

**Examples:**
- `feat(map): add dark mode toggle`
- `fix(api): resolve race condition in event router`
- `chore: upgrade pnpm to 9.x`
- `docs: update README with setup instructions`

**Breaking changes:** append `!` after the type/scope, e.g. `feat(api)!: change authentication flow`, and include `BREAKING CHANGE:` in the commit body.

Husky will enforce the format locally on every `git commit`. Run `pnpm install` after cloning to activate the hooks.

### Pull Request requirements

- PR title must follow the Conventional Commits format (validated automatically by CI).
- Every pull request should:

  - Include a clear summary, any related issue(s), commands run, and impact to DB/env.
  - Add screenshots or screen recordings for UI changes in `apps/map`.
  - Highlight any new migrations or environment variables.
  - Never include secrets; share them using Slack or Doppler scripts, not via git.

- Before opening a pull request, ensure both `pnpm lint` and `pnpm format` pass with no errors or changes required.

## Security & Environment

- Store all secrets in a root `.env` file. Always use `with-env` helpers to load environment variables and never commit `.env` files to the repo.
- Scope Sentry/analytics keys per environment and rotate if leaked. Run production DB changes only through scripts in `packages/db`.
