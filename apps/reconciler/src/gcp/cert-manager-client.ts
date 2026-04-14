/**
 * Thin wrapper over @google-cloud/certificate-manager.
 *
 * The official client is gRPC-based and long-operation-heavy. This module
 * exposes the small, opinionated surface the reconciler actually needs:
 *
 *   - `getDnsAuthorization(id)` → DnsAuthorization | null
 *   - `createCertificate({...})` → void  (await LRO to settle name only)
 *   - `getCertificate(id)` → Certificate  (throws NotFoundError on 404)
 *   - `getCertificateView(id)` → Certificate | null  (null on 404, for ops 6/7)
 *   - `getCertificateMapEntry(id)` → CertificateMapEntry | null
 *   - `createCertificateMapEntry({...})` → void
 *   - `deleteDnsAuthorization(id)` / `deleteCertificate(id)` /
 *     `deleteCertificateMapEntry(id)` → void  (idempotent: NOT_FOUND = success)
 *   - `listDnsAuthorizations()` / `listCertificates()` /
 *     `listCertificateMapEntries()` → full-project enumeration for op 8
 *     (periodic drift detection)
 *
 * All calls go through `mapGcpError` so callers branch via typed errors
 * (NotFoundError / AlreadyExistsError / PermissionDeniedError) instead of
 * inspecting raw google-gax objects. R5 Decision 6's "ALREADY_EXISTS as
 * success path" pattern is implemented at the operation layer; this module
 * just surfaces the error in a typed way.
 *
 * Long-running operations: Certificate Manager CREATE methods return an
 * `LROperation`. For the reconciler's state-machine use case we always
 * `await op.promise()` — if CREATE returns ALREADY_EXISTS, the error is
 * surfaced immediately (before the LRO starts) and we re-GET. If the CREATE
 * is accepted, we wait for the LRO to settle before returning so the row
 * can transition to the next state confident the resource exists.
 *
 * The client is constructed lazily on first use; tests inject a mocked
 * client via `setCertManagerClientForTesting()`.
 */

import { CertificateManagerClient } from "@google-cloud/certificate-manager";

import { NotFoundError, mapGcpError } from "./errors.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface CertManagerConfig {
  /** GCP project that owns the LB and Certificate Manager resources. */
  projectId: string;
  /**
   * Certificate Manager is a GLOBAL product — all resources live under
   * `locations/global`. We keep this a config field so future regional
   * variants don't require a rewrite.
   */
  location: string;
  /** Name of the target Certificate Map (Terraform: redirect-platform-cert-map). */
  certMapName: string;
}

export function loadCertManagerConfig(
  env: NodeJS.ProcessEnv = process.env,
): CertManagerConfig {
  return {
    projectId: env.GCP_PROJECT_ID ?? "f3-redirects",
    location: "global",
    certMapName: env.REDIRECT_CERT_MAP_NAME ?? "redirect-platform-cert-map",
  };
}

// ---------------------------------------------------------------------------
// Types — narrow projections of the upstream protos
// ---------------------------------------------------------------------------

export interface DnsAuthorizationView {
  /** Full resource path, e.g. `projects/f3-redirects/locations/global/dnsAuthorizations/dns-auth-<uuid>`. */
  name: string;
  domain: string;
  state: string;
  /** Records the user has to add as a CNAME to validate the authorization. */
  dnsResourceRecord: {
    name: string;
    type: string;
    data: string;
  } | null;
}

export interface CertificateView {
  name: string;
  managed: {
    domains: string[];
    dnsAuthorizations: string[];
    state: string;
    /** Extracted from `authorizationAttemptInfo[0].details` for FAILED certs. */
    failureDetails: string | null;
  } | null;
}

export interface CertificateMapEntryView {
  name: string;
  hostname: string;
  /** Full resource path of the attached Certificate. */
  certificates: string[];
}

export interface CreateCertificateInput {
  certificateId: string;
  domain: string;
  dnsAuthorizationName: string;
}

export interface CreateCertificateMapEntryInput {
  entryId: string;
  hostname: string;
  certificateName: string;
}

// ---------------------------------------------------------------------------
// Client interface (for test injection)
// ---------------------------------------------------------------------------

