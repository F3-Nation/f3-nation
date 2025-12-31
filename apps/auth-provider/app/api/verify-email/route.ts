import { NextRequest, NextResponse } from 'next/server';
import { verifyEmailCode } from '@/lib/mfa';

export async function POST(request: NextRequest) {
  try {
    let email: string, code: string;

    try {
      // Check if request has a body
      const contentLength = request.headers.get('content-length');
      if (!contentLength || contentLength === '0') {
        return NextResponse.json({ error: 'Request body is required' }, { status: 400 });
      }

      const body = await request.json();
      email = body.email;
      code = body.code;
    } catch (jsonError) {
      console.error('JSON parsing error:', jsonError);
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (!email || !code) {
      return NextResponse.json(
        { error: 'Email and verification code are required' },
        { status: 400 }
      );
    }

    // Verify the code via the MFA service (but don't consume it yet)
    console.log('Attempting to verify email code for:', email);

    const isValid = await verifyEmailCode(email, code, false); // Don't consume the code yet

    if (!isValid) {
      console.log('Email verification failed for:', email);
      return NextResponse.json({ error: 'Invalid verification code' }, { status: 400 });
    }

    console.log('Email verification successful for:', email);

    // Allow email authentication for all users (existing or new)
    return NextResponse.json({
      success: true,
      canSignIn: true,
    });
  } catch (error) {
    console.error('Verify email API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
