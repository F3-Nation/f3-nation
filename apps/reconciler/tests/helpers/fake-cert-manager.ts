/**
 * Test helper: build a fake CertManagerClient with sensible default stubs.
 *
 * Every method is overridable. Defaults:
 *   - resource-path helpers return `<prefix>-<id>`
 *   - get* methods return null / throw "not used" for required paths
 *   - create/delete methods resolve to void
 *   - list* methods return empty arrays
 *
 * Tests override only the methods they need. Used by ops 5–8 tests and
 * the dispatcher test; earlier ops 1–4 tests keep their inline stubs.
 */

import type {
  CertificateView,
  CertificateMapEntryView,
  CertManagerClient,
  DnsAuthorizationView,
} from "../../src/gcp/cert-manager-client.js";

export function createFakeCertManager(
  overrides: Partial<CertManagerClient> = {},
): CertManagerClient {
  const notUsed = (name: string) => () =>
    Promise.reject(new Error(`CertManagerClient.${name} not mocked`));

  const base: CertManagerClient = {
    dnsAuthorizationResourcePath: (id: string) => `dns-auth-path-${id}`,
    certificateResourcePath: (id: string) => `cert-path-${id}`,
    certificateMapEntryResourcePath: (id: string) => `cme-path-${id}`,
    getDnsAuthorization: async () => null,
    getCertificate: notUsed("getCertificate") as () => Promise<CertificateView>,
    getCertificateView: async () => null,
    createCertificate: async () => {},
    deleteCertificate: async () => {},
    getCertificateMapEntry: async () => null,
    createCertificateMapEntry: async () => {},
    deleteCertificateMapEntry: async () => {},
    deleteDnsAuthorization: async () => {},
    listDnsAuthorizations: async (): Promise<DnsAuthorizationView[]> => [],
    listCertificates: async (): Promise<CertificateView[]> => [],
    listCertificateMapEntries: async (): Promise<
      CertificateMapEntryView[]
    > => [],
  };
  return { ...base, ...overrides };
}
