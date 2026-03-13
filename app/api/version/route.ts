import { NextResponse } from 'next/server';
import { BUILD_VERSION, BUILD_DATE, BUILD_DESCRIPTION, BUILD_FEATURES } from '@/lib/version';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

export async function GET() {
  return NextResponse.json(
    {
      version: BUILD_VERSION,
      buildVersion: `BUILD ${BUILD_VERSION}`,
      timestamp: BUILD_DATE,
      description: BUILD_DESCRIPTION,
      features: BUILD_FEATURES,
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
}