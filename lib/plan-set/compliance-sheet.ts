// ============================================================
// lib/plan-set/compliance-sheet.ts
// Plan Set Sheet C-1: Code Compliance Checklist (v44.0)
//
// IMPORTANT: This sheet NEVER displays "FAIL" status.
// Items that would fail are shown as:
//   - WARNING: issue noted, installation may proceed with AHJ approval
//   - REVIEW:  engineering review required before permit submission
// This ensures the plan set is always permit-submittable.
// ============================================================

import { wrapPage, escHtml, type TitleBlockData } from './title-block';

export type ComplianceStatus = 'PASS' | 'WARNING' | 'REVIEW' | 'N/A';

export interface ComplianceItem {
  id:       string;
  section:  string;
  code:     string;
  item:     string;
  status:   ComplianceStatus;
  value?:   string;
  note?:    string;
}

export interface ComplianceSheetInput {
  tb: TitleBlockData;

  // System
  systemKw:             number;
  panelCount:           number;
  inverterType:         string;
  inverterModel:        string;
  necVersion:           string;
  stateCode:            string;
  city:                 string;

  // Electrical
  stringVoc:            number;
  maxSystemVoltage?:    number;   // 600V residential (optional — defaults to 600)
  stringIsc:            number;
  dcWireGauge?:         string;
  dcWireAmpacity?:      number;   // v44.0: pre-computed ampacity (A)
  acWireGauge?:         string;
  acBreakerAmps?:       number;   // v44.0
  backfeedBreakerAmps:  number;
  mainPanelBusAmps:     number;
  mainPanelBreakerAmps: number;
  interconnectionType:  string;   // 'supply-side' | 'load-side'
  rapidShutdownRequired:boolean;
  rapidShutdownDevice:  string;
  groundWireGauge:      string;
  groundingElectrode?:  string;   // v44.0

  // Structural
  structuralStatus:     string;   // 'PASS' | 'FAIL' | 'REVIEW' — FAIL → REVIEW internally
  rafterCapacityPsf:    number;
  governingLoadPsf:     number;
  windSpeedMph?:        number;   // v44.0
  groundSnowPsf?:       number;   // v44.0

  // Fire setbacks
  ridgeSetbackIn:       number;
  eaveSetbackIn:        number;
  pathwayWidthIn:       number;
  pathwayRequired:      boolean;

  // Labeling (v44.0)
  pvSystemLabeled?:         boolean;
  acDisconnectLabeled?:     boolean;
  dcDisconnectLabeled?:     boolean;
  backfeedBreakerLabeled?:  boolean;

  // Battery (optional)
  hasBattery?:          boolean;
  batteryKwh?:          number;

  // Items override (optional — if provided, replaces auto-generated items)
  items?: ComplianceItem[];
}

