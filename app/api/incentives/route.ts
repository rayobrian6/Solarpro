import { NextRequest, NextResponse } from 'next/server';
import { getStateIncentives, calculateIncentives } from '@/lib/incentives/stateIncentives';
import { runIncentiveEngine } from '@/lib/incentives/incentiveEngine';
import { getUserFromRequest } from '@/lib/auth';
import { handleRouteDbError } from '@/lib/db-neon';

// GET /api/incentives?state=CA — get incentives for a state
export async function GET(req: NextRequest) {
  const stateCode = req.nextUrl.searchParams.get('state')?.toUpperCase() || '';
  if (!stateCode) {
    return NextResponse.json({ success: false, error: 'state parameter required' }, { status: 400 });
  }

  const profile = getStateIncentives(stateCode);
  if (!profile) {
    return NextResponse.json({ success: false, error: `No incentive data for state: ${stateCode}` }, { status: 404 });
  }

  return NextResponse.json({ success: true, profile });
}

// POST /api/incentives — calculate incentives for a specific system
export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const {
      stateCode,
      systemCost,
      systemKw,
      annualKwh,
      utilityRatePerKwh,
      annualConsumptionKwh,
      isResidential = true,
      financeType = 'cash',
      loanRate,
      loanTermYears,
    } = body;

    if (!stateCode || !systemCost || !systemKw || !annualKwh) {
      return NextResponse.json({
        success: false,
        error: 'stateCode, systemCost, systemKw, annualKwh required',
      }, { status: 400 });
    }

    const result = runIncentiveEngine({
      stateCode,
      systemCostBeforeIncentives: systemCost,
      systemKw,
      annualKwhProduction: annualKwh,
      isResidential,
      utilityRatePerKwh: utilityRatePerKwh || 0.13,
      annualConsumptionKwh: annualConsumptionKwh || annualKwh,
      financeType,
      loanRate,
      loanTermYears,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    return handleRouteDbError('[incen', err);
  }
}