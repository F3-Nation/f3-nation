/**
 * HTTP client for the internal region-binding validator (R5 Decision 11).
 *
 * Matches the route contract defined by
 * `apps/api/src/app/api/internal/region-binding/validate/route.ts` on the
 * `feat/r5-region-binding-validator` branch:
 *
 *   GET /api/internal/region-binding/validate
 *     ?org_id=<int>&pax_vault_region_id=<string>&region_slug=<string>
 *     &calling_user_id=<int>
 *   Authorization: Bearer <REGION_BINDING_VALIDATOR_S2S_SECRET>
 *
 * Returns typed successes + typed errors so route handlers can branch
 * cleanly and surface user-friendly messages. NEVER logs the shared
 * secret or the full Authorization header.
 *
 * F3R5_012 note: the registration flow does NOT use this client on its
 * happy path — by the time a user registers a domain the binding is
 * already verified and the trigger enforces that at insert time. This
 * module exists now so F3R5_013 (binding verification UI) can import it
 * without touching the scaffold.
 */

export interface ValidatorQueryInput {
  orgId: number;
  paxVaultRegionId: string;
  regionSlug: string;
  callingUserId: number;
}

export interface ValidatorOrgFacts {
  id: number;
  name: string;
  last_modified: string;
  admin_count: number;
  caller_roles: string[];
}

export interface ValidatorPaxVaultFacts {
  region_id: string;
  region_name: string;
}

export interface ValidatorRegionPageFacts {
  slug: string;
}

export interface ValidatorResponseBody {
  org: ValidatorOrgFacts;
  pax_vault: ValidatorPaxVaultFacts;
  f3_region_pages: ValidatorRegionPageFacts;
  cross_check: {
    triple_matches: boolean;
    match_strategy: "exact" | "fuzzy" | "failed";
  };
  validated_at: string;
}

export interface ValidatorTripleMismatchDetail {
  field: string;
  sources: Record<string, string>;
  reason: string;
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/** Thrown when the validator itself is down / unreachable / 5xx. */
export class ValidatorUnavailableError extends Error {
  constructor(
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "ValidatorUnavailableError";
  }
}

/** Thrown when the validator replies 403 (caller lacks role on org). */
export class CallerNotAuthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CallerNotAuthorizedError";
  }
}

/** Thrown when the validator replies 422 with a triangulation failure. */
export class TripleMismatchError extends Error {
  constructor(
    message: string,
    public mismatches: ValidatorTripleMismatchDetail[],
  ) {
    super(message);
    this.name = "TripleMismatchError";
  }
}

/** Thrown when the validator replies 404 (org not in f3-nation DB). */
export class OrgNotFoundError extends Error {
  constructor(orgId: number) {
    super(`org ${orgId} not found`);
    this.name = "OrgNotFoundError";
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface ValidatorClientConfig {
  baseUrl: string;
  s2sSecret: string;
  timeoutMs?: number;
  /** Injected for tests — defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

export class ValidatorClient {
  private readonly config: Required<
    Omit<ValidatorClientConfig, "fetchImpl">
  > & {
    fetchImpl: typeof fetch;
  };

  constructor(config: ValidatorClientConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/+$/, ""),
      s2sSecret: config.s2sSecret,
      timeoutMs: config.timeoutMs ?? 10_000,
      fetchImpl: config.fetchImpl ?? fetch,
    };
  }

  /**
   * Call the internal validator. Throws typed errors on non-2xx, returns
   * the parsed body on success.
   */
  async validate(input: ValidatorQueryInput): Promise<ValidatorResponseBody> {
    const url = new URL(
      "/api/internal/region-binding/validate",
      this.config.baseUrl,
    );
    url.searchParams.set("org_id", String(input.orgId));
    url.searchParams.set("pax_vault_region_id", input.paxVaultRegionId);
    url.searchParams.set("region_slug", input.regionSlug);
    url.searchParams.set("calling_user_id", String(input.callingUserId));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let res: Response;
    try {
      res = await this.config.fetchImpl(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.config.s2sSecret}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
    } catch (err) {
      throw new ValidatorUnavailableError(
        "validator fetch failed (network or timeout)",
        err,
      );
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 500) {
      throw new ValidatorUnavailableError(`validator returned ${res.status}`);
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      throw new ValidatorUnavailableError(
        "validator returned non-JSON body",
        err,
      );
    }

    if (res.status === 404) {
      throw new OrgNotFoundError(input.orgId);
    }

    if (res.status === 403) {
      throw new CallerNotAuthorizedError(
        "calling user is not authorized on this org",
      );
    }

    if (res.status === 422) {
      const detail = (
        body as {
          detail?: { mismatches?: ValidatorTripleMismatchDetail[] };
        }
      ).detail;
      throw new TripleMismatchError(
        "validator triple-mismatch",
        detail?.mismatches ?? [],
      );
    }

    if (!res.ok) {
      throw new ValidatorUnavailableError(
        `validator returned unexpected status ${res.status}`,
      );
    }

    return body as ValidatorResponseBody;
  }
}
