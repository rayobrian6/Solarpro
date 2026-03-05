// Rules Engine API — Full NEC + ASCE deterministic rules
// POST /api/engineering/rules

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { runRulesEngine, RulesEngineInput } from '@/lib/rules-engine';
import { OverrideEntry } from '@/lib/rules-engine';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

    const body = await req.json();
    const { electrical, structural, engineeringMode = 'AUTO', overrides = [] } = body as RulesEngineInput;

    if (!electrical || !structural) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: electrical, structural' },
        { status: 400 }
      );
    }

    const result = runRulesEngine({ electrical, structural, engineeringMode, overrides });

    return NextResponse.json({
      success: true,
      data: {
        overallStatus: result.overallStatus,
        errorCount: result.errorCount,
        warningCount: result.warningCount,
        autoFixCount: result.autoFixCount,
        overrideCount: result.overrideCount,
        rules: result.rules,
        electricalResult: result.electricalResult,
        structuralResult: result.structuralResult,
        structuralAutoResolutions: result.structuralAutoResolutions,
        dependencyChain: result.dependencyChain,
      },
    });
  } catch (error: any) {
    console.error('Rules engine error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Rules engine failed' },
      { status: 500 }
    );
  }
}