// ============================================================
// lib/plan-set/electrical-sheet.ts
// Plan Set Sheet E-1: Electrical — Single-Line Diagram (v45.0)
//
// ARCHITECTURE (v45.0 — Single Source of Truth):
//   This sheet is a PURE RENDERER. All NEC calculations
//   (690.7 Voc, 690.8 ampacity, 705.12 120% rule) are
//   pre-computed by computeSystem() and passed in via
//   ElectricalSheetInput.systemModel (PermitSystemModel).
//   No NEC calculations are performed here.
//
// NEC 690 compliant rendering:
//   - Temperature-corrected Voc (NEC 690.7) — values from engine
//   - Conductor ampacity with rooftop temp derating (NEC 310.15) — from engine
//   - 120% rule with full formula (NEC 705.12) — values from engine
//   - Inverter spec block
//   - Full wire schedule (CU, USE-2/THWN-2, temp rating, code ref)
//   - Rapid shutdown label: "PV SYSTEM EQUIPPED WITH RAPID SHUTDOWN"
// ============================================================

import { wrapPage, escHtml, type TitleBlockData } from './title-block';
import type { PermitSystemModel } from './permit-system-model';

export interface StringRun {
  id:          string;
  label:       string;
  panelCount:  number;
  panelWatts:  number;
  wireGauge:   string;
  conduitType: string;
  wireLength:  number;
  ocpdAmps:    number;
  stringVoc:   number;
  stringVmp:   number;
  stringIsc:   number;
  stringImp:   number;
}

export interface ElectricalSheetInput {
  tb: TitleBlockData;

  // ── Pre-computed system model (single source of truth) ────
  // When systemModel is provided, all NEC calculation display
  // values come from it. Individual fields below are fallbacks.
  systemModel?: PermitSystemModel;

  // Module electrical specs (for display / fallback)
  moduleVoc?:           number;
  moduleIsc?:           number;
  moduleVmp?:           number;
  moduleImp?:           number;
  moduleTempCoeffVoc?:  number;
  panelsPerString?:     number;

  // Inverter
  inverterType:         string;
  inverterModel:        string;
  inverterCount:        number;
  inverterKw:           number;
  inverterVacOut:       number;
  inverterMaxDcV:       number;
  inverterMaxAcA:       number;
  inverterMpptMin?:     number;
  inverterMpptMax?:     number;
  inverterMaxDcA?:      number;
  inverterManufacturer?:string;

  // Strings
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

  // NEC / system
  necVersion:           string;
  systemKw:             number;
  panelCount:           number;
  panelModel:           string;
  stateCode:            string;
  utilityName?:         string;

  // Temperature inputs (fallback when no systemModel)
  minAmbientTempC?:     number;
  maxRooftopTempC?:     number;
}

