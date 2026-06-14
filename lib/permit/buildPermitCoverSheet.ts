// ============================================================
// lib/permit/buildPermitCoverSheet.ts
// Builds the permit cover sheet (PV-0) as a self-contained HTML string
// suitable for wkhtmltopdf rendering and project_files storage.
//
// Architecture:
//   EngineeringReport + DesignSnapshot
//     → mapReportToPermitCover()   → PermitCoverData
//     → renderPermitCoverHTML()    → HTML string (artifact)
//
// Called by:
//   - lib/engineering/artifactBuilders.ts  (pipeline write_artifacts stage)
//   - app/api/engineering/permit-preview/route.ts  (preview endpoint)
// ============================================================

import type { EngineeringReport } from '@/lib/engineering/types';
import type { DesignSnapshot } from '@/lib/engineering/types';
import type { PermitCoverData, PermitArtifact } from './types';
import { PERMIT_SHEET_INDEX } from './types';

// ─── Map EngineeringReport → PermitCoverData ─────────────────────────────────

export function mapReportToPermitCover(
  report: EngineeringReport,
  snapshot?: DesignSnapshot | null,
  overrides?: Partial<PermitCoverData>
): PermitCoverData {
  const sys  = report.systemSummary;
  const elec = report.electrical;
  const stru = report.structural;
  const perm = report.permitPackage;

  const necVer = elec?.necVersion ?? '2020';
  const ibcVer = '2021';
  const ifcVer = necVer === '2023' ? '2024' : '2021';

  // Panel/inverter display
  const moduleParts   = (sys.panelModel   ?? '—').split(' ');
  const moduleMfr     = moduleParts.length > 1 ? moduleParts[0] : '';
  const moduleModel   = sys.panelModel   ?? '—';
  const inverterParts = (sys.inverterModel ?? '—').split(' ');
  const inverterMfr   = inverterParts.length > 1 ? inverterParts[0] : '';
  const inverterModel = sys.inverterModel ?? '—';

  // Interconnection / 120% rule
  const backfeedA  = elec?.backfeedBreakerAmps ?? Math.ceil((sys.systemSizeAcKw ?? 0) * 1000 / 240 * 1.25);
  const svcAmps    = elec?.mainPanelBusAmps ?? 200;
  const busLimit   = Math.round(svcAmps * 1.2);
  const rulePass   = (svcAmps + backfeedA) <= busLimit;

  // Roof pitch from structural
  const pitchRaw = stru?.roofPitch;
  const pitchStr = pitchRaw
    ? `${Math.round(Math.tan(pitchRaw * Math.PI / 180) * 12)}/12`
    : '—';

  // Satellite from snapshot (preferred) or report
  const satBase64 = snapshot?.satelliteImageBase64 ?? sys.satelliteImageBase64;
  const satUrl    = snapshot?.satelliteImageUrl    ?? sys.satelliteImageUrl;
  const satLat    = snapshot?.satelliteLat         ?? sys.satelliteLat;
  const satLng    = snapshot?.satelliteLng         ?? sys.satelliteLng;

  // Address parts
  const address = sys.address ?? snapshot?.address ?? perm?.projectAddress ?? '—';
  const city    = snapshot?.city ?? '';
  const state   = snapshot?.stateCode ?? '';
  const zip     = snapshot?.zip ?? '';

  // Construction notes — NEC-cited
  const notes = buildConstructionNotes(necVer, ibcVer, ifcVer, {
    rapidShutdown:     elec?.rapidShutdownRequired ?? true,
    conduitType:       elec?.dcConduitSize?.split('"')[0]?.trim() ?? 'EMT',
    wireGauge:         elec?.dcWireGauge ?? '#10 AWG',
    utilityName:       sys.utilityName ?? 'the serving utility',
    hasBattery:        !!report.battery,
    acKw:              sys.systemSizeAcKw ?? 0,
  });

  const prepared: PermitCoverData = {
    projectName:          perm?.projectAddress ? `Solar PV System — ${perm.projectAddress}` : `${sys.panelCount ?? 0}x${sys.panelWattage ?? 400}W Solar PV System`,
    clientName:           report.clientName ?? 'Client',
    address,
    city,
    state,
    zip,
    apn:                  report.apn ?? '—',

    ahj:                  sys.ahj ?? '—',
    utility:              sys.utilityName ?? '—',
    necVersion:           necVer,
    ibcVersion:           ibcVer,
    ifcVersion:           ifcVer,

    systemSizeKWDC:       sys.systemSizeDcKw   ?? sys.systemSizeKw ?? 0,
    systemSizeKWAC:       sys.systemSizeAcKw   ?? 0,
    moduleCount:          sys.panelCount        ?? 0,
    moduleModel,
    moduleManufacturer:   moduleMfr,
    moduleWatts:          sys.panelWattage      ?? 400,
    inverterModel,
    inverterManufacturer: inverterMfr,
    inverterType:         (sys.inverterType?.toLowerCase().includes('micro') ? 'microinverter'
                          : sys.inverterType?.toLowerCase().includes('optim') ? 'optimizer'
                          : 'string_inverter') as PermitCoverData['inverterType'],
    mountingSystem:       sys.mountType         ?? 'FLUSH ROOF MOUNT RACKING SYSTEM',

    interconnectionMethod: elec?.interconnectionMethod ?? 'PV BACKFEED BREAKER',
    backfeedAmps:          backfeedA,
    mainPanelAmps:         svcAmps,
    mainBreakerDeRatePass: rulePass,

    roofType:             stru?.roofType        ?? 'COMP. SHINGLE ROOF',
    roofPitch:            pitchStr,
    roofFraming:          stru?.rafterSize      ? `${stru.rafterSize} @ ${stru.rafterSpacingIn ?? 24}" O.C.` : '2"x4" TRUSSES @ 24" O.C.',
    stories:              stru?.stories ?? 'ONE STORY',
    roofLayers:           stru?.roofLayers ?? 1,
    roofLoadPsf:          stru?.roofLoadPsf ?? 20,
    windSpeedMph:         stru?.windSpeedMph    ?? 115,
    windExposure:         stru?.windExposure ?? 'C',
    exposureCategory:     stru?.exposureCategory ?? 'II',
    groundSnowPsf:        stru?.groundSnowLoadPsf ?? 0,

    satelliteImageBase64: satBase64,
    satelliteImageUrl:    satUrl,
    satelliteLat:         satLat,
    satelliteLng:         satLng,

    engineerCompany:  'SolarPro Engineering',
    engineerAddress:  address,
    engineerPhone:    undefined,

    preparedDate:     report.generatedAt ?? new Date().toISOString(),
    designer:         report.designer ?? 'SolarPro Engineering Engine',
    revision:         'A',

    sheets:            PERMIT_SHEET_INDEX,
    constructionNotes: notes,

    ...overrides,
  };

  return prepared;
}

