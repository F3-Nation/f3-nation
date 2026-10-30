# packages/ui

Shared shadcn primitives for the Next.js apps. Before copying a component
between apps, check here; new shadcn primitives go in this package. App-level
rules: [`apps/AGENTS.md`](../../apps/AGENTS.md).

- Forms use `FormField` → `FormItem` → `FormLabel` / `FormControl` /
  `FormMessage`. Never override the id `FormControl` assigns; the label's
  `htmlFor` targets it.
- Icon-only buttons need an accessible name and `type="button"`. A dialog needs
  a (visually hidden) `DialogTitle`. Use complete ARIA patterns only, and keep
  heading levels nested.
