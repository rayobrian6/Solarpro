// ============================================================
// POST /api/engineering/bom
// Registry-driven BOM generation — V4
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { handleRouteDbError } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { generateBOMV4, bomToMarkdown, bomToCSV, BOMGenerationInputV4 } from '@/lib/bom-engine-v4';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const input: BOMGenerationInputV4 = {
      inverterId:         body.inverterId         ?? 'fronius-primo-8.2',
      optimizerId:        body.optimizerId,
      rackingId:          body.rackingId,
      batteryId:          body.batteryId,
      panelId:            body.panelId,
      moduleCount:        Number(body.moduleCount)        || 20,
      deviceCount:        body.deviceCount !== undefined ? Number(body.deviceCount) : undefined,  // PHASE 3 FIX
      stringCount:        Number(body.stringCount)        || 2,
      inverterCount:      Number(body.inverterCount)      || 1,
      systemKw:           Number(body.systemKw)           || 8.0,
      dcWireGauge:        body.dcWireGauge        ?? '#10 AWG',
      acWireGauge:        body.acWireGauge        ?? '#8 AWG',
      dcWireLength:       Number(body.dcWireLength)       || 50,
      acWireLength:       Number(body.acWireLength)       || 60,
      conduitType:        body.conduitType        ?? 'EMT',
      conduitSizeInch:    body.conduitSizeInch    ?? '3/4',
      roofType:           body.roofType           ?? 'shingle',
      attachmentCount:    Number(body.attachmentCount)    || 12,
      railSections:       Number(body.railSections)       || 4,
      // Phase 3 - Layout fields
      rowCount:           body.rowCount !== undefined ? Number(body.rowCount) : undefined,
      columnCount:        body.columnCount !== undefined ? Number(body.columnCount) : undefined,
      layoutOrientation:  body.layoutOrientation,
      mainPanelAmps:      Number(body.mainPanelAmps)      || 200,
      backfeedAmps:       Number(body.backfeedAmps)       || 40,
      acOCPD:             Number(body.acOCPD)             || 40,
      dcOCPD:             Number(body.dcOCPD)             || 20,
      jurisdiction:       body.jurisdiction,
      requiresProductionMeter: body.requiresProductionMeter ?? false,
      requiresACDisconnect:    body.requiresACDisconnect    ?? true,
      requiresDCDisconnect:    body.requiresDCDisconnect    ?? true,
      requiresRapidShutdown:   body.requiresRapidShutdown   ?? true,
      requiresWarningLabels:   body.requiresWarningLabels   ?? true,
      // Interconnection method — controls whether backfed breaker appears in BOM
      interconnectionMethod:   body.interconnectionMethod ?? body.interconnection ?? 'LOAD_SIDE',
      panelBusRating:          Number(body.panelBusRating) || Number(body.mainPanelAmps) || 200,
      runs:                    body.runs,
      // Pre-calculated quantities from ComputedSystem.bomQuantities (exact match with summary cards)
      bomQuantities:            body.bomQuantities,
    };

    const result = generateBOMV4(input);

    const format = body.format ?? 'json';
    if (format === 'csv') {
      return new NextResponse(bomToCSV(result), {
        headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="bom.csv"' },
      });
    }
    if (format === 'markdown') {
      return new NextResponse(bomToMarkdown(result), {
        headers: { 'Content-Type': 'text/markdown' },
      });
    }

    return NextResponse.json({
      success: true,
      bom: result,
      summary: {
        topology: result.topology,
        topologyLabel: result.topologyLabel,
        totalLineItems: result.totalLineItems,
        stageCount: result.stages.filter(s => s.itemCount > 0).length,
        complianceNotes: result.complianceNotes,
        warnings: result.warnings,
      },
    });

  } catch (err: unknown) {
    return handleRouteDbError('[app/api/engineering/bom/route.ts]', err);
  }
}