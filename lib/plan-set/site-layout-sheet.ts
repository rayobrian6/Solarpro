// ============================================================
// lib/plan-set/site-layout-sheet.ts
// Plan Set Sheet A-1: Site / Roof Layout (v44.0)
// Includes: roof outline, panel placement diagram, fire setbacks,
// ridge/eave/pathway dimensions, north arrow, array dimensions,
// equipment locations.
// ============================================================

import { wrapPage, escHtml, type TitleBlockData } from './title-block';

export interface SiteLayoutSheetInput {
  tb: TitleBlockData;

  // Project
  siteAddress:      string;
  city:             string;
  state:            string;

  // Roof geometry
  roofType:         string;
  roofPitchRatio:   string;
  roofWidthFt:      number;   // approximate roof width
  roofLengthFt:     number;   // approximate roof length (ridge to eave)

  // Array
  panelCount:       number;
  panelLengthIn:    number;
  panelWidthIn:     number;
  stringCount?:     number;
  panelsPerString?: number;
  systemKw:         number;

  // Fire setbacks
  ridgeSetbackIn:   number;
  eaveSetbackIn:    number;
  valleySetbackIn:  number;
  pathwayWidthIn:   number;
  pathwayRequired:  boolean;
  setbackCodeRef:   string;

  // Equipment locations (text descriptions for now)
  inverterLocation?:   string;   // e.g. "Garage wall, south side"
  disconnectLocation?: string;   // e.g. "Adjacent to inverter"
  meterLocation?:      string;   // e.g. "North exterior wall"
  mainPanelLocation?:  string;   // e.g. "Garage, east wall"

  // Optional: utility info
  utilityName?:     string;
}