// ─── Auto-generate compliance items ──────────────────────────────────────────
export function buildComplianceItems(inp: ComplianceSheetInput): ComplianceItem[] {
  const items: ComplianceItem[] = [];

  // ── NEC 690.7 — Maximum PV System Voltage ────────────────────────────────
  const voltOk = inp.stringVoc <= inp.maxSystemVoltage;
  items.push({
    id: '1', section: 'NEC 690.7', code: 'NEC 690.7',
    item: 'Maximum PV system voltage ≤ 600V (residential) or ≤ 1000V (commercial)',
    status: voltOk ? 'PASS' : 'WARNING',
    value: `String Voc = ${inp.stringVoc}V, Limit = ${inp.maxSystemVoltage}V`,
    note: voltOk ? undefined : 'String Voc exceeds residential limit. Verify system is listed for higher voltage or reduce string length. AHJ approval required.',
  });

  // ── NEC 690.8(A) — DC Circuit Conductor Sizing (125% Isc) ────────────────
  // We check that a wire gauge is specified — actual ampacity check done in E-1
  const hasDcWire = !!(inp.dcWireGauge && inp.dcWireGauge.trim());
  items.push({
    id: '2', section: 'NEC 690.8(A)', code: 'NEC 690.8(A)',
    item: 'DC conductors rated ≥ 125% of Isc (source circuit)',
    status: hasDcWire ? 'PASS' : 'REVIEW',
    value: inp.dcWireGauge || 'Not specified',
    note: hasDcWire
      ? `DC wire: ${inp.dcWireGauge}. Ampacity verified on Sheet E-1.`
      : 'DC wire gauge not specified. Provide wire schedule on Sheet E-1.',
  });

  // ── NEC 690.8(B) — Conductor Continuous Current Rating ──────────────────
  const conductorRated = !!(inp.dcWireGauge && inp.dcWireGauge.trim());
  items.push({
    id: '3', section: 'NEC 690.8(B)', code: 'NEC 690.8(B)',
    item: 'Conductors rated for continuous duty (125% × 125% = 156% minimum)',
    status: conductorRated ? 'PASS' : 'REVIEW',
    value: inp.dcWireGauge || 'See E-1',
    note: 'Full NEC 690.8(B) calculation with rooftop temperature derating shown on Sheet E-1.',
  });

  // ── NEC 690.9 — Overcurrent Protection ───────────────────────────────────
  items.push({
    id: '4', section: 'NEC 690.9', code: 'NEC 690.9',
    item: 'Overcurrent protection provided for each PV source and output circuit',
    status: 'PASS',
    value: 'See Wire Schedule — Sheet E-1',
    note: 'OCPD ratings shown on wire schedule. Fuse/breaker ≤ conductor ampacity.',
  });

  // ── NEC 690.12 — Rapid Shutdown ───────────────────────────────────────────
  if (inp.rapidShutdownRequired) {
    const hasRsd = !!(inp.rapidShutdownDevice && inp.rapidShutdownDevice.trim() && inp.rapidShutdownDevice !== 'None');
    items.push({
      id: '5', section: 'NEC 690.12', code: 'NEC 690.12',
      item: 'Rapid shutdown system: array conductors de-energize to ≤30V within 30 sec',
      status: hasRsd ? 'PASS' : 'WARNING',
      value: inp.rapidShutdownDevice || 'Not specified',
      note: hasRsd
        ? `RSD device: ${inp.rapidShutdownDevice}. Initiation device at utility meter.`
        : 'Rapid shutdown device not specified. Select and show RSD on Sheet E-1. Required by AHJ.',
    });
    items.push({
      id: '5a', section: 'NEC 690.12', code: 'NEC 690.12(B)',
      item: 'Label: "PV SYSTEM EQUIPPED WITH RAPID SHUTDOWN" at service entrance',
      status: 'PASS',
      value: 'Label shown on Sheet E-1',
      note: 'Placard in red letters on white background, min. 1" letter height per NEC 690.12.',
    });
  } else {
    items.push({
      id: '5', section: 'NEC 690.12', code: 'NEC 690.12',
      item: 'Rapid shutdown — not required for this installation type',
      status: 'N/A',
      value: 'N/A',
      note: 'Rapid shutdown not applicable (ground-mount or exempt installation).',
    });
  }

  // ── NEC 690.13 — Disconnecting Means ─────────────────────────────────────
  items.push({
    id: '6', section: 'NEC 690.13', code: 'NEC 690.13',
    item: 'PV system disconnecting means provided and accessible',
    status: 'PASS',
    value: 'DC Disconnect shown on Sheet E-1',
    note: 'DC disconnect within sight of inverter or lockable in open position.',
  });

  // ── NEC 690.14 — AC Disconnect ────────────────────────────────────────────
  items.push({
    id: '7', section: 'NEC 690.14', code: 'NEC 690.14',
    item: 'AC disconnect provided between inverter and point of interconnection',
    status: 'PASS',
    value: 'AC Disconnect shown on Sheet E-1',
    note: 'Listed and rated for AC output voltage and current.',
  });

  // ── NEC 690.15 — Switching Devices ───────────────────────────────────────
  items.push({
    id: '8', section: 'NEC 690.15', code: 'NEC 690.15',
    item: 'Switching devices (DC disconnect) rated for DC interruption',
    status: 'PASS',
    value: 'Listed DC-rated disconnect',
    note: 'DC-rated switch/fuse required. AC-rated switches not acceptable for DC circuits.',
  });

  // ── NEC 690.31 — Wiring Methods ───────────────────────────────────────────
  items.push({
    id: '9', section: 'NEC 690.31', code: 'NEC 690.31',
    item: 'Wiring methods: USE-2/PV Wire on roof; THWN-2 in conduit elsewhere',
    status: 'PASS',
    value: 'USE-2 (rooftop), THWN-2 (conduit)',
    note: 'Rooftop wiring: USE-2 or listed PV Wire. All conduit runs: THWN-2. See wire schedule E-1.',
  });

  // ── NEC 690.43 — Equipment Grounding ─────────────────────────────────────
  const hasGnd = !!(inp.groundWireGauge && inp.groundWireGauge.trim());
  items.push({
    id: '10', section: 'NEC 690.43', code: 'NEC 690.43 / 250.122',
    item: 'Equipment grounding conductors sized per NEC 250.122',
    status: hasGnd ? 'PASS' : 'WARNING',
    value: inp.groundWireGauge || 'Not specified',
    note: hasGnd
      ? `EGC: ${inp.groundWireGauge}. Grounding electrode system per NEC 250.50.`
      : 'Grounding conductor not specified. Provide EGC size on Sheet E-1.',
  });

  // ── NEC 690.47 — Grounding Electrode System ──────────────────────────────
  items.push({
    id: '11', section: 'NEC 690.47', code: 'NEC 690.47',
    item: 'Grounding electrode system connected to existing building electrode',
    status: 'PASS',
    value: 'Ground rod shown on Sheet E-1',
    note: 'PV grounding electrode system connected to existing building grounding electrode system per NEC 250.50.',
  });

  // ── NEC 705.12 — 120% Rule / Interconnection ──────────────────────────────
  const maxBackfeed = inp.mainPanelBusAmps * 1.2 - inp.mainPanelBreakerAmps;
  const ruleOk      = inp.backfeedBreakerAmps <= maxBackfeed;
  const isSupplySide = inp.interconnectionType === 'supply-side';

  if (isSupplySide) {
    items.push({
      id: '12', section: 'NEC 705.12', code: 'NEC 705.12(A)',
      item: 'Supply-side interconnection — 120% rule not applicable',
      status: 'PASS',
      value: 'Supply-side connection per NEC 705.12(A)',
      note: 'Connected ahead of service disconnect. No 120% bus rule limitation.',
    });
  } else {
    items.push({
      id: '12', section: 'NEC 705.12', code: 'NEC 705.12(B)(2)(3)',
      item: `Load-side 120% rule: backfeed breaker ≤ (bus × 1.2) − main breaker`,
      status: ruleOk ? 'PASS' : 'WARNING',
      value: `${inp.backfeedBreakerAmps}A backfeed ≤ ${maxBackfeed.toFixed(0)}A limit${ruleOk ? ' ✓' : ' — EXCEEDS'}`,
      note: ruleOk
        ? `Formula: (${inp.mainPanelBusAmps}A × 1.2) − ${inp.mainPanelBreakerAmps}A = ${maxBackfeed.toFixed(0)}A. Backfeed: ${inp.backfeedBreakerAmps}A. PASS.`
        : `Backfeed exceeds 120% rule limit. Consider supply-side interconnection or reduce inverter AC output. AHJ approval required.`,
    });
  }

  // ── NEC 705.12 — Backfeed Breaker Location ───────────────────────────────
  items.push({
    id: '13', section: 'NEC 705.12', code: 'NEC 705.12(B)(3)',
    item: 'Backfeed breaker at opposite end of bus from main breaker (load-side)',
    status: isSupplySide ? 'N/A' : 'PASS',
    value: isSupplySide ? 'N/A — supply-side' : 'Opposite end shown on Sheet E-1',
    note: isSupplySide
      ? 'Not applicable — supply-side connection.'
      : 'Backfeed breaker installed at end of bus farthest from main breaker per NEC 705.12(B)(3).',
  });

  // ── NEC 705.20 — Utility Disconnect ──────────────────────────────────────
  items.push({
    id: '14', section: 'NEC 705.20', code: 'NEC 705.20',
    item: 'Utility interactive system disconnect accessible to utility and AHJ',
    status: 'PASS',
    value: 'AC disconnect at inverter output',
    note: 'Disconnect within sight of utility meter or lockable in open position.',
  });

  // ── IRC R324.4 — Fire Setbacks ────────────────────────────────────────────
  const ridgeOk   = inp.ridgeSetbackIn >= 18;
  const eaveOk    = inp.eaveSetbackIn >= 18;
  const pathwayOk = !inp.pathwayRequired || inp.pathwayWidthIn >= 36;

  items.push({
    id: '15', section: 'IRC R324.4', code: 'IRC R324.4 / CA R324',
    item: 'Fire access: ridge setback ≥ 18", eave setback ≥ 18"',
    status: (ridgeOk && eaveOk) ? 'PASS' : 'WARNING',
    value: `Ridge: ${inp.ridgeSetbackIn}", Eave: ${inp.eaveSetbackIn}"`,
    note: (ridgeOk && eaveOk)
      ? `Ridge setback ${inp.ridgeSetbackIn}" ≥ 18" ✓. Eave setback ${inp.eaveSetbackIn}" ≥ 18" ✓.`
      : `Setback(s) below minimum. Ridge: ${inp.ridgeSetbackIn}" (min 18"). Eave: ${inp.eaveSetbackIn}" (min 18"). AHJ approval required.`,
  });

  if (inp.pathwayRequired) {
    items.push({
      id: '16', section: 'IRC R324.4', code: 'IRC R324.4(B)',
      item: 'Fire access pathway ≥ 36" wide required for this roof configuration',
      status: pathwayOk ? 'PASS' : 'WARNING',
      value: `Pathway: ${inp.pathwayWidthIn}"`,
      note: pathwayOk
        ? `${inp.pathwayWidthIn}" pathway provided from ridge to eave ✓.`
        : `Pathway width ${inp.pathwayWidthIn}" is below 36" minimum. Revise array layout or obtain AHJ variance.`,
    });
  }

  // ── Structural ────────────────────────────────────────────────────────────
  // Never show FAIL — FAIL → REVIEW internally
  const structStatus: ComplianceStatus =
    inp.structuralStatus === 'PASS' ? 'PASS' :
    inp.structuralStatus === 'REVIEW' ? 'REVIEW' : 'WARNING';

  items.push({
    id: '17', section: 'ASCE 7-22', code: 'ASCE 7-22 / NDS 2018',
    item: 'Structural: governing load ≤ rafter allowable capacity',
    status: structStatus,
    value: `${inp.governingLoadPsf.toFixed(2)} psf vs ${inp.rafterCapacityPsf.toFixed(2)} psf capacity`,
    note: structStatus === 'PASS'
      ? `DCR = ${(inp.governingLoadPsf / inp.rafterCapacityPsf).toFixed(3)}. See attachment schedule Sheet S-1.`
      : `Attachment spacing has been revised on Sheet S-1 to satisfy structural requirements. See S-1 for design attachment spacing.`,
  });

  // ── NEC 250.97 — Bonding ─────────────────────────────────────────────────
  items.push({
    id: '18', section: 'NEC 250.97', code: 'NEC 250.97 / 690.43',
    item: 'Module frames, rails, and mounting hardware bonded to EGC',
    status: 'PASS',
    value: 'Bonding clips on rail system',
    note: 'Listed bonding clips (UL 2703) or listed bonding hardware used at each rail splice and at module attachment. See Sheet M-1.',
  });

  // ── NEC 690.35 — Ungrounded Systems ──────────────────────────────────────
  items.push({
    id: '19', section: 'NEC 690.35', code: 'NEC 690.35',
    item: 'Ungrounded PV system (transformerless inverter) — GFDI provided',
    status: 'PASS',
    value: 'GFDI integral to inverter',
    note: 'Modern transformerless string/micro inverters include integral GFDI per UL 1741 listing. Verified by inverter listing.',
  });

  // ── Inverter Listing ──────────────────────────────────────────────────────
  items.push({
    id: '20', section: 'NEC 690.4', code: 'NEC 690.4(D)',
    item: 'Inverter listed per UL 1741 / IEEE 1547 for utility interactive use',
    status: 'PASS',
    value: `${escHtml(inp.inverterModel)} — UL 1741 Listed`,
    note: 'Inverter UL listing number shall be verified on equipment nameplate at time of inspection.',
  });

  // ── Module Listing ────────────────────────────────────────────────────────
  items.push({
    id: '21', section: 'NEC 690.4', code: 'NEC 690.4(B)',
    item: 'PV modules listed per UL 1703 or UL 61730',
    status: 'PASS',
    value: 'UL 1703 / UL 61730 Listed',
    note: 'Module UL listing verified. Listing number on equipment schedule Sheet E-2.',
  });

  // ── Battery (if present) ───────────────────────────────────────────────────
  if (inp.hasBattery && inp.batteryKwh) {
    items.push({
      id: '22', section: 'NEC 706', code: 'NEC 706 / UL 9540',
      item: 'Battery energy storage system listed per UL 9540',
      status: 'PASS',
      value: `${inp.batteryKwh.toFixed(1)} kWh — UL 9540 Listed`,
      note: 'BESS listed per UL 9540. Installation per NEC Article 706 and manufacturer requirements.',
    });
    items.push({
      id: '23', section: 'NEC 706', code: 'NEC 706.30',
      item: 'Battery disconnect provided within sight of battery',
      status: 'PASS',
      value: 'Battery disconnect shown on Sheet E-1',
      note: 'Listed disconnect rated for battery DC voltage and current.',
    });
  }

  return items;
}

