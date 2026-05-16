import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, getDbReady } from '@/lib/auth';
import { handleRouteDbError } from '@/lib/db-neon';
import { generateDynamicSLG } from '@/lib/engineering-automation';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    // v48.6: Rate limiting — 10 req / 30s per IP (protects heavy compute + external APIs)
        const _rl = await checkRateLimit('engineering', getClientIp(req));
    if (!_rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Please slow down.' },
        { status: 429 }
      );
    }

    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const body = await req.json();
    const {
      projectId,
      inverterACOutput,
      moduleCount,
      arrayTilt = 20,
      systemCapacityKw,
    } = body;

    if (!projectId || !inverterACOutput || !moduleCount || !systemCapacityKw) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // SECURITY: Validate numeric inputs — prevent NaN/Infinity from reaching calculation engine
    const acOut = Number(inverterACOutput);
    const modCt = Number(moduleCount);
    const tilt   = Number(arrayTilt);
    const capKw  = Number(systemCapacityKw);
    if (!Number.isFinite(acOut) || acOut <= 0 || acOut > 1000) {
      return NextResponse.json({ success: false, error: 'inverterACOutput must be a positive number ≤ 1000 kW.' }, { status: 400 });
    }
    if (!Number.isFinite(modCt) || modCt <= 0 || modCt > 10000 || !Number.isInteger(modCt)) {
      return NextResponse.json({ success: false, error: 'moduleCount must be a positive integer ≤ 10,000.' }, { status: 400 });
    }
    if (!Number.isFinite(tilt) || tilt < 0 || tilt > 90) {
      return NextResponse.json({ success: false, error: 'arrayTilt must be between 0 and 90 degrees.' }, { status: 400 });
    }
    if (!Number.isFinite(capKw) || capKw <= 0 || capKw > 100000) {
      return NextResponse.json({ success: false, error: 'systemCapacityKw must be a positive number ≤ 100,000 kW.' }, { status: 400 });
    }

    // Verify user has access to this project
    const sql = await getDbReady();
    const projectCheck = await sql`
      SELECT user_id FROM projects WHERE id = ${projectId}
    `;

    if (projectCheck.length === 0 || projectCheck[0].user_id !== user.id) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    const slg = await generateDynamicSLG(
      projectId,
      inverterACOutput,
      moduleCount,
      arrayTilt,
      systemCapacityKw
    );

    return NextResponse.json({ success: true, data: { slg } });
  } catch (error: unknown) {
    return handleRouteDbError('[POST /api/engineering/slg/generate]', error);
  }
}