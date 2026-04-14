/**
 * Direct-to-LB SNI probe (R5 Decision 4).
 *
 * This is the architectural centerpiece of R5. The probe MUST NOT resolve
 * public DNS for the tenant hostname — the whole point of this rewrite is
 * that R4's probe did exactly that and certified the old stack.
 *
 * Flow:
 *   1. Open a raw TCP connection to the LB's static IPv4 on port 443.
 *      The IPv4 is a known config value (Terraform output), passed in
 *      as `targetIp`.
 *   2. Initiate a TLS handshake via `tls.connect()` with:
 *        - `host` = targetIp                (no DNS lookup — numeric)
 *        - `servername` = tenant hostname   (SNI + certificate name check)
 *        - `rejectUnauthorized: true`       (full cert validation)
 *   3. On `secureConnect`, immediately write a minimal HTTP/1.1 GET /health
 *      request to the already-established socket (Host header = hostname).
 *   4. Read response, require HTTP/1.1 200 OK + x-redirect-platform: ok.
 *   5. Extract cert serial and expiry from the peer cert for logging.
 *   6. Resolve with a structured result; reject only on programming errors.
 *
 * The probe has a hard timeout (default 10s). Retry loops are deliberately
 * NOT implemented here — the reconciler retries at the cycle level.
 */

import { connect as tlsConnect } from "node:tls";
import type { TLSSocket, ConnectionOptions } from "node:tls";

/** Default `tls.connect` wrapper constrained to the single options-object signature. */
function defaultTlsConnect(options: ConnectionOptions): TLSSocket {
  return tlsConnect(options);
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SniProbeInput {
  /** LB static IPv4 (e.g. from Terraform output `lb_ipv4_address`). */
  targetIp: string;
  /** LB port. Defaults to 443. */
  targetPort?: number;
  /** Tenant hostname — passed as SNI servername and Host header. */
  hostname: string;
  /** Hard timeout for the entire probe in ms. Defaults to 10000. */
  timeoutMs?: number;
  /**
   * Test seam — replaces `tls.connect`. Production code leaves this
   * undefined and uses the real Node TLS stack. The shape is a single
   * options-object signature (narrower than the `tls.connect` overload
   * set) so call sites can delegate cleanly.
   */
  tlsConnectFn?: (options: ConnectionOptions) => TLSSocket;
}

export interface SniProbeCertDetail {
  serialNumber: string | null;
  validFrom: string | null;
  validTo: string | null;
  subjectCN: string | null;
  issuerCN: string | null;
}

export interface SniProbeResult {
  handshake_ok: boolean;
  http_status: number | null;
  cert: SniProbeCertDetail | null;
  latency_ms: number;
  redirect_platform_header_ok: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const REQUIRED_HEADER_NAME = "x-redirect-platform";
const REQUIRED_HEADER_VALUE = "ok";

function formatHttpRequest(hostname: string): string {
  return (
    `GET /health HTTP/1.1\r\n` +
    `Host: ${hostname}\r\n` +
    `User-Agent: redirect-platform-reconciler/1.0\r\n` +
    `Connection: close\r\n` +
    `Accept: */*\r\n` +
    `\r\n`
  );
}

interface ParsedHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Minimal HTTP/1.1 response parser — just enough to read status code,
 * headers (lowercased), and body. Not a general-purpose parser.
 */
export function parseHttpResponse(raw: string): ParsedHttpResponse | null {
  const headerEnd = raw.indexOf("\r\n\r\n");
  if (headerEnd < 0) return null;
  const head = raw.slice(0, headerEnd);
  const body = raw.slice(headerEnd + 4);
  const lines = head.split("\r\n");
  const statusLine = lines[0];
  if (!statusLine) return null;
  const statusMatch = /^HTTP\/1\.[01]\s+(\d{3})/.exec(statusLine);
  if (!statusMatch?.[1]) return null;
  const status = Number.parseInt(statusMatch[1], 10);
  const headers: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).toLowerCase();
    const value = line.slice(colon + 1).trim();
    headers[key] = value;
  }
  return { status, headers, body };
}

/**
 * Extract the narrow cert-detail projection from a TLS peer certificate.
 * Returns null if no cert is present or all fields are unavailable.
 */
