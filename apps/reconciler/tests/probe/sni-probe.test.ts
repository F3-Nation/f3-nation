/**
 * SNI probe unit tests.
 *
 * The probe is the architectural centerpiece of R5 Decision 4. These tests
 * stand up an in-process TLS server using `tls.createServer` with a
 * self-signed cert whose subject/SAN matches a synthetic hostname, then
 * point the probe at 127.0.0.1 with SNI = the synthetic hostname. That
 * exercises the real TLS handshake code path end-to-end.
 *
 * CRITICAL: these tests MUST NOT resolve public DNS for the tenant
 * hostname. The probe always dials the numeric IP passed via `targetIp`;
 * the hostname is only used for SNI + Host header + TLS cert validation.
 * If any of these tests ever required an internet connection the probe
 * was implemented wrong and the R5 rewrite's whole justification is gone.
 */

import type { AddressInfo } from "node:net";
import {
  connect as tlsConnect,
  createServer as createTlsServer,
} from "node:tls";
import type { ConnectionOptions, TLSSocket } from "node:tls";
import type { Server as TlsServer } from "node:tls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generate as generateSelfSigned } from "selfsigned";

import {
  isSniProbeSuccess,
  parseHttpResponse,
  runSniProbe,
} from "../../src/probe/sni-probe.js";

const TEST_HOSTNAME = "probe-test.internal";

interface TestServer {
  server: TlsServer;
  port: number;
  caPem: string;
  /** Replace the current request handler for a single test. */
  setHandler: (handler: RequestHandler) => void;
}

type RequestHandler = (
  socket: TLSSocket,
  requestLine: string,
  headers: Record<string, string>,
) => void;

const sharedServer: { instance: TestServer | null } = { instance: null };

async function startTlsServer(): Promise<TestServer> {
  const pems = await generateSelfSigned(
    [{ name: "commonName", value: TEST_HOSTNAME }],
    {
      algorithm: "sha256",
      keySize: 2048,
      extensions: [
        {
          name: "subjectAltName",
          altNames: [
            { type: 2, value: TEST_HOSTNAME },
            { type: 7, ip: "127.0.0.1" },
          ],
        },
      ],
    },
  );
  let currentHandler: RequestHandler = defaultHandler;
  const server = createTlsServer(
    {
      key: pems.private,
      cert: pems.cert,
      ca: [pems.cert],
    },
    (socket) => {
      handleSocket(socket, () => currentHandler);
    },
  );
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const addr = server.address() as AddressInfo;
  return {
    server,
    port: addr.port,
    caPem: pems.cert,
    setHandler(handler) {
      currentHandler = handler;
    },
  };
}

function handleSocket(
  socket: TLSSocket,
  getHandler: () => RequestHandler,
): void {
  let buffer = "";
  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;
    const headSection = buffer.slice(0, headerEnd);
    const lines = headSection.split("\r\n");
    const requestLine = lines[0] ?? "";
    const headers: Record<string, string> = {};
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      headers[line.slice(0, colon).toLowerCase()] = line
        .slice(colon + 1)
        .trim();
    }
    try {
      getHandler()(socket, requestLine, headers);
    } catch (err) {
      try {
        socket.end();
      } catch {
        // ignore
      }
      throw err;
    }
  });
  socket.on("error", () => {
    // swallow — client test asserts on its own result
  });
}

function defaultHandler(
  socket: TLSSocket,
  _requestLine: string,
  _headers: Record<string, string>,
): void {
  const body = "ok";
  const response =
    `HTTP/1.1 200 OK\r\n` +
    `Content-Type: text/plain\r\n` +
    `Content-Length: ${String(body.length)}\r\n` +
    `x-redirect-platform: ok\r\n` +
    `Connection: close\r\n` +
    `\r\n` +
    body;
  socket.end(response);
}

beforeAll(async () => {
  sharedServer.instance = await startTlsServer();
});

