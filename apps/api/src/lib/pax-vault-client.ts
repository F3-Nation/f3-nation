/**
 * Pax-Vault internal API client stub.
 *
 * TODO(F3R5_014-followup): Replace this stub with a real call to pax-vault's
 * internal region lookup endpoint. The real call should:
 *   1. Read `PAX_VAULT_INTERNAL_URL` from env
 *   2. Authenticate with an s2s token minted by `@acme/sso` (once s2s support
 *      lands in the SSO package — see the matching TODO in s2s-auth.ts)
 *   3. GET `${PAX_VAULT_INTERNAL_URL}/internal/regions/:region_id`
 *   4. Return `{ region_id, region_name, pax_count, most_recent_beatdown,
 *      thumbnail_url }`
 *   5. Throw `PaxVaultUnavailableError` on any network/5xx/timeout
 *
 * Until then, this stub attempts a best-effort fetch when the env var is set
 * and throws `PaxVaultUnavailableError` in every other case so the validator
 * route returns 503.
 */

export interface PaxVaultRegion {
  region_id: string;
  region_name: string;
  pax_count: number;
  most_recent_beatdown: string;
  thumbnail_url: string;
}

export class PaxVaultUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaxVaultUnavailableError";
  }
}

export interface FetchPaxVaultRegionOptions {
  regionId: string;
  signal?: AbortSignal;
}

const PAX_VAULT_TIMEOUT_MS = 3_000;

export const fetchPaxVaultRegion = async ({
  regionId,
  signal,
}: FetchPaxVaultRegionOptions): Promise<PaxVaultRegion> => {
  const baseUrl = process.env.PAX_VAULT_INTERNAL_URL;
  if (!baseUrl) {
    throw new PaxVaultUnavailableError(
      "PAX_VAULT_INTERNAL_URL is not configured",
    );
  }

  // TODO(F3R5_014-followup): attach an s2s bearer token once @acme/sso exposes one.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAX_VAULT_TIMEOUT_MS);

  // Link the upstream signal to our timeout controller so cancellations propagate.
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }
  }

  try {
    const response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/internal/regions/${encodeURIComponent(regionId)}`,
      { signal: controller.signal, headers: { accept: "application/json" } },
    );

    if (!response.ok) {
      throw new PaxVaultUnavailableError(
        `pax-vault returned HTTP ${response.status}`,
      );
    }

    const raw = (await response.json()) as Partial<PaxVaultRegion>;
    if (
      typeof raw.region_id !== "string" ||
      typeof raw.region_name !== "string" ||
      typeof raw.pax_count !== "number" ||
      typeof raw.most_recent_beatdown !== "string" ||
      typeof raw.thumbnail_url !== "string"
    ) {
      throw new PaxVaultUnavailableError(
        "pax-vault response missing required fields",
      );
    }

    return {
      region_id: raw.region_id,
      region_name: raw.region_name,
      pax_count: raw.pax_count,
      most_recent_beatdown: raw.most_recent_beatdown,
      thumbnail_url: raw.thumbnail_url,
    };
  } catch (error) {
    if (error instanceof PaxVaultUnavailableError) throw error;
    throw new PaxVaultUnavailableError(
      error instanceof Error ? error.message : "pax-vault fetch failed",
    );
  } finally {
    clearTimeout(timeout);
  }
};
