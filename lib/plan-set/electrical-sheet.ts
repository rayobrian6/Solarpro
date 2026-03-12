// ============================================================
// lib/plan-set/electrical-sheet.ts  (v44.0 — AHJ-grade rewrite)
// Sheet E-1: Electrical — Single-Line Diagram + Wire Schedule
// NEC 690/705 compliant with full engineering calculations shown
// ============================================================

import { wrapPage, escHtml, type TitleBlockData } from './title-block';

export interface StringRun {
  id:           string;
  label:        string;
  panelCount:   number;
  panelWatts:   number;
  wireGauge:    string;
  conduitType:  string;
  wireLength:   number;
  ocpdAmps:     number;
  stringVoc:    number;
  stringVmp:    number;
  stringIsc:    number;
  stringImp:    number;
}

export interface ElectricalSheetInput {
  tb: TitleBlockData;

  // Module electrical specs (NEW — for calculations)
  moduleVoc:            number;   // Module open-circuit voltage @ STC
  moduleIsc:            number;   // Module short-circuit current @ STC
  moduleVmp:            number;   // Module max power voltage
  moduleImp:            number;   // Module max power current
  moduleTempCoeffVoc:   number;   // %/°C, e.g. -0.27
  panelsPerString:      number;   // panels in series per string

  // Inverter
  inverterType:         string;
  inverterModel:        string;
  inverterManufacturer: string;
  inverterCount:        number;
  inverterKw:           number;
  inverterVacOut:       number;
  inverterMaxDcV:       number;
  inverterMpptMin:      number;   // NEW: MPPT min voltage
  inverterMpptMax:      number;   // NEW: MPPT max voltage
  inverterMaxDcA:       number;   // NEW: max DC input current
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
  interconnectionType:  string;
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
  groundingElectrode:   string;

  // NEC / site
  necVersion:           string;
  systemKw:             number;
  panelCount:           number;
  panelModel:           string;
  stateCode:            string;
  utilityName?:         string;

  // Design temperatures (NEW)
  minAmbientTempC:      number;   // coldest design temp °C, e.g. -10
  maxRooftopTempC:      number;   // rooftop conduit temp °C, e.g. 70
}

// ─── Wire ampacity tables ────────────────────────────────────────────────────
// NEC Table 310.15(B)(16) — 90°C column, Cu, in conduit
const WIRE_AMPACITY_90C: Record<string, number> = {
  '#14 AWG': 25, '#12 AWG': 30, '#10 AWG': 40, '#8 AWG': 55,
  '#6 AWG': 75, '#4 AWG': 95, '#3 AWG': 110, '#2 AWG': 130,
  '#1 AWG': 150, '#1/0 AWG': 170, '#2/0 AWG': 195,
  '#3/0 AWG': 225, '#4/0 AWG': 260,
};

// Temperature correction factors — NEC Table 310.15(B)(2)(a) — 90°C rated
function tempCorrectionFactor(ambientC: number): number {
  if (ambientC <= 10) return 1.15;
  if (ambientC <= 15) return 1.12;
  if (ambientC <= 20) return 1.08;
  if (ambientC <= 25) return 1.04;
  if (ambientC <= 30) return 1.00;
  if (ambientC <= 35) return 0.96;
  if (ambientC <= 40) return 0.91;
  if (ambientC <= 45) return 0.87;
  if (ambientC <= 50) return 0.82;
  if (ambientC <= 55) return 0.76;
  if (ambientC <= 60) return 0.71;
  if (ambientC <= 65) return 0.65;
  if (ambientC <= 70) return 0.58;
  return 0.50;
}