// ─── NEC Calculation Block (pure renderer) ────────────────────────────────
// Renders pre-computed values from PermitSystemModel.
// When systemModel is present, NO calculations are performed here —
// all values come directly from computeSystem() engine output.
function buildCalcBlock(inp: ElectricalSheetInput): string {
  const sm = inp.systemModel;

  // ── Resolve values from system model first, then input fields ──
  const n             = sm?.panelsPerString ?? inp.panelsPerString ?? inp.strings[0]?.panelCount ?? 1;
  const moduleVoc     = sm?.vocSTC         ?? inp.moduleVoc        ?? (inp.strings[0] ? inp.strings[0].stringVoc / n : 40);
  const vocCorrected  = sm?.stringVoc      ?? (moduleVoc * n * 1.12);
  const tMin          = sm?.designTempMin  ?? inp.minAmbientTempC  ?? -10;
  const tcFactor      = sm?.tempCorrectionFactor ?? (vocCorrected / (moduleVoc * n));
  const inverterMaxDcV = sm?.inverterMaxDcV ?? inp.inverterMaxDcV ?? 600;
  const vocPass       = sm?.voltagePass    ?? (vocCorrected <= inverterMaxDcV);
  const tc            = inp.moduleTempCoeffVoc ?? -0.30;
  const vocMethod     = inp.moduleTempCoeffVoc
    ? `Actual Tc = ${tc}%/\u00b0C`
    : `NEC Table 690.7(A)`;

  // NEC 690.8(B) — Conductor Ampacity (values from engine)
  const isc              = sm?.stringIsc    ?? inp.moduleIsc ?? inp.strings[0]?.stringIsc ?? 9.0;
  const requiredAmpacity = isc * 1.25 * 1.25;
  const dcGauge          = sm?.dcWireGauge  ?? inp.dcWireGauge ?? '#10 AWG';
  const effectiveAmbient = sm
    ? sm.ambientTempC + sm.rooftopTempAdderC
    : Math.max(30, (inp.maxRooftopTempC ?? 40) + 33);
  const deratedAmpacity  = sm?.dcAmpacity   ?? 30;
  const conductorPass    = sm?.dcAmpacityPass ?? (deratedAmpacity >= requiredAmpacity);
  const WIRE_AMPACITY_90C: Record<string, number> = {
    '#14 AWG': 25, '#12 AWG': 30, '#10 AWG': 40, '#8 AWG': 55,
    '#6 AWG': 75,  '#4 AWG': 95,  '#3 AWG': 110, '#2 AWG': 130,
    '#1 AWG': 150, '#1/0 AWG': 170, '#2/0 AWG': 195,
  };
  const baseAmpacity = WIRE_AMPACITY_90C[dcGauge] ?? 40;
  const corrFactor   = sm ? (deratedAmpacity / baseAmpacity) : Math.sqrt(Math.max(0, (90 - effectiveAmbient) / 60));

  // NEC 705.12 — 120% Rule (values from engine)
  const mainBusAmps  = sm?.mainPanelBusAmps  ?? inp.mainPanelBusAmps;
  const mainBrkAmps  = sm?.mainPanelBreakerAmps ?? inp.mainPanelBreakerAmps;
  const backfeedAmps = sm?.backfeedBreakerAmps  ?? inp.backfeedBreakerAmps;
  const maxBackfeed  = sm?.maxAllowedBackfeed ?? (mainBusAmps * 1.2 - mainBrkAmps);
  const rulePass     = sm?.interconnectionPass ?? (backfeedAmps <= maxBackfeed);
  const isSupply     = (sm?.interconnectionMethod ?? inp.interconnectionType) === 'supply-side';

  return `
  <div style="font-size:6pt; line-height:1.6;">

    <!-- NEC 690.7: Temperature-Corrected Voc -->
    <div style="background:#f0f4ff; border:0.8px solid #aac; border-radius:3px; padding:5px 7px; margin-bottom:5px;">
      <div style="font-weight:bold; color:#1a3a6b; font-size:6.5pt; margin-bottom:3px;">NEC 690.7 \u2014 Temperature-Corrected V<sub>oc</sub></div>
      <div style="font-family:monospace; font-size:5.5pt; color:#333; background:#fff; padding:3px 5px; border-radius:2px; border:0.5px solid #ccd; margin-bottom:3px;">
        V<sub>oc,corrected</sub> = V<sub>oc</sub> \u00d7 N \u00d7 correction factor<br>
        &nbsp;&nbsp;&nbsp;&nbsp;= ${moduleVoc.toFixed(2)}V \u00d7 ${n} \u00d7 ${tcFactor.toFixed(4)}<br>
        &nbsp;&nbsp;&nbsp;&nbsp;= <strong>${vocCorrected.toFixed(1)}V</strong> &nbsp;(${vocMethod})&nbsp;\u2014&nbsp;T<sub>min</sub> = ${tMin}\u00b0C
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <div>Max inverter DC input: <strong>${inverterMaxDcV}V</strong></div>
        <div style="padding:1px 6px; border-radius:2px; background:${vocPass ? '#e8f5e8' : '#fff0f0'}; color:${vocPass ? '#1a7a1a' : '#a05000'}; border:0.5px solid ${vocPass ? '#1a7a1a' : '#a05000'}; font-weight:bold;">
          ${vocPass ? '\u2713 PASS' : '\u26a0 VERIFY'} \u2014 ${vocCorrected.toFixed(1)}V ${vocPass ? '\u2264' : '>'} ${inverterMaxDcV}V
        </div>
      </div>
    </div>

    <!-- NEC 690.8(B): Conductor Ampacity with Rooftop Derating -->
    <div style="background:#f0f4ff; border:0.8px solid #aac; border-radius:3px; padding:5px 7px; margin-bottom:5px;">
      <div style="font-weight:bold; color:#1a3a6b; font-size:6.5pt; margin-bottom:3px;">NEC 690.8(B) \u2014 Conductor Ampacity &amp; Rooftop Derating</div>
      <div style="font-family:monospace; font-size:5.5pt; color:#333; background:#fff; padding:3px 5px; border-radius:2px; border:0.5px solid #ccd; margin-bottom:3px;">
        Required ampacity = I<sub>sc</sub> \u00d7 1.25 \u00d7 1.25 = ${isc.toFixed(2)}A \u00d7 156% = <strong>${requiredAmpacity.toFixed(1)}A</strong><br>
        Rooftop conduit ambient = ${sm?.ambientTempC ?? (inp.maxRooftopTempC ?? 40)}\u00b0C + ${sm?.rooftopTempAdderC ?? 33}\u00b0C adder = <strong>${effectiveAmbient}\u00b0C</strong> [NEC 310.15(B)(2)(a)]<br>
        Correction factor (90\u00b0C Cu @ ${effectiveAmbient}\u00b0C) = <strong>${corrFactor.toFixed(2)}</strong><br>
        ${dcGauge} base ampacity = ${baseAmpacity}A \u00d7 ${corrFactor.toFixed(2)} = <strong>${deratedAmpacity.toFixed(1)}A derated</strong>
      </div>
      <div style="padding:1px 6px; border-radius:2px; background:${conductorPass ? '#e8f5e8' : '#fff8e8'}; color:${conductorPass ? '#1a7a1a' : '#a05000'}; border:0.5px solid ${conductorPass ? '#1a7a1a' : '#e6a817'}; font-weight:bold; display:inline-block;">
        ${conductorPass ? '\u2713 PASS' : '\u26a0 UPSIZE'} \u2014 Derated: ${deratedAmpacity.toFixed(1)}A ${conductorPass ? '\u2265' : '<'} Required: ${requiredAmpacity.toFixed(1)}A
      </div>
    </div>

    <!-- NEC 705.12: 120% Rule -->
    <div style="background:#f0f4ff; border:0.8px solid #aac; border-radius:3px; padding:5px 7px;">
      <div style="font-weight:bold; color:#1a3a6b; font-size:6.5pt; margin-bottom:3px;">NEC 705.12 \u2014 ${isSupply ? 'Supply-Side Interconnection' : 'Load-Side 120% Rule'}</div>
      ${isSupply ? `
      <div style="font-size:5.5pt; color:#333;">Supply-side connection per NEC 705.12(A). No 120% bus limitation applies.</div>
      <div style="padding:1px 6px; border-radius:2px; background:#e8f5e8; color:#1a7a1a; border:0.5px solid #1a7a1a; font-weight:bold; display:inline-block; margin-top:3px;">\u2713 PASS \u2014 Supply-side, unrestricted</div>
      ` : `
      <div style="font-family:monospace; font-size:5.5pt; color:#333; background:#fff; padding:3px 5px; border-radius:2px; border:0.5px solid #ccd; margin-bottom:3px;">
        Max backfeed = (Bus \u00d7 1.2) \u2212 Main breaker<br>
        &nbsp;&nbsp;&nbsp;&nbsp;= (${mainBusAmps}A \u00d7 1.2) \u2212 ${mainBrkAmps}A = <strong>${maxBackfeed.toFixed(0)}A</strong><br>
        Backfeed breaker: <strong>${backfeedAmps}A</strong>
      </div>
      <div style="padding:1px 6px; border-radius:2px; background:${rulePass ? '#e8f5e8' : '#fff8e8'}; color:${rulePass ? '#1a7a1a' : '#a05000'}; border:0.5px solid ${rulePass ? '#1a7a1a' : '#e6a817'}; font-weight:bold; display:inline-block;">
        ${rulePass ? '\u2713 PASS' : '\u26a0 EXCEEDS \u2014 USE SUPPLY-SIDE'} \u2014 ${backfeedAmps}A ${rulePass ? '\u2264' : '>'} ${maxBackfeed.toFixed(0)}A
      </div>`}
    </div>

  </div>`;
}