// ─── Render PermitCoverData → Self-contained HTML ─────────────────────────────

export function renderPermitCoverHTML(data: PermitCoverData): string {
  // ── Engineering Authority Edition ──────────────────────────────────────────
  // display:table layout throughout (wkhtmltopdf compatible).
  // Pure black/white. No rounded corners. No shadows. No soft UI.
  // ALL DATA BINDINGS IDENTICAL TO CoverSheet.tsx.

  const dcKw     = data.systemSizeKWDC.toFixed(3);
  const acKw     = data.systemSizeKWAC.toFixed(3);
  const busLimit = Math.round(data.mainPanelAmps * 1.2);
  const dateStr  = data.preparedDate
    ? new Date(data.preparedDate).toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })
    : new Date().toLocaleDateString('en-US');

  // ── System type label (derived from mountingSystem, same as CoverSheet.tsx) ──
  const mtg = (data.mountingSystem ?? '').toUpperCase();
  const sysTypeLabel =
    mtg.includes('GROUND') ? 'GROUND MOUNT' :
    mtg.includes('FENCE')  ? 'SOL FENCE / GROUND MOUNT' :
                              'ROOF MOUNT';

  // ── Full address ──
  const fullAddress = [data.address, data.city, data.state, data.zip].filter(Boolean).join(', ');

  // ── Inverter label ──
  const inverterLabel =
    data.inverterType === 'microinverter' ? 'MICROINVERTER' :
    data.inverterType === 'optimizer'     ? 'POWER OPTIMIZER + INVERTER' :
                                            'STRING INVERTER';

  // ── Vicinity map HTML ──
  let vicinityMap = '';
  if (data.satelliteImageBase64) {
    vicinityMap = `
      <div style="position:relative;width:100%;overflow:hidden;border:0;">
        <img src="${data.satelliteImageBase64}" style="width:100%;height:340px;display:block;object-fit:cover;object-position:center;" alt="Vicinity Map"/>
        <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;">
          <svg viewBox="0 0 32 40" width="32" height="40" style="display:block;margin:0 auto;">
            <polygon points="16,2 2,38 16,30 30,38" fill="#000"/>
          </svg>
          <div style="background:#fff;color:#000;font-size:8px;font-weight:900;padding:2px 8px;border:1.5px solid #000;white-space:nowrap;letter-spacing:0.5px;margin-top:1px;">PROJECT SITE</div>
        </div>
        <div style="position:absolute;top:6px;left:50%;transform:translateX(-50%);background:rgba(255,255,255,0.92);color:#000;font-size:8px;font-weight:900;padding:2px 8px;letter-spacing:0.3px;white-space:nowrap;border:1px solid #000;">${esc(data.address)}</div>
        <div style="position:absolute;top:6px;right:8px;background:#fff;border:1.5px solid #000;padding:3px;">
          <svg viewBox="0 0 48 48" width="34" height="34" xmlns="http://www.w3.org/2000/svg">
            <circle cx="24" cy="24" r="22" fill="none" stroke="#000" stroke-width="1.5"/>
            <polygon points="24,3 21,20 24,17 27,20" fill="#000"/>
            <polygon points="24,45 21,28 24,31 27,28" fill="#fff" stroke="#000" stroke-width="0.8"/>
            <line x1="2" y1="24" x2="7" y2="24" stroke="#000" stroke-width="1.5"/>
            <line x1="41" y1="24" x2="46" y2="24" stroke="#000" stroke-width="1.5"/>
            <circle cx="24" cy="24" r="1.6" fill="#000"/>
            <text x="24" y="12" text-anchor="middle" font-size="7" font-weight="bold" font-family="Arial" fill="#000">N</text>
          </svg>
        </div>
      </div>`;
  } else {
    vicinityMap = `
      <div style="position:relative;background:#e8e8e8;border:0;width:100%;height:340px;overflow:hidden;">
        <svg viewBox="0 0 700 340" width="100%" height="340" style="display:block;" xmlns="http://www.w3.org/2000/svg">
          <rect width="700" height="340" fill="#e0e0e0"/>
          <rect x="0" y="130" width="700" height="80" fill="rgba(140,130,100,0.35)"/>
          <rect x="280" y="0" width="140" height="340" fill="rgba(140,130,100,0.35)"/>
          <text x="350" y="28" text-anchor="middle" font-size="11" fill="#444" font-family="Arial" font-weight="bold">STREET</text>
          <rect x="40" y="18" width="200" height="100" fill="#ccc" stroke="#888" stroke-width="1"/>
          <rect x="460" y="18" width="200" height="100" fill="#ccc" stroke="#888" stroke-width="1"/>
          <rect x="40" y="222" width="200" height="100" fill="#ccc" stroke="#888" stroke-width="1"/>
          <rect x="460" y="222" width="200" height="100" fill="#ccc" stroke="#888" stroke-width="1"/>
          <rect x="190" y="30" width="230" height="110" fill="#b8c8d0" stroke="#000" stroke-width="2"/>
          <text x="305" y="82" text-anchor="middle" font-size="10" fill="#000" font-family="Arial" font-weight="bold">PROJECT SITE</text>
          <polygon points="305,58 294,74 305,70 316,74" fill="#000"/>
          <g transform="translate(672,22)">
            <circle cx="0" cy="0" r="20" fill="rgba(255,255,255,0.9)" stroke="#000" stroke-width="1.5"/>
            <polygon points="0,-14 3,5 0,3 -3,5" fill="#000"/>
            <text x="0" y="-17" text-anchor="middle" font-size="9" font-weight="bold" fill="#000" font-family="Arial">N</text>
            <text x="0" y="24" text-anchor="middle" font-size="8" fill="#555" font-family="Arial">S</text>
            <text x="-24" y="3" text-anchor="middle" font-size="8" fill="#555" font-family="Arial">W</text>
            <text x="24" y="3" text-anchor="middle" font-size="8" fill="#555" font-family="Arial">E</text>
          </g>
        </svg>
      </div>`;
  }

  // ── Battery row ──
  const batteryRow = (data.batteryCount && data.batteryCount > 0)
    ? `<tr>
        <td style="width:32px;font-weight:900;font-size:8px;padding:2px 3px;background:#f4f4f4;border:1px solid #000;white-space:nowrap;">(N)</td>
        <td style="width:28px;font-weight:900;font-size:8px;padding:2px 3px;background:#f4f4f4;border:1px solid #000;text-align:center;">${data.batteryCount}</td>
        <td style="font-size:8px;padding:2px 3px;border:1px solid #000;">${data.batteryManufacturer ? esc(data.batteryManufacturer) + ' ' : ''}${esc(data.batteryModel ?? '\u2014')} BATTERY STORAGE SYSTEM</td>
       </tr>`
    : '';

  // ── Battery config row ──
  const batteryConfigRow = (data.batteryCount && data.batteryCount > 0)
    ? `<tr style="background:#000;color:#fff;">
        <td colspan="3" style="font-size:7.5px;font-weight:900;padding:2px 4px;letter-spacing:0.3px;">
          BATTERY CONFIG: ${esc(data.batteryConfig ?? 'PARTIAL HOME BACKUP')}
        </td>
       </tr>`
    : '';

  // ── Construction notes as numbered list ──
  const notesHtml = data.constructionNotes.map((n, i) =>
    `<div style="display:table;width:100%;margin-bottom:2px;">
       <div style="display:table-cell;width:18px;font-weight:900;vertical-align:top;font-size:7.5px;padding-right:2px;">${i + 1}.</div>
       <div style="display:table-cell;font-size:7.5px;line-height:1.38;vertical-align:top;">${esc(n)}</div>
     </div>`
  ).join('') +
  `<div style="display:table;width:100%;margin-top:4px;border-top:1px solid #000;padding-top:3px;">
     <div style="display:table-cell;width:18px;font-weight:900;vertical-align:top;font-size:7.5px;padding-right:2px;">${data.constructionNotes.length + 1}.</div>
     <div style="display:table-cell;font-size:7.5px;line-height:1.38;vertical-align:top;font-weight:700;">CONTRACTOR RESPONSIBLE FOR VERIFICATION OF ALL SITE CONDITIONS PRIOR TO INSTALLATION. FIELD VERIFY ALL DIMENSIONS AND EXISTING CONDITIONS. NOT TO SCALE UNLESS OTHERWISE NOTED. REPORT DISCREPANCIES TO ENGINEER OF RECORD IMMEDIATELY.</div>
   </div>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>PV-0 PERMIT COVER SHEET \u2014 ${esc(data.projectName)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Arial',sans-serif; font-size:8.5px; color:#000; background:#fff; }
  .page { width:11in; min-height:17in; padding:0.28in; display:block; background:#fff; }
</style>
</head>
<body>
<div class="page">
<div style="border:3px solid #000;width:100%;min-height:16.4in;position:relative;">

  <!-- ══ TITLE BAR ══════════════════════════════════════════════════════════ -->
  <div style="display:table;width:100%;border-collapse:collapse;border-bottom:2.5px solid #000;">
    <div style="display:table-cell;vertical-align:middle;padding:7px 10px;">
      <div style="font-size:20px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;line-height:1;">
        PHOTOVOLTAIC ${esc(sysTypeLabel)} SYSTEM
      </div>
      <div style="font-size:9px;font-weight:700;margin-top:3px;letter-spacing:0.3px;">
        PERMIT SUBMITTAL DOCUMENTS &mdash; ${esc(fullAddress)}
      </div>
    </div>
    <div style="display:table-cell;width:200px;vertical-align:middle;padding:5px 10px;border-left:2px solid #000;background:#000;">
      <div style="font-size:18px;font-weight:900;color:#fff;letter-spacing:2px;font-family:Arial,sans-serif;">SolarPro</div>
      <div style="font-size:8px;font-weight:700;color:#fff;letter-spacing:3px;">ENGINEERING</div>
    </div>
  </div>

  <!-- ══ PROJECT ID BAR ════════════════════════════════════════════════════ -->
  <div style="display:table;width:100%;border-collapse:collapse;border-bottom:1.5px solid #000;background:#f4f4f4;">
    <div style="display:table-cell;padding:3px 8px;border-right:1px solid #000;width:22%;">
      <span style="font-size:7px;font-weight:900;letter-spacing:0.5px;">PROJECT: </span>
      <span style="font-size:7.5px;font-weight:700;">${esc(data.projectName)}</span>
    </div>
    <div style="display:table-cell;padding:3px 8px;border-right:1px solid #000;width:14%;">
      <span style="font-size:7px;font-weight:900;">APN: </span>
      <span style="font-size:7.5px;">${esc(data.apn ?? '\u2014')}</span>
    </div>
    <div style="display:table-cell;padding:3px 8px;border-right:1px solid #000;width:14%;">
      <span style="font-size:7px;font-weight:900;">AHJ: </span>
      <span style="font-size:7.5px;">${esc(data.ahj)}</span>
    </div>
    <div style="display:table-cell;padding:3px 8px;border-right:1px solid #000;width:14%;">
      <span style="font-size:7px;font-weight:900;">UTILITY: </span>
      <span style="font-size:7.5px;">${esc(data.utility)}</span>
    </div>
    <div style="display:table-cell;padding:3px 8px;width:36%;text-align:right;">
      <span style="font-size:7px;font-weight:900;letter-spacing:0.3px;">FIELD VERIFY ALL DIMENSIONS &middot; NOT TO SCALE UNLESS OTHERWISE NOTED</span>
    </div>
  </div>

  <!-- ══ SYSTEM SPEC BLOCK ═════════════════════════════════════════════════ -->
  <div style="border-bottom:2px solid #000;background:#fff;">
    <div style="background:#000;color:#fff;font-size:8.5px;font-weight:900;padding:3px 8px;letter-spacing:1px;">
      &#9608; PHOTOVOLTAIC SYSTEM SPECIFICATION
    </div>
    <div style="display:table;width:100%;border-collapse:collapse;">
      <div style="display:table-row;">
        <div style="display:table-cell;width:16.6%;padding:3px 8px;border-right:1px solid #000;border-bottom:1px solid #000;background:#f4f4f4;">
          <div style="font-size:7px;font-weight:900;letter-spacing:0.3px;">SYSTEM TYPE</div>
        </div>
        <div style="display:table-cell;width:16.6%;padding:3px 8px;border-right:1px solid #000;border-bottom:1px solid #000;">
          <div style="font-size:8.5px;font-weight:900;">${esc(sysTypeLabel)}</div>
        </div>
        <div style="display:table-cell;width:16.6%;padding:3px 8px;border-right:1px solid #000;border-bottom:1px solid #000;background:#f4f4f4;">
          <div style="font-size:7px;font-weight:900;letter-spacing:0.3px;">SYSTEM SIZE DC</div>
        </div>
        <div style="display:table-cell;width:16.6%;padding:3px 8px;border-right:1px solid #000;border-bottom:1px solid #000;">
          <div style="font-size:8.5px;font-weight:900;">${dcKw} kW DC</div>
        </div>
        <div style="display:table-cell;width:16.6%;padding:3px 8px;border-right:1px solid #000;border-bottom:1px solid #000;background:#f4f4f4;">
          <div style="font-size:7px;font-weight:900;letter-spacing:0.3px;">SYSTEM SIZE AC</div>
        </div>
        <div style="display:table-cell;width:16.6%;padding:3px 8px;border-bottom:1px solid #000;">
          <div style="font-size:8.5px;font-weight:900;">${acKw} kW AC</div>
        </div>
      </div>
      <div style="display:table-row;">
        <div style="display:table-cell;padding:3px 8px;border-right:1px solid #000;background:#f4f4f4;">
          <div style="font-size:7px;font-weight:900;letter-spacing:0.3px;">MODULE COUNT</div>
        </div>
        <div style="display:table-cell;padding:3px 8px;border-right:1px solid #000;">
          <div style="font-size:8.5px;font-weight:900;">${data.moduleCount} MODULES @ ${data.moduleWatts}W EA.</div>
        </div>
        <div style="display:table-cell;padding:3px 8px;border-right:1px solid #000;background:#f4f4f4;">
          <div style="font-size:7px;font-weight:900;letter-spacing:0.3px;">INVERTER TYPE</div>
        </div>
        <div style="display:table-cell;padding:3px 8px;border-right:1px solid #000;">
          <div style="font-size:8.5px;font-weight:900;">${inverterLabel}</div>
        </div>
        <div style="display:table-cell;padding:3px 8px;border-right:1px solid #000;background:#f4f4f4;">
          <div style="font-size:7px;font-weight:900;letter-spacing:0.3px;">INTERCONNECTION</div>
        </div>
        <div style="display:table-cell;padding:3px 8px;">
          <div style="font-size:8.5px;font-weight:900;">${esc(data.interconnectionMethod)}</div>
        </div>
      </div>
    </div>
  </div>

  <!-- ══ MAIN BODY: left area + right title strip ═══════════════════════════ -->
  <div style="display:table;width:100%;table-layout:fixed;border-collapse:collapse;">

    <!-- ── LEFT CONTENT AREA ─────────────────────────────────────────────── -->
    <div style="display:table-cell;vertical-align:top;padding:0;border-right:2px solid #000;">

      <!-- Two-col: specs + construction notes -->
      <div style="display:table;width:100%;table-layout:fixed;border-collapse:collapse;">

        <!-- SPECS COLUMN -->
        <div style="display:table-cell;width:44%;vertical-align:top;padding:6px 6px 6px 8px;border-right:1.5px solid #000;">

          <!-- Equipment Schedule -->
          <div style="font-size:8px;font-weight:900;letter-spacing:0.5px;border-bottom:1.5px solid #000;padding-bottom:2px;margin-bottom:3px;text-transform:uppercase;">
            EQUIPMENT SCHEDULE
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:8px;margin-bottom:6px;">
            <thead>
              <tr style="background:#000;color:#fff;">
                <td style="padding:2px 3px;font-weight:900;font-size:7.5px;width:32px;">TAG</td>
                <td style="padding:2px 3px;font-weight:900;font-size:7.5px;width:28px;">QTY</td>
                <td style="padding:2px 3px;font-weight:900;font-size:7.5px;">DESCRIPTION</td>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="padding:2px 3px;background:#f4f4f4;border:1px solid #000;font-weight:900;font-size:8px;white-space:nowrap;">(N)</td>
                <td style="padding:2px 3px;background:#f4f4f4;border:1px solid #000;font-weight:900;font-size:8px;text-align:center;">${data.moduleCount}</td>
                <td style="padding:2px 3px;border:1px solid #000;font-size:8px;">${esc(data.moduleManufacturer ? data.moduleManufacturer + ': ' : '')}${esc(data.moduleModel)} (${data.moduleWatts}W) PV MODULE</td>
              </tr>
              <tr>
                <td style="padding:2px 3px;background:#f4f4f4;border:1px solid #000;font-weight:900;font-size:8px;white-space:nowrap;">(N)</td>
                <td style="padding:2px 3px;background:#f4f4f4;border:1px solid #000;font-weight:900;font-size:8px;text-align:center;">${data.inverterType === 'microinverter' ? data.moduleCount : 1}</td>
                <td style="padding:2px 3px;border:1px solid #000;font-size:8px;">${esc(data.inverterManufacturer ? data.inverterManufacturer + ': ' : '')}${esc(data.inverterModel)} ${inverterLabel}</td>
              </tr>
              ${batteryRow}
              <tr>
                <td style="padding:2px 3px;background:#f4f4f4;border:1px solid #000;font-weight:900;font-size:8px;white-space:nowrap;">(E)</td>
                <td style="padding:2px 3px;background:#f4f4f4;border:1px solid #000;font-weight:900;font-size:8px;text-align:center;">1</td>
                <td style="padding:2px 3px;border:1px solid #000;font-size:8px;">${data.mainPanelAmps}A MAIN SERVICE PANEL (EXISTING TO REMAIN)</td>
              </tr>
              <tr>
                <td style="padding:2px 3px;background:#f4f4f4;border:1px solid #000;font-weight:900;font-size:8px;white-space:nowrap;">(N)</td>
                <td style="padding:2px 3px;background:#f4f4f4;border:1px solid #000;font-weight:900;font-size:8px;text-align:center;">1</td>
                <td style="padding:2px 3px;border:1px solid #000;font-size:8px;">${esc(data.mountingSystem)}</td>
              </tr>
              <tr>
                <td style="padding:2px 3px;background:#f4f4f4;border:1px solid #000;font-weight:900;font-size:8px;white-space:nowrap;">(N)</td>
                <td style="padding:2px 3px;background:#f4f4f4;border:1px solid #000;font-weight:900;font-size:8px;text-align:center;">1</td>
                <td style="padding:2px 3px;border:1px solid #000;font-size:8px;">${data.backfeedAmps}A PV BACKFEED BREAKER</td>
              </tr>
              <tr>
                <td style="padding:2px 3px;background:#f4f4f4;border:1px solid #000;font-weight:900;font-size:8px;white-space:nowrap;">(N)</td>
                <td style="padding:2px 3px;background:#f4f4f4;border:1px solid #000;font-weight:900;font-size:8px;text-align:center;">1</td>
                <td style="padding:2px 3px;border:1px solid #000;font-size:8px;">${busLimit}A MAX OCPD PER 120% RULE &mdash; NEC 705.12</td>
              </tr>
              ${batteryConfigRow}
            </tbody>
          </table>

          <!-- Interconnection + 120% rule -->
          <div style="border:1.5px solid #000;margin-bottom:6px;">
            <div style="background:#000;color:#fff;font-size:7.5px;font-weight:900;padding:2px 4px;letter-spacing:0.5px;">INTERCONNECTION METHOD</div>
            <div style="padding:2px 6px;font-size:8px;font-weight:900;">${esc(data.interconnectionMethod)}</div>
            <div style="border-top:1px solid #000;background:#f4f4f4;padding:2px 6px;display:table;width:100%;">
              <div style="display:table-cell;font-size:7.5px;font-weight:900;">120% RULE:</div>
              <div style="display:table-cell;font-size:7.5px;padding-left:4px;">
                ${data.mainPanelAmps}A BUS &times; 1.2 = ${busLimit}A MAX &mdash; ${data.mainBreakerDeRatePass ? 'PASS &#10003;' : 'FAIL &#10007; &mdash; BUS UPGRADE REQUIRED'}
              </div>
            </div>
          </div>

          <!-- Design Criteria -->
          <div style="font-size:8px;font-weight:900;letter-spacing:0.5px;border-bottom:1.5px solid #000;padding-bottom:2px;margin-bottom:3px;">
            DESIGN CRITERIA
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:8px;margin-bottom:6px;">
            <tr>
              <td style="padding:2px 4px;background:#f4f4f4;border:1px solid #000;font-weight:900;width:45%;font-size:7.5px;">ROOF TYPE</td>
              <td style="padding:2px 4px;border:1px solid #000;font-size:7.5px;">${esc(data.roofType)}</td>
            </tr>
            <tr>
              <td style="padding:2px 4px;background:#f4f4f4;border:1px solid #000;font-weight:900;font-size:7.5px;">ROOF LAYERS</td>
              <td style="padding:2px 4px;border:1px solid #000;font-size:7.5px;">${String(data.roofLayers).padStart(2, '0')}</td>
            </tr>
            <tr>
              <td style="padding:2px 4px;background:#f4f4f4;border:1px solid #000;font-weight:900;font-size:7.5px;">ROOF FRAMING</td>
              <td style="padding:2px 4px;border:1px solid #000;font-size:7.5px;">${esc(data.roofFraming)}</td>
            </tr>
            <tr>
              <td style="padding:2px 4px;background:#f4f4f4;border:1px solid #000;font-weight:900;font-size:7.5px;">STORIES</td>
              <td style="padding:2px 4px;border:1px solid #000;font-size:7.5px;">${esc(data.stories)}</td>
            </tr>
            <tr>
              <td style="padding:2px 4px;background:#f4f4f4;border:1px solid #000;font-weight:900;font-size:7.5px;">ROOF PITCH</td>
              <td style="padding:2px 4px;border:1px solid #000;font-size:7.5px;">${esc(data.roofPitch)}</td>
            </tr>
            <tr>
              <td style="padding:2px 4px;background:#f4f4f4;border:1px solid #000;font-weight:900;font-size:7.5px;">ROOF LOAD</td>
              <td style="padding:2px 4px;border:1px solid #000;font-size:7.5px;">${data.roofLoadPsf} PSF</td>
            </tr>
            <tr>
              <td style="padding:2px 4px;background:#f4f4f4;border:1px solid #000;font-weight:900;font-size:7.5px;">WIND SPEED</td>
              <td style="padding:2px 4px;border:1px solid #000;font-size:7.5px;">${data.windSpeedMph} MPH</td>
            </tr>
            <tr>
              <td style="padding:2px 4px;background:#f4f4f4;border:1px solid #000;font-weight:900;font-size:7.5px;">WIND EXPOSURE</td>
              <td style="padding:2px 4px;border:1px solid #000;font-size:7.5px;">EXPOSURE ${esc(data.windExposure)}</td>
            </tr>
            <tr>
              <td style="padding:2px 4px;background:#f4f4f4;border:1px solid #000;font-weight:900;font-size:7.5px;">EXPOSURE CAT.</td>
              <td style="padding:2px 4px;border:1px solid #000;font-size:7.5px;">CATEGORY ${esc(data.exposureCategory)}</td>
            </tr>
            <tr>
              <td style="padding:2px 4px;background:#f4f4f4;border:1px solid #000;font-weight:900;font-size:7.5px;">SNOW LOAD</td>
              <td style="padding:2px 4px;border:1px solid #000;font-size:7.5px;">${data.groundSnowPsf} PSF</td>
            </tr>
          </table>

          <!-- Governing Codes -->
          <div style="font-size:8px;font-weight:900;letter-spacing:0.5px;border-bottom:1.5px solid #000;padding-bottom:2px;margin-bottom:3px;">
            GOVERNING CODES
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:7.5px;margin-bottom:6px;">
            <tr><td style="padding:2px 4px;border:1px solid #000;">${esc(data.ibcVersion)} INTERNATIONAL BUILDING CODE (IBC)</td></tr>
            <tr><td style="padding:2px 4px;border:1px solid #000;">${esc(data.ibcVersion)} INTERNATIONAL RESIDENTIAL CODE (IRC)</td></tr>
            <tr><td style="padding:2px 4px;border:1px solid #000;">${esc(data.ifcVersion)} INTERNATIONAL FIRE CODE (IFC)</td></tr>
            <tr><td style="padding:2px 4px;border:1px solid #000;">${esc(data.necVersion)} NATIONAL ELECTRICAL CODE (NEC)</td></tr>
            <tr><td style="padding:2px 4px;border:1px solid #000;">ASCE 7-22 MINIMUM DESIGN LOADS FOR BUILDINGS</td></tr>
          </table>

          <!-- Sheet Index -->
          <div style="font-size:8px;font-weight:900;letter-spacing:0.5px;border-bottom:1.5px solid #000;padding-bottom:2px;margin-bottom:3px;">
            SHEET INDEX
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:7.5px;">
            <thead>
              <tr style="background:#000;color:#fff;">
                <td style="padding:2px 4px;font-weight:900;width:52px;">SHEET NO.</td>
                <td style="padding:2px 4px;font-weight:900;">DESCRIPTION</td>
              </tr>
            </thead>
            <tbody>
              ${data.sheets.map(s =>
                `<tr>
                  <td style="padding:2px 4px;border:1px solid #000;font-family:monospace;font-weight:900;font-size:8px;">${esc(s.id)}</td>
                  <td style="padding:2px 4px;border:1px solid #000;">${esc(s.title)}</td>
                </tr>`
              ).join('')}
            </tbody>
          </table>

        </div><!-- end specs column -->

        <!-- CONSTRUCTION NOTES COLUMN -->
        <div style="display:table-cell;width:56%;vertical-align:top;padding:6px 8px;">
          <div style="font-size:8px;font-weight:900;letter-spacing:0.5px;border-bottom:1.5px solid #000;padding-bottom:2px;margin-bottom:4px;">
            CONSTRUCTION NOTES
          </div>
          ${notesHtml}

          <!-- Authority line -->
          <div style="margin-top:6px;border:2px solid #000;padding:4px 6px;background:#f4f4f4;">
            <div style="font-size:7.5px;font-weight:900;letter-spacing:0.3px;">
              CONTRACTOR RESPONSIBLE FOR VERIFICATION OF ALL SITE CONDITIONS PRIOR TO INSTALLATION.
              FIELD VERIFY ALL DIMENSIONS AND EXISTING CONDITIONS.
              NOT TO SCALE UNLESS OTHERWISE NOTED.
              REPORT DISCREPANCIES TO ENGINEER OF RECORD IMMEDIATELY.
            </div>
          </div>
        </div><!-- end notes column -->

      </div><!-- end two-col -->

      <!-- ── VICINITY MAP ─────────────────────────────────────────────────── -->
      <div style="border-top:2px solid #000;">
        ${vicinityMap}
        <!-- Map label bar -->
        <div style="display:table;width:100%;border-top:1.5px solid #000;background:#fff;">
          <div style="display:table-cell;width:50px;padding:3px 6px;border-right:1px solid #000;vertical-align:middle;">
            <span style="font-size:13px;font-weight:900;font-family:monospace;">2</span>
          </div>
          <div style="display:table-cell;padding:3px 8px;vertical-align:middle;">
            <span style="font-size:9px;font-weight:900;letter-spacing:0.5px;">VICINITY MAP</span>
            <span style="font-size:8px;margin-left:12px;">SCALE: NTS &mdash; NOT TO SCALE</span>
          </div>
          <div style="display:table-cell;width:55px;padding:2px 4px;text-align:center;vertical-align:middle;">
            <svg viewBox="0 0 48 48" width="38" height="38" xmlns="http://www.w3.org/2000/svg">
              <circle cx="24" cy="24" r="22" fill="none" stroke="#000" stroke-width="1.5"/>
              <polygon points="24,3 21,20 24,17 27,20" fill="#000"/>
              <polygon points="24,45 21,28 24,31 27,28" fill="#fff" stroke="#000" stroke-width="0.8"/>
              <line x1="2" y1="24" x2="7" y2="24" stroke="#000" stroke-width="1.5"/>
              <line x1="41" y1="24" x2="46" y2="24" stroke="#000" stroke-width="1.5"/>
              <circle cx="24" cy="24" r="1.6" fill="#000"/>
              <text x="24" y="12" text-anchor="middle" font-size="7" font-weight="bold" font-family="Arial" fill="#000">N</text>
              <text x="24" y="47" text-anchor="middle" font-size="6" font-family="Arial" fill="#555">S</text>
            </svg>
          </div>
          <div style="display:table-cell;width:55px;padding:3px 6px;text-align:right;vertical-align:middle;border-left:1px solid #000;">
            <span style="font-size:10px;font-weight:900;font-family:monospace;">PV-0</span>
          </div>
        </div>
      </div><!-- end vicinity map -->

    </div><!-- end left content area -->

    <!-- ── RIGHT TITLE STRIP ─────────────────────────────────────────────── -->
    <div style="display:table-cell;width:148px;vertical-align:top;padding:0;">

      <!-- Company block -->
      <div style="padding:8px 6px;border-bottom:1.5px solid #000;text-align:center;background:#000;">
        <div style="font-size:15px;font-weight:900;color:#fff;letter-spacing:2px;">SolarPro</div>
        <div style="font-size:7.5px;font-weight:900;color:#fff;letter-spacing:3px;">ENGINEERING</div>
      </div>

      <!-- Engineer address -->
      <div style="padding:4px 6px;border-bottom:1.5px solid #000;font-size:7px;color:#000;line-height:1.5;text-align:center;">
        ${esc(data.engineerCompany)}<br/>
        ${esc(data.address)}<br/>
        ${data.city ? esc(data.city) + ', ' : ''}${esc(data.state)}${data.zip ? ' ' + esc(data.zip) : ''}
        ${data.engineerPhone ? '<br/>' + esc(data.engineerPhone) : ''}
      </div>

      <!-- Project name -->
      <div style="padding:4px 6px;border-bottom:1.5px solid #000;">
        <div style="font-size:6.5px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:1px;">PROJECT</div>
        <div style="font-size:7.5px;font-weight:900;">${esc(data.projectName)}</div>
      </div>

      <!-- Client -->
      <div style="padding:4px 6px;border-bottom:1.5px solid #000;">
        <div style="font-size:6.5px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:1px;">CLIENT</div>
        <div style="font-size:7.5px;font-weight:700;">${esc(data.clientName)}</div>
      </div>

      <!-- Address -->
      <div style="padding:4px 6px;border-bottom:1.5px solid #000;">
        <div style="font-size:6.5px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:1px;">SITE ADDRESS</div>
        <div style="font-size:7px;font-weight:700;line-height:1.4;">${esc(fullAddress)}</div>
      </div>

      <!-- APN/AHJ/Utility -->
      <div style="padding:4px 6px;border-bottom:1.5px solid #000;">
        <table style="width:100%;border-collapse:collapse;font-size:7px;">
          <tr>
            <td style="font-weight:900;padding:1px 0;width:42%;">APN:</td>
            <td style="padding:1px 0;">${esc(data.apn ?? '\u2014')}</td>
          </tr>
          <tr>
            <td style="font-weight:900;padding:1px 0;">AHJ:</td>
            <td style="padding:1px 0;">${esc(data.ahj)}</td>
          </tr>
          <tr>
            <td style="font-weight:900;padding:1px 0;">UTILITY:</td>
            <td style="padding:1px 0;">${esc(data.utility)}</td>
          </tr>
        </table>
      </div>

      <!-- Revisions table -->
      <div style="border-bottom:1.5px solid #000;">
        <div style="background:#000;color:#fff;font-size:7.5px;font-weight:900;padding:2px 6px;text-align:center;letter-spacing:1px;">REVISIONS</div>
        <table style="width:100%;border-collapse:collapse;font-size:6.5px;">
          <tr style="background:#f4f4f4;">
            <td style="padding:2px 3px;font-weight:900;border:1px solid #000;width:30%;">REV</td>
            <td style="padding:2px 3px;font-weight:900;border:1px solid #000;">DATE</td>
            <td style="padding:2px 3px;font-weight:900;border:1px solid #000;width:40%;">DESCRIPTION</td>
          </tr>
          <tr>
            <td style="padding:2px 3px;font-weight:900;border:1px solid #000;font-size:7.5px;">${esc(data.revision)}</td>
            <td style="padding:2px 3px;border:1px solid #000;">${dateStr}</td>
            <td style="padding:2px 3px;border:1px solid #000;">ISSUED FOR PERMIT</td>
          </tr>
          <tr><td colspan="3" style="padding:5px 3px;border:1px solid #000;">&nbsp;</td></tr>
          <tr><td colspan="3" style="padding:5px 3px;border:1px solid #000;">&nbsp;</td></tr>
          <tr><td colspan="3" style="padding:5px 3px;border:1px solid #000;">&nbsp;</td></tr>
        </table>
      </div>

      <!-- Designed by / Date -->
      <div style="padding:4px 6px;border-bottom:1.5px solid #000;">
        <table style="width:100%;border-collapse:collapse;font-size:7px;">
          <tr>
            <td style="font-weight:900;padding:1px 0;width:48%;">DESIGNED BY:</td>
            <td style="padding:1px 0;">${esc(data.designer)}</td>
          </tr>
          <tr>
            <td style="font-weight:900;padding:1px 0;">DATE:</td>
            <td style="padding:1px 0;">${dateStr}</td>
          </tr>
          <tr>
            <td style="font-weight:900;padding:1px 0;">SCALE:</td>
            <td style="padding:1px 0;">NTS</td>
          </tr>
        </table>
      </div>

      <!-- PE Stamp -->
      <div style="padding:6px;border-bottom:1.5px solid #000;text-align:center;">
        <div style="border:2px solid #000;width:90px;height:90px;margin:0 auto;display:table;">
          <div style="display:table-cell;vertical-align:middle;font-size:7px;font-weight:900;text-align:center;line-height:1.5;">PE STAMP<br/>REQUIRED</div>
        </div>
      </div>

      <!-- Sheet name / size / number -->
      <div style="padding:4px 6px;border-bottom:1.5px solid #000;">
        <div style="font-size:6.5px;font-weight:900;letter-spacing:0.5px;margin-bottom:1px;">SHEET NAME</div>
        <div style="font-size:10px;font-weight:900;">COVER SHEET</div>
      </div>
      <div style="padding:4px 6px;border-bottom:1.5px solid #000;">
        <div style="font-size:6.5px;font-weight:900;letter-spacing:0.5px;margin-bottom:1px;">SHEET SIZE</div>
        <div style="font-size:8px;font-weight:700;">ANSI B &mdash; 11"&times;17"</div>
      </div>
      <div style="padding:4px 6px;">
        <div style="font-size:6.5px;font-weight:900;letter-spacing:0.5px;margin-bottom:1px;">SHEET NO.</div>
        <div style="font-size:20px;font-weight:900;font-family:monospace;">PV-0</div>
      </div>

    </div><!-- end right title strip -->

  </div><!-- end main body table -->

  <!-- ══ FOOTER ════════════════════════════════════════════════════════════ -->
  <div style="border-top:2px solid #000;display:table;width:100%;">
    <div style="display:table-cell;padding:3px 10px;vertical-align:middle;font-size:7px;font-weight:700;">
      ${esc(data.engineerCompany)} &mdash; ${esc(fullAddress)}
    </div>
    <div style="display:table-cell;text-align:center;padding:3px 10px;vertical-align:middle;border-left:1px solid #000;border-right:1px solid #000;">
      <span style="font-size:8px;font-weight:900;letter-spacing:1px;border:1.5px solid #000;padding:1px 10px;">
        ISSUED FOR PERMIT &mdash; REV ${esc(data.revision)}
      </span>
    </div>
    <div style="display:table-cell;padding:3px 10px;vertical-align:middle;text-align:right;font-size:7px;font-weight:700;">
      ${dateStr}
    </div>
  </div>

</div><!-- end inner border -->
</div><!-- end page -->
</body>
</html>`;
}