export interface CertManagerClient {
  getDnsAuthorization(id: string): Promise<DnsAuthorizationView | null>;
  getCertificate(id: string): Promise<CertificateView>;
  /**
   * Null-returning sibling of `getCertificate` for ops 6 and 7 where
   * NOT_FOUND is the expected success condition of a DELETE or a
   * quarantine drift check. Throws on PERMISSION_DENIED or other errors.
   */
  getCertificateView(id: string): Promise<CertificateView | null>;
  createCertificate(input: CreateCertificateInput): Promise<void>;
  /** Idempotent: NOT_FOUND is treated as success (returns void, no error). */
  deleteCertificate(id: string): Promise<void>;
  getCertificateMapEntry(id: string): Promise<CertificateMapEntryView | null>;
  createCertificateMapEntry(
    input: CreateCertificateMapEntryInput,
  ): Promise<void>;
  /** Idempotent: NOT_FOUND is treated as success (returns void, no error). */
  deleteCertificateMapEntry(id: string): Promise<void>;
  /** Idempotent: NOT_FOUND is treated as success (returns void, no error). */
  deleteDnsAuthorization(id: string): Promise<void>;
  /** List every DnsAuthorization in the project (op 8 drift detection). */
  listDnsAuthorizations(): Promise<DnsAuthorizationView[]>;
  /** List every Certificate in the project (op 8 drift detection). */
  listCertificates(): Promise<CertificateView[]>;
  /**
   * List every CertificateMapEntry under the configured cert map
   * (op 8 drift detection).
   */
  listCertificateMapEntries(): Promise<CertificateMapEntryView[]>;
  /** Return the full resource path for a DnsAuthorization id. */
  dnsAuthorizationResourcePath(id: string): string;
  /** Return the full resource path for a Certificate id. */
  certificateResourcePath(id: string): string;
  /** Return the full resource path for a CertificateMapEntry id. */
  certificateMapEntryResourcePath(id: string): string;
}

// ---------------------------------------------------------------------------
// Helpers to access google-gax LRO .promise() without using `any`
// ---------------------------------------------------------------------------

interface LongRunningOp<T> {
  promise(): Promise<[T, unknown, unknown]>;
}

function isLongRunningOp<T>(value: unknown): value is LongRunningOp<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "promise" in value &&
    typeof (value as { promise: unknown }).promise === "function"
  );
}

// ---------------------------------------------------------------------------
// Narrow proto-view projections — defensively typed
// ---------------------------------------------------------------------------

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function projectDnsAuthorization(raw: unknown): DnsAuthorizationView {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const dnsResource = (obj.dnsResourceRecord ?? null) as Record<
    string,
    unknown
  > | null;
  return {
    name: asString(obj.name),
    domain: asString(obj.domain),
    state: asString(obj.state),
    dnsResourceRecord: dnsResource
      ? {
          name: asString(dnsResource.name),
          type: asString(dnsResource.type),
          data: asString(dnsResource.data),
        }
      : null,
  };
}

function projectCertificate(raw: unknown): CertificateView {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const managed = obj.managed as Record<string, unknown> | null | undefined;
  if (!managed) {
    return { name: asString(obj.name), managed: null };
  }
  let failureDetails: string | null = null;
  const attemptInfoRaw = managed.authorizationAttemptInfo;
  if (Array.isArray(attemptInfoRaw) && attemptInfoRaw.length > 0) {
    const first = attemptInfoRaw[0] as Record<string, unknown> | undefined;
    if (first && typeof first.details === "string") {
      failureDetails = first.details;
    }
  }
  return {
    name: asString(obj.name),
    managed: {
      domains: asStringArray(managed.domains),
      dnsAuthorizations: asStringArray(managed.dnsAuthorizations),
      state: asString(managed.state),
      failureDetails,
    },
  };
}

function projectCertificateMapEntry(raw: unknown): CertificateMapEntryView {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    name: asString(obj.name),
    hostname: asString(obj.hostname),
    certificates: asStringArray(obj.certificates),
  };
}

// ---------------------------------------------------------------------------
// Real implementation backed by @google-cloud/certificate-manager
// ---------------------------------------------------------------------------

/**
 * Subset of CertificateManagerClient we actually use. Declaring it as a
 * structural interface lets us mock without pulling in the heavy proto types.
 */
export interface UpstreamCertManagerClient {
  getDnsAuthorization(req: { name: string }): Promise<[unknown]>;
  getCertificate(req: { name: string }): Promise<[unknown]>;
  createCertificate(req: {
    parent: string;
    certificateId: string;
    certificate: unknown;
  }): Promise<[unknown]>;
  deleteCertificate(req: { name: string }): Promise<[unknown]>;
  getCertificateMapEntry(req: { name: string }): Promise<[unknown]>;
  createCertificateMapEntry(req: {
    parent: string;
    certificateMapEntryId: string;
    certificateMapEntry: unknown;
  }): Promise<[unknown]>;
  deleteCertificateMapEntry(req: { name: string }): Promise<[unknown]>;
  deleteDnsAuthorization(req: { name: string }): Promise<[unknown]>;
  listDnsAuthorizations(req: { parent: string }): Promise<[unknown[]]>;
  listCertificates(req: { parent: string }): Promise<[unknown[]]>;
  listCertificateMapEntries(req: { parent: string }): Promise<[unknown[]]>;
}

