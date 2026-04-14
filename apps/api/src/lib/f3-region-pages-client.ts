/**
 * f3-region-pages client stub.
 *
 * TODO(F3R5_014-followup): Replace this stub with a real read against the
 * f3-region-pages Postgres database. The real implementation should:
 *   1. Read `F3_REGION_PAGES_DATABASE_URL` from env
 *   2. Use a connection pool (same shape as `apps/me` uses for its direct
 *      f3-region-pages reads — confirm pattern before wiring)
 *   3. Query `SELECT slug, point_of_contact, page_url FROM regions WHERE slug = $1`
 *   4. Throw `F3RegionPagesUnavailableError` on connection failure or timeout
 *
 * Until then, this stub returns failure whenever the env var is unset so the
 * validator route returns 503. When the env var IS set it attempts an HTTP
 * fallback to an internal JSON endpoint — allowing integration tests to
 * mock-serve the response without wiring a real Postgres pool.
 */

export interface F3RegionPage {
  slug: string;
  point_of_contact: string;
  page_url: string;
}

export class F3RegionPagesUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "F3RegionPagesUnavailableError";
  }
}

export interface FetchF3RegionPageOptions {
  slug: string;
  signal?: AbortSignal;
}

const F3_REGION_PAGES_TIMEOUT_MS = 3_000;

export const fetchF3RegionPage = async ({
  slug,
  signal,
}: FetchF3RegionPageOptions): Promise<F3RegionPage> => {
  const baseUrl = process.env.F3_REGION_PAGES_DATABASE_URL;
  if (!baseUrl) {
    throw new F3RegionPagesUnavailableError(
      "F3_REGION_PAGES_DATABASE_URL is not configured",
    );
  }

  // TODO(F3R5_014-followup): swap this HTTP fallback for a real Postgres read.
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    F3_REGION_PAGES_TIMEOUT_MS,
  );

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
      `${baseUrl.replace(/\/$/, "")}/internal/regions/${encodeURIComponent(slug)}`,
      { signal: controller.signal, headers: { accept: "application/json" } },
    );

    if (!response.ok) {
      throw new F3RegionPagesUnavailableError(
        `f3-region-pages returned HTTP ${response.status}`,
      );
    }

    const raw = (await response.json()) as Partial<F3RegionPage>;
    if (
      typeof raw.slug !== "string" ||
      typeof raw.point_of_contact !== "string" ||
      typeof raw.page_url !== "string"
    ) {
      throw new F3RegionPagesUnavailableError(
        "f3-region-pages response missing required fields",
      );
    }

    return {
      slug: raw.slug,
      point_of_contact: raw.point_of_contact,
      page_url: raw.page_url,
    };
  } catch (error) {
    if (error instanceof F3RegionPagesUnavailableError) throw error;
    throw new F3RegionPagesUnavailableError(
      error instanceof Error ? error.message : "f3-region-pages fetch failed",
    );
  } finally {
    clearTimeout(timeout);
  }
};
