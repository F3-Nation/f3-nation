import { NextRequest, NextResponse } from 'next/server';

// Get allowed origins based on environment
function getAllowedOrigin(request: NextRequest): string {
  const origin = request.headers.get('origin');

  // In development, be more permissive
  if (process.env.NODE_ENV === 'development') {
    if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
      return origin;
    }
    // Default to localhost:3000 for development
    return 'https://localhost:3000';
  }

  // Production origins
  const productionOrigins = ['https://auth.f3nation.com'];

  // Check if origin is allowed
  if (origin && productionOrigins.includes(origin)) {
    return origin;
  }

  // Default to production origin
  return 'https://auth.f3nation.com';
}

// Handle CORS preflight requests
export async function OPTIONS(request: NextRequest) {
  const allowedOrigin = getAllowedOrigin(request);

  // Log for debugging in development
  if (process.env.NODE_ENV === 'development') {
    console.log('OPTIONS request:', {
      origin: request.headers.get('origin'),
      allowedOrigin,
      url: request.url,
    });
  }

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

// Handle GET requests (redirect from OAuth provider)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  const allowedOrigin = getAllowedOrigin(request);

  // Add CORS headers to the response
  const headers = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  // If there's an error parameter, redirect to page with error
  if (error) {
    const url = new URL('/callback', request.url);
    url.searchParams.set('error', error);
    return NextResponse.redirect(url, { headers });
  }

  // If code and state are present, redirect to page route for processing
  if (code && state) {
    const url = new URL('/callback', request.url);
    url.searchParams.set('code', code);
    url.searchParams.set('state', state);
    return NextResponse.redirect(url, { headers });
  }

  // If parameters are missing, redirect to page with error
  const url = new URL('/callback', request.url);
  url.searchParams.set('error', 'missing_parameters');
  return NextResponse.redirect(url, { headers });
}