export function buildElectricalSheet(inp: ElectricalSheetInput): string {
  // ── Engineering calculations ──────────────────────────────────────────────

  // NEC 690.7: Temperature-corrected max string voltage
  // Voc_corrected = Voc × [1 + (Tmin - 25) × (tempCoeff/100)]
  const tcFactor    = 1 + (inp.minAmbientTempC - 25) * (inp.moduleTempCoeffVoc / 100);
  const stringVocCorr = inp.moduleVoc * inp.panelsPerString * tcFactor;
  const vocCheck      = stringVocCorr <= inp.inverterMaxDcV;

  // NEC 690.8(B): Conductor ampacity requirement
  // Required ampacity = Isc × 1.25 (continuous) × 1.25 (690.8 factor) = 156% Isc
  const isc           = inp.strings[0]?.stringIsc || inp.moduleIsc;
  const reqAmpacity   = isc * 1.25 * 1.25;

  // Rooftop temp derating for DC conductors
  const rooftopDerateFactor = tempCorrectionFactor(inp.maxRooftopTempC);
  const dcBaseAmpacity      = WIRE_AMPACITY_90C[inp.dcWireGauge] || 40;
  const dcDeratedAmpacity   = dcBaseAmpacity * rooftopDerateFactor;

  // AC conductor sizing
  const acBaseAmpacity    = WIRE_AMPACITY_90C[inp.acWireGauge] || 55;
  const acDeratedAmpacity = acBaseAmpacity * tempCorrectionFactor(inp.maxRooftopTempC);

  // 120% rule check
  const maxBackfeed   = inp.mainPanelBusAmps * 1.2 - inp.mainPanelBreakerAmps;
  const busbarPasses  = inp.interconnectionType === 'supply-side' || inp.backfeedBreakerAmps <= maxBackfeed;

  const sldSvg      = buildSldSvg(inp);
  const wireTable   = buildWireScheduleTable(inp, dcDeratedAmpacity, acDeratedAmpacity);
  const calcsBlock  = buildCalcBlock(inp, tcFactor, stringVocCorr, vocCheck, reqAmpacity, dcDeratedAmpacity, rooftopDerateFactor, maxBackfeed, busbarPasses);
  const necNotes    = buildNecNotes(inp, reqAmpacity, maxBackfeed);

  const content = `
    <!-- Sheet Header -->
    <div class="sheet-header">
      <div>
        <div class="sh-title">ELECTRICAL — SINGLE-LINE DIAGRAM &amp; WIRE SCHEDULE</div>
        <div class="sh-sub">${escHtml(inp.systemKw.toFixed(2))} kW DC · ${inp.panelCount} Panels · ${escHtml(inp.inverterType)} Inverter · ${escHtml(inp.necVersion)}</div>
      </div>
      <div class="sh-badge">E-1 ELECTRICAL</div>
    </div>

    <div style="display:grid; grid-template-columns: 1fr 330px; gap:10px; height: calc(100% - 30px);">

      <!-- LEFT: SLD -->
      <div style="display:flex; flex-direction:column; gap:6px;">
        <div class="section-header">Single-Line Diagram (NEC 690 Compliant)</div>
        <div style="border:1px solid #aab; border-radius:3px; padding:6px; background:#fff; flex:1;">
          ${sldSvg}
        </div>
      </div>

      <!-- RIGHT: Calculations + Wire Schedule + Notes -->
      <div style="display:flex; flex-direction:column; gap:6px; overflow:hidden;">

        <!-- Inverter Spec Block -->
        <div class="info-box" style="border-color:#1a3a6b; background:#f0f4ff;">
          <div class="ib-title" style="color:#1a3a6b;">Inverter Specifications</div>
          <div class="ib-row"><span class="lbl">Model</span><span class="val">${escHtml(inp.inverterModel)}</span></div>
          <div class="ib-row"><span class="lbl">Max DC Input V</span><span class="val">${inp.inverterMaxDcV}V</span></div>
          <div class="ib-row"><span class="lbl">MPPT Range</span><span class="val">${inp.inverterMpptMin}–${inp.inverterMpptMax}V</span></div>
          <div class="ib-row"><span class="lbl">Max DC Input A</span><span class="val">${inp.inverterMaxDcA}A</span></div>
          <div class="ib-row"><span class="lbl">AC Output</span><span class="val">${inp.inverterKw.toFixed(2)} kW @ ${inp.inverterVacOut}V</span></div>
          <div class="ib-row"><span class="lbl">Max AC Output A</span><span class="val">${inp.inverterMaxAcA.toFixed(1)}A</span></div>
        </div>

        <!-- Engineering Calculations -->
        ${calcsBlock}

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

        <!-- Rapid Shutdown -->
        ${inp.rapidShutdownRequired ? `
        <div class="info-box" style="border-color:#c00; background:#fff5f5;">
          <div class="ib-title" style="color:#c00;">⚡ RAPID SHUTDOWN — NEC 690.12</div>
          <div style="font-size:6.5pt; line-height:1.5; color:#600; padding:2px 0;">
            <strong>LABEL REQUIRED:</strong> "PV SYSTEM EQUIPPED WITH RAPID SHUTDOWN"<br/>
            Initiation device location: <strong>Utility Meter / Service Entrance</strong><br/>
            All array conductors de-energize to ≤30V within 30 seconds of initiation.<br/>
            Device: <strong>${escHtml(inp.rapidShutdownDevice || 'Per Inverter Manufacturer Spec')}</strong>
          </div>
        </div>` : ''}

        <!-- Interconnection -->
        <div class="info-box">
          <div class="ib-title">Interconnection — NEC 705.12</div>
          <div class="ib-row"><span class="lbl">Type</span><span class="val">${escHtml(inp.interconnectionType)}</span></div>
          <div class="ib-row"><span class="lbl">Method</span><span class="val">${escHtml(inp.interconnectionMethod)}</span></div>
          <div class="ib-row"><span class="lbl">Bus Rating</span><span class="val">${inp.mainPanelBusAmps}A</span></div>
          <div class="ib-row"><span class="lbl">Main Breaker</span><span class="val">${inp.mainPanelBreakerAmps}A</span></div>
          <div class="ib-row"><span class="lbl">Max Backfeed</span><span class="val">${maxBackfeed.toFixed(0)}A allowed</span></div>
          <div class="ib-row"><span class="lbl">PV Backfeed</span><span class="val">${inp.backfeedBreakerAmps}A</span></div>
          <div class="ib-row"><span class="lbl">120% Check</span><span class="val" style="color:${busbarPasses ? '#1a7a1a' : '#c00'}; font-weight:bold;">${busbarPasses ? '✓ PASS' : '✗ — USE SUPPLY-SIDE'}</span></div>
        </div>

      </div>
    </div>
  `;

  return wrapPage(content, inp.tb);
}

