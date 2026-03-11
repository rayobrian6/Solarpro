// ============================================================
// lib/plan-set/electrical-sheet.ts
// Plan Set Sheet E-1: Electrical — Single-Line Diagram + Wire Schedule
// Full NEC 690 compliant SLD with:
//   - PV array → combiner/optimizer → inverter → AC disconnect
//   - Main service panel with backfeed breaker
//   - Utility meter and grid connection
//   - Rapid shutdown device
//   - Battery storage (if present)
//   - Wire schedule table
//   - NEC code reference callouts
// ============================================================

import { wrapPage, escHtml, type TitleBlockData } from './title-block';

export interface StringRun {
  id:             string;
  label:          string;
  panelCount:     number;
  panelWatts:     number;
  wireGauge:      string;   // e.g. "#10 AWG"
  conduitType:    string;   // e.g. "3/4&quot; EMT"
  wireLength:     number;   // ft
  ocpdAmps:       number;
  stringVoc:      number;
  stringVmp:      number;
  stringIsc:      number;
  stringImp:      number;
}

export interface ElectricalSheetInput {
  tb: TitleBlockData;

  // Inverter
  inverterType:         string;   // 'string' | 'micro' | 'optimizer'
  inverterModel:        string;
  inverterCount:        number;
  inverterKw:           number;
  inverterVacOut:       number;   // e.g. 240
  inverterMaxDcV:       number;   // e.g. 600
  inverterMaxAcA:       number;

  // Strings / runs
  strings:              StringRun[];

  // DC side
  dcDisconnectAmps:     number;
  dcDisconnectVoltage:  number;
  dcWireGauge:          string;
  dcConduitType:        string;

  // AC side
  acWireGauge:          string;
  acConduitType:        string;
  acBreakerAmps:        number;
  acDisconnectAmps:     number;

  // Main panel
  mainPanelBusAmps:     number;
  mainPanelBreakerAmps: number;
  backfeedBreakerAmps:  number;
  interconnectionType:  string;   // 'supply-side' | 'load-side'
  interconnectionMethod:string;

  // Rapid shutdown
  rapidShutdownRequired:boolean;
  rapidShutdownDevice:  string;

  // Battery (optional)
  hasBattery:           boolean;
  batteryModel?:        string;
  batteryKwh?:          number;
  batteryBreakerAmps?:  number;

  // Ground
  groundWireGauge:      string;
  groundingElectrode:   string;   // e.g. "Ground Rod (2 × 5/8&quot; × 8')"

  // NEC
  necVersion:           string;
  systemKw:             number;
  panelCount:           number;
  panelModel:           string;
  stateCode:            string;
  utilityName?:         string;
}