export function buildSiteLayoutSheet(inp: SiteLayoutSheetInput): string {
  const content = `
    <!-- Sheet Header -->
    <div class="sheet-header">
      <div>
        <div class="sh-title">SITE &amp; ROOF LAYOUT — PV ARRAY PLACEMENT</div>
        <div class="sh-sub">${escHtml(inp.siteAddress)}, ${escHtml(inp.city)}, ${escHtml(inp.state)} · ${inp.panelCount} Modules · ${inp.systemKw.toFixed(2)} kW DC · ${escHtml(inp.roofPitchRatio)} Pitch</div>
      </div>
      <div class="sh-badge">A-1 SITE LAYOUT</div>
    </div>

    <div class="two-col" style="gap:12px; margin-top:6px; height: calc(100% - 32px);">

      <!-- LEFT: Roof Plan Diagram -->
      <div style="display:flex; flex-direction:column; gap:6px;">

        <div class="section-header">Roof Plan — Array Layout (Schematic, Not to Scale)</div>
        ${buildRoofPlanSvg(inp)}

        <!-- Dimension Notes -->
        <div style="font-size:6pt; line-height:1.7; padding:4px 6px; background:#f7f8fc; border:0.5px solid #ccd; border-radius:2px;">
          <strong>Array Dimensions (approximate):</strong><br>
          Panel size: ${inp.panelLengthIn}" × ${inp.panelWidthIn}" (${(inp.panelLengthIn/12).toFixed(1)}' × ${(inp.panelWidthIn/12).toFixed(1)}')<br>
          ${inp.stringCount && inp.panelsPerString
            ? `Configuration: ${inp.stringCount} string${inp.stringCount > 1 ? 's' : ''} × ${inp.panelsPerString} panels/string = ${inp.panelCount} total`
            : `Total panels: ${inp.panelCount}`}<br>
          System size: ${inp.systemKw.toFixed(3)} kW<sub>DC</sub><br>
          Roof pitch: ${escHtml(inp.roofPitchRatio)} · Type: ${escHtml(inp.roofType)}
        </div>

        <!-- Fire Setback Summary -->
        <div class="section-header">Fire Access Setback Summary</div>
        <table style="font-size:6.5pt;">
          <thead>
            <tr>
              <th>Location</th>
              <th style="text-align:right;">Required</th>
              <th style="text-align:right;">Provided</th>
              <th style="text-align:center;">Status</th>
              <th>Code Reference</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Ridge Setback</td>
              <td style="text-align:right;">18" min</td>
              <td style="text-align:right;"><strong>${inp.ridgeSetbackIn}"</strong></td>
              <td style="text-align:center;">${inp.ridgeSetbackIn >= 18 ? '<span style="color:#1a7a1a;">✓ PASS</span>' : '<span style="color:#a05000;">⚠ VERIFY</span>'}</td>
              <td>IRC R324.4 / CA R324</td>
            </tr>
            <tr>
              <td>Eave Setback</td>
              <td style="text-align:right;">18" min</td>
              <td style="text-align:right;"><strong>${inp.eaveSetbackIn}"</strong></td>
              <td style="text-align:center;">${inp.eaveSetbackIn >= 18 ? '<span style="color:#1a7a1a;">✓ PASS</span>' : '<span style="color:#a05000;">⚠ VERIFY</span>'}</td>
              <td>IRC R324.4 / CA R324</td>
            </tr>
            <tr>
              <td>Valley Setback</td>
              <td style="text-align:right;">18" min</td>
              <td style="text-align:right;"><strong>${inp.valleySetbackIn}"</strong></td>
              <td style="text-align:center;">${inp.valleySetbackIn >= 18 ? '<span style="color:#1a7a1a;">✓ PASS</span>' : '<span style="color:#a05000;">⚠ VERIFY</span>'}</td>
              <td>IRC R324.4 / CA R324</td>
            </tr>
            ${inp.pathwayRequired ? `
            <tr>
              <td>Access Pathway</td>
              <td style="text-align:right;">36" min</td>
              <td style="text-align:right;"><strong>${inp.pathwayWidthIn}"</strong></td>
              <td style="text-align:center;">${inp.pathwayWidthIn >= 36 ? '<span style="color:#1a7a1a;">✓ PASS</span>' : '<span style="color:#a05000;">⚠ VERIFY</span>'}</td>
              <td>IRC R324.4(B)</td>
            </tr>` : `
            <tr>
              <td>Access Pathway</td>
              <td style="text-align:right;">N/A</td>
              <td style="text-align:right;">N/A</td>
              <td style="text-align:center;"><span style="color:#888;">— N/A</span></td>
              <td>Not required</td>
            </tr>`}
          </tbody>
        </table>

        <div style="font-size:6pt; color:#555; padding:3px 6px; background:#fff8e8; border-left:3px solid #e6a817; border-radius:2px;">
          <strong>Note:</strong> Roof layout is schematic only. Exact panel placement to be verified in field by installer.
          All setback dimensions shall be measured in the plane of the roof. Contact engineer for roof geometries
          requiring special consideration (hip roofs, skylights, dormers, etc.).
        </div>

      </div>

      <!-- RIGHT: Equipment Locations + Site Notes -->
      <div style="display:flex; flex-direction:column; gap:6px;">

        <!-- Site Plan (top-down) -->
        <div class="section-header">Site Plan — Equipment Locations (Schematic)</div>
        ${buildSitePlanSvg(inp)}

        <!-- Equipment Locations Table -->
        <div class="section-header" style="margin-top:4px;">Equipment Locations</div>
        <table>
          <tr>
            <td style="color:#555; width:42%;">Inverter</td>
            <td>${inp.inverterLocation ? escHtml(inp.inverterLocation) : '<span style="color:#aaa;">Per site plan / installer</span>'}</td>
          </tr>
          <tr>
            <td style="color:#555;">DC Disconnect</td>
            <td>${inp.disconnectLocation ? escHtml(inp.disconnectLocation) : '<span style="color:#aaa;">Adjacent to inverter</span>'}</td>
          </tr>
          <tr>
            <td style="color:#555;">AC Disconnect</td>
            <td>Adjacent to inverter / per AHJ</td>
          </tr>
          <tr>
            <td style="color:#555;">Utility Meter</td>
            <td>${inp.meterLocation ? escHtml(inp.meterLocation) : '<span style="color:#aaa;">Per utility / existing</span>'}</td>
          </tr>
          <tr>
            <td style="color:#555;">Main Service Panel</td>
            <td>${inp.mainPanelLocation ? escHtml(inp.mainPanelLocation) : '<span style="color:#aaa;">Per site plan / existing</span>'}</td>
          </tr>
          <tr>
            <td style="color:#555;">RSD Initiation Device</td>
            <td>At utility meter per NEC 690.12</td>
          </tr>
          ${inp.utilityName ? `<tr><td style="color:#555;">Utility Provider</td><td>${escHtml(inp.utilityName)}</td></tr>` : ''}
        </table>

        <!-- Conduit Run Notes -->
        <div class="section-header" style="margin-top:4px;">Conduit Routing Notes</div>
        <div style="font-size:6pt; line-height:1.65; padding:4px 6px; background:#f7f8fc; border:0.5px solid #ccd; border-radius:2px;">
          ${CONDUIT_NOTES.map((n, i) => `<div style="margin-bottom:2px;"><strong>${i+1}.</strong> ${n}</div>`).join('')}
        </div>

        <!-- Layout Legend -->
        <div class="section-header" style="margin-top:4px;">Legend</div>
        <div style="display:flex; flex-wrap:wrap; gap:8px; font-size:6pt; padding:4px 6px;">
          <div style="display:flex; align-items:center; gap:4px;">
            <div style="width:14px; height:10px; background:#ffd700; opacity:0.7; border:1px solid #e6a817; border-radius:1px;"></div>
            <span>PV Panel / Array</span>
          </div>
          <div style="display:flex; align-items:center; gap:4px;">
            <div style="width:14px; height:3px; background:#c00; border-top:1px dashed #c00;"></div>
            <span>Fire Setback Line</span>
          </div>
          <div style="display:flex; align-items:center; gap:4px;">
            <div style="width:14px; height:3px; background:#1a3a6b; border-top:2px dashed #1a3a6b;"></div>
            <span>Access Pathway</span>
          </div>
          <div style="display:flex; align-items:center; gap:4px;">
            <div style="width:14px; height:10px; background:#e8f5e8; border:1px solid #1a7a1a; border-radius:1px;"></div>
            <span>Inverter / Equip.</span>
          </div>
          <div style="display:flex; align-items:center; gap:4px;">
            <div style="width:14px; height:3px; background:#555; border-top:1px solid #555;"></div>
            <span>Conduit Run</span>
          </div>
        </div>

        <!-- Site Notes -->
        <div class="section-header" style="margin-top:4px;">Site Notes</div>
        <div style="font-size:6pt; line-height:1.65; padding:4px 6px;">
          ${SITE_NOTES.map((n, i) => `<div style="margin-bottom:2px;"><strong>${i+1}.</strong> ${n}</div>`).join('')}
        </div>

      </div>
    </div>
  `;

  return wrapPage(content, inp.tb);
}

