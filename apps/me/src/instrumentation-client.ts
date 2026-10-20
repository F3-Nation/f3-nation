// Browser error reporting (PostHog error tracking only, no analytics). Runs
// when a page loads; a silent no-op without a key. See
// packages/observability/src/browser.ts and #1223.
import { initErrorReporting } from "@acme/observability/browser";

import { env } from "@/env";

initErrorReporting({ key: env.NEXT_PUBLIC_POSTHOG_KEY, app: "me" });