// ─── Inverter Spec Block ───────────────────────────────────────────────────
function buildInverterSpecBlock(inp: ElectricalSheetInput): string {
  return `
  <div class="info-box" style="margin-top:6px;">
    <div class="ib-title">Inverter Specifications</div>
    <div class="ib-row"><span class="lbl">Manufacturer</span><span class="val">${escHtml(inp.inverterManufacturer || inp.inverterModel.split(' ')[0] || '\u2014')}</span></div>
    <div class="ib-row"><span class="lbl">Model</span><span class="val">${escHtml(inp.inverterModel)}</span></div>
    <div class="ib-row"><span class="lbl">Type</span><span class="val">${escHtml(inp.inverterType)} inverter</span></div>
    <div class="ib-row"><span class="lbl">Qty</span><span class="val">${inp.inverterCount}</span></div>
    <div class="ib-row"><span class="lbl">AC Output</span><span class="val">${inp.inverterKw.toFixed(3)} kW / ${inp.inverterMaxAcA.toFixed(1)}A @ ${inp.inverterVacOut}VAC</span></div>
    <div class="ib-row"><span class="lbl">Max DC Voltage</span><span class="val">${inp.inverterMaxDcV}VDC</span></div>
    ${inp.inverterMpptMin && inp.inverterMpptMax ? `<div class="ib-row"><span class="lbl">MPPT Range</span><span class="val">${inp.inverterMpptMin}V \u2013 ${inp.inverterMpptMax}V</span></div>` : ''}
    ${inp.inverterMaxDcA ? `<div class="ib-row"><span class="lbl">Max DC Input</span><span class="val">${inp.inverterMaxDcA}A</span></div>` : ''}
    <div class="ib-row"><span class="lbl">Listing</span><span class="val">UL 1741 / IEEE 1547</span></div>
  </div>`;
}