// ─── Roof Plan SVG ─────────────────────────────────────────────────────────────
function buildRoofPlanSvg(inp: SiteLayoutSheetInput): string {
  // SVG viewbox: 400 × 240
  const W = 400, H = 240;

  // Roof rectangle (looking down — flat plan view)
  const roofX = 30, roofY = 20, roofW = 300, roofH = 180;

  // Scale panel dimensions to fit on drawing
  const scale = Math.min(roofW / (inp.roofWidthFt * 12), roofH / (inp.roofLengthFt * 12));
  const scaledPanelW = inp.panelWidthIn * scale;
  const scaledPanelH = inp.panelLengthIn * scale;

  // Setback margins in SVG units
  const ridgeMargin = (inp.ridgeSetbackIn) * scale;
  const eaveMargin  = (inp.eaveSetbackIn) * scale;
  const sideMargin  = 18 * scale; // 18" valley setback on sides

  // Array area after setbacks
  const arrayX = roofX + sideMargin;
  const arrayY = roofY + ridgeMargin;
  const arrayW = roofW - 2 * sideMargin - (inp.pathwayRequired ? inp.pathwayWidthIn * scale : 0);
  const arrayH = roofH - ridgeMargin - eaveMargin;

  // Panel grid
  const cols = Math.max(1, Math.floor(arrayW / (scaledPanelW + 2)));
  const rows = Math.max(1, Math.floor(arrayH / (scaledPanelH + 2)));
  const totalInLayout = Math.min(inp.panelCount, cols * rows);

  let panelRects = '';
  let count = 0;
  for (let r = 0; r < rows && count < inp.panelCount; r++) {
    for (let c = 0; c < cols && count < inp.panelCount; c++) {
      const px = arrayX + c * (scaledPanelW + 2);
      const py = arrayY + r * (scaledPanelH + 2);
      panelRects += `<rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${scaledPanelW.toFixed(1)}" height="${scaledPanelH.toFixed(1)}" fill="#ffd700" fill-opacity="0.75" stroke="#e6a817" stroke-width="0.6"/>`;
      count++;
    }
  }

  // Pathway line (if required)
  const pathwayX = inp.pathwayRequired
    ? roofX + roofW / 2 - (inp.pathwayWidthIn * scale) / 2
    : 0;

  return `
  <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%; height:200px; border:0.5px solid #ccd; border-radius:3px; background:#f0f4ff;">

    <!-- Roof outline -->
    <rect x="${roofX}" y="${roofY}" width="${roofW}" height="${roofH}" fill="#dde" fill-opacity="0.3" stroke="#555" stroke-width="1.5"/>

    <!-- Ridge label (top) -->
    <text x="${roofX + roofW/2}" y="${roofY - 5}" text-anchor="middle" font-size="7" fill="#555" font-weight="bold">RIDGE</text>

    <!-- Eave label (bottom) -->
    <text x="${roofX + roofW/2}" y="${roofY + roofH + 12}" text-anchor="middle" font-size="7" fill="#555" font-weight="bold">EAVE</text>

    <!-- Ridge setback line -->
    <line x1="${roofX}" y1="${roofY + ridgeMargin}" x2="${roofX + roofW}" y2="${roofY + ridgeMargin}" stroke="#c00" stroke-width="1" stroke-dasharray="4,3"/>
    <text x="${roofX + roofW + 3}" y="${roofY + ridgeMargin + 4}" font-size="5.5" fill="#c00">${inp.ridgeSetbackIn}"</text>

    <!-- Eave setback line -->
    <line x1="${roofX}" y1="${roofY + roofH - eaveMargin}" x2="${roofX + roofW}" y2="${roofY + roofH - eaveMargin}" stroke="#c00" stroke-width="1" stroke-dasharray="4,3"/>
    <text x="${roofX + roofW + 3}" y="${roofY + roofH - eaveMargin + 4}" font-size="5.5" fill="#c00">${inp.eaveSetbackIn}"</text>

    <!-- Side setback lines -->
    <line x1="${roofX + sideMargin}" y1="${roofY}" x2="${roofX + sideMargin}" y2="${roofY + roofH}" stroke="#c00" stroke-width="0.8" stroke-dasharray="3,3"/>
    <line x1="${roofX + roofW - sideMargin}" y1="${roofY}" x2="${roofX + roofW - sideMargin}" y2="${roofY + roofH}" stroke="#c00" stroke-width="0.8" stroke-dasharray="3,3"/>

    <!-- Panel grid -->
    ${panelRects}
    ${count < inp.panelCount ? `<text x="${arrayX + arrayW/2}" y="${arrayY + arrayH/2 + 8}" text-anchor="middle" font-size="6" fill="#8b6000">+${inp.panelCount - count} more</text>` : ''}

    <!-- Array count label -->
    <text x="${arrayX + arrayW/2}" y="${arrayY + 10}" text-anchor="middle" font-size="6" fill="#7a5000" font-weight="bold">${inp.panelCount} MODULES — ${inp.systemKw.toFixed(2)} kW</text>

    <!-- Pathway (if required) -->
    ${inp.pathwayRequired ? `
    <rect x="${pathwayX}" y="${roofY}" width="${(inp.pathwayWidthIn * scale).toFixed(1)}" height="${roofH}" fill="#1a3a6b" fill-opacity="0.1" stroke="#1a3a6b" stroke-width="1" stroke-dasharray="5,3"/>
    <text x="${pathwayX + (inp.pathwayWidthIn * scale)/2}" y="${roofY + roofH/2}" text-anchor="middle" font-size="6" fill="#1a3a6b" font-weight="bold">${inp.pathwayWidthIn}" PATHWAY</text>
    ` : ''}

    <!-- North arrow -->
    <g transform="translate(${W - 40}, 30)">
      <circle cx="0" cy="0" r="16" fill="white" stroke="#555" stroke-width="0.8"/>
      <polygon points="0,-13 -5,5 0,2 5,5" fill="#1a3a6b"/>
      <polygon points="0,13 -5,-5 0,-2 5,-5" fill="#aaa"/>
      <text x="0" y="-16" text-anchor="middle" font-size="7" fill="#1a3a6b" font-weight="bold">N</text>
    </g>

    <!-- Roof width dimension -->
    <line x1="${roofX}" y1="${roofY + roofH + 18}" x2="${roofX + roofW}" y2="${roofY + roofH + 18}" stroke="#555" stroke-width="0.8"/>
    <polygon points="${roofX},${roofY + roofH + 18} ${roofX + 5},${roofY + roofH + 15} ${roofX + 5},${roofY + roofH + 21}" fill="#555"/>
    <polygon points="${roofX + roofW},${roofY + roofH + 18} ${roofX + roofW - 5},${roofY + roofH + 15} ${roofX + roofW - 5},${roofY + roofH + 21}" fill="#555"/>
    <text x="${roofX + roofW/2}" y="${roofY + roofH + 26}" text-anchor="middle" font-size="6" fill="#333">~${inp.roofWidthFt}' wide (schematic)</text>

    <!-- Roof length dimension -->
    <line x1="${roofX - 20}" y1="${roofY}" x2="${roofX - 20}" y2="${roofY + roofH}" stroke="#555" stroke-width="0.8"/>
    <text x="${roofX - 22}" y="${roofY + roofH/2}" text-anchor="middle" font-size="6" fill="#333" transform="rotate(-90, ${roofX - 22}, ${roofY + roofH/2})">~${inp.roofLengthFt}' long</text>

    <!-- Scale note -->
    <text x="${roofX}" y="${H - 5}" font-size="5.5" fill="#888">SCHEMATIC — NOT TO SCALE. Field verify all dimensions.</text>

  </svg>`;
}

