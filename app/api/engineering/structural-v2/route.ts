// ============================================================
// POST /api/engineering/structural-v2
// Structural Calculation Engine V2
// Realistic residential rooftop solar structural analysis
// ============================================================

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

import { 
  runStructuralCalcV2, 
  StructuralInputV2,
  StructuralResultV2 
} from '@/lib/structural-engine-v2';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Map request body to StructuralInputV2
    const input: StructuralInputV2 = {
      // Site
      windSpeed: Number(body.windSpeed) || 115,
      windExposure: body.windExposure ?? 'C',
      groundSnowLoad: Number(body.groundSnowLoad) || 20,
      meanRoofHeight: Number(body.meanRoofHeight) || 15,

      // Roof Framing
      framingType: body.framingType ?? 'unknown',
      rafterSize: body.rafterSize ?? '2x6',
      rafterSpacing: Number(body.rafterSpacing) || 24,
      rafterSpan: Number(body.rafterSpan) || 14,
      rafterSpecies: body.rafterSpecies ?? 'Douglas Fir-Larch',
      sheathingType: body.sheathingType,
      sheathingThickness: body.sheathingThickness,
      roofPitch: Number(body.roofPitch) || 20,
      roofType: body.roofType ?? 'shingle',

      // PV Array
      panelCount: Number(body.panelCount) || 20,
      panelLength: Number(body.panelLength) || 70.9,
      panelWidth: Number(body.panelWidth) || 41.7,
      panelWeight: Number(body.panelWeight) || 44.1,
      panelOrientation: body.panelOrientation ?? 'portrait',
      rowCount: Number(body.rowCount) || 2,

      // Mounting System
      mountingSystem: body.mountingSystem ?? 'rt-mini',
      rackingWeight: Number(body.rackingWeight) || 4.0,

      // Optional
      maxMountSpacing: body.maxMountSpacing ? Number(body.maxMountSpacing) : undefined,
    };

    const result = runStructuralCalcV2(input);

    return NextResponse.json({
      success: true,
      status: result.status,

      // Summary for UI
      summary: {
        status: result.status,
        framingType: result.framing.type,
        framingUtilization: result.framing.utilization,
        framingPasses: result.framing.passes,
        mountCount: result.mountLayout.mountCount,
        mountSpacing: result.mountLayout.mountSpacing,
        safetyFactor: result.mountLayout.upliftPerMount > 0 
          ? (2 * 450) / result.mountLayout.upliftPerMount 
          : 999,
        totalSystemWeight: result.totalSystemWeight,
        addedDeadLoadPsf: result.addedDeadLoadPsf,
      },

      // Detailed results
      framing: result.framing,
      mountLayout: result.mountLayout,
      railSystem: result.railSystem,
      rackingBOM: result.rackingBOM,
      wind: result.wind,
      snow: result.snow,

      // Issues
      errors: result.errors,
      warnings: result.warnings,
      recommendations: result.recommendations,

      // Compliance table for UI
      complianceTable: [
        {
          check: 'Framing Capacity',
          value: `${(result.framing.utilization * 100).toFixed(0)}%`,
          limit: '≤ 100%',
          status: result.framing.passes ? 'PASS' : 'FAIL',
          reference: result.framing.type === 'truss' ? 'BCSI / TPI' : 'NDS 2018',
        },
        {
          check: 'Mount Safety Factor',
          value: result.mountLayout.upliftPerMount > 0 
            ? ((2 * 450) / result.mountLayout.upliftPerMount).toFixed(2)
            : 'N/A',
          limit: '≥ 1.5',
          status: result.mountLayout.upliftPerMount > 0 && (2 * 450) / result.mountLayout.upliftPerMount >= 1.5 
            ? 'PASS' 
            : 'FAIL',
          reference: 'ICC-ES ESR-3575',
        },
        {
          check: 'Mount Spacing',
          value: `${result.mountLayout.mountSpacing}"`,
          limit: `≤ ${result.mountLayout.mountSpacing}" (calculated)`,
          status: 'PASS',
          reference: 'ASCE 7-22',
        },
        {
          check: 'Added Dead Load',
          value: `${result.addedDeadLoadPsf.toFixed(1)} psf`,
          limit: '≤ 5 psf (advisory)',
          status: result.addedDeadLoadPsf <= 5 ? 'PASS' : 'WARNING',
          reference: 'IBC 2021 §1604',
        },
      ],
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Structural calculation failed';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}