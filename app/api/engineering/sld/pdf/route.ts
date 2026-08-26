// ============================================================
// Permit-Grade SLD PDF Export API — V8
// POST /api/engineering/sld/pdf
// Renders SVG → HTML → PDF via wkhtmltopdf at 300 DPI
// ANSI C sheet (24×18 inches landscape)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { handleRouteDbError } from '@/lib/db-neon';
import { renderSLDProfessional, SLDProfessionalInput } from '@/lib/sld-professional-renderer';
import { sanitizeClientSourceBranches } from '@/lib/permit/utils/sldAdapter';
import { generatePdfFromHtml, CanonicalFontError } from '@/lib/pdf/generatePdf';
import { fontFaceCss, CSS_FONT_SANS_STACK } from '@/lib/permit/fonts/fontPack';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// 60s, matching the permit route. chromium-min ships no binary: the FIRST call on
// a cold Lambda downloads a ~65 MB tarball, extracts it to /tmp and launches
// Chromium before a single pixel is drawn. 30s could not fit that, so even with a
// correct download URL the first request would time out and report no PDF.
export const maxDuration = 60;


// ─── HTML wrapper for wkhtmltopdf ─────────────────────────────────────────────
/** Real HTML escaping. The previous body mapped every character to ITSELF
 *  (`.replace(/&/g, '&')` and friends — the entities had been decoded into
 *  their literal characters at some point), so it escaped nothing and
 *  `projectName` reached <title> raw. */
function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The sheet this export prints on. The SLD canvas is 2304 × 1728 user units at
 *  exactly 96 uu/in — i.e. it IS a 24 × 18 in (ARCH C) drawing. Printing it here
 *  at its native size means the outer fit scale is exactly 1.000 and NO paper is
 *  letterboxed away. Larger named sheets (ANSI D 34 × 22) are a Phase-2 change:
 *  they only pay off once the canvas aspect is generated FROM the sheet, because
 *  a 4:3 canvas on a 34 × 22 sheet strands 2.67 in of blank paper per flank —
 *  the same complaint on nicer paper. One source of truth; the page box, the
 *  element boxes and the Puppeteer paper size are all derived from it. */
const SHEET = { widthIn: 24, heightIn: 18 } as const;

