import { NextRequest, NextResponse } from 'next/server';
import { createEmailVerification } from '@/lib/mfa';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // Check database connection is configured
    if (!process.env.DATABASE_URL) {
      console.error('DATABASE_URL environment variable is not set');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const body = await request.json();
    const { email, callbackUrl } = body;

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    const resolvedCallbackUrl = callbackUrl || '/';

    console.log('Sending verification email to:', email);
    await createEmailVerification(email, resolvedCallbackUrl);
    console.log('Verification email sent successfully to:', email);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error sending verification email:', error);
    if (error instanceof Error) {
      console.error('Error stack:', error.stack);
    }
    return NextResponse.json(
      { error: 'Failed to send verification email. Please try again.' },
      { status: 500 }
    );
  }
}
