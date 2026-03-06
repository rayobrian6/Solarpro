// ============================================================
// Permit-Grade SLD PDF Export API — V8
// POST /api/engineering/sld/pdf
// Renders SVG → HTML → PDF via wkhtmltopdf at 300 DPI
// ANSI C sheet (24×18 inches landscape)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { renderSLDProfessional, SLDProfessionalInput } from '@/lib/sld-professional-renderer';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, unlink } from 'fs/promises';
import path from 'path';
import os from 'os';

export const dynamic = 'force-dynamic';

const execAsync = promisify(exec);

// ─── HTML wrapper for wkhtmltopdf ─────────────────────────────────────────────
function wrapSVGinHTML(svgContent: string, projectName: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>SLD — ${projectName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 24in;
      height: 18in;
      background: white;
      overflow: hidden;
    }
    .page {
      width: 24in;
      height: 18in;
      display: flex;
      align-items: center;
      justify-content: center;
      background: white;
    }
    svg {
      width: 24in;
      height: 18in;
      display: block;
    }
  </style>
</head>
<body>
  <div class="page">
    ${svgContent}
  </div>
</body>
</html>`;
}

// ─── POST handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    // Auth check
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const body = await req.json();
    const buildInput = body.buildInput ?? body;

    if (!buildInput) {
      return NextResponse.json({ success: false, error: 'Missing buildInput' }, { status: 400 });
    }

    // Extract inverter data from inverterSpecs array if present
    const firstInvSpec = buildInput.inverterSpecs?.[0];
    const firstPanelSpec = buildInput.panelSpecs?.[0];

    // Build SLDProfessionalInput from buildInput (same logic as /api/engineering/sld)
    const acOutputKw = Number(
      buildInput.acOutputKw || buildInput.inverterKw ||
      firstInvSpec?.acOutputKw ||
      (buildInput.acOutputW ? buildInput.acOutputW / 1000 : 0) || 8.2
    );

    let inverterManufacturer = String(buildInput.inverterManufacturer ?? firstInvSpec?.manufacturer ?? '');
    let inverterModel = String(buildInput.inverterModel ?? firstInvSpec?.model ?? '');
    if (!inverterManufacturer && inverterModel.includes(' ')) {
      const parts = inverterModel.split(' ');
      inverterManufacturer = parts[0];
      inverterModel = parts.slice(1).join(' ');
    }
    // Default manufacturer based on topology
    const topoForDefaultPdf = String(body.topologyType ?? 'STRING_INVERTER');
    if (!inverterManufacturer) {
      inverterManufacturer = topoForDefaultPdf === 'MICROINVERTER' ? 'Enphase' : 'Fronius';
    }
    if (!inverterModel) inverterModel = 'Primo 8.2-1';

    const acOutputAmps = Number(buildInput.acOutputAmps) || Math.round(acOutputKw * 1000 / 240);
    const acOCPD = Number(buildInput.acOCPD) || Math.ceil(acOutputAmps * 1.25 / 5) * 5;
    const backfeedAmps = Number(buildInput.backfeedAmps || buildInput.acOCPD) || acOCPD;
    const acWireLength = Number(buildInput.acWireLength || buildInput.wireLength) || 60;

    const input: SLDProfessionalInput = {
      projectName:             String(buildInput.projectName             ?? 'Solar PV System'),
      clientName:              String(buildInput.clientName              ?? 'Homeowner'),
      address:                 String(buildInput.address                 ?? '123 Main St'),
      designer:                String(buildInput.designer                ?? 'SolarPro Engineering'),
      drawingDate:             String(buildInput.drawingDate ?? buildInput.date ?? new Date().toLocaleDateString()),
      drawingNumber:           String(buildInput.drawingNumber           ?? 'SLD-001'),
      revision:                String(buildInput.revision                ?? 'A'),
      topologyType:            String(buildInput.topologyType            ?? 'STRING_INVERTER'),
      totalModules:            Number(buildInput.totalModules)           || 20,
      totalStrings:            Number(buildInput.totalStrings)           || 2,
      panelModel:              String(buildInput.panelModel ?? (firstPanelSpec ? `${firstPanelSpec.manufacturer} ${firstPanelSpec.model}` : 'Q.PEAK DUO BLK ML-G10+ 400W')),
      panelWatts:              Number(buildInput.panelWatts ?? firstPanelSpec?.watts)   || 400,
      panelVoc:                Number(buildInput.panelVoc   ?? firstPanelSpec?.voc)     || 49.6,
      panelIsc:                Number(buildInput.panelIsc   ?? firstPanelSpec?.isc)     || 10.18,
      dcWireGauge:             String(buildInput.dcWireGauge             ?? '#10 AWG'),
      dcConduitType:           String(buildInput.dcConduitType ?? buildInput.conduitType ?? 'EMT'),
      dcOCPD:                  Number(buildInput.dcOCPD)                 || 20,
      inverterModel,
      inverterManufacturer,
      acOutputKw,
      acOutputAmps,
      acWireGauge:             String(buildInput.acWireGauge ?? buildInput.wireGauge ?? '#8 AWG'),
      acConduitType:           String(buildInput.acConduitType ?? buildInput.conduitType ?? 'EMT'),
      acOCPD,
      acWireLength,
      backfeedAmps,
      mainPanelAmps:           Number(buildInput.mainPanelAmps)          || 200,
      utilityName:             String(buildInput.utilityName ?? buildInput.utilityCompany ?? buildInput.utility ?? 'Local Utility'),
      // Map interconnection method to renderer-friendly string
      interconnection:         (() => {
        const raw = String(buildInput.interconnection ?? buildInput.interconnectionType ?? 'LOAD_SIDE');
        if (raw === 'LOAD_SIDE' || raw.toLowerCase().includes('load')) return 'Load Side Tap';
        if (raw === 'SUPPLY_SIDE_TAP' || raw.toLowerCase().includes('supply')) return 'Supply Side Tap';
        if (raw === 'MAIN_BREAKER_DERATE' || raw.toLowerCase().includes('derate')) return 'Load Side Tap';
        if (raw === 'PANEL_UPGRADE' || raw.toLowerCase().includes('upgrade')) return 'Load Side Tap';
        if (raw.toLowerCase().includes('line')) return 'Line Side Tap';
        return raw;
      })(),
      rapidShutdownIntegrated: !!(buildInput.rapidShutdownIntegrated || buildInput.rapidShutdown),
      hasProductionMeter:      buildInput.hasProductionMeter !== false,
      hasBattery:              !!(buildInput.hasBattery || buildInput.batteryModel || buildInput.batteryKwh),
      batteryModel:            String(buildInput.batteryModel            ?? ''),
      batteryKwh:              Number(buildInput.batteryKwh)             || 0,
      scale:                   String(buildInput.scale                   ?? 'NOT TO SCALE'),
      // Pass through runs, micro data, and string details if provided
      runs:                    buildInput.runs ?? undefined,
      deviceCount:             buildInput.deviceCount ?? undefined,
      microBranches:           buildInput.microBranches ?? undefined,
      branchWireGauge:         buildInput.branchWireGauge ?? undefined,
      branchConduitSize:       buildInput.branchConduitSize ?? undefined,
      branchOcpdAmps:          buildInput.branchOcpdAmps ? Number(buildInput.branchOcpdAmps) : undefined,
      stringDetails:           buildInput.stringDetails ?? undefined,
    };

    // Render SVG
    const svg = renderSLDProfessional(input);

    // Check format — if svg requested, return directly
    const format = String(body.format ?? 'pdf');
    if (format === 'svg') {
      return new NextResponse(svg, {
        headers: {
          'Content-Type': 'image/svg+xml',
          'Content-Disposition': `attachment; filename="sld-${Date.now()}.svg"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    // Generate PDF via wkhtmltopdf
    const tmpDir = os.tmpdir();
    const ts = Date.now();
    const htmlPath = path.join(tmpDir, `sld-${ts}.html`);
    const pdfPath  = path.join(tmpDir, `sld-${ts}.pdf`);

    try {
      const html = wrapSVGinHTML(svg, input.projectName);
      await writeFile(htmlPath, html, 'utf8');

      const cmd = [
        'wkhtmltopdf',
        '--page-width 24in',
        '--page-height 18in',
        '--orientation Landscape',
        '--margin-top 0',
        '--margin-right 0',
        '--margin-bottom 0',
        '--margin-left 0',
        '--dpi 150',
        '--image-dpi 150',
        '--image-quality 95',
        '--enable-local-file-access',
        '--disable-smart-shrinking',
        '--zoom 1.0',
        '--quiet',
        `"${htmlPath}"`,
        `"${pdfPath}"`,
      ].join(' ');

      await execAsync(cmd, { timeout: 30000 });
      const pdfBuffer = await readFile(pdfPath);

      return new NextResponse(pdfBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="SLD-${input.projectName.replace(/[^a-zA-Z0-9]/g, '_')}-${ts}.pdf"`,
          'Cache-Control': 'no-store',
        },
      });
    } finally {
      try { await unlink(htmlPath); } catch {}
      try { await unlink(pdfPath); } catch {}
    }

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'PDF generation failed';
    console.error('SLD PDF error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}