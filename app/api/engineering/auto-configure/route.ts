import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, getDbReady } from '@/lib/auth';
import { handleRouteDbError } from '@/lib/db-neon';
import { autoConfigureProject } from '@/lib/engineering-automation';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
      address,
      inverterACOutput,
      dcStringCurrent,
      runLengthFeet,
      conduitType = 'schedule40_pvc',
      conductorType = 'THHN',
      arrayType = 'roof',
    } = body;

    if (!projectId || !address || !inverterACOutput || !dcStringCurrent || !runLengthFeet) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // SECURITY: Validate numeric inputs — prevent NaN/Infinity from reaching calculation engine
    const acOut = Number(inverterACOutput);
    const dcCurr = Number(dcStringCurrent);
    const runLen = Number(runLengthFeet);
    if (!Number.isFinite(acOut) || acOut <= 0 || acOut > 1000) {
      return NextResponse.json({ success: false, error: 'inverterACOutput must be a positive number ≤ 1000 kW.' }, { status: 400 });
    }
    if (!Number.isFinite(dcCurr) || dcCurr <= 0 || dcCurr > 100) {
      return NextResponse.json({ success: false, error: 'dcStringCurrent must be a positive number ≤ 100 A.' }, { status: 400 });
    }
    if (!Number.isFinite(runLen) || runLen <= 0 || runLen > 10000) {
      return NextResponse.json({ success: false, error: 'runLengthFeet must be a positive number ≤ 10,000 ft.' }, { status: 400 });
    }

    // Verify user has access to this project
    const sql = await getDbReady();
    const projectCheck = await sql`
      SELECT user_id FROM projects WHERE id = ${projectId}
    `;

    if (projectCheck.length === 0 || projectCheck[0].user_id !== user.id) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    const result = await autoConfigureProject(
      projectId,
      address,
      inverterACOutput,
      dcStringCurrent,
      runLengthFeet,
      conduitType,
      conductorType,
      arrayType
    );

    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    return handleRouteDbError('[POST /api/engineering/auto-configure]', error);
  }
}