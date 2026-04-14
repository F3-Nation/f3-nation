/**
 * Thin wrapper over `@google-cloud/certificate-manager` for
 * DnsAuthorization.Create — the only GCP API call the registration
 * flow makes synchronously (R5 Phase 1, step 6).
 *
 * Responsibilities:
 *   - Build the deterministic resource name (`dns-auth-<row.id>`).
 *   - Call CertificateManagerClient.createDnsAuthorization + await the
 *     returned LRO.
 *   - On ALREADY_EXISTS (from a retry), GET the existing resource and
 *     return its challenge record. Same pattern used by the reconciler.
 *   - Pluck the CNAME challenge record (`dnsResourceRecord.name` +
 *     `dnsResourceRecord.data`) into a plain typed object.
 *
 * The real GCP client is injected via `CertManagerClientFactory` so tests
 * can pass a fake. Route handlers use `createDefaultCertManagerClient()`
 * which wires the real `@google-cloud/certificate-manager` package.
 */

import "server-only";

import { env } from "@/env";

export interface DnsChallengeRecord {
  /** The fully-qualified CNAME name the user must create. */
  name: string;
  /** The CNAME record's target value (what it should resolve to). */
  data: string;
  /** Record type — always "CNAME" for Certificate Manager DNS-01. */
  type: "CNAME";
}

export interface CreateDnsAuthorizationInput {
  /** Deterministic id, derived from the `region_custom_domains.id` UUID. */
  authorizationId: string;
  /** Fully-qualified hostname being authorized. */
  hostname: string;
  /** GCP project id — defaults to `env().options.gcpProjectId`. */
  projectId?: string;
  /** Location — Certificate Manager DnsAuthorizations are `global`. */
  location?: string;
}

export interface CreateDnsAuthorizationResult {
  /** Full GCP resource name — `projects/.../dnsAuthorizations/<id>`. */
  resourceName: string;
  /** Parsed DNS challenge the caller must persist + surface to the user. */
  challenge: DnsChallengeRecord;
  /**
   * Whether this call created a new resource or reused an existing one
   * (ALREADY_EXISTS path). Useful for structured logging.
   */
  reused: boolean;
}

/**
 * Minimal type for the injected GCP client — only the two methods we
 * call are typed here. Keeps tests dependency-free and avoids pulling
 * the full `@google-cloud/certificate-manager` type surface into unit
 * tests.
 */
export interface CertManagerLike {
  createDnsAuthorization: (request: {
    parent: string;
    dnsAuthorizationId: string;
    dnsAuthorization: { domain: string };
  }) => Promise<[{ promise: () => Promise<[DnsAuthorizationShape]> }]>;
  getDnsAuthorization: (request: {
    name: string;
  }) => Promise<[DnsAuthorizationShape]>;
}

export interface DnsAuthorizationShape {
  name?: string | null;
  dnsResourceRecord?: {
    name?: string | null;
    type?: string | null;
    data?: string | null;
  } | null;
}

export type CertManagerClientFactory = () => CertManagerLike;

// ---------------------------------------------------------------------------
// Pure helpers (exported for direct unit testing)
// ---------------------------------------------------------------------------

/**
 * Derive the deterministic DnsAuthorization resource id from a
 * `region_custom_domains.id` UUID. The reconciler uses this same shape
 * so retries across processes land on the same GCP resource.
 */
export function buildDnsAuthorizationId(domainRowId: string): string {
  return `dns-auth-${domainRowId}`;
}

/**
 * Pluck the CNAME challenge out of a GCP DnsAuthorization response.
 * Throws if the record isn't present — the GCP API is supposed to
 * always include it on successful create/get of a DNS-01 authorization.
 */
export function extractDnsChallenge(
  authorization: DnsAuthorizationShape,
): DnsChallengeRecord {
  const record = authorization.dnsResourceRecord;
  if (!record?.name || !record.data) {
    throw new Error(
      "DnsAuthorization response missing dnsResourceRecord.{name,data}",
    );
  }
  return {
    name: record.name,
    data: record.data,
    type: "CNAME",
  };
}

export function buildParent(projectId: string, location: string): string {
  return `projects/${projectId}/locations/${location}`;
}

export function buildResourceName(
  projectId: string,
  location: string,
  authorizationId: string,
): string {
  return `${buildParent(projectId, location)}/dnsAuthorizations/${authorizationId}`;
}

/** Returned when a duplicate create is reconciled via GET. */
export function isAlreadyExistsError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: number }).code;
  // gRPC ALREADY_EXISTS = 6
  if (code === 6) return true;
  const message = (err as { message?: string }).message;
  if (message && /already exists/i.test(message)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function createOrReuseDnsAuthorization(
  factory: CertManagerClientFactory,
  input: CreateDnsAuthorizationInput,
): Promise<CreateDnsAuthorizationResult> {
  const client = factory();
  const projectId = input.projectId ?? env().options.gcpProjectId;
  const location = input.location ?? "global";
  const parent = buildParent(projectId, location);
  const resourceName = buildResourceName(
    projectId,
    location,
    input.authorizationId,
  );

  try {
    const [operation] = await client.createDnsAuthorization({
      parent,
      dnsAuthorizationId: input.authorizationId,
      dnsAuthorization: { domain: input.hostname },
    });
    const [authorization] = await operation.promise();
    return {
      resourceName: authorization.name ?? resourceName,
      challenge: extractDnsChallenge(authorization),
      reused: false,
    };
  } catch (err) {
    if (!isAlreadyExistsError(err)) throw err;
    // Existing resource (probably from a prior failed attempt). GET it.
    const [authorization] = await client.getDnsAuthorization({
      name: resourceName,
    });
    return {
      resourceName: authorization.name ?? resourceName,
      challenge: extractDnsChallenge(authorization),
      reused: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Default (real) factory — lazy import so tests never touch GCP.
// ---------------------------------------------------------------------------

let _cachedClient: CertManagerLike | null = null;

/**
 * Wraps the real `@google-cloud/certificate-manager` client. Returns a
 * `CertManagerLike` rather than the full client so unit tests don't need
 * GCP auth to run. Prod code calls this from the route handler, tests
 * pass their own factory.
 */
export async function getDefaultCertManagerClient(): Promise<CertManagerLike> {
  if (_cachedClient) return _cachedClient;
  // Dynamic import keeps `@google-cloud/certificate-manager` out of the
  // unit-test path. The module is declared as a dependency in
  // package.json but only loaded when prod code calls this factory.
  const mod = (await import(
    "@google-cloud/certificate-manager"
  )) as unknown as {
    CertificateManagerClient: new () => CertManagerLike;
  };
  _cachedClient = new mod.CertificateManagerClient();
  return _cachedClient;
}

/**
 * Sync factory used by the registration flow. Throws if the async
 * initializer hasn't been primed yet — call `getDefaultCertManagerClient`
 * once during server startup (or await it in the route) before invoking
 * this.
 */
export function createDefaultCertManagerClient(): CertManagerLike {
  if (!_cachedClient) {
    throw new Error(
      "cert-manager client not initialized — call getDefaultCertManagerClient() first",
    );
  }
  return _cachedClient;
}