function projectPeerCert(socket: TLSSocket): SniProbeCertDetail | null {
  // getPeerCertificate returns an object where every field may be missing.
  const raw = socket.getPeerCertificate(false) as
    | {
        serialNumber?: string;
        valid_from?: string;
        valid_to?: string;
        subject?: { CN?: string };
        issuer?: { CN?: string };
      }
    | undefined;
  if (!raw || Object.keys(raw).length === 0) {
    return null;
  }
  return {
    serialNumber: raw.serialNumber ?? null,
    validFrom: raw.valid_from ?? null,
    validTo: raw.valid_to ?? null,
    subjectCN: raw.subject?.CN ?? null,
    issuerCN: raw.issuer?.CN ?? null,
  };
}

/**
 * Run one SNI probe. Resolves with a structured result regardless of
 * success or failure. Never rejects.
 */
export function runSniProbe(input: SniProbeInput): Promise<SniProbeResult> {
  const {
    targetIp,
    targetPort = 443,
    hostname,
    timeoutMs = 10_000,
    tlsConnectFn = defaultTlsConnect,
  } = input;

  return new Promise<SniProbeResult>((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    let handshakeOk = false;
    let cert: SniProbeCertDetail | null = null;
    let responseBuf = "";

    function settle(result: Omit<SniProbeResult, "latency_ms">): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {
        // socket may already be destroyed; ignore
      }
      resolve({
        ...result,
        latency_ms: Date.now() - startedAt,
      });
    }

    const timer = setTimeout(() => {
      settle({
        handshake_ok: handshakeOk,
        http_status: null,
        cert,
        redirect_platform_header_ok: false,
        error: `probe timed out after ${String(timeoutMs)}ms`,
      });
    }, timeoutMs);

    const options: ConnectionOptions = {
      host: targetIp,
      port: targetPort,
      servername: hostname,
      rejectUnauthorized: true,
      // Use the system trust store (default in Node 20+ with a system ca
      // bundle; for production containers we rely on the standard bundle).
      ALPNProtocols: ["http/1.1"],
      // Disable session resumption so each probe exercises a full handshake.
      session: undefined,
    };

    const socket: TLSSocket = tlsConnectFn(options);

    socket.once("secureConnect", () => {
      handshakeOk = true;
      cert = projectPeerCert(socket);
      // Write the HTTP request; if the peer closes on us before we finish
      // writing, the 'error' handler will fire.
      try {
        socket.write(formatHttpRequest(hostname));
      } catch (writeErr) {
        settle({
          handshake_ok: true,
          http_status: null,
          cert,
          redirect_platform_header_ok: false,
          error: `socket write failed: ${String(writeErr)}`,
        });
      }
    });

    socket.on("data", (chunk: Buffer) => {
      responseBuf += chunk.toString("utf8");
    });

    socket.on("end", () => {
      const parsed = parseHttpResponse(responseBuf);
      if (!parsed) {
        settle({
          handshake_ok: handshakeOk,
          http_status: null,
          cert,
          redirect_platform_header_ok: false,
          error: "could not parse HTTP response",
        });
        return;
      }
      const headerOk =
        parsed.headers[REQUIRED_HEADER_NAME] === REQUIRED_HEADER_VALUE;
      settle({
        handshake_ok: handshakeOk,
        http_status: parsed.status,
        cert,
        redirect_platform_header_ok: headerOk,
        error: null,
      });
    });

    socket.on("error", (err: Error) => {
      settle({
        handshake_ok: handshakeOk,
        http_status: null,
        cert,
        redirect_platform_header_ok: false,
        error: `${err.name}: ${err.message}`,
      });
    });

    socket.on("close", () => {
      // Fallback: if the socket closed without 'end' emitting and we have
      // any response bytes, try to parse them. If we already settled, this
      // is a no-op.
      if (settled) return;
      if (responseBuf.length > 0) {
        const parsed = parseHttpResponse(responseBuf);
        if (parsed) {
          settle({
            handshake_ok: handshakeOk,
            http_status: parsed.status,
            cert,
            redirect_platform_header_ok:
              parsed.headers[REQUIRED_HEADER_NAME] === REQUIRED_HEADER_VALUE,
            error: null,
          });
          return;
        }
      }
      settle({
        handshake_ok: handshakeOk,
        http_status: null,
        cert,
        redirect_platform_header_ok: false,
        error: "socket closed without complete response",
      });
    });
  });
}

/**
 * Convenience: is a probe result "successful" by the Decision 4 criteria?
 * Handshake OK, HTTP 200, required header present.
 */
export function isSniProbeSuccess(result: SniProbeResult): boolean {
  return (
    result.handshake_ok &&
    result.http_status === 200 &&
    result.redirect_platform_header_ok
  );
}
