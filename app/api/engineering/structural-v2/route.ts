// ============================================================
// Structural V3 API Route
// Accepts full panel geometry + site params
// Returns: geometry, loads, mount layout, racking BOM, rafter check
// ============================================================

export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { handleRouteDbError } from '@/lib/db-neon';
import { runStructuralCalcV3, type StructuralInputV3 } from '@/lib/structural-engine-v3';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      // Site
      windSpeed       = 115,
      windExposure    = 'C',
      groundSnowLoad  = 20,
      meanRoofHeight  = 15,
      roofPitch       = 20,

      // Framing
      framingType     = 'unknown',
      rafterSize      = '2x6',
      rafterSpacing   = 24,
      rafterSpan      = 16,
      rafterSpecies   = 'Douglas Fir-Larch',

      // Array
      panelCount      = 24,
      panelLength     = 73.0,
      panelWidth      = 41.0,
      panelWeight     = 45.0,
      panelOrientation = 'portrait',
      rowCount,
      colCount,
      moduleGap       = 0.5,
      rowGap          = 6,

      // Racking
      mountingSystem  = 'ironridge-xr100',
      rackingWeight   = 4.0,
    } = body;

    // Map legacy mounting system IDs to racking-database IDs
    const idMap: Record<string, string> = {
      'ironridge-xr100':    'ironridge-xr100',
      'ironridge-xr1000':   'ironridge-xr1000',
      'unirac-solarmount':  'unirac-solarmount',
      'unirac-sme':         'unirac-sme',
      'snapnrack-100':      'snapnrack-100',
      'quickmount-classic': 'quickmount-classic',
      'quickmount-tile':    'quickmount-tile',
      's5-pvkit':           's5-pvkit',
      'k2-crossrail':       'k2-crossrail',
      'ecofasten-rockit':   'ecofasten-rockit',
      'dpw-powerrail':      'dpw-powerrail',
      'schletter-classic':  'schletter-classic',
      'esdec-flatfix':      'esdec-flatfix',
      'rooftech-mini':      'rooftech-mini',
      // Legacy aliases
      'rt-mini':            'rooftech-mini',
      'rail-based':         'ironridge-xr100',
      'rail-less':          'rooftech-mini',
    };

    const rackingSystemId = idMap[mountingSystem] ?? mountingSystem ?? 'ironridge-xr100';

    const input: StructuralInputV3 = {
      windSpeed:       Number(windSpeed),
      windExposure:    windExposure as 'B' | 'C' | 'D',
      groundSnowLoad:  Number(groundSnowLoad),
      meanRoofHeight:  Number(meanRoofHeight),
      roofPitch:       Number(roofPitch),

      framingType:     framingType as 'truss' | 'rafter' | 'unknown',
      rafterSize:      String(rafterSize),
      rafterSpacingIn: Number(rafterSpacing),
      rafterSpanFt:    Number(rafterSpan),
      woodSpecies:     rafterSpecies as any,

      panelCount:      Number(panelCount),
      panelLengthIn:   Number(panelLength),
      panelWidthIn:    Number(panelWidth),
      panelWeightLbs:  Number(panelWeight),
      panelOrientation: panelOrientation as 'portrait' | 'landscape',
      rowCount:        rowCount ? Number(rowCount) : undefined,
      colCount:        colCount ? Number(colCount) : undefined,
      moduleGapIn:     Number(moduleGap),
      rowGapIn:        Number(rowGap),

      rackingSystemId,
      rackingWeightPerPanelLbs: Number(rackingWeight),
    };

    const result = runStructuralCalcV3(input);

    return NextResponse.json({
      status:        result.status,
      arrayGeometry: result.arrayGeometry,
      wind:          result.wind,
      snow:          result.snow,
      mountLayout:   result.mountLayout,
      railAnalysis:  result.railAnalysis,
      rafterAnalysis: result.rafterAnalysis,
      rackingBOM:    result.rackingBOM,
      framing: {
        type:          result.rafterAnalysis.framingType,
        description:   result.rafterAnalysis.framingType === 'truss'
                         ? 'Pre-Engineered Truss'
                         : `${result.rafterAnalysis.size} Stick-Built Rafter`,
        capacityPsf:   result.rafterAnalysis.framingType === 'truss'
                         ? (result.rafterAnalysis.bendingMomentCapacityFtLbs || 45)
                         : result.rafterAnalysis.bendingMomentCapacityFtLbs,
        actualLoadPsf: result.rafterAnalysis.totalLoadPsf,
        utilization:   result.rafterAnalysis.overallUtilization,
        passes:        result.rafterAnalysis.passes,
        notes:         result.rafterAnalysis.notes,
      },
      totalSystemWeightLbs: result.totalSystemWeightLbs,
      addedDeadLoadPsf:     result.addedDeadLoadPsf,
      errors:               result.errors,
      warnings:             result.warnings,
      recommendations:      result.recommendations,
    });

  } catch (err: unknown) {
    return handleRouteDbError('[s', err);
  }
}