export function buildElectricalSheet(inp: ElectricalSheetInput): string {
  const sldSvg = buildSldSvg(inp);
  const wireTable = buildWireScheduleTable(inp);
  const necNotes = buildNecNotes(inp);

  const content = `
    <!-- Sheet Header -->
    <div class="sheet-header">
      <div>
        <div class="sh-title">ELECTRICAL — SINGLE-LINE DIAGRAM &amp; WIRE SCHEDULE</div>
        <div class="sh-sub">${escHtml(inp.systemKw.toFixed(2))} kW DC · ${inp.panelCount} Panels · ${escHtml(inp.inverterType)} Inverter · ${escHtml(inp.necVersion)}</div>
      </div>
      <div class="sh-badge">E-1 ELECTRICAL</div>
    </div>

    <div style="display:grid; grid-template-columns: 1fr 320px; gap:10px; height: calc(100% - 30px);">

      <!-- SLD -->
      <div>
        <div class="section-header">Single-Line Diagram (NEC 690 Compliant)</div>
        <div style="border:1px solid #aab; border-radius:3px; padding:6px; background:#fff; height:calc(100% - 22px);">
          ${sldSvg}
        </div>
      </div>

      <!-- Right panel: wire schedule + NEC notes -->
      <div style="display:flex; flex-direction:column; gap:6px; overflow:hidden;">

        <!-- Wire Schedule -->
        <div>
          <div class="section-header">Wire &amp; Conduit Schedule</div>
          ${wireTable}
        </div>

        <!-- NEC Notes -->
        <div>
          <div class="section-header">NEC Code References</div>
          ${necNotes}
        </div>

        <!-- Rapid Shutdown Zone -->
        ${inp.rapidShutdownRequired ? `
        <div class="info-box" style="border-color:#c00; background:#fff5f5;">
          <div class="ib-title" style="color:#c00;">⚡ Rapid Shutdown — NEC 690.12</div>
          <div style="font-size:6.5pt; line-height:1.5; color:#600;">
            Rapid shutdown initiation device required at utility meter or as directed by AHJ.
            All conductors within the array boundary must de-energize to ≤30V within 30 seconds.
            Device: <strong>${escHtml(inp.rapidShutdownDevice || 'Per Manufacturer Spec')}</strong>
          </div>
        </div>` : ''}

        <!-- Interconnection Method -->
        <div class="info-box">
          <div class="ib-title">Interconnection Method</div>
          <div class="ib-row"><span class="lbl">Type</span><span class="val">${escHtml(inp.interconnectionType)}</span></div>
          <div class="ib-row"><span class="lbl">Method</span><span class="val">${escHtml(inp.interconnectionMethod)}</span></div>
          <div class="ib-row"><span class="lbl">Main Bus</span><span class="val">${inp.mainPanelBusAmps}A</span></div>
          <div class="ib-row"><span class="lbl">Backfeed Breaker</span><span class="val">${inp.backfeedBreakerAmps}A</span></div>
          <div class="ib-row"><span class="lbl">120% Rule Check</span><span class="val">${check120Percent(inp)}</span></div>
        </div>

      </div>
    </div>
  `;

  return wrapPage(content, inp.tb);
}

// ─── 120% Rule Check ─────────────────────────────────────────────────────────
function check120Percent(inp: ElectricalSheetInput): string {
  const maxBackfeed = inp.mainPanelBusAmps * 1.2 - inp.mainPanelBreakerAmps;
  const ok = inp.backfeedBreakerAmps <= maxBackfeed;
  return ok
    ? `✓ PASS (${inp.backfeedBreakerAmps}A ≤ ${maxBackfeed.toFixed(0)}A)`
    : `✗ FAIL (${inp.backfeedBreakerAmps}A > ${maxBackfeed.toFixed(0)}A — supply-side required)`;
}

