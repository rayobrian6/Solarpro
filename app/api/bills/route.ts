import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getBillsByProject, saveBill, isValidUUID , handleRouteDbError } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { projectId, utilityName, monthlyKwh, annualKwh, electricRate, fileUrl, parsedJson } = body;

    if (!projectId || !isValidUUID(projectId)) {
      return NextResponse.json({ success: false, error: 'Missing or invalid projectId' }, { status: 400 });
    }

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