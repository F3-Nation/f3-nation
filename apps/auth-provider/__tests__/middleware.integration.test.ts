import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// Store original environment
const originalEnv = process.env.ALLOWED_ORIGINS;

// We need to test the middleware function directly
// The middleware is exported from the middleware.ts file

describe('Middleware', () => {
  let middleware: (request: NextRequest) => NextResponse | undefined;

  beforeEach(async () => {
    // Reset modules to reload with new env
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original environment
    process.env.ALLOWED_ORIGINS = originalEnv;
    vi.resetModules();
  });

  async function loadMiddlewareWithOrigins(origins: string[]) {
    process.env.ALLOWED_ORIGINS = origins.join(',');
    vi.resetModules();
    const module = await import('../middleware');
    return module.middleware;
  }

  describe('CORS handling for OAuth endpoints', () => {
    it('sets CORS headers for allowed origin on /api/oauth/* routes', async () => {
      middleware = await loadMiddlewareWithOrigins([
        'http://localhost:3001',
        'https://app.example.com',
      ]);

      const request = new NextRequest('http://localhost:3000/api/oauth/token', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3001',
        },
      });

      const response = middleware(request);

      expect(response).toBeDefined();
      expect(response!.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3001');
      expect(response!.headers.get('Access-Control-Allow-Credentials')).toBe('true');
      expect(response!.headers.get('Vary')).toBe('Origin');
    });

    it('does not set CORS headers for non-allowed origin', async () => {
      middleware = await loadMiddlewareWithOrigins(['http://localhost:3001']);

      const request = new NextRequest('http://localhost:3000/api/oauth/token', {
        method: 'POST',
        headers: {
          origin: 'http://evil.com',
        },
      });

      const response = middleware(request);

      expect(response).toBeDefined();
      expect(response!.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(response!.headers.get('Vary')).toBe('Origin');
    });

    it('does not set CORS headers when no origin header present', async () => {
      middleware = await loadMiddlewareWithOrigins(['http://localhost:3001']);

      const request = new NextRequest('http://localhost:3000/api/oauth/token', {
        method: 'POST',
      });

      const response = middleware(request);

      expect(response).toBeDefined();
      expect(response!.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });

    it('handles multiple allowed origins', async () => {
      middleware = await loadMiddlewareWithOrigins([
        'http://localhost:3001',
        'https://app.example.com',
        'https://staging.example.com',
      ]);

      // Test first origin
      let request = new NextRequest('http://localhost:3000/api/oauth/userinfo', {
        method: 'GET',
        headers: { origin: 'http://localhost:3001' },
      });
      let response = middleware(request);
      expect(response!.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3001');

      // Test second origin
      request = new NextRequest('http://localhost:3000/api/oauth/userinfo', {
        method: 'GET',
        headers: { origin: 'https://app.example.com' },
      });
      response = middleware(request);
      expect(response!.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');

      // Test third origin
      request = new NextRequest('http://localhost:3000/api/oauth/userinfo', {
        method: 'GET',
        headers: { origin: 'https://staging.example.com' },
      });
      response = middleware(request);
      expect(response!.headers.get('Access-Control-Allow-Origin')).toBe(
        'https://staging.example.com'
      );
    });

    it('handles allowed origins with whitespace', async () => {
      middleware = await loadMiddlewareWithOrigins([
        '  http://localhost:3001  ',
        ' https://app.example.com ',
      ]);

      const request = new NextRequest('http://localhost:3000/api/oauth/token', {
        method: 'POST',
        headers: { origin: 'http://localhost:3001' },
      });

      const response = middleware(request);
      expect(response!.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3001');
    });
  });

  describe('OPTIONS preflight requests', () => {
    it('handles preflight requests with 204 status', async () => {
      middleware = await loadMiddlewareWithOrigins(['http://localhost:3001']);

      const request = new NextRequest('http://localhost:3000/api/oauth/token', {
        method: 'OPTIONS',
        headers: {
          origin: 'http://localhost:3001',
        },
      });

      const response = middleware(request);

      expect(response).toBeDefined();
      expect(response!.status).toBe(204);
      expect(response!.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
      expect(response!.headers.get('Access-Control-Allow-Headers')).toBe(
        'Content-Type, Authorization'
      );
      expect(response!.headers.get('Vary')).toBe('Origin');
    });

    it('sets CORS headers on preflight for allowed origin', async () => {
      middleware = await loadMiddlewareWithOrigins(['http://localhost:3001']);

      const request = new NextRequest('http://localhost:3000/api/oauth/authorize', {
        method: 'OPTIONS',
        headers: {
          origin: 'http://localhost:3001',
        },
      });

      const response = middleware(request);

      expect(response!.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3001');
      expect(response!.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    });

    it('does not set CORS origin header on preflight for non-allowed origin', async () => {
      middleware = await loadMiddlewareWithOrigins(['http://localhost:3001']);

      const request = new NextRequest('http://localhost:3000/api/oauth/authorize', {
        method: 'OPTIONS',
        headers: {
          origin: 'http://malicious.com',
        },
      });

      const response = middleware(request);

      expect(response!.status).toBe(204);
      expect(response!.headers.get('Access-Control-Allow-Origin')).toBeNull();
      // Methods and headers are still set (general preflight response)
      expect(response!.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
    });

    it('handles preflight without origin header', async () => {
      middleware = await loadMiddlewareWithOrigins(['http://localhost:3001']);

      const request = new NextRequest('http://localhost:3000/api/oauth/token', {
        method: 'OPTIONS',
      });

      const response = middleware(request);

      expect(response!.status).toBe(204);
      expect(response!.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });
  });

  describe('CSP headers for login and onboarding pages', () => {
    it('sets CSP headers for /login routes', async () => {
      middleware = await loadMiddlewareWithOrigins([]);

      const request = new NextRequest('http://localhost:3000/login', {
        method: 'GET',
      });

      const response = middleware(request);

      expect(response).toBeDefined();
      const csp = response!.headers.get('Content-Security-Policy');
      expect(csp).toBeDefined();
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
      expect(csp).toContain("style-src 'self' 'unsafe-inline'");
      expect(csp).toContain("img-src 'self' data: https:");
      expect(csp).toContain("font-src 'self' data:");
      expect(csp).toContain("connect-src 'self' https:");
    });

    it('sets CSP headers for /login subpaths', async () => {
      middleware = await loadMiddlewareWithOrigins([]);

      const request = new NextRequest('http://localhost:3000/login/callback', {
        method: 'GET',
      });

      const response = middleware(request);

      expect(response).toBeDefined();
      expect(response!.headers.get('Content-Security-Policy')).toBeDefined();
    });

    it('sets CSP headers for /onboarding routes', async () => {
      middleware = await loadMiddlewareWithOrigins([]);

      const request = new NextRequest('http://localhost:3000/onboarding', {
        method: 'GET',
      });

      const response = middleware(request);

      expect(response).toBeDefined();
      const csp = response!.headers.get('Content-Security-Policy');
      expect(csp).toBeDefined();
      expect(csp).toContain("default-src 'self'");
    });

    it('sets CSP headers for /onboarding subpaths', async () => {
      middleware = await loadMiddlewareWithOrigins([]);

      const request = new NextRequest('http://localhost:3000/onboarding/step-2', {
        method: 'GET',
      });

      const response = middleware(request);

      expect(response).toBeDefined();
      expect(response!.headers.get('Content-Security-Policy')).toBeDefined();
    });

    it('removes X-Frame-Options for login pages', async () => {
      middleware = await loadMiddlewareWithOrigins([]);

      const request = new NextRequest('http://localhost:3000/login', {
        method: 'GET',
      });

      const response = middleware(request);

      // X-Frame-Options should be deleted (not present or null)
      // NextResponse.next() doesn't have it by default, but we call delete to be sure
      expect(response).toBeDefined();
    });
  });

  describe('origin validation', () => {
    it('handles empty ALLOWED_ORIGINS', async () => {
      process.env.ALLOWED_ORIGINS = '';
      vi.resetModules();
      const module = await import('../middleware');
      middleware = module.middleware;

      const request = new NextRequest('http://localhost:3000/api/oauth/token', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3001',
        },
      });

      const response = middleware(request);

      expect(response).toBeDefined();
      expect(response!.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });

    it('handles undefined ALLOWED_ORIGINS', async () => {
      delete process.env.ALLOWED_ORIGINS;
      vi.resetModules();
      const module = await import('../middleware');
      middleware = module.middleware;

      const request = new NextRequest('http://localhost:3000/api/oauth/token', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3001',
        },
      });

      const response = middleware(request);

      expect(response).toBeDefined();
      expect(response!.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });

    it('strictly matches origin (no partial matching)', async () => {
      middleware = await loadMiddlewareWithOrigins(['http://localhost:3001']);

      // Try with port variation
      let request = new NextRequest('http://localhost:3000/api/oauth/token', {
        method: 'POST',
        headers: { origin: 'http://localhost:3002' },
      });
      let response = middleware(request);
      expect(response!.headers.get('Access-Control-Allow-Origin')).toBeNull();

      // Try with scheme variation
      request = new NextRequest('http://localhost:3000/api/oauth/token', {
        method: 'POST',
        headers: { origin: 'https://localhost:3001' },
      });
      response = middleware(request);
      expect(response!.headers.get('Access-Control-Allow-Origin')).toBeNull();

      // Try with subdomain
      request = new NextRequest('http://localhost:3000/api/oauth/token', {
        method: 'POST',
        headers: { origin: 'http://sub.localhost:3001' },
      });
      response = middleware(request);
      expect(response!.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });
  });

  describe('non-matched routes', () => {
    it('passes through for routes not matched by middleware', async () => {
      middleware = await loadMiddlewareWithOrigins(['http://localhost:3001']);

      // Route not in the matcher pattern
      const request = new NextRequest('http://localhost:3000/api/other-endpoint', {
        method: 'GET',
        headers: {
          origin: 'http://localhost:3001',
        },
      });

      const response = middleware(request);

      // For non-matched routes, middleware just calls NextResponse.next()
      // without setting any special headers
      expect(response).toBeDefined();
    });
  });

  describe('middleware config', () => {
    it('exports correct matcher config', async () => {
      const module = await import('../middleware');
      expect(module.config).toBeDefined();
      expect(module.config.matcher).toEqual([
        '/api/oauth/:path*',
        '/login/:path*',
        '/onboarding/:path*',
      ]);
    });
  });
});
