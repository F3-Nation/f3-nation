/**
 * Environment variable loading + validation for the redirect-admin UI.
 *
 * Validated at boot (first import). Any missing REQUIRED var throws
 * immediately so the process fails fast in container startup. Mirrors
 * the pattern used by `apps/me/src/lib/auth/*` — intentionally simple,
 * no `@t3-oss/env-nextjs` dependency because this app has a tiny surface.
 *
 * See R5 plan, Decision 5 (admin UI placement) and Decision 8 (per-role
 * Neon connection strings). The `NEON_REDIRECT_ADMIN_UI_URL` var binds us
 * to the `redirect_admin_ui` role defined in
 * `packages/redirect-platform-db/sql/0001_roles_and_grants.sql`.
 */

const REQUIRED_ENV_VARS = [
  // --- Neon (redirect_admin_ui role) ---
  "NEON_REDIRECT_ADMIN_UI_URL",

  // --- Internal region-binding validator (Decision 11) ---
  "REGION_BINDING_VALIDATOR_URL",
  "REGION_BINDING_VALIDATOR_S2S_SECRET",

  // --- f3-nation Supabase DB (for reading org hierarchy + user roles) ---
  // Matches the `@acme/env` var name used by `@acme/db`.
  "DATABASE_URL",

  // --- SSO (copied from apps/me) ---
  "OAUTH_CLIENT_ID",
  "OAUTH_CLIENT_SECRET",
  "OAUTH_REDIRECT_URI",
  "AUTH_PROVIDER_URL",
  "SESSION_SECRET",
  "NEXT_PUBLIC_SITE_URL",
] as const;

type RequiredVar = (typeof REQUIRED_ENV_VARS)[number];

interface OptionalEnv {
  /** GCP project for Certificate Manager API calls. */
  gcpProjectId: string;
  /** Name of the Certificate Map the redirect LB uses. */
  redirectCertMapName: string;
  /** LB static IPv4 shown to users as the A record they need to create. */
  redirectLbIpv4: string | null;
  /** Optional: override for the validator HTTP timeout (ms). */
  validatorTimeoutMs: number;
}

export interface RedirectAdminEnv extends Record<RequiredVar, string> {
  /** Convenience alias — same value as NEON_REDIRECT_ADMIN_UI_URL. */
  neonAdminUiConnectionString: string;
  /** Convenience alias — same value as DATABASE_URL. */
  supabaseConnectionString: string;
  options: OptionalEnv;
}

export class EnvValidationError extends Error {
  constructor(missing: readonly string[]) {
    super(
      `redirect-admin env validation failed; missing required vars: ${missing.join(
        ", ",
      )}`,
    );
    this.name = "EnvValidationError";
  }
}

/**
 * Pure, testable env loader. Accepts `process.env`-shaped input so tests
 * can pass synthetic envs without mutating the real process env.
 */
export function loadEnv(
  source: NodeJS.ProcessEnv = process.env,
): RedirectAdminEnv {
  const missing: string[] = [];
  const required: Partial<Record<RequiredVar, string>> = {};

  for (const name of REQUIRED_ENV_VARS) {
    const value = source[name];
    if (!value) {
      missing.push(name);
    } else {
      required[name] = value;
    }
  }

  if (missing.length > 0) {
    throw new EnvValidationError(missing);
  }

  const gcpProjectId = source.GCP_PROJECT_ID ?? "f3-redirects";
  const redirectCertMapName =
    source.REDIRECT_CERT_MAP_NAME ?? "redirect-platform-cert-map";
  const redirectLbIpv4 = source.REDIRECT_LB_IPV4 ?? null;
  const validatorTimeoutMs = source.REGION_BINDING_VALIDATOR_TIMEOUT_MS
    ? Number(source.REGION_BINDING_VALIDATOR_TIMEOUT_MS)
    : 10_000;

  // The type cast is safe: we just populated every required key in the
  // loop above (else we would have thrown on `missing.length > 0`).
   
  const base = required as Record<RequiredVar, string>;

  return {
    ...base,
    neonAdminUiConnectionString: base.NEON_REDIRECT_ADMIN_UI_URL,
    supabaseConnectionString: base.DATABASE_URL,
    options: {
      gcpProjectId,
      redirectCertMapName,
      redirectLbIpv4,
      validatorTimeoutMs,
    },
  };
}

/**
 * Cached singleton. Lazy so tests that import this module don't crash
 * during module evaluation if the real process env is missing a var.
 */
let _cached: RedirectAdminEnv | null = null;
export function env(): RedirectAdminEnv {
  if (_cached) return _cached;
  // During `next build` or test runs with explicit skip flag, return a
  // stub so static analysis of route handlers doesn't crash.
  if (process.env.SKIP_ENV_VALIDATION === "1") {
    _cached = stubEnv();
    return _cached;
  }
  _cached = loadEnv();
  return _cached;
}

function stubEnv(): RedirectAdminEnv {
  const stub = "stub";
  return {
    NEON_REDIRECT_ADMIN_UI_URL: stub,
    REGION_BINDING_VALIDATOR_URL: "http://localhost:0",
    REGION_BINDING_VALIDATOR_S2S_SECRET: stub,
    DATABASE_URL: stub,
    OAUTH_CLIENT_ID: stub,
    OAUTH_CLIENT_SECRET: stub,
    OAUTH_REDIRECT_URI: "http://localhost:3006/api/auth/callback",
    AUTH_PROVIDER_URL: "http://localhost:3004",
    SESSION_SECRET: stub,
    NEXT_PUBLIC_SITE_URL: "http://localhost:3006",
    neonAdminUiConnectionString: stub,
    supabaseConnectionString: stub,
    options: {
      gcpProjectId: "f3-redirects",
      redirectCertMapName: "redirect-platform-cert-map",
      redirectLbIpv4: null,
      validatorTimeoutMs: 10_000,
    },
  };
}