// ─── Wire Schedule Table ─────────────────────────────────────────────────────
function buildWireScheduleTable(inp: ElectricalSheetInput): string {
  const rows: { id: string; from: string; to: string; wire: string; conduit: string; ocpd: string; notes: string }[] = [];

  // DC string runs
  inp.strings.forEach((s, i) => {
    rows.push({
      id: `DC-${i+1}`,
      from: `String ${s.label} (${s.panelCount} panels)`,
      to: inp.inverterType === 'micro' ? 'Microinverter' : inp.inverterType === 'optimizer' ? 'Optimizer → Inverter' : 'Inverter DC Input',
      wire: `${s.wireGauge} THWN-2`,
      conduit: s.conduitType,
      ocpd: `${s.ocpdAmps}A`,
      notes: `Voc=${s.stringVoc}V, Isc=${s.stringIsc}A`,
    });
  });

  // DC disconnect
  rows.push({
    id: 'DC-DISC',
    from: 'Inverter DC Output',
    to: 'DC Disconnect',
    wire: `${inp.dcWireGauge} THWN-2`,
    conduit: inp.dcConduitType,
    ocpd: `${inp.dcDisconnectAmps}A / ${inp.dcDisconnectVoltage}VDC`,
    notes: 'NEC 690.15',
  });

  // AC inverter output
  rows.push({
    id: 'AC-1',
    from: 'Inverter AC Output',
    to: 'AC Disconnect',
    wire: `${inp.acWireGauge} THWN-2`,
    conduit: inp.acConduitType,
    ocpd: `${inp.acDisconnectAmps}A`,
    notes: 'NEC 690.14',
  });

  // AC to panel
  rows.push({
    id: 'AC-2',
    from: 'AC Disconnect',
    to: 'Main Service Panel',
    wire: `${inp.acWireGauge} THWN-2`,
    conduit: inp.acConduitType,
    ocpd: `${inp.acBreakerAmps}A`,
    notes: `${inp.interconnectionType} interconnection`,
  });

  // Ground
  rows.push({
    id: 'GND',
    from: 'Array / Inverter',
    to: 'Grounding Electrode',
    wire: `${inp.groundWireGauge} bare copper`,
    conduit: 'N/A',
    ocpd: 'N/A',
    notes: `NEC 690.47 · ${inp.groundingElectrode}`,
  });

  // Battery
  if (inp.hasBattery && inp.batteryModel) {
    rows.push({
      id: 'BAT-1',
      from: 'Battery System',
      to: 'Main Service Panel',
      wire: `#6 AWG THWN-2`,
      conduit: '3/4" EMT',
      ocpd: `${inp.batteryBreakerAmps || 30}A`,
      notes: `NEC 705.12(B) · ${inp.batteryModel}`,
    });
  }

  return `
  <table style="font-size:6pt;">
    <thead>
      <tr>
        <th style="width:8%;">ID</th>
        <th style="width:22%;">From</th>
        <th style="width:22%;">To</th>
        <th style="width:14%;">Wire</th>
        <th style="width:12%;">Conduit</th>
        <th style="width:10%;">OCPD</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(r => `
      <tr>
        <td><strong>${escHtml(r.id)}</strong></td>
        <td>${escHtml(r.from)}</td>
        <td>${escHtml(r.to)}</td>
        <td>${escHtml(r.wire)}</td>
        <td>${escHtml(r.conduit)}</td>
        <td>${escHtml(r.ocpd)}</td>
        <td style="font-size:5.5pt;">${escHtml(r.notes)}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

// ─── NEC Notes ───────────────────────────────────────────────────────────────
function buildNecNotes(inp: ElectricalSheetInput): string {
  const notes = [
    { ref: 'NEC 690.7', text: 'Maximum PV system voltage: 600V (residential). String Voc × 1.25 temperature correction factor applied.' },
    { ref: 'NEC 690.8', text: `DC circuit conductors sized at 125% of Isc. String Isc × 1.25 = ${inp.strings[0] ? (inp.strings[0].stringIsc * 1.25).toFixed(1) + 'A' : 'N/A'}.` },
    { ref: 'NEC 690.9', text: 'Overcurrent protection required for each PV source circuit. Fuse/breaker rating per conductor ampacity.' },
    { ref: 'NEC 690.12', text: inp.rapidShutdownRequired ? `Rapid shutdown required. Initiation device at utility meter. Array conductors de-energize to ≤30V within 30 sec.` : 'Rapid shutdown not required for this installation type.' },
    { ref: 'NEC 690.15', text: 'DC disconnect required within sight of inverter or lockable in open position.' },
    { ref: 'NEC 690.47', text: 'Equipment grounding conductors sized per NEC 250.122. Grounding electrode system per NEC 250.50.' },
    { ref: 'NEC 705.12', text: `${inp.interconnectionType === 'supply-side' ? 'Supply-side connection per NEC 705.12(A). No 120% rule applies.' : `Load-side connection per NEC 705.12(B). 120% rule: backfeed ≤ ${(inp.mainPanelBusAmps * 0.2).toFixed(0)}A (bus × 20%).`}` },
  ];

  return `
  <div style="font-size:6pt; line-height:1.5;">
    ${notes.map(n => `
    <div style="display:flex; gap:4px; margin-bottom:2px; padding:2px 4px; background:#f7f8fc; border-left:2px solid #1a3a6b;">
      <span style="font-weight:bold; color:#1a3a6b; white-space:nowrap; min-width:60px;">${escHtml(n.ref)}</span>
      <span style="color:#333;">${escHtml(n.text)}</span>
    </div>`).join('')}
  </div>`;
}

// ─── SLD SVG ─────────────────────────────────────────────────────────────────
function buildSldSvg(inp: ElectricalSheetInput): string {
  const hasBattery = inp.hasBattery && !!inp.batteryModel;
  const isString   = inp.inverterType === 'string';
  const isMicro    = inp.inverterType === 'micro';
  const isOptimizer= inp.inverterType === 'optimizer';

  // Layout constants
  const W = 580, H = 380;
  const panelY = 20, panelH = 50;
  const invY   = 120;
  const dcDiscY= 190;
  const acDiscY= 250;
  const panelBY= 310;
  const meterY = 310;
  const gridY  = 350;

  // Colors
  const dcColor  = '#c00';
  const acColor  = '#1a3a6b';
  const gndColor = '#2a7a2a';
  const boxFill  = '#e8edf5';
  const boxStroke= '#1a3a6b';

  // Helper: box
  function box(x: number, y: number, w: number, h: number, label: string, sub?: string, fill?: string): string {
    return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${fill || boxFill}" stroke="${boxStroke}" stroke-width="1.2"/>
    <text x="${x + w/2}" y="${y + h/2 - (sub ? 5 : 0)}" text-anchor="middle" dominant-baseline="middle" font-size="7" font-weight="bold" fill="${boxStroke}">${escHtml(label)}</text>
    ${sub ? `<text x="${x + w/2}" y="${y + h/2 + 7}" text-anchor="middle" dominant-baseline="middle" font-size="5.5" fill="#555">${escHtml(sub)}</text>` : ''}`;
  }

  // Helper: wire label
  function wireLabel(x: number, y: number, text: string, color: string): string {
    return `<text x="${x}" y="${y}" text-anchor="middle" font-size="5.5" fill="${color}" font-style="italic">${escHtml(text)}</text>`;
  }

  // Helper: line
  function line(x1: number, y1: number, x2: number, y2: number, color: string, dashed?: boolean): string {
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.5" ${dashed ? 'stroke-dasharray="4,2"' : ''}/>`;
  }

  // Helper: arrow
  function arrow(x: number, y: number, dir: 'down' | 'right', color: string): string {
    if (dir === 'down') return `<polygon points="${x},${y} ${x-4},${y-7} ${x+4},${y-7}" fill="${color}"/>`;
    return `<polygon points="${x},${y} ${x-7},${y-4} ${x-7},${y+4}" fill="${color}"/>`;
  }

  // Build string panels
  const stringCount = inp.strings.length || 1;
  const panelSpacing = Math.min(120, (W - 40) / stringCount);
  const panelStartX = (W - (stringCount * panelSpacing - (panelSpacing - 80))) / 2;

  let panels = '';
  let stringLines = '';
  for (let i = 0; i < stringCount; i++) {
    const s = inp.strings[i] || { label: `S${i+1}`, panelCount: 8, wireGauge: '#10 AWG', stringVoc: 400, stringIsc: 10 };
    const px = panelStartX + i * panelSpacing;
    panels += box(px, panelY, 80, panelH, `String ${s.label}`, `${s.panelCount} × ${inp.panelModel?.split(' ')[0] || 'Panel'}`, '#fff8e8');
    // DC line from panel to inverter
    const invCenterX = isString ? 240 : (isMicro ? px + 40 : 240);
    stringLines += line(px + 40, panelY + panelH, px + 40, invY, dcColor);
    stringLines += wireLabel(px + 40, invY - 8, `${s.wireGauge}`, dcColor);
    if (stringCount > 1 && i < stringCount - 1) {
      stringLines += line(px + 40, invY, invCenterX, invY, dcColor);
    }
  }

  // Inverter
  const invLabel = isMicro ? 'Microinverter' : isOptimizer ? 'Optimizer + Inverter' : 'String Inverter';
  const invSub   = `${inp.inverterModel?.substring(0, 20) || ''} · ${inp.inverterKw.toFixed(1)}kW`;
  const invX = 180, invW = 120, invH = 40;

  // DC Disconnect
  const dcDiscX = 220, dcDiscW = 80, dcDiscH = 30;

  // AC Disconnect
  const acDiscX = 220, acDiscW = 80, acDiscH = 30;

  // Main Panel
  const mpX = 180, mpW = 120, mpH = 40;

  // Meter
  const meterX = 340, meterW = 60, meterH = 30;

  // Grid
  const gridX = 340, gridW = 60, gridH = 25;

  // Battery
  const batX = 60, batW = 90, batH = 35;

  // Rapid Shutdown
  const rsX = 420, rsW = 80, rsH = 30;

  const svg = `
  <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%; height:100%; font-family:Arial,sans-serif;">

    <!-- Background -->
    <rect width="${W}" height="${H}" fill="#fafbff"/>

    <!-- DC Zone label -->
    <rect x="5" y="10" width="${W-10}" height="${dcDiscY + dcDiscH - 5}" rx="4" fill="none" stroke="${dcColor}" stroke-width="0.8" stroke-dasharray="6,3" opacity="0.4"/>
    <text x="12" y="22" font-size="6" fill="${dcColor}" font-weight="bold" opacity="0.7">DC ZONE (NEC 690)</text>

    <!-- AC Zone label -->
    <rect x="5" y="${dcDiscY + dcDiscH + 5}" width="${W-10}" height="${H - dcDiscY - dcDiscH - 10}" rx="4" fill="none" stroke="${acColor}" stroke-width="0.8" stroke-dasharray="6,3" opacity="0.3"/>
    <text x="12" y="${dcDiscY + dcDiscH + 17}" font-size="6" fill="${acColor}" font-weight="bold" opacity="0.7">AC ZONE (NEC 705)</text>

    <!-- String panels -->
    ${panels}

    <!-- String lines to inverter -->
    ${stringLines}

    <!-- Inverter -->
    ${box(invX, invY, invW, invH, invLabel, invSub)}
    ${line(invX + invW/2, invY + invH, invX + invW/2, dcDiscY, dcColor)}
    ${wireLabel(invX + invW/2 + 20, dcDiscY - 8, `${inp.dcWireGauge}`, dcColor)}

    <!-- DC Disconnect -->
    ${box(dcDiscX, dcDiscY, dcDiscW, dcDiscH, 'DC Disconnect', `${inp.dcDisconnectAmps}A / ${inp.dcDisconnectVoltage}VDC`)}
    ${line(dcDiscX + dcDiscW/2, dcDiscY + dcDiscH, dcDiscX + dcDiscW/2, acDiscY, acColor)}
    ${wireLabel(dcDiscX + dcDiscW/2 + 20, acDiscY - 8, `${inp.acWireGauge}`, acColor)}

    <!-- AC Disconnect -->
    ${box(acDiscX, acDiscY, acDiscW, acDiscH, 'AC Disconnect', `${inp.acDisconnectAmps}A / 240VAC`)}
    ${line(acDiscX + acDiscW/2, acDiscY + acDiscH, acDiscX + acDiscW/2, panelBY, acColor)}
    ${arrow(acDiscX + acDiscW/2, panelBY, 'down', acColor)}

    <!-- Main Service Panel -->
    ${box(mpX, panelBY, mpW, mpH, 'Main Service Panel', `${inp.mainPanelBusAmps}A Bus · ${inp.backfeedBreakerAmps}A Backfeed`)}

    <!-- Backfeed breaker label -->
    <text x="${mpX + mpW + 4}" y="${panelBY + 12}" font-size="5.5" fill="${acColor}">${inp.backfeedBreakerAmps}A Backfeed</text>
    <text x="${mpX + mpW + 4}" y="${panelBY + 20}" font-size="5.5" fill="${acColor}">Breaker (NEC 705.12)</text>

    <!-- Main panel to meter -->
    ${line(mpX + mpW, panelBY + mpH/2, meterX, panelBY + mpH/2, acColor)}
    ${box(meterX, meterY - 5, meterW, meterH, 'Utility Meter', 'Bidirectional')}

    <!-- Meter to grid -->
    ${line(meterX + meterW/2, meterY - 5 + meterH, meterX + meterW/2, gridY, acColor)}
    ${box(gridX, gridY, gridW, gridH, '⚡ GRID', inp.utilityName?.substring(0, 12) || 'Utility', '#e8f5e8')}

    <!-- Rapid Shutdown Device -->
    ${inp.rapidShutdownRequired ? `
    ${box(rsX, acDiscY, rsW, rsH, 'Rapid Shutdown', 'NEC 690.12', '#fff5f5')}
    ${line(acDiscX + acDiscW, acDiscY + rsH/2, rsX, acDiscY + rsH/2, '#c00', true)}
    <text x="${rsX + rsW/2}" y="${acDiscY - 5}" text-anchor="middle" font-size="5.5" fill="#c00">Initiation Device</text>
    ` : ''}

    <!-- Battery Storage -->
    ${hasBattery ? `
    ${box(batX, panelBY, batW, batH, 'Battery Storage', `${inp.batteryModel?.substring(0, 15) || ''} · ${inp.batteryKwh?.toFixed(1) || '?'}kWh`, '#f0fff0')}
    ${line(batX + batW, panelBY + batH/2, mpX, panelBY + mpH/2, acColor, true)}
    <text x="${batX + batW + 10}" y="${panelBY + batH/2 - 4}" font-size="5.5" fill="${acColor}">${inp.batteryBreakerAmps || 30}A (NEC 705.12)</text>
    ` : ''}

    <!-- Ground symbol -->
    <line x1="${invX}" y1="${invY + invH/2}" x2="${invX - 30}" y2="${invY + invH/2}" stroke="${gndColor}" stroke-width="1.2"/>
    <line x1="${invX - 30}" y1="${invY + invH/2 - 8}" x2="${invX - 30}" y2="${invY + invH/2 + 8}" stroke="${gndColor}" stroke-width="1.5"/>
    <line x1="${invX - 35}" y1="${invY + invH/2 + 2}" x2="${invX - 25}" y2="${invY + invH/2 + 2}" stroke="${gndColor}" stroke-width="1.2"/>
    <line x1="${invX - 33}" y1="${invY + invH/2 + 5}" x2="${invX - 27}" y2="${invY + invH/2 + 5}" stroke="${gndColor}" stroke-width="1"/>
    <text x="${invX - 30}" y="${invY + invH/2 + 14}" text-anchor="middle" font-size="5.5" fill="${gndColor}">GND</text>
    <text x="${invX - 30}" y="${invY + invH/2 + 20}" text-anchor="middle" font-size="5" fill="${gndColor}">${escHtml(inp.groundWireGauge)}</text>

    <!-- Legend -->
    <rect x="${W - 120}" y="10" width="115" height="55" rx="2" fill="white" stroke="#aab" stroke-width="0.8"/>
    <text x="${W - 112}" y="22" font-size="6" font-weight="bold" fill="#333">LEGEND</text>
    <line x1="${W - 112}" y1="30" x2="${W - 90}" y2="30" stroke="${dcColor}" stroke-width="1.5"/>
    <text x="${W - 87}" y="33" font-size="5.5" fill="#333">DC Circuit</text>
    <line x1="${W - 112}" y1="40" x2="${W - 90}" y2="40" stroke="${acColor}" stroke-width="1.5"/>
    <text x="${W - 87}" y="43" font-size="5.5" fill="#333">AC Circuit</text>
    <line x1="${W - 112}" y1="50" x2="${W - 90}" y2="50" stroke="${gndColor}" stroke-width="1.5"/>
    <text x="${W - 87}" y="53" font-size="5.5" fill="#333">Ground</text>
    <line x1="${W - 112}" y1="60" x2="${W - 90}" y2="60" stroke="#999" stroke-width="1.5" stroke-dasharray="4,2"/>
    <text x="${W - 87}" y="63" font-size="5.5" fill="#333">Control/Signal</text>

    <!-- NEC callout bubbles -->
    <circle cx="${invX - 10}" cy="${invY - 8}" r="8" fill="#1a3a6b" opacity="0.9"/>
    <text x="${invX - 10}" y="${invY - 5}" text-anchor="middle" font-size="5" fill="white" font-weight="bold">690.4</text>

    <circle cx="${dcDiscX + dcDiscW + 12}" cy="${dcDiscY + 8}" r="8" fill="#1a3a6b" opacity="0.9"/>
    <text x="${dcDiscX + dcDiscW + 12}" y="${dcDiscY + 11}" text-anchor="middle" font-size="5" fill="white" font-weight="bold">690.15</text>

    <circle cx="${acDiscX + acDiscW + 12}" cy="${acDiscY + 8}" r="8" fill="#1a3a6b" opacity="0.9"/>
    <text x="${acDiscX + acDiscW + 12}" y="${acDiscY + 11}" text-anchor="middle" font-size="5" fill="white" font-weight="bold">690.14</text>

  </svg>`;

  return svg;
}