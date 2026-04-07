---
name: api-routes
description: "Creating or modifying oRPC API routers in packages/api/src/. USE FOR: new endpoints, router patterns, permission checks, pagination. DO NOT USE FOR: frontend components, database schema changes."
---

# Skill: Creating & Modifying oRPC API Routes

## When to Use

Use this skill when adding new API endpoints, modifying existing routers, or working in `packages/api/src/`.

## Architecture

This project uses **oRPC** (`@orpc/server`), NOT tRPC. Key differences:

- Import from `@orpc/server`, never from `@trpc/*`
- Routes defined via `os.prefix(API_PREFIX_V1).router({ ... })`
- Procedures use `.handler()` instead of `.query()` / `.mutation()`

## File Structure

```
packages/api/src/
├── index.ts              # Root router aggregation
├── shared.ts             # Context, rate limiting, auth procedures
├── router/
│   ├── user.ts           # Domain router (example)
│   └── user.test.ts      # Co-located test
├── check-has-role-on-org.ts   # Permission helper
├── get-editable-org-ids.ts    # Returns orgs user can modify
├── get-descendant-org-ids.ts  # Gets child orgs in hierarchy
├── with-pagination.ts         # Pagination helper
└── lib/
    ├── notify-webhooks.ts     # Webhook notifications
    └── revalidate-map.ts      # Cache invalidation
```

## Creating a New Router

1. Create `packages/api/src/router/[entity].ts`
2. Define input/output schemas using Zod (prefer schemas from `@acme/validators`)
3. Choose the right procedure level:
   - `base` — public, no auth required
   - `editorProcedure` — requires editor role or higher
   - `adminProcedure` — requires admin role
4. Register in `packages/api/src/index.ts`

### Template

```typescript
import { z } from "zod";
import { os } from "../shared";
import { adminProcedure, editorProcedure } from "../shared";
import { withPagination } from "../with-pagination";

// Input schema
const myEntityListInput = z.object({
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(100).default(20),
});

// Router
export const myEntityRouter = os.prefix("/my-entity").router({
  list: base
    .input(myEntityListInput)
    .handler(async ({ input, context }) => {
      const { db } = context;
      // Use withPagination for list endpoints
      return withPagination(/* query */, input);
    }),

  create: editorProcedure
    .input(myEntityInsertSchema)
    .handler(async ({ input, context }) => {
      const { db, session } = context;
      // Check permissions on the relevant org
      // Insert and return
    }),
});
```

## Permission Checking Pattern

```typescript
import { checkHasRoleOnOrg } from "../check-has-role-on-org";
import { getEditableOrgIds } from "../get-editable-org-ids";

// In a handler:
await checkHasRoleOnOrg({
  db,
  userId: session.user.id,
  orgId: input.orgId,
  roleName: "editor",
});
```

## Testing

- Co-locate tests: `router/[entity].test.ts`
- Use Vitest, not Jest
- Reset test DB before mutating suites: `pnpm reset-test-db`
- Mock context with `{ session: mockSession, db: testDb }`

## Checklist

- [ ] Input validated with Zod schema
- [ ] Output schema defined
- [ ] Appropriate auth procedure used
- [ ] Org-level permissions checked where needed
- [ ] Router registered in `packages/api/src/index.ts`
- [ ] Test file created
- [ ] `pnpm typecheck && pnpm test` passes
