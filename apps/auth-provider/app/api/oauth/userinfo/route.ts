import { NextRequest, NextResponse } from 'next/server';
import { validateAccessToken, getUserInfo } from '@/lib/oauth';
import { oauthClientRepository } from '@/db';

interface TokenData {
  userId: number;
  clientId: string;
  scopes: string[];
}

// Add CORS headers
async function addCorsHeaders(
  response: NextResponse,
  origin: string | null,
  clientId?: string,
  isOptions = false
) {
  // Always set CORS headers for OPTIONS requests
  if (isOptions && origin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    return response;
  }

  // For non-OPTIONS requests, validate against client config
  if (origin && clientId) {
    const client = await oauthClientRepository.findById(clientId);
    if (client && origin === client.allowedOrigin) {
      response.headers.set('Access-Control-Allow-Origin', client.allowedOrigin);
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      response.headers.set('Access-Control-Allow-Credentials', 'true');
    }
  }
  return response;
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('Origin');
  return await addCorsHeaders(new NextResponse(null, { status: 200 }), origin, undefined, true);
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get('Origin');
  try {
    // Extract access token from Authorization header
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return await addCorsHeaders(
        NextResponse.json(
          {
            error: 'invalid_request',
            error_description: 'Missing or invalid Authorization header',
          },
          { status: 401 }
        ),
        origin
      );
    }

    const accessToken = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Validate access token
    const tokenData: TokenData | null = await validateAccessToken(accessToken);
    if (!tokenData) {
      return await addCorsHeaders(
        NextResponse.json(
          { error: 'invalid_token', error_description: 'Invalid or expired access token' },
          { status: 401 }
        ),
        origin,
        undefined
      );
    }

    // Get user info based on token scopes
    const userInfo = await getUserInfo(tokenData.userId, tokenData.scopes);
    if (!userInfo) {
      return await addCorsHeaders(
        NextResponse.json(
          { error: 'server_error', error_description: 'User not found' },
          { status: 500 }
        ),
        origin
      );
    }

    return await addCorsHeaders(NextResponse.json(userInfo), origin, tokenData.clientId);
  } catch (error) {
    console.error('OAuth userinfo error:', error);
    return await addCorsHeaders(
      NextResponse.json(
        { error: 'server_error', error_description: 'Internal server error' },
        { status: 500 }
      ),
      origin
    );
  }
}

export async function POST(request: NextRequest) {
  // Support POST method as well (some OAuth implementations use POST)
  return GET(request);
}
