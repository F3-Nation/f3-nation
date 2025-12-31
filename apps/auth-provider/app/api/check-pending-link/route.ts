import { NextResponse } from 'next/server';

// This endpoint is no longer needed since we removed the email linking functionality
export async function POST() {
  return NextResponse.json({
    hasPendingEmailLink: false,
  });
}