// ─── Build artifact object for project_files storage ─────────────────────────

export function buildPermitCoverSheetArtifact(
  report: EngineeringReport,
  snapshot?: DesignSnapshot | null,
  clientSlug?: string
): PermitArtifact {
  const data = mapReportToPermitCover(report, snapshot);
  const html = renderPermitCoverHTML(data);
  const slug = clientSlug ?? 'Client';

  return {
    fileName: `Permit_Cover_Sheet_${slug}.html`,
    fileType: 'permit_cover_sheet',
    mimeType: 'text/html',
    content:  html,
    notes:    'Permit cover sheet (PV-0) — pipeline run',
  };
}

// ─── Construction notes builder ───────────────────────────────────────────────

function buildConstructionNotes(
  necVer: string,
  ibcVer: string,
  ifcVer: string,
  opts: {
    rapidShutdown: boolean;
    conduitType: string;
    wireGauge: string;
    utilityName: string;
    hasBattery: boolean;
    acKw: number;
  }
): string[] {
  const notes: string[] = [
    `ALL WORK SHALL CONFORM TO NEC ${necVer}, ${ibcVer} IBC, ${ibcVer} IRC, ${ifcVer} IFC, ASCE 7-22, APPLICABLE STATE AMENDMENTS, AND AHJ REQUIREMENTS. ALL EQUIPMENT SHALL BE LISTED AND LABELED PER NEC 110.3(B).`,
    `A GROUND ELECTRODE SYSTEM IN ACCORDANCE WITH NEC 690.47 AND 250-50 THROUGH 250-168 SHALL BE PROVIDED PER NEC. GROUNDING ELECTRODE SYSTEM OF EXISTING BUILDING MAY BE USED AND BONDED TO AT THE SERVICE ENTRANCE IF EXISTING SYSTEMS IS INADEQUATE OR IS ONLY METALLIC WATER PIPING. A SUPPLEMENTAL GROUNDING ELECTRODE WILL BE USED AT THE INVERTER LOCATION CONSISTING OF A UL LISTED 8FT GROUND ROD WITH ACORN CLAMP.`,
    `GROUNDING ELECTRODE CONDUCTORS SHALL BE COMPLIANT TO SERVICE OR AMPERAGE MEANS AND BONDED TO THE EXISTING GROUNDING ELECTRODE TO PROVIDE OR COMPLETE GROUNDING. GROUNDING ELECTRODE TO PROVIDE OR A COMPLETE GROUND.`,
    `EACH MODULE WILL BE GROUNDED USING THE SUPPLIED GROUNDING POINTS IDENTIFIED BY THE MANUFACTURER.`,
    `EXPOSED NON-CURRENT CARRYING METAL PARTS OF MODULE FRAMES, EQUIPMENT AND CONDUCTOR ENCLOSURES SHALL BE GROUNDED REGARDLESS OF VOLTAGE.`,
    `PROPER ACCESS AND WORKING CLEARANCE AROUND EXISTING AND PROPOSED ELECTRICAL EQUIPMENT WILL BE PROVIDED.`,
    `ALL SIGNAGE WILL BE INSTALLED AS REQUIRED BY LISTED NEC.`,
    `HEIGHT OF INTEGRATED AC/DC DISCONNECT SHALL NOT EXCEED 6'-7".`,
    `THE GROUNDING ELECTRODE CONDUCTOR SHALL BE PROTECTED FROM PHYSICAL DAMAGE BETWEEN THE GROUNDING ELECTRODE AND THE PANEL (OR INVERTER) IF SMALLER THAN #8 AWG COPPER WIRE. THE GROUNDING CONDUCTOR ELECTRODE WILL BE CONTINUOUS, EXCEPT FOR SPLICES OR JOINTS AT BUSBARS WITHIN LISTED EQUIPMENT.`,
    `THE PV CONNECTION IN THE PANEL BOARD SHALL BE POSITIONED AT THE OPPOSITE (LOAD) END FROM THE INPUT FEEDER LOCATION OR MAIN CIRCUIT LOCATION.`,
    `SITE CONDITIONS SHALL PREVAIL IF NO SCALE IS GIVEN.`,
    `DRAWINGS ARE NOT NECESSARILY TO SCALE. ALL DIMENSIONS SHALL BE VERIFIED BY SUBCONTRACTOR UPON COMMENCEMENT OF CONSTRUCTION.`,
    `CONDUIT AND CONDUCTOR SPECIFICATIONS ARE BASED ON MINIMUM CODE REQUIREMENTS AND ARE NOT MEANT TO LIMIT UP-SIZING AS REQUIRED BY FIELD CONDITIONS.`,
    `SOLAR PV WIRING SHALL COMPLY WITH NEC ARTICLE 690. DC WIRING METHODS SHALL BE PER NEC 690.31. PV SOURCE AND OUTPUT CIRCUIT CONDUCTORS SHALL BE IDENTIFIED AT ALL ACCESS POINTS PER NEC 690.31(B).`,
    `SYSTEM SHALL COMPLY WITH NEC 705.12 FOR INTERCONNECTED POWER PRODUCTION EQUIPMENT. BACKFEED BREAKER SHALL BE SIZED PER NEC 705.12(B)(2)(3)(B). SUM OF ALL SUPPLY BREAKERS SHALL NOT EXCEED 120% OF BUS RATING.`,
    opts.rapidShutdown
      ? `RAPID SHUTDOWN SYSTEM REQUIRED PER NEC 690.12. MODULE-LEVEL RAPID SHUTDOWN (MLRS) SHALL REDUCE ARRAY CONDUCTORS TO \u226430V WITHIN 30 SECONDS. INITIATOR SHALL BE LOCATED AT UTILITY METER PER NEC 690.56(B).`
      : `RAPID SHUTDOWN INITIATOR SHALL BE INSTALLED PER NEC 690.12. ARRAY BOUNDARY CONDUCTORS SHALL BE DE-ENERGIZED TO \u226430V WITHIN 30 SECONDS OF INITIATION.`,
    `CONDUIT TYPE: ${opts.conduitType}. ALL CONDUIT SUPPORTS PER NEC 358.30 (EMT) OR NEC 352.30 (PVC). CONDUIT FILL SHALL NOT EXCEED 40% PER NEC CHAPTER 9, TABLE 1.`,
    `ROOF ATTACHMENTS SHALL BE INSTALLED PER MANUFACTURER INSTRUCTIONS AND ATTACHMENT DETAIL ON SHEET PV-3. LAG BOLTS MINIMUM 3/8" DIAMETER, MINIMUM 2.5" EMBEDMENT INTO RAFTER. USE STAINLESS STEEL HARDWARE THROUGHOUT.`,
    `ALL JUNCTION BOXES, COMBINER BOXES, AND CONDUIT BODIES SHALL BE ACCESSIBLE PER NEC 314.29. COVER PLATES SHALL BE SECURED AND LABELED. BOX FILL CALCULATED PER NEC 314.16.`,
    `INSTALLER SHALL VERIFY UTILITY INTERCONNECTION REQUIREMENTS WITH ${opts.utilityName.toUpperCase()} PRIOR TO ENERGIZATION. OBTAIN AHJ FINAL INSPECTION AND UTILITY PTO BEFORE ENERGIZING.`,
    `ALL EQUIPMENT SHALL BE INSTALLED PER MANUFACTURER INSTALLATION INSTRUCTIONS. FIELD MODIFICATIONS TO LISTED EQUIPMENT ARE PROHIBITED PER NEC 110.3(B). SUBSTITUTIONS REQUIRE ENGINEER APPROVAL AND AHJ RE-SUBMISSION.`,
  ];

  if (opts.hasBattery) {
    notes.push(`BATTERY ENERGY STORAGE SYSTEM (BESS) SHALL COMPLY WITH NEC ARTICLE 706 AND NFPA 855. INSTALLATION LOCATION, CLEARANCES, AND VENTILATION PER MANUFACTURER REQUIREMENTS AND AHJ. BESS SHALL BE UL 9540-LISTED.`);
  }

  return notes;
}

// ─── HTML escaping ────────────────────────────────────────────────────────────

function esc(s: string | undefined | null): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}