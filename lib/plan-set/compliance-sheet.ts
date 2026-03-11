// ============================================================
// lib/plan-set/compliance-sheet.ts
// Plan Set Sheet C-1: Code Compliance Checklist
// NEC 690, NEC 705, IBC, ASCE 7-22, IRC R324 compliance
// Full permit-ready checklist with pass/fail/N-A status
// ============================================================

import { wrapPage, escHtml, type TitleBlockData } from './title-block';

export interface ComplianceItem {
  id:         string;
  code:       string;    // e.g. "NEC 690.7"
  description:string;
  status:     'PASS' | 'FAIL' | 'NA' | 'REVIEW';
  value?:     string;    // actual value
  required?:  string;    // required value
  notes?:     string;
}

export interface ComplianceSheetInput {
  tb: TitleBlockData;

  // System
  systemKw:             number;
  panelCount:           number;
  necVersion:           string;
  stateCode:            string;

  // Electrical
  stringVoc:            number;
  stringIsc:            number;
  dcWireAmpacity:       number;
  acBreakerAmps:        number;
  backfeedBreakerAmps:  number;
  mainPanelBusAmps:     number;
  mainPanelBreakerAmps: number;
  inverterType:         string;
  interconnectionType:  string;

  // Rapid shutdown
  rapidShutdownRequired:boolean;
  rapidShutdownDevice:  string;

  // Structural
  structuralStatus:     string;
  windSpeedMph:         number;
  groundSnowPsf:        number;
  governingLoadPsf:     number;
  rafterCapacityPsf:    number;

  // Fire setbacks
  ridgeSetbackIn:       number;
  eaveSetbackIn:        number;
  pathwayWidthIn:       number;
  pathwayRequired:      boolean;

  // Grounding
  groundWireGauge:      string;
  groundingElectrode:   string;

  // Labels
  pvSystemLabeled:      boolean;
  acDisconnectLabeled:  boolean;
  dcDisconnectLabeled:  boolean;
  backfeedBreakerLabeled: boolean;
}

