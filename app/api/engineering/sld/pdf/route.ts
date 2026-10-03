// ============================================================
// Permit-Grade SLD PDF Export API — V8
// POST /api/engineering/sld/pdf
// Renders SVG → HTML → PDF via wkhtmltopdf at 300 DPI
// ANSI C sheet (24×18 inches landscape)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { sldCombinerFields, hybridLaneMetering } from '@/lib/equipment/sldCombinerFields';
import { readProductionMeterFlag, ungroundedConductorsForService } from '@/lib/equipment/currentTransformers';
import { getUserFromRequest } from '@/lib/auth';
// THE one NEC 240.6(A) ladder — never `Math.ceil(x / 5) * 5`.
import { nextStandardOcpd } from '@/lib/electrical/stdSizes';
import { unselectedInverterLabel } from '@/lib/permit/utils/helpers';
import { TOPOLOGY_UNRESOLVED_TOKEN, pvArrayInputRequired } from '@/lib/electrical/canonicalSldProjection';
import { handleRouteDbError } from '@/lib/db-neon';
import { renderSLDProfessional, SLDProfessionalInput } from '@/lib/sld-professional-renderer';
import { sanitizeClientSourceBranches } from '@/lib/permit/utils/sldAdapter';
import { generatePdfFromHtml, CanonicalFontError } from '@/lib/pdf/generatePdf';
import { fontFaceCss, CSS_FONT_SANS_STACK } from '@/lib/permit/fonts/fontPack';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { readStoredCombinerSelection, effectiveCombinerId, isReadableProjectId } from '@/lib/combinerSelection/storedRead';

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

    // ── The RECORDED combiner, from the project store ─────────────────────────
    // The page posts its own copy of the installer's pick, and its read of the
    // store fails open — one dropped GET and it posts nothing. The permit route
    // reads the store itself, so this drawing must too, or the two name
    // different devices (lib/combinerSelection/storedRead). A store that cannot
    // be read leaves the posted value: only the permit, the sealed package, refuses.
    if (isReadableProjectId(buildInput?.projectId)) {
      const { getDbReady } = await import('@/lib/db-neon');
      const _stored = await readStoredCombinerSelection(getDbReady, buildInput.projectId);
      if (_stored.kind === 'stored') {
        const _id = effectiveCombinerId(buildInput.selectedCombinerId, _stored, 'sld/pdf/POST');
        if (_id) buildInput.selectedCombinerId = _id; else delete buildInput.selectedCombinerId;
      } else effectiveCombinerId(buildInput.selectedCombinerId, _stored, 'sld/pdf/POST');
    }

    if (!buildInput) {
      return NextResponse.json({ success: false, error: 'Missing buildInput' }, { status: 400 });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 🚨 THE EXPORTED PDF DREW A DIFFERENT SERVICE THAN THE DIAGRAM TAB.
    //
    // Found in the re-audit (docs/ELECTRICAL-AUTHORITY-REAUDIT.md, F-3). This route had ZERO
    // references to the service graph, so "Export PDF" rendered the legacy single-service tail for
    // Ray's 400 A job while the Diagram tab — reading the same project — drew two 200 A systems, two
    // Gateways and four Powerwalls. Two rendering entry points, one project, two drawings.
    //
    // It also carried both of the fabrications the sweep found elsewhere: `mainPanelAmps ... || 200`
    // and `?? 'LOAD_SIDE'`, the second of which assigns NEC 705.12(B) to a project whose point of
    // interconnection nobody has classified.
    //
    // Same assembly as every other surface. Non-fatal: a project with no graph exports exactly as
    // before.
    // ═══════════════════════════════════════════════════════════════════════
    // ═══════════════════════════════════════════════════════════════════
    // 🚨 THE EXPORTED SHEET IS BUILT FROM THE SAME ENGINEERED PROJECT AS THE DIAGRAM.
    //
    // This route carried a PARTIAL copy of the SVG route's canonical projection: it had the
    // refusal gate, the service rating and the interconnection, and it was missing the Rule
    // Eleven architecture override, the DC string limits, the graph's battery count and the
    // revision stamp. The on-screen diagram therefore drew a DC-coupled Powerwall design and
    // the PDF of the same project, in the same session, drew a string inverter — and the
    // printable one was the wrong one.
    //
    // `projectCanonicalArchitecture` is now the ONLY implementation, called here with the same
    // arguments the SVG route uses. A field cannot be projected on one surface and missed on
    // the other, because there is no second copy to fall behind.
    // ═══════════════════════════════════════════════════════════════════
    let _electricalRevision: string | null = null;
    let _pdfCanonicalApplied = false;
    let _pdfCoupling: string | null = null;
    let _pdfDcLimits: unknown = null;
    if (user?.id && isReadableProjectId(buildInput?.projectId)) {
      try {
        const { projectCanonicalArchitecture } =
          await import('@/lib/electrical/canonicalSldProjection');
        const _proj = await projectCanonicalArchitecture(
          buildInput, String(buildInput.projectId), user.id, 'sld/pdf/POST');
        if (_proj.refusal) return NextResponse.json(_proj.refusal, { status: 409 });
        _electricalRevision = _proj.revision;
        _pdfCanonicalApplied = _proj.applied;
        _pdfCoupling = _proj.coupling;
        _pdfDcLimits = _proj.dcLimits ?? null;
      } catch (e) {
        console.warn('[sld/pdf/POST] canonical electrical read skipped (non-fatal):',
          (e as Error)?.message);
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // 🚨 THE EXPORTED SHEET DRAWS THE ARRAY DESIGN PLACED, OR SAYS WHAT IS MISSING.
    //
    // This route read `Number(buildInput.totalModules) || 20` and `panelWatts … || 400` — the same
    // literals that drew Ray's 37 × 440 W design as 20 × 400 W on the Diagram tab. The canonical
    // projection above has already supplied the array from Design where the project records one.
    // The older `panelSpecs[0]` request shape is folded in first (it names a module, it does not
    // invent one), and anything still missing is refused with what, why, whose and what it blocks.
    // ═══════════════════════════════════════════════════════════════════
    {
      const _fps = Array.isArray(buildInput.panelSpecs) ? buildInput.panelSpecs[0] : null;
      if (_fps && typeof _fps === 'object') {
        const _pairs: Array<[string, string]> = [
          ['panelWatts', 'watts'], ['panelVoc', 'voc'], ['panelIsc', 'isc'],
          ['panelVmp', 'vmp'], ['panelImp', 'imp'],
        ];
        for (const [k, src] of _pairs) {
          if (buildInput[k] == null && _fps[src] != null) buildInput[k] = _fps[src];
        }
        if (!buildInput.panelModel && _fps.model) {
          buildInput.panelModel = `${_fps.manufacturer ?? ''} ${_fps.model}`.trim();
        }
      }
      // A hybrid export carries one validated lane per array, each with its own module facts, and
      // switches to the multi-lane renderer below — the top-level fields are not what it draws.
      const _pvRefusal = sanitizeClientSourceBranches(buildInput.sources)
        ? null : pvArrayInputRequired(buildInput);
      if (_pvRefusal) {
        console.warn('[sld/pdf/POST] REFUSED: ' + String(_pvRefusal.message));
        return NextResponse.json(_pvRefusal, { status: 422 });
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // 🚨 THE EXPORTED SHEET DERIVES ITS STRINGS FROM THE ENGINE, NOT FROM THE REQUEST.
    //
    // This route carried NO engine values at all: it never called `generateStringConfig` and
    // never called `computeSystem`, so every string fact on the printed sheet was whatever the
    // browser happened to post — `totalStrings` defaulted to 2 (line ~342) and
    // `stringPanelCounts` was never set.
    //
    // The end-to-end probe made the consequence plain. On Ray's 400 A Powerwall 3 job the Diagram
    // tab drew `Strings 5: 9 / 9 / 9 / 8 / 2 panels` with a 538.3 V maximum system voltage, and
    // the EXPORTED PDF of the same project, in the same request, printed
    // `4 — ASSIGNMENT REQUIRES RE-DERIVATION`. Repair 11.1 put both routes on one canonical
    // ARCHITECTURE projection; this is the other half — one canonical STRING derivation.
    //
    // 🚨 IT CALLS THE OWNER RATHER THAN RE-DERIVING. `generateStringConfig` is the NEC 690.7
    // string engine, and `stringSizingBounds` inside it owns the cold-Voc correction. The inputs
    // are the ones the canonical projection just set on `buildInput` — on a DC-coupled job
    // the DC window comes from the STORAGE (`dcStringLimits`), so the strings are sized against
    // the Powerwall 3's published 60–480 V MPPT / 550 V input rather than a phantom inverter's
    // defaults. Same function, same inputs, same answer as the SVG route.
    //
    // Non-fatal: if the derivation throws, the posted values stand exactly as before.
    // ═══════════════════════════════════════════════════════════════════
    let _pdfStringResult: import('@/lib/string-generator').StringGeneratorResult | null = null;
    {
      const _topoRaw = String(buildInput.topologyType ?? '');
      const _isMicroForStrings = /MICRO/i.test(_topoRaw);
      const _isOptimizerForStrings = /OPTIMIZER/i.test(_topoRaw);
      const _modules = Number(buildInput.totalModules) || 0;
      // 🚨 NO STRINGS WITHOUT AN ENDPOINT (closure brief §2) — the same rule as the SVG route: no PV
      // inverter, no brand, not micro and no storage PV input ⇒ nothing is derived against the
      // generator's defaults, and a posted layout is not drawn.
      const _hasInverter = [buildInput.selectedInverterId, buildInput.inverterId, buildInput.selectedBrand]
        .some(v => v != null && String(v).trim());
      const _pdfStringsPending = !_isMicroForStrings && !_hasInverter
        && !(_pdfCoupling === 'dc-coupled-storage' && _pdfDcLimits);
      if (_pdfStringsPending) {
        delete buildInput.stringPanelCounts;
        delete buildInput.stringDetails;
        buildInput.totalStrings = 0;
        buildInput.stringingPending = true;
        // …and a posted inverter NAME with no id behind it is not drawn (INVERTER NOT SELECTED).
        delete buildInput.inverterModel;
        delete buildInput.inverterManufacturer;
        console.warn('[sld/pdf/POST] stringing pending equipment selection — no string partition derived or drawn.');
      }
      if (!_isMicroForStrings && !_pdfStringsPending && _modules > 0) {
        try {
          const { generateStringConfig, moduleSpecsFromRegistry, inverterSpecsFromRegistry } =
            await import('@/lib/string-generator');
          const _designTempMin = Number(
            buildInput.designTempMin ?? buildInput.designTempMinC ?? -18);
          _pdfStringResult = generateStringConfig({
            totalModules: _modules,
            moduleSpecs: moduleSpecsFromRegistry({
              voc: Number(buildInput.panelVoc) || undefined,
              vmp: Number(buildInput.panelVmp) || undefined,
              isc: Number(buildInput.panelIsc) || undefined,
              imp: Number(buildInput.panelImp) || undefined,
              watts: Number(buildInput.panelWatts) || undefined,
              tempCoeffVoc: buildInput.panelTempCoeffVoc != null
                ? Number(buildInput.panelTempCoeffVoc)
                : (buildInput.tempCoeffVoc != null ? Number(buildInput.tempCoeffVoc) : undefined),
              tempCoeffVmp: buildInput.tempCoeffVmp != null
                ? Number(buildInput.tempCoeffVmp) : undefined,
              maxSeriesFuseRating: buildInput.maxSeriesFuse != null
                ? Number(buildInput.maxSeriesFuse) : undefined,
            }),
            inverterSpecs: inverterSpecsFromRegistry({
              // Set by the canonical projection from the storage on a DC-coupled job.
              maxDcVoltage: Number(buildInput.inverterMaxDcV ?? buildInput.maxDcVoltage) || undefined,
              mpptVoltageMin: Number(buildInput.mpptVoltageMin) || undefined,
              mpptVoltageMax: Number(buildInput.mpptVoltageMax) || undefined,
              mpptChannels: Number(buildInput.mpptChannels) || undefined,
              maxInputCurrent: Number(buildInput.maxInputCurrentPerMppt) || undefined,
              acOutputKw: Number(buildInput.acOutputKw) || undefined,
              maxPanelsPerString: Number(buildInput.maxPanelsPerString) || undefined,
            }),
            designTempMin: _designTempMin,
            topology: _isOptimizerForStrings ? 'optimizer' : 'string',
          });

          const _counts = _pdfStringResult.strings
            .map(st => st.panelsInString)
            .filter((n): n is number => typeof n === 'number' && n > 0);
          if (_counts.length > 0 && _counts.reduce((a, b) => a + b, 0) === _modules) {
            buildInput.stringPanelCounts = _counts;
            buildInput.totalStrings = _pdfStringResult.totalStrings;
            buildInput.panelsPerString = _counts[0];
            buildInput.lastStringPanels = _counts[_counts.length - 1];
            buildInput.vocCorrected = _pdfStringResult.vocCorrected;
            buildInput.stringVoc = _pdfStringResult.vocCorrected * _counts[0];
            buildInput.minPanelsPerString = _pdfStringResult.minPanelsPerString;
            buildInput.maxPanelsPerString = _pdfStringResult.maxPanelsPerString;
            console.log('[sld/pdf/POST] strings derived by the engine: '
              + `[${_counts.join('/')}] = ${_modules} modules, `
              + `${_pdfStringResult.vocCorrected.toFixed(1)} V/module corrected to `
              + `${_designTempMin} °C, ceiling ${_pdfStringResult.maxPanelsPerString}/string`);
          } else {
            console.warn('[sld/pdf/POST] the string derivation did not describe this array '
              + `([${_counts.join('/')}] vs ${_modules} modules) — the posted values stand.`);
          }
        } catch (e) {
          console.warn('[sld/pdf/POST] string derivation skipped (non-fatal):',
            (e as Error)?.message);
        }
      }
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
    // ════════════════════════════════════════════════════════════════════
    // 🚨 NO EQUIPMENT MAY APPEAR FROM ABSENCE — AND THIS IS THE SHEET THAT LEAVES THE BUILDING.
    //
    // What stood here printed a real FRONIUS PRIMO 8.2-1, or an ENPHASE, in the nameplate
    // position of the EXPORTED PDF for any project that sent no inverter model. The SVG route's
    // identical fabrication was removed; this one was not, so the repair held for the diagram
    // on screen and failed for the artefact that gets attached to a submission.
    //
    // It was also reading the WRONG OBJECT. `buildInput = body.buildInput ?? body` (line 139),
    // so whenever the client wrapped its payload — which it does — `body.topologyType` was
    // `undefined`, the default fired, and `topoForDefaultPdf` was ALWAYS 'STRING_INVERTER'.
    // A microinverter job was therefore given a Fronius, not even the Enphase the branch
    // intended. The guess could not get its own guess right.
    //
    // `unselectedInverterLabel()` is the repo's existing answer: the fail-loud
    // '⚠ INVERTER NOT SELECTED' marker the renderer detects and prints in red
    // (`isInverterUnselectedMarker`). Absence is a state with a representation.
    // ════════════════════════════════════════════════════════════════════
    if (!inverterModel) {
      inverterModel = unselectedInverterLabel();
      inverterManufacturer = '';
      console.warn('[sld/pdf/POST] no inverter model was supplied — the exported sheet says '
        + 'INVERTER NOT SELECTED rather than naming a product nobody chose.'
        + (_pdfCanonicalApplied ? ' (canonical architecture was applied)' : ''));
    }

    const acOutputAmps = Number(buildInput.acOutputAmps) || Math.round(acOutputKw * 1000 / 240);
    // 🚨 `Math.ceil(x / 5) * 5` — the formula lib/electrical/stdSizes.ts forbids in its
    // own header, because 55, 65, 75, 85 and 95 A are NOT NEC 240.6(A) ratings. This is
    // the EXPORTED sheet, so a rating no manufacturer makes went out as a PDF. The last
    // of the five sites; the ladder is the one authority.
    const acOCPD = Number(buildInput.acOCPD) || nextStandardOcpd(acOutputAmps * 1.25);
    const backfeedAmps = Number(buildInput.backfeedAmps || buildInput.acOCPD) || acOCPD;
    const acWireLength = Number(buildInput.acWireLength || buildInput.wireLength) || 60;

    // 🚨 THE EXPORTED SHEET RESOLVES THE COMBINER THE SAME WAY THE DIAGRAM DOES.
    // This route used to resolve nothing: it accepted `combinerId` from the
    // client and dropped it on the floor, so the renderer fell back to the
    // literal 'IQ Combiner' and — because `combinerProvidesAcDisconnect` arrived
    // undefined — the PDF silently withheld the NEC integral-disconnect
    // statement that the on-screen diagram asserted for the same project.
    // 🚨 Same token as the SVG route — never `?? 'STRING_INVERTER'`, which is the guess that
    // used to select the product above.
    const _topo = buildInput.topologyType != null && String(buildInput.topologyType).trim()
      ? String(buildInput.topologyType)
      : TOPOLOGY_UNRESOLVED_TOKEN;
    const _isMicro = /MICRO/i.test(_topo);
    const _combiner = sldCombinerFields({
      inverterManufacturer: String(buildInput.inverterManufacturer ?? ''),
      inverterModel: String(buildInput.inverterModel ?? ''),
      inverterId: buildInput.inverterId ? String(buildInput.inverterId) : null,
      isMicro: _isMicro,
      totalDevices: Number(buildInput.deviceCount ?? buildInput.totalModules) || 0,
      branchCount: Array.isArray(buildInput.microBranches) ? buildInput.microBranches.length : 0,
      hasBattery: !!(buildInput.hasBattery || buildInput.batteryModel || buildInput.batteryKwh
        || (buildInput.batteryCount && Number(buildInput.batteryCount) > 0)),
      overrideDeviceIds: Array.isArray(buildInput.bosDeviceIds)
        ? buildInput.bosDeviceIds.map(String)
        : (buildInput.combinerId ? [String(buildInput.combinerId)] : undefined),
      selectedCombinerId: buildInput.selectedCombinerId ? String(buildInput.selectedCombinerId) : null,
      // The CT authority needs the interconnection to derive the metering mode.
      // It is NOT normalised here — the authority owns the token table, and a
      // sixth spelling of the interconnection is the last thing this repo needs.
      interconnectionRaw: buildInput.interconnection ?? buildInput.interconnectionType
        ?? buildInput.interconnectionMethod ?? null,
      // 240 V split-phase 3-wire is what every other statement on this sheet
      // assumes (the meter node prints '120/240V, 1Ø, 3W'), so the CT count
      // follows the same assumption from the same place, via the authority's
      // explicit table — not a literal 2.
      ungroundedConductorCount: ungroundedConductorsForService(
        Number(buildInput.systemVoltage) || 240, 1),
      // Where the consumption CTs clamp — recorded, or '' for the default.
      consumptionCtLocation: typeof buildInput.consumptionCtLocation === 'string'
        ? buildInput.consumptionCtLocation : null,
    });

    const input: SLDProfessionalInput = {
      projectName:             String(buildInput.projectName             ?? 'Solar PV System'),
      clientName:              String(buildInput.clientName              ?? 'Homeowner'),
      address:                 String(buildInput.address                 ?? '123 Main St'),
      designer:                String(buildInput.designer                ?? 'SolarPro Engineering'),
      drawingDate:             String(buildInput.drawingDate ?? buildInput.date ?? new Date().toLocaleDateString()),
      drawingNumber:           String(buildInput.drawingNumber           ?? 'SLD-001'),
      revision:                String(buildInput.revision                ?? 'A'),
      topologyType:            _topo,
      combinerLabel:                _combiner.combinerLabel,
      combinerModel:                _combiner.combinerModel,
      combinerHasIntegratedGateway: _combiner.combinerHasIntegratedGateway,
      combinerProvidesAcDisconnect: _combiner.combinerProvidesAcDisconnect,
      // 🚨 AND WHETHER THAT NAME IS A DECISION OR A PLACEHOLDER.
      //
      // `combinerSelectionIsDecided` was computed by the adapter and read by
      // NOTHING, so every sheet printed an unresolved default with exactly the
      // same confidence as a recorded installer selection. Carrying it here is
      // what lets the renderer qualify the box. Only an explicit `false`
      // qualifies, so a builder that does not pass it renders as before.
      combinerSelectionIsDecided: _combiner.combinerSelectionIsDecided,
      meteringChannels:             _combiner.combinerMeteringSummary,
      // The CTs, the lead and the "Consumption CTs" row — same composer as
      // the Diagram tab, so the export draws what the screen draws.
      meteringDrawing:              _combiner.meteringDrawing ?? undefined,
      // The standalone IQ Gateway (its own enclosure, fed from its own 2-pole
      // breaker in the panel named above) — the adapter states it only on that
      // topology, and the export draws what the screen draws.
      ...(_combiner.standaloneGateway ? { standaloneGateway: _combiner.standaloneGateway } : {}),
      // More than one IQ Combiner / Envoy (capacity decides how many): each with
      // its branches and CTs — the export draws what the screen draws.
      ...(_combiner.gateways ? { gateways: _combiner.gateways } : {}),
      // The four fields above are the RESOLVED single-lane combiner. This is
      // the selection itself, and it is needed because a hybrid export attaches
      // `input.sources` below and switches to the multi-lane renderer, which
      // ignores those four and re-resolves per lane. Without it the EXPORTED
      // hybrid sheet — the one that reaches the permit package — silently
      // dropped the selection the on-screen single-lane sheet honoured.
      selectedCombinerId:      buildInput.selectedCombinerId ? String(buildInput.selectedCombinerId) : null,
      totalModules:            Number(buildInput.totalModules)           || 0,
      // 🚨 NOT `|| 2`. The engine pass above sets this from the derivation; the literal was a
      // fabricated string count on a printed sheet.
      totalStrings:            Number(buildInput.totalStrings) || 0,
      // 🚨 THE DISTRIBUTION, so the schedule states the real assignment instead of a scalar
      // times a count — the same field the SVG route forwards.
      stringPanelCounts:       Array.isArray(buildInput.stringPanelCounts)
                                 && buildInput.stringPanelCounts.length > 0
                                 ? buildInput.stringPanelCounts.map(Number)
                                 : undefined,
      ...(buildInput.stringingPending === true ? { stringingPending: true } : {}),
      // No literal module: `pvArrayInputRequired` above refused any request that reached here
      // without these, so a fallback could only ever name a product nobody selected.
      panelModel:              String(buildInput.panelModel ?? (firstPanelSpec ? `${firstPanelSpec.manufacturer} ${firstPanelSpec.model}` : 'PV MODULE — MODEL NOT RECORDED')),
      panelWatts:              Number(buildInput.panelWatts ?? firstPanelSpec?.watts)   || 0,
      panelVoc:                Number(buildInput.panelVoc   ?? firstPanelSpec?.voc)     || 0,
      panelIsc:                Number(buildInput.panelIsc   ?? firstPanelSpec?.isc)     || 0,
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
      // 🚨 THE SERVICE GRAPH REACHES THE EXPORTED SHEET. Attached above from the canonical model, so
      // the PDF and the Diagram tab draw the same service for the same project.
      serviceTopology:         buildInput.serviceTopology ?? null,
      utilityName:             String(buildInput.utilityName ?? buildInput.utilityCompany ?? buildInput.utility ?? 'Local Utility'),
      // Map interconnection method to renderer-friendly string
      interconnection:         (() => {
        // 🚨 ABSENCE IS 'UNRESOLVED', NEVER 'LOAD_SIDE'. The canonical projection claims this field from
        // the service graph's POI for every project whose relationship IS established, so what reaches
        // this `??` is a request about a project where nobody has said — and handing that NEC 705.12(B)
        // prints a code basis the design has not earned. The evaluator now has an explicit
        // NOT_EVALUATED branch for it (lib/electrical-calc.ts).
        const raw = String(buildInput.interconnection ?? buildInput.interconnectionType ?? 'UNRESOLVED');
        if (raw === 'LOAD_SIDE' || raw.toLowerCase().includes('load')) return 'Load Side Tap';
        if (raw === 'SUPPLY_SIDE_TAP' || raw.toLowerCase().includes('supply')) return 'Supply Side Tap';
        if (raw === 'MAIN_BREAKER_DERATE' || raw.toLowerCase().includes('derate')) return 'Load Side Tap';
        if (raw === 'PANEL_UPGRADE' || raw.toLowerCase().includes('upgrade')) return 'Load Side Tap';
        if (raw.toLowerCase().includes('line')) return 'Line Side Tap';
        return raw;
      })(),
      rapidShutdownIntegrated: !!(buildInput.rapidShutdownIntegrated || buildInput.rapidShutdown),
      // The EXPORT path had the same inert toggle: the page posts
      // `buildInput.productionMeter`, this read `hasProductionMeter`. The
      // exported sheet is the one that reaches the permit package, so it is the
      // one that most needed to be listening. ONE key name.
      hasProductionMeter:      readProductionMeterFlag(buildInput, true),
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
      // …with each metering lane's CTs, composed exactly as the Diagram route
      // composes them (hybridLaneMetering — one composer, run on each lane's
      // own plan, one lane carrying the site's consumption CTs), from the same
      // selection the renderer resolves the lanes' combiners from and the same
      // interconnection / CT count / location this route hands sldCombinerFields
      // above. The export draws what the screen draws.
      const _pdfMetering = hybridLaneMetering({
        lanes: _pdfSources,
        selectedCombinerId: input.selectedCombinerId ?? null,
        selectedCombinerIdByLane: input.selectedCombinerIdByLane ?? null,
        interconnectionRaw: buildInput.interconnection ?? buildInput.interconnectionType
          ?? buildInput.interconnectionMethod ?? null,
        ungroundedConductorCount: ungroundedConductorsForService(
          Number(buildInput.systemVoltage) || 240, 1),
        consumptionCtLocation: typeof buildInput.consumptionCtLocation === 'string'
          ? buildInput.consumptionCtLocation : null,
      });
      input.sources = _pdfMetering.lanes;
      // A hybrid's gateways are the collection's (pooled by topology), never the
      // single-lane answer above.
      if (_pdfMetering.gateways.length) input.gateways = _pdfMetering.gateways;
      else delete input.gateways;
      console.log(`[SLD PDF] Wave 5A multi-lane export: lanes=${_pdfSources.length} keys=${_pdfSources.map(s2 => s2.key).join('+')} metering=${_pdfMetering.metered.map(m => `${m.key}${m.isPrimary ? '*' : ''}`).join('+') || 'none'}`);
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