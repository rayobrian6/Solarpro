// GET /api/debug/rate?id=<projectId>
// Diagnostic: shows raw bill_data from DB + what validateAndCorrectUtilityRate returns.
// Use this to debug $0/kWh rate issues on specific projects.

export const dynamic    = 'force-dynamic';
export const runtime    = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady } from '@/lib/db-neon';
import { validateAndCorrectUtilityRate } from '@/lib/utility-rules';
import { productionGuard } from '@/lib/security';

export async function GET(req: NextRequest) {
  // SECURITY: Block debug routes in production
  const _blocked = productionGuard(); if (_blocked) return _blocked;

  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const projectId = req.nextUrl.searchParams.get('id');
    if (!projectId) {
      return NextResponse.json({ error: 'id param required' }, { status: 400 });
    }

    const sql = await getDbReady();

    // Raw DB row — no rowToProject hydration
    const rows = await sql`
      SELECT id, name,
             bill_data,
             utility_name,
             utility_rate_per_kwh,
             state_code,
             city
      FROM projects
      WHERE id = ${projectId}
        AND user_id = ${user.id}
        AND deleted_at IS NULL
      LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const row = rows[0];
    const billData = row.bill_data as Record<string, unknown> | null;

    // Reproduce the exact rate lookup rowToProject does
    const utilityProviderFromBill = (billData?.utilityProvider as string) || null;
    const utilityNameFromRow      = (row.utility_name as string) || null;
    const utilityNameUsed         = utilityProviderFromBill || utilityNameFromRow;

    const electricityRateFromBill = (billData?.electricityRate as number) > 0
      ? (billData?.electricityRate as number) : null;
    const rateFromRow             = (row.utility_rate_per_kwh as number) > 0
      ? (row.utility_rate_per_kwh as number) : null;
    const rawRateUsed             = electricityRateFromBill ?? rateFromRow;

    const validation = validateAndCorrectUtilityRate(rawRateUsed, utilityNameUsed);

    // Which branch would rowToProject take?
    const hasBillData    = !!billData;
    const hasBillAnalysis = !!(billData?._billAnalysis);
    const flatBranchTriggered = !hasBillAnalysis && !!(
      billData?.monthlyKwh       ||
      billData?.annualKwh        ||
      billData?.estimatedAnnualKwh ||
      billData?.monthlyUsageHistory ||
      billData?.utilityProvider  ||
      billData?.electricityRate
    );

    return NextResponse.json({
      projectId: row.id,
      projectName: row.name,
      db: {
        utility_name:         row.utility_name,
        utility_rate_per_kwh: row.utility_rate_per_kwh,
        state_code:           row.state_code,
        city:                 row.city,
      },
      billData: {
        exists:                hasBillData,
        utilityProvider:       billData?.utilityProvider ?? null,
        electricityRate:       billData?.electricityRate ?? null,
        annualKwh:             billData?.annualKwh ?? null,
        estimatedAnnualKwh:    billData?.estimatedAnnualKwh ?? null,
        monthlyKwh:            billData?.monthlyKwh ?? null,
        monthlyUsageHistory:   billData?.monthlyUsageHistory ?? null,
        hasBillAnalysisKey:    hasBillAnalysis,
        allKeys:               billData ? Object.keys(billData) : [],
      },
      hydration: {
        utilityProviderFromBill,
        utilityNameFromRow,
        utilityNameUsed,
        electricityRateFromBill,
        rateFromRow,
        rawRateUsed,
        flatBranchTriggered,
        hasBillData,
        hasBillAnalysis,
      },
      rateValidation: {
        finalRate:    validation.rate,
        source:       validation.source,
        corrected:    validation.corrected,
        suspect:      validation.suspect,
        originalRate: validation.originalRate,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? (err as Error).message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}