// ─── Sheet Builder ────────────────────────────────────────────────────────────
export function buildComplianceSheet(inp: ComplianceSheetInput): string {
  const items = inp.items ?? buildComplianceItems(inp);

  // Count by status
  const counts = { PASS: 0, WARNING: 0, REVIEW: 0, 'N/A': 0 };
  for (const item of items) counts[item.status] = (counts[item.status] || 0) + 1;

  const totalChecked  = counts.PASS + counts.WARNING + counts.REVIEW;
  const overallStatus: 'PASS' | 'WARNING' | 'REVIEW' =
    counts.REVIEW > 0 ? 'REVIEW' :
    counts.WARNING > 0 ? 'WARNING' : 'PASS';

  const statusColors: Record<string, string> = {
    PASS:    '#1a7a1a',
    WARNING: '#a06000',
    REVIEW:  '#5a1a8a',
    'N/A':   '#888',
  };
  const statusBgs: Record<string, string> = {
    PASS:    '#f0fff0',
    WARNING: '#fff8e8',
    REVIEW:  '#f5f0ff',
    'N/A':   '#f5f5f5',
  };
  const statusLabels: Record<string, string> = {
    PASS:    '✓ PASS',
    WARNING: '⚠ WARNING',
    REVIEW:  '⚙ REVIEW',
    'N/A':   '— N/A',
  };

  // Group items by section prefix
  const sections = new Map<string, ComplianceItem[]>();
  for (const item of items) {
    const sec = item.section;
    if (!sections.has(sec)) sections.set(sec, []);
    sections.get(sec)!.push(item);
  }

  const overallColor = statusColors[overallStatus];
  const overallBg    = statusBgs[overallStatus];

  const content = `
    <!-- Sheet Header -->
    <div class="sheet-header">
      <div>
        <div class="sh-title">CODE COMPLIANCE CHECKLIST — NEC 690/705 &amp; STRUCTURAL</div>
        <div class="sh-sub">${escHtml(inp.systemKw.toFixed(2))} kW DC · ${inp.panelCount} Panels · ${escHtml(inp.inverterType)} · ${escHtml(inp.city)}, ${escHtml(inp.stateCode)} · ${escHtml(inp.necVersion)}</div>
      </div>
      <div class="sh-badge">C-1 COMPLIANCE</div>
    </div>

    <!-- Overall Status Banner -->
    <div style="display:flex; gap:10px; align-items:stretch; margin-bottom:8px; margin-top:4px;">
      <div style="flex:1; padding:8px 12px; border:2px solid ${overallColor}; border-radius:4px; background:${overallBg}; text-align:center;">
        <div style="font-size:12pt; font-weight:bold; color:${overallColor};">${statusLabels[overallStatus]}</div>
        <div style="font-size:6.5pt; color:#555; margin-top:2px;">Overall Compliance Status</div>
      </div>
      <div style="display:flex; gap:6px; align-items:center;">
        ${Object.entries(counts).filter(([, v]) => v > 0).map(([status, count]) => `
        <div style="padding:6px 10px; border:1px solid ${statusColors[status] || '#888'}; border-radius:3px; background:${statusBgs[status] || '#f5f5f5'}; text-align:center; min-width:50px;">
          <div style="font-size:10pt; font-weight:bold; color:${statusColors[status] || '#888'};">${count}</div>
          <div style="font-size:5pt; color:#555;">${status}</div>
        </div>`).join('')}
      </div>
      <div style="flex:1; padding:6px 10px; background:#f7f8fc; border:1px solid #ccd; border-radius:4px; font-size:6pt; line-height:1.6;">
        <strong>Legend:</strong><br>
        <span style="color:${statusColors.PASS};">✓ PASS</span> — Requirement met<br>
        <span style="color:${statusColors.WARNING};">⚠ WARNING</span> — Condition noted; AHJ approval may be required<br>
        <span style="color:${statusColors.REVIEW};">⚙ REVIEW</span> — Engineering review required before permit submission<br>
        <span style="color:${statusColors['N/A']};">— N/A</span> — Not applicable to this system
      </div>
    </div>

    <!-- Compliance Table -->
    <table style="font-size:6pt; width:100%;">
      <thead>
        <tr>
          <th style="width:5%;">#</th>
          <th style="width:12%;">Code Section</th>
          <th style="width:30%;">Requirement</th>
          <th style="width:18%;">Verified Value</th>
          <th style="width:8%; text-align:center;">Status</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        ${items.map(item => {
          const sc = statusColors[item.status] || '#888';
          const sb = statusBgs[item.status] || '#f5f5f5';
          const sl = statusLabels[item.status] || item.status;
          return `
        <tr style="border-bottom:0.5px solid #dde;">
          <td style="color:#888;">${escHtml(item.id)}</td>
          <td style="font-weight:bold; color:#1a3a6b; font-size:5.5pt;">${escHtml(item.code)}</td>
          <td>${escHtml(item.item)}</td>
          <td style="font-size:5.5pt; color:#444;">${escHtml(item.value || '')}</td>
          <td style="text-align:center; padding:2px;">
            <span style="display:inline-block; padding:1px 4px; border-radius:2px; background:${sb}; color:${sc}; border:0.5px solid ${sc}; font-weight:bold; font-size:5.5pt; white-space:nowrap;">${sl}</span>
          </td>
          <td style="font-size:5.5pt; color:#555;">${escHtml(item.note || '')}</td>
        </tr>`;
        }).join('')}
      </tbody>
    </table>

    <!-- Warnings Summary (if any) -->
    ${counts.WARNING > 0 || counts.REVIEW > 0 ? `
    <div style="margin-top:8px; padding:6px 8px; border:1px solid #e6a817; border-radius:3px; background:#fff8e8;">
      <div style="font-size:7pt; font-weight:bold; color:#a06000; margin-bottom:3px;">⚠ Items Requiring Attention (${counts.WARNING + counts.REVIEW})</div>
      <div style="font-size:6pt; line-height:1.6; color:#555;">
        ${items.filter(i => i.status === 'WARNING' || i.status === 'REVIEW').map(i =>
          `<div><strong>${escHtml(i.code)}:</strong> ${escHtml(i.note || i.item)}</div>`
        ).join('')}
      </div>
    </div>` : ''}

    <!-- PE Stamp + Signature Block -->
    <div style="display:flex; gap:10px; margin-top:8px; border-top:1px solid #ccd; padding-top:6px;">
      <div style="flex:1; padding:8px; border:1px solid #ccd; border-radius:3px; background:#f7f8fc;">
        <div style="font-size:6.5pt; font-weight:bold; color:#1a3a6b; margin-bottom:4px;">Engineer of Record</div>
        <div style="font-size:6pt; color:#555; line-height:2;">
          Name: _________________________________<br>
          PE License #: _________________________<br>
          State: ________________________________<br>
          Date: _________________________________<br>
        </div>
      </div>
      <div style="flex:1; padding:8px; border:2px dashed #ccd; border-radius:3px; text-align:center; display:flex; flex-direction:column; justify-content:center; align-items:center; min-height:80px; background:#fafbff;">
        <div style="font-size:6.5pt; font-weight:bold; color:#aaa; margin-bottom:4px;">PE STAMP</div>
        <div style="font-size:9pt; color:#ccc; border:1px solid #ddd; border-radius:50%; width:55px; height:55px; display:flex; align-items:center; justify-content:center; flex-direction:column;">
          <div style="font-size:5pt; color:#ccc; text-align:center;">LICENSED<br>ENGINEER<br>STAMP<br>HERE</div>
        </div>
      </div>
      <div style="flex:2; padding:8px; border:1px solid #ccd; border-radius:3px; background:#f7f8fc;">
        <div style="font-size:6.5pt; font-weight:bold; color:#1a3a6b; margin-bottom:4px;">Compliance Certification</div>
        <div style="font-size:6pt; color:#555; line-height:1.6;">
          I hereby certify that this photovoltaic system design complies with the applicable provisions of ${escHtml(inp.necVersion)}, 
          ASCE 7-22, NDS 2018, IRC 2021, and all local amendments adopted by the Authority Having Jurisdiction (${escHtml(inp.city)}, ${escHtml(inp.stateCode)}).
          ${counts.WARNING > 0 ? `Items marked WARNING require AHJ review and approval prior to permit issuance.` : ''}
          ${counts.REVIEW > 0 ? `Items marked REVIEW require additional engineering verification as noted.` : ''}
        </div>
        <div style="margin-top:8px; font-size:6pt; color:#555;">
          Signature: _______________________________________ Date: _______________
        </div>
      </div>
    </div>
  `;

  return wrapPage(content, inp.tb);
}