// ─── Wire Schedule Table ───────────────────────────────────────────────────
function buildWireScheduleTable(inp: ElectricalSheetInput): string {
  const sm = inp.systemModel;
  interface WireRow {
    id:        string;
    from:      string;
    to:        string;
    size:      string;
    material:  string;
    insul:     string;
    tempRating:string;
    conduit:   string;
    ocpd:      string;
    codeRef:   string;
  }
  const rows: WireRow[] = [];

  // Use systemModel string data when available, fall back to inp.strings
  const smStrings = sm?.strings ?? [];
  const displayStrings = smStrings.length > 0
    ? smStrings.map(s => ({
        label: `S${s.stringIndex + 1}`,
        panelCount: s.panelCount,
        wireGauge: s.wireGauge,
        conduitType: s.conduitType,
        ocpdAmps: s.ocpdAmps,
        stringVoc: s.stringVoc,
        stringIsc: s.stringIsc,
      }))
    : inp.strings.map(s => ({
        label: s.label,
        panelCount: s.panelCount,
        wireGauge: s.wireGauge,
        conduitType: s.conduitType,
        ocpdAmps: s.ocpdAmps,
        stringVoc: s.stringVoc,
        stringIsc: s.stringIsc,
      }));

  displayStrings.forEach((s, i) => {
    rows.push({
      id:         `DC-${i+1}`,
      from:       `String ${s.label} (${s.panelCount} panels)`,
      to:         inp.inverterType === 'micro' ? 'Microinverter' : inp.inverterType === 'optimizer' ? 'Optimizer \u2192 Inv' : 'Inverter DC In',
      size:       s.wireGauge,
      material:   'CU',
      insul:      'USE-2/PV Wire',
      tempRating: '90\u00b0C wet',
      conduit:    s.conduitType,
      ocpd:       `${s.ocpdAmps}A`,
      codeRef:    'NEC 690.8',
    });
  });

  rows.push({
    id:         'DC-DISC',
    from:       'Inverter DC Out',
    to:         'DC Disconnect',
    size:       sm?.dcWireGauge ?? inp.dcWireGauge,
    material:   'CU',
    insul:      'THWN-2',
    tempRating: '90\u00b0C wet',
    conduit:    sm?.dcConduitType ?? inp.dcConduitType,
    ocpd:       `${inp.dcDisconnectAmps}A / ${inp.dcDisconnectVoltage}VDC`,
    codeRef:    'NEC 690.15',
  });

  rows.push({
    id:         'AC-1',
    from:       'Inverter AC Out',
    to:         'AC Disconnect',
    size:       sm?.acWireGauge ?? inp.acWireGauge,
    material:   'CU',
    insul:      'THWN-2',
    tempRating: '90\u00b0C wet',
    conduit:    sm?.acConduitType ?? inp.acConduitType,
    ocpd:       `${inp.acDisconnectAmps}A`,
    codeRef:    'NEC 690.14',
  });

  rows.push({
    id:         'AC-2',
    from:       'AC Disconnect',
    to:         'Main Service Panel',
    size:       sm?.acWireGauge ?? inp.acWireGauge,
    material:   'CU',
    insul:      'THWN-2',
    tempRating: '90\u00b0C wet',
    conduit:    sm?.acConduitType ?? inp.acConduitType,
    ocpd:       `${sm?.acOcpdAmps ?? inp.acBreakerAmps}A`,
    codeRef:    `NEC 705.12(${(sm?.interconnectionMethod ?? inp.interconnectionType) === 'supply-side' ? 'A' : 'B'})`,
  });

  rows.push({
    id:         'EGC',
    from:       'Array / Inverter',
    to:         'Grounding Electrode',
    size:       sm?.egcGauge ?? inp.groundWireGauge,
    material:   'CU',
    insul:      'Bare / Green',
    tempRating: '\u2014',
    conduit:    'N/A',
    ocpd:       'N/A',
    codeRef:    'NEC 690.43 / 250.122',
  });

  if (inp.hasBattery && inp.batteryModel) {
    rows.push({
      id:         'BAT-1',
      from:       'Battery System',
      to:         'Main Service Panel',
      size:       '#6 AWG',
      material:   'CU',
      insul:      'THWN-2',
      tempRating: '90\u00b0C wet',
      conduit:    '3/4" EMT',
      ocpd:       `${inp.batteryBreakerAmps || 30}A`,
      codeRef:    'NEC 706 / 705.12',
    });
  }

  return `
  <table style="font-size:5.5pt; width:100%;">
    <thead>
      <tr>
        <th style="width:7%;">ID</th>
        <th style="width:14%;">From</th>
        <th style="width:14%;">To</th>
        <th style="width:9%;">Size</th>
        <th style="width:5%;">Mat.</th>
        <th style="width:11%;">Insulation</th>
        <th style="width:8%;">Temp.</th>
        <th style="width:10%;">Conduit</th>
        <th style="width:8%;">OCPD</th>
        <th>Code Ref.</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(r => `
      <tr>
        <td><strong>${escHtml(r.id)}</strong></td>
        <td>${escHtml(r.from)}</td>
        <td>${escHtml(r.to)}</td>
        <td>${escHtml(r.size)}</td>
        <td style="text-align:center;">${escHtml(r.material)}</td>
        <td>${escHtml(r.insul)}</td>
        <td>${escHtml(r.tempRating)}</td>
        <td>${escHtml(r.conduit)}</td>
        <td>${escHtml(r.ocpd)}</td>
        <td style="font-size:5pt;">${escHtml(r.codeRef)}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

// ─── NEC Code Reference Notes ─────────────────────────────────────────────
function buildNecNotes(inp: ElectricalSheetInput): string {
  const sm = inp.systemModel;
  const groundWire = sm?.egcGauge ?? inp.groundWireGauge;
  const grElectrode = inp.groundingElectrode;
  const interconType = sm?.interconnectionMethod ?? inp.interconnectionType;

  const notes = [
    { ref: 'NEC 690.7',  text: `Max PV voltage: temp-corrected Voc shown above. Design for min ambient temp per local climate data.` },
    { ref: 'NEC 690.8',  text: `DC conductors: Isc \u00d7 1.25 \u00d7 1.25 = 156%. Rooftop conduit derating applied per NEC 310.15(B)(2)(a).` },
    { ref: 'NEC 690.9',  text: 'OCPD required for each PV source circuit. Rating \u2264 conductor ampacity (derated). See wire schedule.' },
    { ref: 'NEC 690.12', text: inp.rapidShutdownRequired
        ? `Rapid shutdown required. Array conductors de-energize to \u226430V within 30 sec. Label at service entrance.`
        : 'Rapid shutdown not required for this installation.' },
    { ref: 'NEC 690.31', text: 'Rooftop: USE-2 or listed PV Wire. Conduit runs: THWN-2 minimum. All conductors 90\u00b0C rated.' },
    { ref: 'NEC 690.43', text: `EGC: ${groundWire} bare Cu. All frames, rails, mounting hardware bonded. Grounding electrode: ${grElectrode}.` },
    { ref: 'NEC 705.12', text: interconType === 'supply-side'
        ? 'Supply-side per NEC 705.12(A) \u2014 ahead of service disconnect.'
        : `Load-side per NEC 705.12(B). 120% rule verified above. Backfeed breaker at opposite end of bus from main.` },
  ];

  return `
  <div style="font-size:5.5pt; line-height:1.5;">
    ${notes.map(n => `
    <div style="display:flex; gap:4px; margin-bottom:2px; padding:2px 4px; background:#f7f8fc; border-left:2px solid #1a3a6b;">
      <span style="font-weight:bold; color:#1a3a6b; white-space:nowrap; min-width:58px;">${escHtml(n.ref)}</span>
      <span style="color:#333;">${escHtml(n.text)}</span>
    </div>`).join('')}
  </div>`;
}

// ─── Main Sheet Builder ────────────────────────────────────────────────────
export function buildElectricalSheet(inp: ElectricalSheetInput): string {
  const sm        = inp.systemModel;
  const sldSvg    = buildSldSvg(inp);
  const calcBlock = buildCalcBlock(inp);
  const invSpec   = buildInverterSpecBlock(inp);
  const wireTable = buildWireScheduleTable(inp);
  const necNotes  = buildNecNotes(inp);

  const content = `
    <!-- Sheet Header -->
    <div class="sheet-header">
      <div>
        <div class="sh-title">ELECTRICAL \u2014 SINGLE-LINE DIAGRAM &amp; WIRE SCHEDULE</div>
        <div class="sh-sub">${escHtml(inp.systemKw.toFixed(2))} kW DC \u00b7 ${inp.panelCount} Panels \u00b7 ${escHtml(inp.inverterType)} Inverter \u00b7 ${escHtml(inp.necVersion)}</div>
      </div>
      <div class="sh-badge">E-1 ELECTRICAL</div>
    </div>

    <div style="display:grid; grid-template-columns: 1fr 330px; gap:10px; height: calc(100% - 32px);">

      <!-- LEFT: SLD -->
      <div style="display:flex; flex-direction:column; gap:6px;">
        <div>
          <div class="section-header">Single-Line Diagram (NEC 690 / 705 Compliant)</div>
          <div style="border:1px solid #aab; border-radius:3px; padding:4px; background:#fff; height:340px;">
            ${sldSvg}
          </div>
        </div>

        ${inp.rapidShutdownRequired ? `
        <div style="padding:5px 10px; border:2px solid #c00; border-radius:3px; background:#fff; text-align:center;">
          <div style="font-size:8pt; font-weight:bold; color:#c00; letter-spacing:0.5px;">PV SYSTEM EQUIPPED WITH RAPID SHUTDOWN</div>
          <div style="font-size:5.5pt; color:#555; margin-top:2px;">NEC 690.12 \u2014 Label at utility meter / service entrance \u00b7 Red letters on white background</div>
          <div style="font-size:5.5pt; color:#333; margin-top:1px;">Initiation Device: <strong>${escHtml(inp.rapidShutdownDevice || 'Per Manufacturer Specification')}</strong></div>
        </div>` : ''}

        <div>
          <div class="section-header">NEC Engineering Calculations${sm ? ' <span style="font-size:4.5pt;font-weight:normal;color:#1a7a1a;">[Values from computeSystem() \u2014 single source of truth]</span>' : ''}</div>
          ${calcBlock}
        </div>
      </div>

      <!-- RIGHT: Wire Schedule + Inverter Spec + Notes -->
      <div style="display:flex; flex-direction:column; gap:6px; overflow:hidden;">

        <div>
          <div class="section-header">Wire &amp; Conduit Schedule</div>
          ${wireTable}
        </div>

        ${invSpec}

        <div class="info-box">
          <div class="ib-title">Interconnection</div>
          <div class="ib-row"><span class="lbl">Type</span><span class="val">${escHtml(sm?.interconnectionMethod ?? inp.interconnectionType)}</span></div>
          <div class="ib-row"><span class="lbl">Method</span><span class="val">${escHtml(inp.interconnectionMethod)}</span></div>
          <div class="ib-row"><span class="lbl">Main Bus</span><span class="val">${sm?.mainPanelBusAmps ?? inp.mainPanelBusAmps}A</span></div>
          <div class="ib-row"><span class="lbl">Main Breaker</span><span class="val">${sm?.mainPanelBreakerAmps ?? inp.mainPanelBreakerAmps}A</span></div>
          <div class="ib-row"><span class="lbl">Backfeed Breaker</span><span class="val">${sm?.backfeedBreakerAmps ?? inp.backfeedBreakerAmps}A</span></div>
          ${sm?.interconnectionPass !== undefined ? `<div class="ib-row"><span class="lbl">705.12 Status</span><span class="val" style="color:${sm.interconnectionPass ? '#1a7a1a' : '#a05000'};font-weight:bold;">${sm.interconnectionPass ? '\u2713 PASS' : '\u26a0 REVIEW'}</span></div>` : ''}
        </div>

        <div>
          <div class="section-header">NEC Code References</div>
          ${necNotes}
        </div>

      </div>
    </div>
  `;

  return wrapPage(content, inp.tb);
}

// ─── SLD SVG ──────────────────────────────────────────────────────────────
function buildSldSvg(inp: ElectricalSheetInput): string {
  const sm = inp.systemModel;
  const hasBattery  = inp.hasBattery && !!inp.batteryModel;
  const isMicro     = inp.inverterType === 'micro';
  const isOptimizer = inp.inverterType === 'optimizer';

  const W = 580, H = 330;
  const panelY  = 18;
  const panelH  = 44;
  const invY    = 100;
  const invH    = 36;
  const dcDiscY = 168;
  const dcDiscH = 26;
  const acDiscY = 224;
  const acDiscH = 26;
  const panelBY = 282;
  const panelBH = 36;
  const meterY  = 282;
  const gridY   = 320;

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

  function wireLabel(x: number, y: number, text: string, color: string): string {
    return `<text x="${x}" y="${y}" text-anchor="middle" font-size="5" fill="${color}" font-style="italic">${escHtml(text)}</text>`;
  }

  function line(x1: number, y1: number, x2: number, y2: number, color: string, dashed?: boolean): string {
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.5" ${dashed ? 'stroke-dasharray="4,2"' : ''}/>`;
  }

  function arrow(x: number, y: number, dir: 'down' | 'right', color: string): string {
    if (dir === 'down') return `<polygon points="${x},${y} ${x-4},${y-7} ${x+4},${y-7}" fill="${color}"/>`;
    return `<polygon points="${x},${y} ${x-7},${y-4} ${x-7},${y+4}" fill="${color}"/>`;
  }

  function necBubble(cx: number, cy: number, text: string): string {
    return `
    <circle cx="${cx}" cy="${cy}" r="9" fill="#1a3a6b" opacity="0.85"/>
    <text x="${cx}" y="${cy+3}" text-anchor="middle" font-size="5" fill="white" font-weight="bold">${escHtml(text)}</text>`;
  }

  // Use systemModel strings if available
  const smStrings = sm?.strings ?? [];
  const displayStrings = smStrings.length > 0
    ? smStrings.map(s => ({
        label: `S${s.stringIndex + 1}`,
        panelCount: s.panelCount,
        wireGauge: s.wireGauge,
        stringVoc: s.stringVoc,
        stringIsc: s.stringIsc,
        ocpdAmps: s.ocpdAmps,
      }))
    : inp.strings.map(s => ({
        label: s.label,
        panelCount: s.panelCount,
        wireGauge: s.wireGauge,
        stringVoc: s.stringVoc,
        stringIsc: s.stringIsc,
        ocpdAmps: s.ocpdAmps,
      }));

  const stringCount  = displayStrings.length || 1;
  const panelSpacing = Math.min(110, (W - 60) / stringCount);
  const panelStartX  = (W - (stringCount * panelSpacing - (panelSpacing - 80))) / 2;

  let panels      = '';
  let stringLines = '';
  const invCenterX = 235;

  for (let i = 0; i < Math.min(stringCount, 5); i++) {
    const s  = displayStrings[i];
    const px = panelStartX + i * panelSpacing;
    const vocLabel = s.stringVoc ? ` Voc=${s.stringVoc.toFixed(0)}V` : '';
    const iscLabel = s.stringIsc ? ` Isc=${s.stringIsc.toFixed(1)}A` : '';
    panels += box(px, panelY, 76, panelH,
      `Str. ${s.label}`,
      `${s.panelCount}\u00d7${vocLabel}`,
      '#fff8e8');
    const midY = panelY + panelH + 12;
    stringLines += line(px + 38, panelY + panelH, px + 38, midY, dcColor);
    stringLines += `<rect x="${px+33}" y="${midY}" width="10" height="6" fill="#fff" stroke="${dcColor}" stroke-width="0.8"/>`;
    stringLines += `<text x="${px+38}" y="${midY+11}" text-anchor="middle" font-size="4.5" fill="${dcColor}">${s.ocpdAmps ?? '\u2014'}A fuse</text>`;
    stringLines += line(px + 38, midY + 6, px + 38, invY, dcColor);
    stringLines += wireLabel(px + 38, invY - 5, `${s.wireGauge}`, dcColor);
    if (stringCount > 1) {
      stringLines += line(px + 38, invY, invCenterX + 60, invY, dcColor);
    }
    stringLines += `<text x="${px+38}" y="${panelY - 3}" text-anchor="middle" font-size="4.5" fill="#888" font-style="italic">${iscLabel}</text>`;
  }
  if (stringCount > 5) {
    panels += `<text x="${panelStartX + 5 * panelSpacing}" y="${panelY + panelH/2}" font-size="6" fill="#888">+${stringCount - 5} more</text>`;
  }

  // Use SM values for wire gauge labels on SLD
  const displayDcWire    = sm?.dcWireGauge       ?? inp.dcWireGauge;
  const displayAcWire    = sm?.acWireGauge        ?? inp.acWireGauge;
  const displayBackfeed  = sm?.backfeedBreakerAmps ?? inp.backfeedBreakerAmps;
  const displayBusAmps   = sm?.mainPanelBusAmps   ?? inp.mainPanelBusAmps;
  const displayGroundWire = sm?.egcGauge          ?? inp.groundWireGauge;

  const invLabel = isMicro ? 'Microinverter' : isOptimizer ? 'Optimizer+Inv' : 'String Inverter';
  const invSub   = `${inp.inverterModel.substring(0, 22)} \u00b7 ${inp.inverterKw.toFixed(1)}kW`;
  const invX = 175, invW = 130;
  const dcDiscX = 215, dcDiscW = 90;
  const acDiscX = 215, acDiscW = 90;
  const mpX = 175, mpW = 130;
  const meterX = 360, meterW = 65;
  const gridX = 360, gridW = 65;
  const batX = 40, batW = 100, batH = 34;
  const rsX = 430, rsW = 90, rsH = 26;

  return `
  <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%; height:100%; font-family:Arial,sans-serif;">
    <rect width="${W}" height="${H}" fill="#fafbff"/>
    <rect x="5" y="10" width="${W-10}" height="${dcDiscY + dcDiscH - 5}" rx="4" fill="none" stroke="${dcColor}" stroke-width="0.7" stroke-dasharray="6,3" opacity="0.35"/>
    <text x="12" y="20" font-size="6" fill="${dcColor}" font-weight="bold" opacity="0.6">DC ZONE \u2014 NEC 690</text>
    <rect x="5" y="${dcDiscY + dcDiscH + 4}" width="${W-10}" height="${H - dcDiscY - dcDiscH - 9}" rx="4" fill="none" stroke="${acColor}" stroke-width="0.7" stroke-dasharray="6,3" opacity="0.25"/>
    <text x="12" y="${dcDiscY + dcDiscH + 16}" font-size="6" fill="${acColor}" font-weight="bold" opacity="0.6">AC ZONE \u2014 NEC 705</text>
    ${panels}
    ${stringLines}
    ${box(invX, invY, invW, invH, invLabel, invSub)}
    ${line(invX + invW/2, invY + invH, invX + invW/2, dcDiscY, dcColor)}
    ${wireLabel(invX + invW/2 + 25, dcDiscY - 6, displayDcWire, dcColor)}
    ${necBubble(invX - 12, invY - 8, '690.4')}
    ${box(dcDiscX, dcDiscY, dcDiscW, dcDiscH, 'DC Disconnect', `${inp.dcDisconnectAmps}A / ${inp.dcDisconnectVoltage}VDC`)}
    ${necBubble(dcDiscX + dcDiscW + 12, dcDiscY + 10, '690.15')}
    ${line(dcDiscX + dcDiscW/2, dcDiscY + dcDiscH, dcDiscX + dcDiscW/2, acDiscY, acColor)}
    ${wireLabel(dcDiscX + dcDiscW/2 + 25, acDiscY - 6, displayAcWire, acColor)}
    ${box(acDiscX, acDiscY, acDiscW, acDiscH, 'AC Disconnect', `${inp.acDisconnectAmps}A / 240VAC`)}
    ${necBubble(acDiscX + acDiscW + 12, acDiscY + 10, '690.14')}
    ${line(acDiscX + acDiscW/2, acDiscY + acDiscH, acDiscX + acDiscW/2, panelBY, acColor)}
    ${arrow(acDiscX + acDiscW/2, panelBY, 'down', acColor)}
    ${box(mpX, panelBY, mpW, panelBH, 'Main Service Panel', `${displayBusAmps}A Bus \u00b7 ${displayBackfeed}A Backfeed`)}
    <text x="${mpX + mpW + 5}" y="${panelBY + 12}" font-size="5" fill="${acColor}">${displayBackfeed}A Backfeed Breaker</text>
    <text x="${mpX + mpW + 5}" y="${panelBY + 20}" font-size="5" fill="${acColor}">NEC 705.12(B)(3)</text>
    ${necBubble(mpX + mpW + 70, panelBY + 16, '705.12')}
    ${line(mpX + mpW, panelBY + panelBH/2, meterX, meterY + 10, acColor)}
    ${box(meterX, meterY, meterW, 28, 'Utility Meter', 'Bidirectional')}
    ${line(meterX + meterW/2, meterY + 28, meterX + meterW/2, gridY, acColor)}
    ${box(gridX, gridY, gridW, 22, '\u26a1 GRID', inp.utilityName?.substring(0, 14) || 'Utility', '#e8f5e8')}
    ${inp.rapidShutdownRequired ? `
    ${box(rsX, acDiscY, rsW, rsH, 'RSD Device', 'NEC 690.12', '#fff5f5')}
    ${line(acDiscX + acDiscW, acDiscY + rsH/2, rsX, acDiscY + rsH/2, '#c00', true)}
    <text x="${rsX + rsW/2}" y="${acDiscY - 4}" text-anchor="middle" font-size="5" fill="#c00">Initiation Device</text>
    ` : ''}
    ${hasBattery ? `
    ${box(batX, panelBY, batW, batH, 'Battery BESS', `${inp.batteryModel?.substring(0, 16) || ''} \u00b7 ${inp.batteryKwh?.toFixed(1) || '?'}kWh`, '#f0fff0')}
    ${line(batX + batW, panelBY + batH/2, mpX, panelBY + panelBH/2, acColor, true)}
    <text x="${batX + batW + 12}" y="${panelBY + batH/2 - 4}" font-size="5" fill="${acColor}">${inp.batteryBreakerAmps || 30}A (NEC 706)</text>
    ` : ''}
    <line x1="${invX - 5}" y1="${invY + invH/2}" x2="${invX - 35}" y2="${invY + invH/2}" stroke="${gndColor}" stroke-width="1.2"/>
    <line x1="${invX - 35}" y1="${invY + invH/2 - 9}" x2="${invX - 35}" y2="${invY + invH/2 + 9}" stroke="${gndColor}" stroke-width="1.5"/>
    <line x1="${invX - 40}" y1="${invY + invH/2 + 2}" x2="${invX - 30}" y2="${invY + invH/2 + 2}" stroke="${gndColor}" stroke-width="1.2"/>
    <line x1="${invX - 38}" y1="${invY + invH/2 + 5}" x2="${invX - 32}" y2="${invY + invH/2 + 5}" stroke="${gndColor}" stroke-width="1"/>
    <text x="${invX - 35}" y="${invY + invH/2 + 16}" text-anchor="middle" font-size="5.5" fill="${gndColor}">GND</text>
    <text x="${invX - 35}" y="${invY + invH/2 + 22}" text-anchor="middle" font-size="5" fill="${gndColor}">${escHtml(displayGroundWire)}</text>
    <rect x="${W - 125}" y="8" width="118" height="60" rx="2" fill="white" stroke="#aab" stroke-width="0.8"/>
    <text x="${W - 117}" y="20" font-size="6" font-weight="bold" fill="#333">LEGEND</text>
    ${line(W - 117, 28, W - 95, 28, dcColor)}
    <text x="${W - 92}" y="31" font-size="5.5" fill="#333">DC Circuit</text>
    ${line(W - 117, 36, W - 95, 36, acColor)}
    <text x="${W - 92}" y="39" font-size="5.5" fill="#333">AC Circuit</text>
    ${line(W - 117, 44, W - 95, 44, gndColor)}
    <text x="${W - 92}" y="47" font-size="5.5" fill="#333">Ground (EGC)</text>
    <line x1="${W - 117}" y1="52" x2="${W - 95}" y2="52" stroke="#999" stroke-width="1.5" stroke-dasharray="4,2"/>
    <text x="${W - 92}" y="55" font-size="5.5" fill="#333">Control / Signal</text>
    <circle cx="${W - 107}" cy="62" r="5" fill="#1a3a6b" opacity="0.8"/>
    <text x="${W - 107}" y="65" text-anchor="middle" font-size="4" fill="white">690.x</text>
    <text x="${W - 99}" y="65" font-size="5.5" fill="#333">NEC ref bubble</text>
  </svg>`;
}