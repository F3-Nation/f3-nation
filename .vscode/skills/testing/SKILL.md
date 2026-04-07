# Skill: Writing Tests

## When to Use

Use this skill when adding or modifying tests anywhere in the monorepo.

## Test Framework

- **Unit/Integration**: Vitest (NOT Jest — similar API but different runner)
- **E2E**: Playwright (for `apps/map`)
- **Assertion style**: Vitest `expect` API
- **Mocking**: Vitest `vi.mock()`, `vi.fn()`, `vi.spyOn()`

## File Naming & Location

- Name test files `*.test.ts` or `*.test.tsx`
- Place in `__tests__/` directory OR co-located next to source
- E2E tests go in `apps/map/tests/`

## Unit Test Template

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

describe("myFunction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should do the expected thing", () => {
    const result = myFunction(input);
    expect(result).toEqual(expected);
  });

  it("should handle edge case", () => {
    expect(() => myFunction(badInput)).toThrow();
  });
});
```

## API Router Test Template

```typescript
import { describe, expect, it, beforeAll } from "vitest";
import { createCaller } from "../index";

describe("myEntity router", () => {
  const caller = createCaller({
    session: mockSession,
    db: testDb,
  });

  it("should list entities", async () => {
    const result = await caller.myEntity.list({ page: 1, pageSize: 10 });
    expect(result.data).toBeDefined();
    expect(result.data.length).toBeGreaterThan(0);
  });

  it("should require auth for create", async () => {
    const unauthCaller = createCaller({ session: null, db: testDb });
    await expect(
      unauthCaller.myEntity.create({ name: "test" }),
    ).rejects.toThrow();
  });
});
```

## React Component Test Template

```typescript
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MyComponent } from "./my-component";

describe("MyComponent", () => {
  it("renders correctly", () => {
    render(<MyComponent title="Test" />);
    expect(screen.getByText("Test")).toBeInTheDocument();
  });
});
```

## Database Tests

For tests that mutate the database:

```bash
# Reset test DB before running
pnpm reset-test-db

# Then run tests
pnpm test
```

The test pipeline in Turbo already depends on `reset-test-db`.

## E2E Test Template (Playwright)

```typescript
import { test, expect } from "@playwright/test";

test.describe("Map page", () => {
  test("loads the map", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#map")).toBeVisible();
  });
});
```

Run E2E: `pnpm -C apps/map test:e2e`

## Running Tests

| Command | Scope |
|---------|-------|
| `pnpm test` | All tests across monorepo |
| `pnpm -C apps/map test` | Map app unit tests |
| `pnpm -C apps/api test` | API app tests |
| `pnpm -C packages/api test` | API package tests |
| `pnpm -C apps/map test:e2e` | Playwright E2E |
| `pnpm test -- --coverage` | With coverage reports |

## Key Principles

1. **Prefer fixtures over live services** — use mocks in `__mocks__/` or test fixtures
2. **Test behavior, not implementation** — assert outputs and side effects
3. **Reset state between tests** — use `beforeEach` to clear mocks, reset DB for mutation tests
4. **Test the permission layer** — verify auth/role checks work correctly
5. **Keep tests fast** — mock external services (email, Google APIs, webhooks)

## Checklist

- [ ] Test file named `*.test.ts[x]`
- [ ] Uses Vitest (not Jest)
- [ ] Mocks cleared between tests
- [ ] Database tests use reset-test-db
- [ ] Auth scenarios tested (authed vs unauthed)
- [ ] `pnpm test` passes
