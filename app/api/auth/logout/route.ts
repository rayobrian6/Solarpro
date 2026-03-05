import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth';

export async function POST(req: NextRequest) {
  return NextResponse.json(
    { success: true },
    { headers: { 'Set-Cookie': clearSessionCookie() } }
  );
}