// ─── Site Plan SVG ─────────────────────────────────────────────────────────────
function buildSitePlanSvg(inp: SiteLayoutSheetInput): string {
  const W = 320, H = 200;

  return `
  <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%; height:170px; border:0.5px solid #ccd; border-radius:3px; background:#f7f8fc;">

    <!-- Property / lot outline -->
    <rect x="10" y="10" width="${W - 20}" height="${H - 20}" fill="none" stroke="#888" stroke-width="1" stroke-dasharray="5,3"/>
    <text x="${W/2}" y="${H - 5}" text-anchor="middle" font-size="5.5" fill="#888">Property Line (schematic)</text>

    <!-- House footprint -->
    <rect x="80" y="40" width="160" height="120" fill="#e8edf5" stroke="#1a3a6b" stroke-width="1.2" rx="2"/>
    <text x="160" y="100" text-anchor="middle" font-size="7" fill="#1a3a6b" font-weight="bold">HOUSE</text>

    <!-- Roof area indicator -->
    <rect x="85" y="45" width="150" height="60" fill="#dde8ff" fill-opacity="0.6" stroke="#5577aa" stroke-width="0.8" stroke-dasharray="3,2"/>
    <text x="160" y="72" text-anchor="middle" font-size="5.5" fill="#5577aa">Roof / Array Area</text>

    <!-- PV array on roof -->
    <rect x="100" y="50" width="110" height="45" fill="#ffd700" fill-opacity="0.5" stroke="#e6a817" stroke-width="1"/>
    <text x="155" y="75" text-anchor="middle" font-size="6" fill="#7a5000" font-weight="bold">PV ARRAY</text>
    <text x="155" y="85" text-anchor="middle" font-size="5.5" fill="#7a5000">${inp.panelCount} mod · ${inp.systemKw.toFixed(1)}kW</text>

    <!-- Inverter location -->
    <rect x="${inp.inverterLocation ? 82 : 82}" y="115" width="30" height="18" fill="#e8f5e8" stroke="#1a7a1a" stroke-width="1" rx="1"/>
    <text x="97" y="126" text-anchor="middle" font-size="5" fill="#1a7a1a" font-weight="bold">INV</text>

    <!-- DC conduit from array to inverter -->
    <line x1="100" y1="95" x2="97" y2="115" stroke="#c00" stroke-width="1.2" stroke-dasharray="4,2"/>
    <text x="88" y="107" font-size="4.5" fill="#c00">DC conduit</text>

    <!-- AC conduit from inverter to panel -->
    <line x1="112" y1="124" x2="145" y2="124" stroke="#1a3a6b" stroke-width="1.2"/>
    <text x="128" y="133" text-anchor="middle" font-size="4.5" fill="#1a3a6b">AC conduit</text>

    <!-- Main panel -->
    <rect x="145" y="115" width="28" height="18" fill="#e8edf5" stroke="#1a3a6b" stroke-width="1" rx="1"/>
    <text x="159" y="126" text-anchor="middle" font-size="4.5" fill="#1a3a6b" font-weight="bold">MSP</text>

    <!-- Utility meter -->
    <rect x="220" y="115" width="28" height="18" fill="#f0f0ff" stroke="#555" stroke-width="1" rx="1"/>
    <text x="234" y="126" text-anchor="middle" font-size="4.5" fill="#555" font-weight="bold">METER</text>

    <!-- Panel to meter -->
    <line x1="173" y1="124" x2="220" y2="124" stroke="#555" stroke-width="1"/>

    <!-- Utility line -->
    <line x1="248" y1="124" x2="280" y2="124" stroke="#555" stroke-width="1" stroke-dasharray="4,2"/>
    <text x="264" y="133" text-anchor="middle" font-size="4.5" fill="#888">Utility</text>

    <!-- RSD label at meter -->
    <text x="234" y="140" text-anchor="middle" font-size="4" fill="#c00">RSD here</text>

    <!-- Street -->
    <rect x="10" y="${H - 30}" width="${W - 20}" height="14" fill="#ddd" stroke="#bbb" stroke-width="0.5"/>
    <text x="${W/2}" y="${H - 20}" text-anchor="middle" font-size="6" fill="#888">STREET</text>

    <!-- North arrow (small) -->
    <g transform="translate(${W - 22}, 25)">
      <circle cx="0" cy="0" r="10" fill="white" stroke="#555" stroke-width="0.7"/>
      <polygon points="0,-8 -3,3 0,1 3,3" fill="#1a3a6b"/>
      <text x="0" y="-10" text-anchor="middle" font-size="5.5" fill="#1a3a6b" font-weight="bold">N</text>
    </g>

    <!-- Scale note -->
    <text x="12" y="${H - 35}" font-size="5" fill="#888">NOT TO SCALE</text>

  </svg>`;
}

// ─── Notes ─────────────────────────────────────────────────────────────────────
const CONDUIT_NOTES = [
  'DC conduit from array to inverter: USE-2 or PV Wire on rooftop; THWN-2 in conduit for all penetrations and indoor runs. Schedule 40 PVC or EMT.',
  'All roof penetrations to be made at rafter locations only. Flash and seal all penetrations per manufacturer requirements.',
  'AC conduit from inverter to main service panel per wire schedule on Sheet E-1.',
  'All conduit exposed to weather shall be liquid-tight flexible conduit (LFNC) or Schedule 40 PVC at roof-to-wall transitions.',
  'Label all conduit "PHOTOVOLTAIC POWER SOURCE" per NEC 690.31(G) at intervals ≤10 ft and at penetrations.',
];

const SITE_NOTES = [
  'This site plan is schematic only. Exact equipment locations shall be determined by installer in field prior to installation.',
  'Verify all dimensions, utility service locations, and property line setbacks with local building and zoning requirements.',
  'Maintain required clearances around electrical equipment per NEC Article 110 (min 36" working space).',
  'Contact utility for net metering interconnection application requirements and inspection scheduling.',
  'All exterior equipment shall be rated for wet/outdoor locations. Use weatherproof covers on all junction boxes.',
];