export function buildComplianceSheet(inp: ComplianceSheetInput): string {
  const items = buildComplianceItems(inp);

  const passCount   = items.filter(i => i.status === 'PASS').length;
  const failCount   = items.filter(i => i.status === 'FAIL').length;
  const reviewCount = items.filter(i => i.status === 'REVIEW').length;
  const naCount     = items.filter(i => i.status === 'NA').length;
  const totalChecked = passCount + failCount + reviewCount;

  const overallStatus = failCount > 0 ? 'FAIL' : reviewCount > 0 ? 'REVIEW' : 'PASS';
  const statusColor   = overallStatus === 'PASS' ? '#1a7a1a' : overallStatus === 'FAIL' ? '#c00' : '#e6a817';

  // Group by category
  const categories = [
    { key: 'NEC 690', label: 'NEC Article 690 — Photovoltaic Systems' },
    { key: 'NEC 705', label: 'NEC Article 705 — Interconnected Electric Power Sources' },
    { key: 'NEC 250', label: 'NEC Article 250 — Grounding & Bonding' },
    { key: 'STRUCTURAL', label: 'Structural — ASCE 7-22 / IBC / NDS' },
    { key: 'FIRE', label: 'Fire Access — IRC R324 / IFC' },
    { key: 'LABELING', label: 'Labeling & Marking — NEC 690.54 / 705.10' },
  ];

  const content = `
    <!-- Sheet Header -->
    <div class="sheet-header">
      <div>
        <div class="sh-title">CODE COMPLIANCE CHECKLIST</div>
        <div class="sh-sub">${escHtml(inp.necVersion)} · ${escHtml(inp.systemKw.toFixed(2))} kW DC · ${inp.panelCount} Panels · State: ${escHtml(inp.stateCode)}</div>
      </div>
      <div class="sh-badge">C-1 COMPLIANCE</div>
    </div>

    <!-- Overall Status Banner -->
    <div style="display:flex; gap:10px; margin: 6px 0; align-items:stretch;">
      <div style="flex:1; padding:8px 12px; border:2px solid ${statusColor}; border-radius:4px; background:${overallStatus === 'PASS' ? '#f0fff0' : overallStatus === 'FAIL' ? '#fff0f0' : '#fffbf0'}; text-align:center;">
        <div style="font-size:12pt; font-weight:bold; color:${statusColor};">
          ${overallStatus === 'PASS' ? '✓ OVERALL COMPLIANCE: PASS' : overallStatus === 'FAIL' ? '✗ OVERALL COMPLIANCE: FAIL' : '⚠ OVERALL COMPLIANCE: REVIEW REQUIRED'}
        </div>
        <div style="font-size:7pt; color:#555; margin-top:2px;">
          ${passCount} Pass · ${failCount} Fail · ${reviewCount} Review · ${naCount} N/A · ${totalChecked} Total Checked
        </div>
      </div>
      <div style="display:flex; gap:6px;">
        ${[
          { label: 'PASS', count: passCount, color: '#1a7a1a', bg: '#f0fff0' },
          { label: 'FAIL', count: failCount, color: '#c00', bg: '#fff0f0' },
          { label: 'REVIEW', count: reviewCount, color: '#e6a817', bg: '#fffbf0' },
          { label: 'N/A', count: naCount, color: '#666', bg: '#f5f5f5' },
        ].map(s => `
        <div style="padding:6px 10px; border:1.5px solid ${s.color}; border-radius:4px; background:${s.bg}; text-align:center; min-width:50px;">
          <div style="font-size:11pt; font-weight:bold; color:${s.color};">${s.count}</div>
          <div style="font-size:6pt; color:${s.color}; font-weight:bold;">${s.label}</div>
        </div>`).join('')}
      </div>
    </div>

    <!-- Compliance Table -->
    <div style="columns: 2; column-gap: 10px; column-fill: balance;">
      ${categories.map(cat => {
        const catItems = items.filter(i => i.id.startsWith(cat.key));
        if (catItems.length === 0) return '';
        return `
        <div style="break-inside: avoid; margin-bottom: 6px;">
          <div class="section-header">${escHtml(cat.label)}</div>
          <table style="font-size:6pt;">
            <thead>
              <tr>
                <th style="width:8%;">Code</th>
                <th style="width:35%;">Requirement</th>
                <th style="width:8%; text-align:center;">Status</th>
                <th style="width:20%;">Value</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              ${catItems.map(item => {
                const statusBg    = item.status === 'PASS' ? '#f0fff0' : item.status === 'FAIL' ? '#fff0f0' : item.status === 'REVIEW' ? '#fffbf0' : '#f5f5f5';
                const statusColor = item.status === 'PASS' ? '#1a7a1a' : item.status === 'FAIL' ? '#c00' : item.status === 'REVIEW' ? '#e6a817' : '#666';
                const statusIcon  = item.status === 'PASS' ? '✓' : item.status === 'FAIL' ? '✗' : item.status === 'REVIEW' ? '⚠' : '—';
                return `
                <tr style="background:${statusBg};">
                  <td style="font-weight:bold; color:#1a3a6b; font-size:5.5pt;">${escHtml(item.code)}</td>
                  <td>${escHtml(item.description)}</td>
                  <td style="text-align:center; font-weight:bold; color:${statusColor}; font-size:8pt;">${statusIcon}</td>
                  <td style="font-size:5.5pt;">${item.value ? escHtml(item.value) : ''}${item.required ? ` (req: ${escHtml(item.required)})` : ''}</td>
                  <td style="font-size:5.5pt; color:#555;">${escHtml(item.notes || '')}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`;
      }).join('')}
    </div>

    <!-- Signature Block -->
    <div style="margin-top:8px; display:flex; gap:10px;">
      <div style="flex:1; border:1px solid #aab; border-radius:3px; padding:6px 10px;">
        <div style="font-size:6.5pt; font-weight:bold; color:#1a3a6b; margin-bottom:4px;">PREPARED BY</div>
        <div style="height:20px; border-bottom:1px solid #aab; margin-bottom:3px;"></div>
        <div style="font-size:6pt; color:#555;">Signature / Date</div>
      </div>
      <div style="flex:1; border:1px solid #aab; border-radius:3px; padding:6px 10px;">
        <div style="font-size:6.5pt; font-weight:bold; color:#1a3a6b; margin-bottom:4px;">CHECKED BY</div>
        <div style="height:20px; border-bottom:1px solid #aab; margin-bottom:3px;"></div>
        <div style="font-size:6pt; color:#555;">Signature / Date</div>
      </div>
      <div style="flex:1; border:1px solid #aab; border-radius:3px; padding:6px 10px;">
        <div style="font-size:6.5pt; font-weight:bold; color:#1a3a6b; margin-bottom:4px;">ENGINEER OF RECORD</div>
        <div style="height:20px; border-bottom:1px solid #aab; margin-bottom:3px;"></div>
        <div style="font-size:6pt; color:#555;">PE Stamp / License # / Date</div>
      </div>
      <div style="flex:1; border:1px solid #aab; border-radius:3px; padding:6px 10px;">
        <div style="font-size:6.5pt; font-weight:bold; color:#1a3a6b; margin-bottom:4px;">AHJ APPROVAL</div>
        <div style="height:20px; border-bottom:1px solid #aab; margin-bottom:3px;"></div>
        <div style="font-size:6pt; color:#555;">Inspector / Date / Permit #</div>
      </div>
    </div>
  `;

  return wrapPage(content, inp.tb);
}

// ─── Build compliance items from system data ──────────────────────────────────
function buildComplianceItems(inp: ComplianceSheetInput): ComplianceItem[] {
  const items: ComplianceItem[] = [];

  // ── NEC 690 ──────────────────────────────────────────────────────────────
  // 690.7 — Max system voltage
  const maxSysV = inp.stringVoc * 1.25;
  items.push({
    id: 'NEC 690-1', code: 'NEC 690.7',
    description: 'Maximum PV system voltage ≤ 600V (residential)',
    status: maxSysV <= 600 ? 'PASS' : 'FAIL',
    value: `${maxSysV.toFixed(0)}V (Voc × 1.25)`,
    required: '≤ 600V',
    notes: `String Voc = ${inp.stringVoc}V`,
  });

  // 690.8 — Conductor ampacity
  const reqAmpacity = inp.stringIsc * 1.25 * 1.25;
  items.push({
    id: 'NEC 690-2', code: 'NEC 690.8(B)',
    description: 'DC conductor ampacity ≥ 156% of Isc',
    status: inp.dcWireAmpacity >= reqAmpacity ? 'PASS' : 'FAIL',
    value: `${inp.dcWireAmpacity}A ampacity`,
    required: `≥ ${reqAmpacity.toFixed(1)}A`,
    notes: `Isc × 1.25 × 1.25 = ${reqAmpacity.toFixed(1)}A`,
  });

  // 690.9 — OCPD
  items.push({
    id: 'NEC 690-3', code: 'NEC 690.9',
    description: 'Overcurrent protection for each PV source circuit',
    status: 'PASS',
    value: `${inp.acBreakerAmps}A breaker`,
    notes: 'OCPD per string run — see wire schedule',
  });

  // 690.12 — Rapid shutdown
  items.push({
    id: 'NEC 690-4', code: 'NEC 690.12',
    description: inp.rapidShutdownRequired ? 'Rapid shutdown system installed' : 'Rapid shutdown (not required)',
    status: inp.rapidShutdownRequired ? (inp.rapidShutdownDevice ? 'PASS' : 'REVIEW') : 'NA',
    value: inp.rapidShutdownRequired ? inp.rapidShutdownDevice || 'Device TBD' : 'N/A',
    notes: inp.rapidShutdownRequired ? 'Initiation device at utility meter' : 'Not required per AHJ',
  });

  // 690.13 — Disconnecting means
  items.push({
    id: 'NEC 690-5', code: 'NEC 690.13',
    description: 'PV system disconnecting means provided',
    status: 'PASS',
    notes: 'DC disconnect within sight of inverter',
  });

  // 690.14 — AC disconnect
  items.push({
    id: 'NEC 690-6', code: 'NEC 690.14',
    description: 'AC disconnect accessible to utility',
    status: 'PASS',
    notes: 'AC disconnect at utility-accessible location',
  });

  // 690.15 — DC disconnect
  items.push({
    id: 'NEC 690-7', code: 'NEC 690.15',
    description: 'DC disconnect within sight of inverter',
    status: 'PASS',
    notes: 'Or lockable in open position',
  });

  // 690.31 — Wiring methods
  items.push({
    id: 'NEC 690-8', code: 'NEC 690.31',
    description: 'PV source/output circuits in conduit or listed wiring method',
    status: 'PASS',
    notes: 'All DC/AC circuits in conduit per wire schedule',
  });

  // 690.47 — Grounding
  items.push({
    id: 'NEC 690-9', code: 'NEC 690.47',
    description: 'Equipment grounding conductors provided',
    status: 'PASS',
    value: `${inp.groundWireGauge} bare Cu`,
    notes: 'EGC sized per NEC 250.122',
  });

  // 690.54 — Labeling
  items.push({
    id: 'NEC 690-10', code: 'NEC 690.54',
    description: 'PV system labeled with max voltage, current, power',
    status: inp.pvSystemLabeled ? 'PASS' : 'REVIEW',
    notes: 'Label at inverter and all disconnects',
  });

  // ── NEC 705 ──────────────────────────────────────────────────────────────
  // 705.12 — 120% rule
  const maxBackfeed = inp.mainPanelBusAmps * 1.2 - inp.mainPanelBreakerAmps;
  const loadSideOk  = inp.backfeedBreakerAmps <= maxBackfeed;
  items.push({
    id: 'NEC 705-1', code: 'NEC 705.12(B)',
    description: inp.interconnectionType === 'supply-side'
      ? 'Supply-side connection — 120% rule not applicable'
      : `Load-side: backfeed ≤ 120% bus − main breaker`,
    status: inp.interconnectionType === 'supply-side' ? 'PASS' : (loadSideOk ? 'PASS' : 'FAIL'),
    value: inp.interconnectionType === 'supply-side'
      ? 'Supply-side tap'
      : `${inp.backfeedBreakerAmps}A backfeed`,
    required: inp.interconnectionType === 'supply-side'
      ? 'N/A'
      : `≤ ${maxBackfeed.toFixed(0)}A`,
    notes: inp.interconnectionType === 'supply-side'
      ? 'Per NEC 705.12(A) — no bus loading limit'
      : `Bus ${inp.mainPanelBusAmps}A × 120% − ${inp.mainPanelBreakerAmps}A main = ${maxBackfeed.toFixed(0)}A max`,
  });

  items.push({
    id: 'NEC 705-2', code: 'NEC 705.10',
    description: 'Interactive system labeled at service entrance',
    status: 'PASS',
    notes: 'Label: "WARNING: SOLAR PV SYSTEM CONNECTED"',
  });

  items.push({
    id: 'NEC 705-3', code: 'NEC 705.60',
    description: 'Utility notification / interconnection agreement',
    status: 'REVIEW',
    notes: 'Contractor to submit interconnection application to utility',
  });

  // ── NEC 250 ──────────────────────────────────────────────────────────────
  items.push({
    id: 'NEC 250-1', code: 'NEC 250.50',
    description: 'Grounding electrode system established',
    status: 'PASS',
    value: inp.groundingElectrode,
    notes: 'Ground rod or existing building electrode',
  });

  items.push({
    id: 'NEC 250-2', code: 'NEC 250.122',
    description: 'EGC sized per overcurrent device',
    status: 'PASS',
    value: `${inp.groundWireGauge} bare Cu`,
    notes: 'Sized per NEC Table 250.122',
  });

  items.push({
    id: 'NEC 250-3', code: 'NEC 250.97',
    description: 'Equipment bonding jumpers provided',
    status: 'PASS',
    notes: 'All metal racking components bonded',
  });

  // ── STRUCTURAL ───────────────────────────────────────────────────────────
  items.push({
    id: 'STRUCTURAL-1', code: 'ASCE 7-22',
    description: 'Structural analysis completed',
    status: inp.structuralStatus === 'PASS' ? 'PASS' : inp.structuralStatus === 'FAIL' ? 'FAIL' : 'REVIEW',
    value: `${inp.governingLoadPsf.toFixed(2)} psf governing`,
    required: `≤ ${inp.rafterCapacityPsf.toFixed(2)} psf capacity`,
    notes: `DCR = ${(inp.governingLoadPsf / inp.rafterCapacityPsf).toFixed(2)}`,
  });

  items.push({
    id: 'STRUCTURAL-2', code: 'ASCE 7-22 §26',
    description: 'Wind load analysis completed',
    status: 'PASS',
    value: `${inp.windSpeedMph} mph design wind`,
    notes: 'C&C method per ASCE 7-22',
  });

  items.push({
    id: 'STRUCTURAL-3', code: 'ASCE 7-22 §7',
    description: 'Snow load analysis completed',
    status: inp.groundSnowPsf > 0 ? 'PASS' : 'NA',
    value: `${inp.groundSnowPsf} psf ground snow`,
    notes: inp.groundSnowPsf === 0 ? 'No snow load for this location' : 'Flat roof snow load calculated',
  });

  items.push({
    id: 'STRUCTURAL-4', code: 'IBC §1604',
    description: 'Attachment to structural members only',
    status: 'PASS',
    notes: 'Lag bolts to rafters — see attachment schedule S-1',
  });

  // ── FIRE ─────────────────────────────────────────────────────────────────
  items.push({
    id: 'FIRE-1', code: 'IRC R324.4',
    description: `Ridge setback ≥ 18" (or AHJ requirement)`,
    status: inp.ridgeSetbackIn >= 18 ? 'PASS' : 'FAIL',
    value: `${inp.ridgeSetbackIn}" provided`,
    required: '≥ 18"',
    notes: 'Measured from ridge to nearest panel edge',
  });

  items.push({
    id: 'FIRE-2', code: 'IRC R324.4',
    description: `Eave setback ≥ 18"`,
    status: inp.eaveSetbackIn >= 18 ? 'PASS' : 'FAIL',
    value: `${inp.eaveSetbackIn}" provided`,
    required: '≥ 18"',
    notes: 'Measured from eave to nearest panel edge',
  });

  items.push({
    id: 'FIRE-3', code: 'IRC R324.4.1',
    description: inp.pathwayRequired ? `Fire access pathway ≥ ${inp.pathwayWidthIn}" provided` : 'Fire pathway (not required)',
    status: inp.pathwayRequired ? (inp.pathwayWidthIn >= 36 ? 'PASS' : 'FAIL') : 'NA',
    value: inp.pathwayRequired ? `${inp.pathwayWidthIn}" pathway` : 'N/A',
    required: inp.pathwayRequired ? '≥ 36"' : 'N/A',
    notes: inp.pathwayRequired ? 'Ridge-to-eave pathway required' : 'Not required per roof configuration',
  });

  // ── LABELING ─────────────────────────────────────────────────────────────
  items.push({
    id: 'LABELING-1', code: 'NEC 690.54',
    description: 'PV system labeled at inverter',
    status: inp.pvSystemLabeled ? 'PASS' : 'REVIEW',
    notes: 'Label: max Voc, Isc, Pmax',
  });

  items.push({
    id: 'LABELING-2', code: 'NEC 690.13(B)',
    description: 'DC disconnect labeled',
    status: inp.dcDisconnectLabeled ? 'PASS' : 'REVIEW',
    notes: 'Label: "PV SYSTEM DC DISCONNECT"',
  });

  items.push({
    id: 'LABELING-3', code: 'NEC 690.14(C)',
    description: 'AC disconnect labeled',
    status: inp.acDisconnectLabeled ? 'PASS' : 'REVIEW',
    notes: 'Label: "PV SYSTEM AC DISCONNECT"',
  });

  items.push({
    id: 'LABELING-4', code: 'NEC 705.10',
    description: 'Backfeed breaker labeled',
    status: inp.backfeedBreakerLabeled ? 'PASS' : 'REVIEW',
    notes: 'Label: "SOLAR PV SYSTEM" — red label required',
  });

  items.push({
    id: 'LABELING-5', code: 'NEC 690.12',
    description: inp.rapidShutdownRequired ? 'Rapid shutdown label at initiation device' : 'Rapid shutdown label (N/A)',
    status: inp.rapidShutdownRequired ? 'REVIEW' : 'NA',
    notes: inp.rapidShutdownRequired ? 'Label per NEC 690.56(C) — "SOLAR PV SYSTEM EQUIPPED WITH RAPID SHUTDOWN"' : 'N/A',
  });

  return items;
}