// BOM V2 API — Stage-Based Bill of Materials
// POST /api/engineering/bom-v2

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { handleRouteDbError } from '@/lib/db-neon';
import { generateBOMV2 } from '@/lib/bom-v2-engine';
import { SystemState } from '@/lib/system-state';
import { EngineeringModel } from '@/lib/electrical-calc';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

    const body = await req.json();
    const { systemState, engineeringModel } = body as { systemState: SystemState; engineeringModel?: EngineeringModel };

    if (!systemState) {
      return NextResponse.json({ success: false, error: 'Missing systemState' }, { status: 400 });
    }

    const result = generateBOMV2(systemState, engineeringModel);
    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    return handleRouteDbError('[BOM V2 err]', error);
  }
}