export function createCertManagerClient(
  config: CertManagerConfig,
  upstream?: UpstreamCertManagerClient,
): CertManagerClient {
  const client: UpstreamCertManagerClient =
    upstream ??
    (new CertificateManagerClient() as unknown as UpstreamCertManagerClient);

  const parent = `projects/${config.projectId}/locations/${config.location}`;
  const certMapParent = `${parent}/certificateMaps/${config.certMapName}`;

  function dnsAuthorizationResourcePath(id: string): string {
    return `${parent}/dnsAuthorizations/${id}`;
  }
  function certificateResourcePath(id: string): string {
    return `${parent}/certificates/${id}`;
  }
  function certificateMapEntryResourcePath(id: string): string {
    return `${certMapParent}/certificateMapEntries/${id}`;
  }

  async function waitForLro<T>(value: unknown): Promise<void> {
    if (isLongRunningOp<T>(value)) {
      await value.promise();
    }
  }

  return {
    dnsAuthorizationResourcePath,
    certificateResourcePath,
    certificateMapEntryResourcePath,

    async getDnsAuthorization(id) {
      const name = dnsAuthorizationResourcePath(id);
      try {
        return await mapGcpError("DnsAuthorization", name, async () => {
          const [raw] = await client.getDnsAuthorization({ name });
          return projectDnsAuthorization(raw);
        });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return null;
        }
        throw err;
      }
    },

    async getCertificate(id) {
      const name = certificateResourcePath(id);
      return mapGcpError("Certificate", name, async () => {
        const [raw] = await client.getCertificate({ name });
        return projectCertificate(raw);
      });
    },

    async getCertificateView(id) {
      const name = certificateResourcePath(id);
      try {
        return await mapGcpError("Certificate", name, async () => {
          const [raw] = await client.getCertificate({ name });
          return projectCertificate(raw);
        });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return null;
        }
        throw err;
      }
    },

    async createCertificate(input) {
      const name = certificateResourcePath(input.certificateId);
      await mapGcpError("Certificate", name, async () => {
        const [op] = await client.createCertificate({
          parent,
          certificateId: input.certificateId,
          certificate: {
            managed: {
              domains: [input.domain],
              dnsAuthorizations: [input.dnsAuthorizationName],
            },
          },
        });
        await waitForLro(op);
      });
    },

    async getCertificateMapEntry(id) {
      const name = certificateMapEntryResourcePath(id);
      try {
        return await mapGcpError("CertificateMapEntry", name, async () => {
          const [raw] = await client.getCertificateMapEntry({ name });
          return projectCertificateMapEntry(raw);
        });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return null;
        }
        throw err;
      }
    },

    async createCertificateMapEntry(input) {
      const name = certificateMapEntryResourcePath(input.entryId);
      await mapGcpError("CertificateMapEntry", name, async () => {
        const [op] = await client.createCertificateMapEntry({
          parent: certMapParent,
          certificateMapEntryId: input.entryId,
          certificateMapEntry: {
            hostname: input.hostname,
            certificates: [input.certificateName],
          },
        });
        await waitForLro(op);
      });
    },

    async deleteCertificate(id) {
      const name = certificateResourcePath(id);
      try {
        await mapGcpError("Certificate", name, async () => {
          const [op] = await client.deleteCertificate({ name });
          await waitForLro(op);
        });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return;
        }
        throw err;
      }
    },

    async deleteCertificateMapEntry(id) {
      const name = certificateMapEntryResourcePath(id);
      try {
        await mapGcpError("CertificateMapEntry", name, async () => {
          const [op] = await client.deleteCertificateMapEntry({ name });
          await waitForLro(op);
        });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return;
        }
        throw err;
      }
    },

    async deleteDnsAuthorization(id) {
      const name = dnsAuthorizationResourcePath(id);
      try {
        await mapGcpError("DnsAuthorization", name, async () => {
          const [op] = await client.deleteDnsAuthorization({ name });
          await waitForLro(op);
        });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return;
        }
        throw err;
      }
    },

    async listDnsAuthorizations() {
      return mapGcpError(
        "DnsAuthorization",
        `${parent}/dnsAuthorizations`,
        async () => {
          const [raw] = await client.listDnsAuthorizations({ parent });
          return raw.map(projectDnsAuthorization);
        },
      );
    },

    async listCertificates() {
      return mapGcpError("Certificate", `${parent}/certificates`, async () => {
        const [raw] = await client.listCertificates({ parent });
        return raw.map(projectCertificate);
      });
    },

    async listCertificateMapEntries() {
      return mapGcpError(
        "CertificateMapEntry",
        `${certMapParent}/certificateMapEntries`,
        async () => {
          const [raw] = await client.listCertificateMapEntries({
            parent: certMapParent,
          });
          return raw.map(projectCertificateMapEntry);
        },
      );
    },
  };
}

// Re-exports for convenience.
export {
  AlreadyExistsError,
  NotFoundError,
  PermissionDeniedError,
} from "./errors.js";
