import type { NextRequest } from 'next/server';

/**
 * Build a minimal NextRequest stand-in carrying just what the middleware reads:
 * the Host header and the parsed URL path + query.
 */
function mockRequest(
  host: string | null,
  pathname: string,
  search = ''
): NextRequest {
  return {
    headers: {
      get: (key: string) => (key.toLowerCase() === 'host' ? host : null),
    },
    nextUrl: { pathname, search },
  } as unknown as NextRequest;
}

/**
 * Load the middleware fresh with NEXT_PUBLIC_CANONICAL_HOST set to `canonical`
 * (or unset when null). The module reads the env var at import time, so each
 * scenario needs an isolated module registry.
 */
function loadMiddleware(canonical: string | null) {
  let mw!: (req: NextRequest) => Response;
  jest.isolateModules(() => {
    if (canonical === null) {
      delete process.env.NEXT_PUBLIC_CANONICAL_HOST;
    } else {
      process.env.NEXT_PUBLIC_CANONICAL_HOST = canonical;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mw = require('./middleware').middleware;
  });
  return mw;
}

describe('canonical-host middleware', () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_CANONICAL_HOST;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_CANONICAL_HOST;
    else process.env.NEXT_PUBLIC_CANONICAL_HOST = ORIGINAL;
  });

  it('is inert (no redirect) when NEXT_PUBLIC_CANONICAL_HOST is unset', () => {
    const middleware = loadMiddleware(null);
    const res = middleware(mockRequest('f3regions.com', '/charlotte'));
    expect(res.status).not.toBe(308);
    expect(res.headers.get('location')).toBeNull();
  });

  it('passes through requests already on the canonical host', () => {
    const middleware = loadMiddleware('regions.f3nation.com');
    const res = middleware(
      mockRequest('regions.f3nation.com', '/charlotte', '?a=1')
    );
    expect(res.status).not.toBe(308);
    expect(res.headers.get('location')).toBeNull();
  });

  it('308-redirects a non-canonical host to the canonical host, preserving path + query', () => {
    const middleware = loadMiddleware('regions.f3nation.com');
    const res = middleware(mockRequest('f3regions.com', '/charlotte', '?a=1'));
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe(
      'https://regions.f3nation.com/charlotte?a=1'
    );
  });

  it('compares hostname only, ignoring the port (local dev)', () => {
    const middleware = loadMiddleware('regions.f3nation.com');
    const res = middleware(mockRequest('regions.f3nation.com:3000', '/', ''));
    expect(res.status).not.toBe(308);
  });

  it('does not redirect when the Host header is absent', () => {
    const middleware = loadMiddleware('regions.f3nation.com');
    const res = middleware(mockRequest(null, '/charlotte'));
    expect(res.status).not.toBe(308);
  });
});
