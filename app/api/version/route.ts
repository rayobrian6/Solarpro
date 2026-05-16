import { NextResponse } from 'next/server';
import { BUILD_VERSION, BUILD_DATE } from '@/lib/version';
// SECURITY FIX: BUILD_DESCRIPTION and BUILD_FEATURES removed from import —
// they contain internal engineering notes that should not be exposed publicly.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

export async function GET() {
  try {
    return NextResponse.json(
      {
        version: BUILD_VERSION,
        buildVersion: `BUILD ${BUILD_VERSION}`,
        timestamp: BUILD_DATE,
        // SECURITY FIX: Removed description and features fields — BUILD_FEATURES contains
        // detailed internal engineering notes (algorithm names, logic details, component counts)
        // that aid reconnaissance. Version number is sufficient for public consumers.
        ts: Date.now(),
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      }
    );
  } catch (err: unknown) {
    console.error(`[API_ERROR] /api/version: ${(err as Error).message}`);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}