function wrapSVGinHTML(svgContent: string, projectName: string): string {
  const safeTitle = escHtml(projectName);
  const W = `${SHEET.widthIn}in`;
  const H = `${SHEET.heightIn}in`;
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>SLD — ${safeTitle}</title>
  <style>
    /* ── D4 · THE CANONICAL EMBEDDED FONT PACK ──────────────────────────────
       Every <text> the SLD renderer emits asks for "SolarPro Sans, SolarPro
       Symbols" (sld-professional-renderer.ts:382/395). This wrapper is the ONLY
       injection point — the SVG carries no <style> of its own — so without these
       bytes the drawing typesets in a substituted face, the authoritative font
       gate in generatePdf.ts trips on the metric fingerprint, and no PDF is ever
       produced. fontFaceCss() throws if the bytes do not match the manifest. */
${fontFaceCss()}
    * { margin: 0; padding: 0; box-sizing: border-box; }
    @page { size: ${W} ${H}; margin: 0; }
    html, body {
      width: ${W};
      height: ${H};
      background: white;
      overflow: hidden;
      font-family: ${CSS_FONT_SANS_STACK};
    }
    .page {
      width: ${W};
      height: ${H};
      display: flex;
      align-items: center;
      justify-content: center;
      background: white;
    }
    svg {
      width: ${W};
      height: ${H};
      display: block;
    }
    /* The gate measures the faces, and document.fonts.check() reports FALSE for
       a face that is declared but never used — declaring the pack is not enough
       to load it. This forces each face to actually resolve. It must stay laid
       out and painted: display:none would suppress the load entirely. */
    .font-preload {
      position: fixed; left: -9999px; top: 0;
      white-space: pre; pointer-events: none;
    }
  </style>
</head>
<body>
  <div class="font-preload" aria-hidden="true"
    ><span style="font-family:'SolarPro Sans';font-weight:400">A</span
    ><span style="font-family:'SolarPro Sans';font-weight:700">A</span
    ><span style="font-family:'SolarPro Mono';font-weight:400">A</span
    ><span style="font-family:'SolarPro Mono';font-weight:700">A</span
    ><span style="font-family:'SolarPro Symbols';font-weight:400">⚡</span
  ></div>
  <div class="page">
    ${svgContent}
  </div>
</body>
</html>`;
}

// ─── POST handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    // v48.6: Rate limiting — 10 req / 30s per IP (protects heavy compute + external APIs)
        const _rl = await checkRateLimit('engineering', getClientIp(req));
    if (!_rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Please slow down.' },
        { status: 429 }
      );
    }

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
      // NEC 705.12(B) — the 120% calculation's busbar base and the battery's
      // contribution to backfeed. BOTH are already POSTed by the Diagram tab
      // (page.tsx: `panelBusRating`, `batteryBackfeedA`) and were being dropped
      // on the floor here. Losing batteryBackfeedA makes the renderer fall back
      // to `?? 0` / `?? 20`, so the exported sheet can print "120% RULE PASS"
      // on a system the Diagram tab fails. They are pass-through-or-undefined:
      // a caller that genuinely has no value must NOT get a fabricated one.
      panelBusRating:          buildInput.panelBusRating   != null ? Number(buildInput.panelBusRating)   : undefined,
      batteryBackfeedA:        buildInput.batteryBackfeedA != null ? Number(buildInput.batteryBackfeedA) : undefined,
      // DC string provenance. Absent ⇒ the renderer now suppresses the derived
      // rows rather than printing STC values under "corrected" labels.
      vocCorrected:            buildInput.vocCorrected     != null ? Number(buildInput.vocCorrected)     : undefined,
      designTempMin:           buildInput.designTempMin    != null ? Number(buildInput.designTempMin)    : undefined,
      panelsPerString:         buildInput.panelsPerString  != null ? Number(buildInput.panelsPerString)  : undefined,
      lastStringPanels:        buildInput.lastStringPanels != null ? Number(buildInput.lastStringPanels) : undefined,
      stringVoc:               buildInput.stringVoc        != null ? Number(buildInput.stringVoc)        : undefined,
      stringIsc:               buildInput.stringIsc        != null ? Number(buildInput.stringIsc)        : undefined,
      ocpdPerString:           buildInput.ocpdPerString    != null ? Number(buildInput.ocpdPerString)    : undefined,
      dcAcRatio:               buildInput.dcAcRatio        != null ? Number(buildInput.dcAcRatio)        : undefined,
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

    // Wave 5A — hybrid multi-lane export: validated source lanes ride the
    // buildInput; >=2 usable lanes => the PDF renders the SAME multi-lane
    // diagram the Diagram tab shows (I-8: a hybrid export must never be a
    // plausible-wrong single-lane sheet). buildInput.backfeedAmps carries the
    // aggregate §1.7 total on this path.
    const _pdfSources = sanitizeClientSourceBranches(buildInput.sources);
    if (_pdfSources) {
      input.sources = _pdfSources;
      console.log(`[SLD PDF] Wave 5A multi-lane export: lanes=${_pdfSources.length} keys=${_pdfSources.map(s2 => s2.key).join('+')}`);
    }

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

    // Generate PDF via Puppeteer+chromium (Vercel-compatible)
    const ts = Date.now();
    const html = wrapSVGinHTML(svg, input.projectName);
    // Explicit dimensions (never `landscape` — 24 wide × 18 high ALREADY encodes
    // landscape, and passing both makes Chrome transpose the paper a second
    // time). authoritativeOnly refuses the wkhtmltopdf preview: its geometry is
    // not this drawing's geometry, and a sheet a plan reviewer measures with a
    // rule must not silently be a different one.
    const pdfResult = await generatePdfFromHtml(html, {
      widthIn:           `${SHEET.widthIn}in`,
      heightIn:          `${SHEET.heightIn}in`,
      authoritativeOnly: true,
    });

    if (pdfResult) {
      return new NextResponse(pdfResult.pdf as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="SLD-${input.projectName.replace(/[^a-zA-Z0-9]/g, '_')}-${ts}.pdf"`,
          'Cache-Control': 'no-store',
          'X-Pdf-Method': pdfResult.method,
          'X-Sld-Sheet': `${SHEET.widthIn}x${SHEET.heightIn}in`,
        },
      });
    }

    // NO SVG MASQUERADE. This used to return the raw SVG at HTTP 200 with a
    // .svg filename — the client saw res.ok, honoured the server filename and
    // saved it, so "Export PDF" silently handed the user a file Acrobat cannot
    // open. A failed PDF is a FAILURE and must be reported as one.
    console.error('[SLD PDF] no PDF engine produced output — refusing to serve an SVG as if it were the export');
    return NextResponse.json(
      {
        success: false,
        code: 'PDF_ENGINE_UNAVAILABLE',
        error: 'The PDF renderer is unavailable, so no drawing was produced. '
             + 'Nothing was downloaded — this is not a partial or degraded export. '
             + 'Use the Diagram tab to view the SLD, or request format:"svg" for the vector source.',
      },
      { status: 502 },
    );

  } catch (err: unknown) {
    // A canonical-font failure is NOT a database error. handleRouteDbError would
    // relabel it and bury the one message that says which face failed and by how
    // many pixels, so it is caught first and surfaced verbatim.
    const _fontErr = err instanceof CanonicalFontError
      || (err as { isCanonicalFontError?: boolean })?.isCanonicalFontError === true;
    if (_fontErr) {
      console.error('[SLD PDF] canonical font gate refused the render:', (err as Error).message);
      return NextResponse.json(
        { success: false, code: 'CANONICAL_FONT_FAILURE', error: (err as Error).message },
        { status: 500 },
      );
    }
    return handleRouteDbError('[SLD PDF err]', err);
  }
}