import { NextResponse } from 'next/server';
import { BUILD_VERSION, BUILD_DATE, BUILD_DESCRIPTION, BUILD_FEATURES } from '@/lib/version';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    buildVersion: `BUILD ${BUILD_VERSION}`,
    timestamp: BUILD_DATE,
    description: BUILD_DESCRIPTION,
    features: BUILD_FEATURES
  });
}