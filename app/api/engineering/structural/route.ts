// ============================================================
// POST /api/engineering/structural
// ASCE 7-22 structural calculation — V4
// Returns: computed capacity, safety factor, margin %
// Fails ONLY when safety factor < required minimum
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { handleRouteDbError } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { runStructuralCalc, StructuralInput } from '@/lib/structural-calc';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const input: StructuralInput = {
      // Site
      windSpeed:         Number(body.windSpeed)         || 115,
      windExposure:      body.windExposure              ?? 'C',
      groundSnowLoad:    Number(body.groundSnowLoad)    || 20,
      seismicZone:       body.seismicZone,

      // Roof
      roofType:          body.roofType                  ?? 'shingle',
      roofPitch:         Number(body.roofPitch)         || 20,
      rafterSpacing:     Number(body.rafterSpacing)     || 24,
      rafterSpan:        Number(body.rafterSpan)        || 14,
      rafterSize:        body.rafterSize                ?? '2x6',
      rafterSpecies:     body.rafterSpecies             ?? 'Douglas Fir-Larch',

      // Array
      panelLength:       Number(body.panelLength)       || 70.9,
      panelWidth:        Number(body.panelWidth)        || 41.7,
      panelWeight:       Number(body.panelWeight)       || 44.1,
      panelCount:        Number(body.panelCount)        || 20,
      rackingWeight:     Number(body.rackingWeight)     || 4.0,
      attachmentSpacing: Number(body.attachmentSpacing) || 48,
      railSpan:          Number(body.railSpan)          || 48,
      rowSpacing:        Number(body.rowSpacing)        || 12,
      arrayTilt:         Number(body.arrayTilt)         || 0,
      systemType:        body.systemType                ?? 'roof',
    };

    const result = runStructuralCalc(input);

    return NextResponse.json({
      success: true,
      status: result.status,

      // User-facing summary
      summary: {
        status:              result.status,
        safetyFactor:        result.attachment.safetyFactor,
        safetyFactorMin:     2.0,
        safetyFactorPasses:  result.attachment.safetyFactor >= 2.0,
        marginPct:           result.attachment.spacingMarginPct,
        spacingCompliant:    result.attachment.spacingCompliant,
        userSpacing:         result.attachment.attachmentSpacing,
        maxAllowedSpacing:   result.attachment.maxAllowedSpacing,
        computedMaxSpacing:  result.attachment.computedMaxSpacing,
        rafterUtilization:   result.rafter.utilizationRatio,
        rafterPasses:        result.rafter.passes,
        totalSystemWeight:   result.totalSystemWeight,
        addedDeadLoadPsf:    result.addedDeadLoadPsf,
      },

      // Detailed results
      wind:       result.wind,
      snow:       result.snow,
      deadLoad:   result.deadLoad,
      rafter:     result.rafter,
      attachment: result.attachment,

      // Issues
      errors:          result.errors,
      warnings:        result.warnings,
      recommendations: result.recommendations,

      // Compliance table
      complianceTable: [
        {
          check: 'Attachment Safety Factor',
          value: result.attachment.safetyFactor.toFixed(2),
          limit: '≥ 2.0',
          status: result.attachment.safetyFactor >= 2.0 ? 'PASS' : 'FAIL',
          reference: 'IBC 2021 / ASCE 7-22',
        },
        {
          check: 'Attachment Spacing',
          value: `${result.attachment.attachmentSpacing}"`,
          limit: `≤ ${result.attachment.maxAllowedSpacing}"`,
          status: result.attachment.spacingCompliant ? 'PASS' : 'FAIL',
          reference: 'ASCE 7-22 / Racking Mfr',
        },
        {
          check: 'Rafter Utilization',
          value: `${(result.rafter.utilizationRatio * 100).toFixed(0)}%`,
          limit: '≤ 100%',
          status: result.rafter.utilizationRatio <= 1.0 ? 'PASS' : 'FAIL',
          reference: 'NDS 2018 / IBC 2021',
        },
        {
          check: 'Rafter Deflection',
          value: `${result.rafter.deflection.toFixed(3)}"`,
          limit: `≤ ${result.rafter.allowableDeflection.toFixed(3)}" (L/240)`,
          status: result.rafter.deflection <= result.rafter.allowableDeflection ? 'PASS' : 'FAIL',
          reference: 'IBC 2021 Table 1604.3',
        },
        {
          check: 'Added Dead Load',
          value: `${result.addedDeadLoadPsf.toFixed(1)} psf`,
          limit: '≤ 5 psf (advisory)',
          status: result.addedDeadLoadPsf <= 5 ? 'PASS' : 'WARNING',
          reference: 'IBC 2021 Section 1604',
        },
      ],
    });

  } catch (err: unknown) {
    return handleRouteDbError('[app/api/engineering/structural/route.ts]', err);
  }
}