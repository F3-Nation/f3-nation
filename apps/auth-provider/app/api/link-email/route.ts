import { NextResponse } from 'next/server';

// This endpoint is no longer needed since we removed the email linking functionality
export async function POST() {
  return NextResponse.json({ error: 'Email linking is no longer supported' }, { status: 410 });
}

export async function DELETE() {
  return NextResponse.json({ error: 'Email linking is no longer supported' }, { status: 410 });
}
