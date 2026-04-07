---
name: frontend-components
description: "Creating or modifying React components and pages in apps/map/. USE FOR: Next.js pages, shadcn/ui components, Tailwind styling, client vs server components. DO NOT USE FOR: API routes, database schema."
---

# Skill: Frontend Components & Pages (apps/map)

## When to Use

Use this skill when creating or modifying React components, pages, or UI features in `apps/map/`.

## Architecture

- **Framework**: Next.js 15 App Router
- **Components**: Server Components by default. Add `"use client"` only when needed (hooks, event handlers, browser APIs).
- **Styling**: Tailwind CSS + shadcn/ui from `@acme/ui`
- **State**: Server-side data in layouts/pages, client state minimal

## File Organization

```
apps/map/src/
├── app/
│   ├── layout.tsx          # Root layout with provider stack
│   ├── page.tsx            # Home page
│   ├── _components/        # Shared map components
│   ├── admin/              # Admin feature group
│   ├── auth/               # Auth pages
│   └── api/                # API route handlers
├── env.ts                  # Environment validation
└── orpc/                   # oRPC client setup
```

## Using shadcn/ui Components

Always check `packages/ui/src/` for existing components before creating new ones:

```typescript
import { Button } from "@acme/ui/button";
import { Card } from "@acme/ui/card";
import { Input } from "@acme/ui/input";
import { cn } from "@acme/ui"; // Class name utility
```

Available components include: Button, Card, Dialog, Drawer, Sheet, Table, Input, Select, Badge, Toast, Tooltip, Tabs, Skeleton, Spinner, and 20+ more.

## Component Patterns

### CVA Variants (for component variants)

```typescript
import { cva, type VariantProps } from "class-variance-authority";

const buttonVariants = cva("inline-flex items-center", {
  variants: {
    variant: {
      default: "bg-primary text-primary-foreground",
      outline: "border border-input bg-background",
    },
    size: {
      default: "h-10 px-4",
      sm: "h-9 px-3",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});
```

### Client Component with oRPC

```typescript
"use client";

import { orpc } from "~/orpc/react";

export function MyComponent() {
  const { data } = orpc.myRouter.myProcedure.useQuery({
    input: { /* ... */ },
  });
  return <div>{/* render data */}</div>;
}
```

### Server Component with Data

```typescript
// No "use client" — this is a server component
import { caller } from "~/orpc/server";

export default async function MyPage() {
  const data = await caller.myRouter.myProcedure({ /* input */ });
  return <div>{/* render data */}</div>;
}
```

## Provider Stack

The root layout wraps the app in this provider order (don't rearrange without reason):

1. `DataProvider` (SessionProvider + OrpcReactProvider + UserLocationProvider + KeyPressProvider)
2. `ElementProvider` (ThemeProvider + TooltipProvider + Toaster + ShadCnContainer + ModalSwitcher)

## Styling Rules

- Use Tailwind utility classes, not custom CSS
- Use HSL CSS variables for colors: `text-primary`, `bg-muted`, `border-destructive`
- Use `cn()` for conditional class merging
- Responsive: mobile-first with `sm:`, `md:`, `lg:` breakpoints
- Fonts: `GeistSans` (body) / `GeistMono` (code) — already configured in root layout

## Testing

- Unit tests: Vitest + React Testing Library in `__tests__/` or co-located
- E2E: Playwright in `apps/map/tests/`
- Run: `pnpm -C apps/map test` (unit), `pnpm -C apps/map test:e2e` (e2e)

## Checklist

- [ ] Server component unless `"use client"` is needed
- [ ] Uses existing `@acme/ui` components where available
- [ ] Tailwind classes, no custom CSS files
- [ ] Responsive (mobile-first)
- [ ] Environment vars accessed via `~/env.ts`, not `process.env`
- [ ] Imports use `@acme/*` aliases
- [ ] `pnpm lint && pnpm typecheck` passes