// ─── Engineering Calculations Block ─────────────────────────────────────────
function buildCalcBlock(
  inp: ElectricalSheetInput,
  tcFactor: number,
  stringVocCorr: number,
  vocCheck: boolean,
  reqAmpacity: number,
  dcDeratedAmpacity: number,
  rooftopDerateFactor: number,
  maxBackfeed: number,
  busbarPasses: boolean,
): string {
  const isc = inp.strings[0]?.stringIsc || inp.moduleIsc;
  return `
  <div class="info-box" style="border-color:#1a7a1a; background:#f0fff4;">
    <div class="ib-title" style="color:#1a7a1a;">Engineering Calculations (NEC 690)</div>
    <div style="font-size:6pt; line-height:1.7;">
      <div style="background:#e8f5e8; padding:2px 4px; margin-bottom:2px; border-radius:2px;">
        <strong>Max String Voltage (NEC 690.7)</strong><br/>
        = Voc × N × [1 + (Tmin − 25°C) × Tc/100]<br/>
        = ${inp.moduleVoc}V × ${inp.panelsPerString} × [1 + (${inp.minAmbientTempC}°C − 25°C) × ${inp.moduleTempCoeffVoc}%/°C ÷ 100]<br/>
        = ${inp.moduleVoc}V × ${inp.panelsPerString} × ${tcFactor.toFixed(4)}<br/>
        = <strong>${stringVocCorr.toFixed(1)}V</strong>
        ${vocCheck
          ? `<span style="color:#1a7a1a; font-weight:bold;"> ✓ ≤ ${inp.inverterMaxDcV}V max inverter input</span>`
          : `<span style="color:#c00; font-weight:bold;"> ✗ EXCEEDS ${inp.inverterMaxDcV}V — reduce string length</span>`}
      </div>
      <div style="background:#e8f5e8; padding:2px 4px; margin-bottom:2px; border-radius:2px;">
        <strong>Conductor Ampacity (NEC 690.8(B))</strong><br/>
        = Isc × 1.25 × 1.25 = ${isc.toFixed(2)}A × 1.25 × 1.25 = <strong>${reqAmpacity.toFixed(1)}A required</strong><br/>
        ${inp.dcWireGauge} base ampacity: ${WIRE_AMPACITY_90C[inp.dcWireGauge] || 40}A × ${rooftopDerateFactor.toFixed(2)} (${inp.maxRooftopTempC}°C rooftop)<br/>
        Derated ampacity: <strong>${dcDeratedAmpacity.toFixed(1)}A</strong>
        ${dcDeratedAmpacity >= reqAmpacity
          ? `<span style="color:#1a7a1a; font-weight:bold;"> ✓ ADEQUATE</span>`
          : `<span style="color:#c00; font-weight:bold;"> ✗ UNDERSIZED — upsize conductor</span>`}
      </div>
      <div style="background:#e8f5e8; padding:2px 4px; border-radius:2px;">
        <strong>120% Busbar Rule (NEC 705.12(B))</strong><br/>
        Max backfeed = (${inp.mainPanelBusAmps}A × 1.2) − ${inp.mainPanelBreakerAmps}A = <strong>${maxBackfeed.toFixed(0)}A</strong><br/>
        PV backfeed breaker: ${inp.backfeedBreakerAmps}A
        ${busbarPasses
          ? `<span style="color:#1a7a1a; font-weight:bold;"> ✓ PASS</span>`
          : `<span style="color:#c00; font-weight:bold;"> ✗ Use supply-side connection (NEC 705.12(A))</span>`}
      </div>
    </div>
  </div>`;
}