afterAll(async () => {
  const inst = sharedServer.instance;
  if (inst) {
    await new Promise<void>((resolve, reject) =>
      inst.server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

/**
 * Probe helper — wires the probe to 127.0.0.1 with the test CA trusted
 * via `NODE_EXTRA_CA_CERTS`... we can't mutate envs inside the process
 * cleanly. Instead we inject a custom `tlsConnectFn` that adds the `ca`
 * option to the TLS ConnectionOptions before delegating to the real
 * `tls.connect`. This is NOT hand-mocking the handshake — it's adding a
 * trust-store override so the system trust store doesn't fail validation.
 */
function probeWithTestCa(
  hostname: string,
  overrides: { port?: number } = {},
): ReturnType<typeof runSniProbe> {
  const inst = sharedServer.instance;
  if (!inst) throw new Error("sharedServer not started");
  return runSniProbe({
    targetIp: "127.0.0.1",
    targetPort: overrides.port ?? inst.port,
    hostname,
    timeoutMs: 3_000,
    tlsConnectFn: (options: ConnectionOptions): TLSSocket =>
      tlsConnect({ ...options, ca: [inst.caPem] }),
  });
}

describe("parseHttpResponse", () => {
  it("parses status, headers, body", () => {
    const raw =
      "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nx-redirect-platform: ok\r\n\r\nhello";
    const parsed = parseHttpResponse(raw);
    expect(parsed?.status).toBe(200);
    expect(parsed?.headers["x-redirect-platform"]).toBe("ok");
    expect(parsed?.body).toBe("hello");
  });

  it("returns null on malformed input", () => {
    expect(parseHttpResponse("not an http response")).toBeNull();
  });
});

describe("runSniProbe — happy path", () => {
  it("succeeds when cert matches SNI and handler returns 200 + header", async () => {
    sharedServer.instance?.setHandler(defaultHandler);
    const result = await probeWithTestCa(TEST_HOSTNAME);
    expect(result.handshake_ok).toBe(true);
    expect(result.http_status).toBe(200);
    expect(result.redirect_platform_header_ok).toBe(true);
    expect(result.cert).not.toBeNull();
    expect(result.cert?.subjectCN).toBe(TEST_HOSTNAME);
    expect(result.error).toBeNull();
    expect(isSniProbeSuccess(result)).toBe(true);
  });

  it("records latency_ms as a non-negative integer", async () => {
    sharedServer.instance?.setHandler(defaultHandler);
    const result = await probeWithTestCa(TEST_HOSTNAME);
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });
});

describe("runSniProbe — TLS failure", () => {
  it("fails when SNI does not match the cert (rejectUnauthorized)", async () => {
    sharedServer.instance?.setHandler(defaultHandler);
    const result = await probeWithTestCa("not-the-test-hostname.example");
    expect(result.handshake_ok).toBe(false);
    expect(result.http_status).toBeNull();
    expect(result.error).not.toBeNull();
    expect(isSniProbeSuccess(result)).toBe(false);
  });
});

describe("runSniProbe — HTTP failure", () => {
  it("fails when handler returns 404", async () => {
    sharedServer.instance?.setHandler((socket) => {
      const body = "not found";
      socket.end(
        `HTTP/1.1 404 Not Found\r\nContent-Length: ${String(body.length)}\r\n\r\n${body}`,
      );
    });
    const result = await probeWithTestCa(TEST_HOSTNAME);
    expect(result.handshake_ok).toBe(true);
    expect(result.http_status).toBe(404);
    expect(result.redirect_platform_header_ok).toBe(false);
    expect(isSniProbeSuccess(result)).toBe(false);
  });

  it("fails when x-redirect-platform header is missing", async () => {
    sharedServer.instance?.setHandler((socket) => {
      const body = "ok";
      socket.end(
        `HTTP/1.1 200 OK\r\nContent-Length: ${String(body.length)}\r\n\r\n${body}`,
      );
    });
    const result = await probeWithTestCa(TEST_HOSTNAME);
    expect(result.handshake_ok).toBe(true);
    expect(result.http_status).toBe(200);
    expect(result.redirect_platform_header_ok).toBe(false);
    expect(isSniProbeSuccess(result)).toBe(false);
  });
});

describe("runSniProbe — timeout", () => {
  it("times out when the server never responds", async () => {
    sharedServer.instance?.setHandler(() => {
      // hang on purpose — do not write anything
    });
    const inst = sharedServer.instance;
    if (!inst) throw new Error("no server");
    const result = await runSniProbe({
      targetIp: "127.0.0.1",
      targetPort: inst.port,
      hostname: TEST_HOSTNAME,
      timeoutMs: 500,
      tlsConnectFn: (options) => {
        return tlsConnect({ ...options, ca: [inst.caPem] });
      },
    });
    expect(result.handshake_ok).toBe(true);
    expect(result.http_status).toBeNull();
    expect(result.error).toContain("timed out");
  });
});

describe("runSniProbe — concurrency", () => {
  it("two concurrent probes do not interfere", async () => {
    sharedServer.instance?.setHandler(defaultHandler);
    const [a, b] = await Promise.all([
      probeWithTestCa(TEST_HOSTNAME),
      probeWithTestCa(TEST_HOSTNAME),
    ]);
    expect(isSniProbeSuccess(a)).toBe(true);
    expect(isSniProbeSuccess(b)).toBe(true);
  });
});

describe("runSniProbe — no public DNS resolution (R5 Decision 4 invariant)", () => {
  it("passes the numeric targetIp as `host` and the hostname only as `servername`", async () => {
    // The whole R5 rewrite hinges on the probe NEVER resolving public DNS
    // for the tenant hostname. We prove this by inspecting the exact
    // ConnectionOptions the probe hands to tlsConnectFn:
    //   - options.host MUST be the numeric IP we passed in
    //   - options.servername MUST be the tenant hostname
    // Node's tls.connect with a numeric `host` skips dns.lookup entirely.
    sharedServer.instance?.setHandler(defaultHandler);
    const inst = sharedServer.instance;
    if (!inst) throw new Error("no server");
    let capturedHost: string | undefined;
    let capturedServername: string | undefined;
    const result = await runSniProbe({
      targetIp: "127.0.0.1",
      targetPort: inst.port,
      hostname: TEST_HOSTNAME,
      timeoutMs: 3_000,
      tlsConnectFn: (options: ConnectionOptions): TLSSocket => {
        capturedHost = options.host;
        capturedServername = options.servername;
        return tlsConnect({ ...options, ca: [inst.caPem] });
      },
    });
    expect(capturedHost).toBe("127.0.0.1");
    expect(capturedServername).toBe(TEST_HOSTNAME);
    // Must be numeric — regex enforces IPv4 dotted-quad so an accidental
    // hostname substitution would fail this assertion.
    expect(capturedHost).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(isSniProbeSuccess(result)).toBe(true);
  });
});
