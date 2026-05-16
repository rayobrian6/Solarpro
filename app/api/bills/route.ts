import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getBillsByProject, saveBill, isValidUUID , handleRouteDbError } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * GET /api/bills?projectId=<uuid>
 * Returns all bills saved for a project.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const projectId = req.nextUrl.searchParams.get('projectId');
    if (!projectId || !isValidUUID(projectId)) {
      return NextResponse.json({ success: false, error: 'Missing or invalid projectId' }, { status: 400 });
    }

    const bills = await getBillsByProject(projectId, user.id as string);
    return NextResponse.json({ success: true, bills });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/bills]', err);
  }
}

/**
 * POST /api/bills
 * Manually save a bill record for a project.
 * Body: { projectId, utilityName, monthlyKwh, annualKwh, electricRate, fileUrl, parsedJson }
 */
export async function POST(req: NextRequest) {
  try {
        const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { projectId, utilityName, monthlyKwh, annualKwh, electricRate, fileUrl, parsedJson } = body;

    if (!projectId || !isValidUUID(projectId)) {
      return NextResponse.json({ success: false, error: 'Missing or invalid projectId' }, { status: 400 });
    }

    // SECURITY: field length caps + numeric type checks
    if (utilityName && typeof utilityName === 'string' && utilityName.length > 200) return NextResponse.json({ success: false, error: 'utilityName too long (max 200).' }, { status: 400 });
    if (fileUrl     && typeof fileUrl     === 'string' && fileUrl.length     > 500) return NextResponse.json({ success: false, error: 'fileUrl too long (max 500).'     }, { status: 400 });
    if (monthlyKwh  !== null && monthlyKwh  !== undefined && typeof monthlyKwh  !== 'number') return NextResponse.json({ success: false, error: 'monthlyKwh must be a number.'  }, { status: 400 });
    if (annualKwh   !== null && annualKwh   !== undefined && typeof annualKwh   !== 'number') return NextResponse.json({ success: false, error: 'annualKwh must be a number.'   }, { status: 400 });
    if (electricRate !== null && electricRate !== undefined && typeof electricRate !== 'number') return NextResponse.json({ success: false, error: 'electricRate must be a number.' }, { status: 400 });

    const bill = await saveBill({
      projectId,
      userId: user.id as string,
      utilityName: utilityName ?? null,
      monthlyKwh: monthlyKwh ?? null,
      annualKwh: annualKwh ?? null,
      electricRate: electricRate ?? null,
      fileUrl: fileUrl ?? null,
      parsedJson: parsedJson ?? null,
    });

    if (!bill) {
      return NextResponse.json({ success: false, error: 'Failed to save bill' }, { status: 500 });
    }

    return NextResponse.json({ success: true, bill });
  } catch (err: unknown) {
    return handleRouteDbError('[POST /api/bills]', err);
  }
}