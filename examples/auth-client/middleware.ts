import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  // Handle CORS for callback routes
  if (
    request.nextUrl.pathname.startsWith('/callback') ||
    request.nextUrl.pathname.startsWith('/api/callback')
  ) {
    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      const allowedOrigin =
        process.env.NODE_ENV === 'development'
          ? 'https://localhost:3000'
          : 'https://auth.f3nation.com';

      return new NextResponse(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': allowedOrigin,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Add CORS headers to all callback responses
    const response = NextResponse.next();
    const allowedOrigin =
      process.env.NODE_ENV === 'development'
        ? 'https://localhost:3000'
        : 'https://auth.f3nation.com';

    response.headers.set('Access-Control-Allow-Origin', allowedOrigin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/callback/:path*', '/api/callback/:path*'],
};