// ─── Wire & Conduit Schedule ─────────────────────────────────────────────────
function buildWireScheduleTable(inp: ElectricalSheetInput, dcDeratedAmpacity: number, acDeratedAmpacity: number): string {
  const rows: {
    id: string; from: string; to: string;
    size: string; material: string; insulation: string;
    tempRating: string; conduit: string; ocpd: string; ref: string;
  }[] = [];

  // DC string runs
  inp.strings.forEach((s, i) => {
    rows.push({
      id: `DC-${i+1}`,
      from: `String ${s.label} (${s.panelCount} panels)`,
      to: inp.inverterType === 'micro' ? 'Microinverter' : inp.inverterType === 'optimizer' ? 'Power Optimizer → Inv.' : 'Inverter DC Input',
      size: s.wireGauge,
      material: 'CU',
      insulation: 'USE-2 / PV Wire',
      tempRating: '90°C',
      conduit: s.conduitType,
      ocpd: `${s.ocpdAmps}A`,
      ref: 'NEC 690.8',
    });
  });

  // DC disconnect
  rows.push({
    id: 'DC-DISC',
    from: 'Inverter DC Output',
    to: 'DC Disconnect',
    size: inp.dcWireGauge,
    material: 'CU',
    insulation: 'THWN-2',
    tempRating: '90°C',
    conduit: inp.dcConduitType,
    ocpd: `${inp.dcDisconnectAmps}A / ${inp.dcDisconnectVoltage}VDC`,
    ref: 'NEC 690.15',
  });

  // AC inverter output
  rows.push({
    id: 'AC-1',
    from: 'Inverter AC Output',
    to: 'AC Disconnect',
    size: inp.acWireGauge,
    material: 'CU',
    insulation: 'THWN-2',
    tempRating: '90°C',
    conduit: inp.acConduitType,
    ocpd: `${inp.acDisconnectAmps}A / 240VAC`,
    ref: 'NEC 690.14',
  });

  // AC to panel
  rows.push({
    id: 'AC-2',
    from: 'AC Disconnect',
    to: 'Main Service Panel',
    size: inp.acWireGauge,
    material: 'CU',
    insulation: 'THWN-2',
    tempRating: '90°C',
    conduit: inp.acConduitType,
    ocpd: `${inp.acBreakerAmps}A backfeed`,
    ref: 'NEC 705.12',
  });

  // EGC
  rows.push({
    id: 'EGC',
    from: 'Array / Racking',
    to: 'Inverter / Ground Bus',
    size: inp.groundWireGauge,
    material: 'CU',
    insulation: 'Bare',
    tempRating: 'N/A',
    conduit: 'With circuit',
    ocpd: 'N/A',
    ref: 'NEC 250.122',
  });

  // GEC
  rows.push({
    id: 'GEC',
    from: 'Main Panel Ground Bus',
    to: 'Grounding Electrode',
    size: '#8 AWG',
    material: 'CU',
    insulation: 'Bare',
    tempRating: 'N/A',
    conduit: 'N/A',
    ocpd: 'N/A',
    ref: 'NEC 250.50',
  });

  // Battery
  if (inp.hasBattery && inp.batteryModel) {
    rows.push({
      id: 'BAT-1',
      from: 'Battery System',
      to: 'Main Service Panel',
      size: '#6 AWG',
      material: 'CU',
      insulation: 'THWN-2',
      tempRating: '90°C',
      conduit: '3/4" EMT',
      ocpd: `${inp.batteryBreakerAmps || 30}A`,
      ref: 'NEC 705.12(B)',
    });
  }

  return `
  <table style="font-size:5.5pt;">
    <thead>
      <tr>
        <th style="width:7%;">ID</th>
        <th style="width:18%;">From</th>
        <th style="width:18%;">To</th>
        <th style="width:9%;">Size</th>
        <th style="width:5%;">Mat.</th>
        <th style="width:13%;">Insulation</th>
        <th style="width:6%;">Temp</th>
        <th style="width:10%;">Conduit</th>
        <th style="width:8%;">OCPD</th>
        <th>Ref</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(r => `
      <tr>
        <td><strong>${escHtml(r.id)}</strong></td>
        <td>${escHtml(r.from)}</td>
        <td>${escHtml(r.to)}</td>
        <td>${escHtml(r.size)}</td>
        <td>${escHtml(r.material)}</td>
        <td>${escHtml(r.insulation)}</td>
        <td>${escHtml(r.tempRating)}</td>
        <td>${escHtml(r.conduit)}</td>
        <td>${escHtml(r.ocpd)}</td>
        <td style="font-size:5pt;">${escHtml(r.ref)}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

// ─── NEC Notes ───────────────────────────────────────────────────────────────
function buildNecNotes(inp: ElectricalSheetInput, reqAmpacity: number, maxBackfeed: number): string {
  const notes = [
    { ref: 'NEC 690.7', text: `Max system voltage = Voc × panels × temp correction. Calculated: ${(inp.moduleVoc * inp.panelsPerString * (1 + (inp.minAmbientTempC - 25) * inp.moduleTempCoeffVoc / 100)).toFixed(1)}V ≤ ${inp.inverterMaxDcV}V.` },
    { ref: 'NEC 690.8(B)', text: `DC conductors sized at 156% of Isc: ${(inp.strings[0]?.stringIsc || inp.moduleIsc).toFixed(2)}A × 1.25 × 1.25 = ${reqAmpacity.toFixed(1)}A min. Rooftop temp derating applied.` },
    { ref: 'NEC 690.9', text: 'Overcurrent protection required for each PV source circuit. OCPD rating ≥ required ampacity per 690.8.' },
    { ref: 'NEC 690.12', text: inp.rapidShutdownRequired ? 'Rapid shutdown required. Initiation device at utility meter. Array conductors ≤30V within 30 sec.' : 'Rapid shutdown not required for this installation type.' },
    { ref: 'NEC 690.15', text: 'DC disconnect required within sight of inverter or lockable in open position.' },
    { ref: 'NEC 250.122', text: `EGC: ${inp.groundWireGauge} bare Cu sized per OCPD per NEC Table 250.122.` },
    { ref: 'NEC 705.12', text: `${inp.interconnectionType === 'supply-side' ? 'Supply-side per NEC 705.12(A). No busbar limitation.' : `Load-side per 705.12(B). Max backfeed = ${maxBackfeed.toFixed(0)}A. PV breaker = ${inp.backfeedBreakerAmps}A.`}` },
  ];

  return `
  <div style="font-size:5.5pt; line-height:1.5;">
    ${notes.map(n => `
    <div style="display:flex; gap:4px; margin-bottom:2px; padding:2px 4px; background:#f7f8fc; border-left:2px solid #1a3a6b;">
      <span style="font-weight:bold; color:#1a3a6b; white-space:nowrap; min-width:65px;">${escHtml(n.ref)}</span>
      <span style="color:#333;">${escHtml(n.text)}</span>
    </div>`).join('')}
  </div>`;
}

// ─── SLD SVG ─────────────────────────────────────────────────────────────────
function buildSldSvg(inp: ElectricalSheetInput): string {
  const hasBattery  = inp.hasBattery && !!inp.batteryModel;
  const isMicro     = inp.inverterType === 'micro';
  const isOptimizer = inp.inverterType === 'optimizer';

  const W = 560, H = 370;
  const dcColor  = '#c00';
  const acColor  = '#1a3a6b';
  const gndColor = '#2a7a2a';
  const boxFill  = '#e8edf5';
  const boxStroke= '#1a3a6b';

  function box(x: number, y: number, w: number, h: number, label: string, sub?: string, fill?: string): string {
    return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${fill || boxFill}" stroke="${boxStroke}" stroke-width="1.2"/>
    <text x="${x + w/2}" y="${y + h/2 - (sub ? 5 : 0)}" text-anchor="middle" dominant-baseline="middle" font-size="7" font-weight="bold" fill="${boxStroke}">${escHtml(label)}</text>
    ${sub ? `<text x="${x + w/2}" y="${y + h/2 + 7}" text-anchor="middle" dominant-baseline="middle" font-size="5.5" fill="#555">${escHtml(sub)}</text>` : ''}`;
  }

  function line(x1: number, y1: number, x2: number, y2: number, color: string, dashed?: boolean): string {
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.5" ${dashed ? 'stroke-dasharray="4,2"' : ''}/>`;
  }

  function wireLabel(x: number, y: number, text: string, color: string): string {
    return `<text x="${x}" y="${y}" text-anchor="middle" font-size="5.5" fill="${color}" font-style="italic">${escHtml(text)}</text>`;
  }

  function necBubble(x: number, y: number, ref: string): string {
    return `<circle cx="${x}" cy="${y}" r="9" fill="#1a3a6b" opacity="0.85"/>
    <text x="${x}" y="${y + 3}" text-anchor="middle" font-size="4.5" fill="white" font-weight="bold">${escHtml(ref)}</text>`;
  }

  const stringCount   = inp.strings.length || 1;
  const panelSpacing  = Math.min(110, (W - 40) / stringCount);
  const panelStartX   = (W - (stringCount * panelSpacing - (panelSpacing - 80))) / 2;

  let panels = '';
  let stringLines = '';
  for (let i = 0; i < stringCount; i++) {
    const s  = inp.strings[i] || { label: `S${i+1}`, panelCount: 8, wireGauge: '#10 AWG', stringVoc: 400, stringIsc: 10 };
    const px = panelStartX + i * panelSpacing;
    panels += box(px, 15, 80, 45, `String ${s.label}`, `${s.panelCount}p · Voc=${s.stringVoc.toFixed(0)}V`, '#fff8e8');
    panels += `<text x="${px + 40}" y="68" text-anchor="middle" font-size="5" fill="${dcColor}">Isc=${s.stringIsc.toFixed(1)}A</text>`;
    stringLines += line(px + 40, 60, px + 40, 110, dcColor);
    stringLines += wireLabel(px + 55, 88, s.wireGauge, dcColor);
    if (stringCount > 1 && i > 0) {
      stringLines += line(panelStartX + 40, 110, px + 40, 110, dcColor);
    }
  }

  const invX = 210, invY = 115, invW = 130, invH = 40;
  const invLabel = isMicro ? 'Microinverter Array' : isOptimizer ? 'Optimizers + Inverter' : 'String Inverter';
  const invSub   = `${inp.inverterModel.substring(0, 22)} · ${inp.inverterKw.toFixed(1)}kW`;

  const dcDiscX = 235, dcDiscY = 175, dcDiscW = 80, dcDiscH = 28;
  const acDiscX = 235, acDiscY = 225, acDiscW = 80, acDiscH = 28;
  const mpX = 210, mpY = 285, mpW = 130, mpH = 38;
  const meterX = 380, meterY = 290, meterW = 65, meterH = 28;
  const gridX = 380, gridY = 340, gridW = 65, gridH = 22;
  const rsX = 420, rsY = 225, rsW = 80, rsH = 28;
  const batX = 40, batW = 95, batH = 32;

  return `
  <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%; height:100%; font-family:Arial,sans-serif;">
    <rect width="${W}" height="${H}" fill="#fafbff"/>

    <!-- DC Zone -->
    <rect x="5" y="8" width="${W-10}" height="${dcDiscY + dcDiscH - 2}" rx="4" fill="none" stroke="${dcColor}" stroke-width="0.8" stroke-dasharray="6,3" opacity="0.4"/>
    <text x="12" y="20" font-size="6" fill="${dcColor}" font-weight="bold" opacity="0.7">DC ZONE — NEC 690</text>

    <!-- AC Zone -->
    <rect x="5" y="${dcDiscY + dcDiscH + 4}" width="${W-10}" height="${H - dcDiscY - dcDiscH - 10}" rx="4" fill="none" stroke="${acColor}" stroke-width="0.8" stroke-dasharray="6,3" opacity="0.3"/>
    <text x="12" y="${dcDiscY + dcDiscH + 16}" font-size="6" fill="${acColor}" font-weight="bold" opacity="0.7">AC ZONE — NEC 705</text>

    <!-- Panels / Strings -->
    ${panels}
    ${stringLines}

    <!-- Line from strings to inverter -->
    ${line(panelStartX + 40, 110, invX + invW/2, invY, dcColor)}
    ${wireLabel(invX + invW/2 - 22, invY - 4, inp.dcWireGauge, dcColor)}

    <!-- Inverter -->
    ${box(invX, invY, invW, invH, invLabel, invSub)}
    ${necBubble(invX - 12, invY - 8, '690.4')}

    <!-- Inverter → DC Disconnect -->
    ${line(invX + invW/2, invY + invH, invX + invW/2, dcDiscY, dcColor)}
    ${wireLabel(invX + invW/2 + 22, dcDiscY - 6, inp.dcWireGauge, dcColor)}

    <!-- DC Disconnect -->
    ${box(dcDiscX, dcDiscY, dcDiscW, dcDiscH, 'DC Disconnect', `${inp.dcDisconnectAmps}A / ${inp.dcDisconnectVoltage}VDC`)}
    ${necBubble(dcDiscX + dcDiscW + 12, dcDiscY + 10, '690.15')}

    <!-- DC Disconnect → AC Disconnect -->
    ${line(dcDiscX + dcDiscW/2, dcDiscY + dcDiscH, acDiscX + acDiscW/2, acDiscY, acColor)}
    ${wireLabel(acDiscX + acDiscW/2 + 22, acDiscY - 6, inp.acWireGauge, acColor)}

    <!-- AC Disconnect -->
    ${box(acDiscX, acDiscY, acDiscW, acDiscH, 'AC Disconnect', `${inp.acDisconnectAmps}A / 240VAC`)}
    ${necBubble(acDiscX + acDiscW + 12, acDiscY + 10, '690.14')}

    <!-- Rapid Shutdown -->
    ${inp.rapidShutdownRequired ? `
    ${box(rsX, rsY, rsW, rsH, 'RSD Device', 'NEC 690.12', '#fff5f5')}
    ${line(acDiscX + acDiscW, acDiscY + rsH/2, rsX, rsY + rsH/2, '#c00', true)}
    <text x="${rsX + rsW/2}" y="${rsY - 5}" text-anchor="middle" font-size="5" fill="#c00" font-weight="bold">RAPID SHUTDOWN</text>
    ` : ''}

    <!-- AC Disconnect → Main Panel -->
    ${line(acDiscX + acDiscW/2, acDiscY + acDiscH, mpX + mpW/2, mpY, acColor)}
    ${wireLabel(mpX + mpW/2 + 22, mpY - 6, inp.acWireGauge, acColor)}

    <!-- Main Panel -->
    ${box(mpX, mpY, mpW, mpH, 'Main Service Panel', `${inp.mainPanelBusAmps}A Bus · ${inp.backfeedBreakerAmps}A PV Breaker`)}
    ${necBubble(mpX + mpW + 12, mpY + 15, '705.12')}

    <!-- Main Panel → Meter -->
    ${line(mpX + mpW, mpY + mpH/2, meterX, meterY + meterH/2, acColor)}
    ${box(meterX, meterY, meterW, meterH, 'Utility Meter', 'Bidirectional')}

    <!-- Meter → Grid -->
    ${line(meterX + meterW/2, meterY + meterH, meterX + meterW/2, gridY, acColor)}
    ${box(gridX, gridY, gridW, gridH, '⚡ GRID', inp.utilityName?.substring(0, 14) || 'Utility', '#e8f5e8')}

    <!-- Battery -->
    ${hasBattery ? `
    ${box(batX, mpY, batW, batH, 'Battery Storage', `${inp.batteryModel?.substring(0, 14) || ''} · ${inp.batteryKwh?.toFixed(1) || '?'}kWh`, '#f0fff0')}
    ${line(batX + batW, mpY + batH/2, mpX, mpY + mpH/2, acColor, true)}
    ${wireLabel(batX + batW + (mpX - batX - batW)/2, mpY + batH/2 - 5, `${inp.batteryBreakerAmps || 30}A`, acColor)}
    ` : ''}

    <!-- Ground symbol -->
    ${line(invX, invY + invH/2, invX - 28, invY + invH/2, gndColor)}
    <line x1="${invX - 28}" y1="${invY + invH/2 - 9}" x2="${invX - 28}" y2="${invY + invH/2 + 9}" stroke="${gndColor}" stroke-width="1.5"/>
    <line x1="${invX - 34}" y1="${invY + invH/2 + 2}" x2="${invX - 22}" y2="${invY + invH/2 + 2}" stroke="${gndColor}" stroke-width="1.2"/>
    <line x1="${invX - 31}" y1="${invY + invH/2 + 5}" x2="${invX - 25}" y2="${invY + invH/2 + 5}" stroke="${gndColor}" stroke-width="1"/>
    <text x="${invX - 28}" y="${invY + invH/2 + 15}" text-anchor="middle" font-size="5.5" fill="${gndColor}">EGC</text>
    <text x="${invX - 28}" y="${invY + invH/2 + 21}" text-anchor="middle" font-size="5" fill="${gndColor}">${escHtml(inp.groundWireGauge)}</text>

    <!-- Legend -->
    <rect x="${W - 110}" y="10" width="105" height="60" rx="2" fill="white" stroke="#aab" stroke-width="0.8"/>
    <text x="${W - 102}" y="22" font-size="6" font-weight="bold" fill="#333">LEGEND</text>
    ${line(W - 102, 30, W - 82, 30, dcColor)} <text x="${W - 79}" y="33" font-size="5.5" fill="#333">DC Circuit</text>
    ${line(W - 102, 40, W - 82, 40, acColor)} <text x="${W - 79}" y="43" font-size="5.5" fill="#333">AC Circuit</text>
    ${line(W - 102, 50, W - 82, 50, gndColor)} <text x="${W - 79}" y="53" font-size="5.5" fill="#333">Ground (EGC/GEC)</text>
    <line x1="${W - 102}" y1="60" x2="${W - 82}" y2="60" stroke="#999" stroke-width="1.5" stroke-dasharray="4,2"/> <text x="${W - 79}" y="63" font-size="5.5" fill="#333">Control / Signal</text>

  </svg>`;
}