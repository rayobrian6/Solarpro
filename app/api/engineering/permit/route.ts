// ============================================================
// Permit Package PDF Generator — SolarPro V4
// POST /api/engineering/permit
//
// SHEET SET (matches professional reference plan set standard):
//   Page 1  (PV-0):  Cover Sheet + System Summary + Construction Notes + Sheet Index
//   Page 2  (PV-1):  Site Information & Interconnection Details
//   Page 3  (PV-2):  Schematic Roof Plan with Fire Setbacks & Attachment Pattern
//   Page 4  (PV-3):  Attachment Detail Cross-Section + Bill of Materials
//   Page 5  (PV-4A): NEC Compliance Sheet (Rules Engine Results)
//   Page 6  (PV-4B): Conductor & Conduit Schedule + NEC Calculations
//   Page 7  (PV-4C): Structural Calculation Sheet (ASCE 7-22)
//   Page 8  (PV-5):  Warning Labels & Required Placards
//   Page 9  (SCHED): Equipment Schedule
//   Page 10 (CERT):  Engineer Certification Block + Revision History
//
// The SLD (single-line diagram) is generated separately via
// /api/engineering/sld/pdf and referenced on PV-0 as sheet E-1.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';

export const dynamic = 'force-dynamic';

const execAsync = promisify(exec);

// ─── Types ──────────────────────────────────────────────────────────────────

interface PermitInput {
  project: {
    projectName: string;
    clientName: string;
    address: string;
    designer: string;
    date: string;
    notes: string;
    systemType: string;
    mainPanelAmps: number;
    mainPanelBrand: string;
    utilityMeter: string;
    utilityName?: string;
    acDisconnect: boolean;
    dcDisconnect: boolean;
    productionMeter: boolean;
    rapidShutdown: boolean;
    conduitType: string;
    wireGauge: string;
    wireLength: number;
    roofType?: string;
    mountingSystem?: string;
    mountingSystemId?: string;
    roofPitch?: number;
    rafterSize?: string;
    rafterSpacing?: number;
    attachmentSpacing?: number;
    batteryBrand?: string;
    batteryModel?: string;
    batteryCount?: number;
    batteryKwh?: number;
    batteryBackfeedA?: number;
    generatorBrand?: string;
    generatorKw?: number;
    interconnectionMethod?: string;
    panelBusRating?: number;
  };
  system: {
    totalDcKw: number;
    totalAcKw: number;
    totalPanels: number;
    dcAcRatio: number;
    topology: string;
    inverters: Array<{
      manufacturer: string;
      model: string;
      type: string;
      acOutputKw: number;
      maxDcVoltage: number;
      efficiency: number;
      ulListing: string;
      strings: Array<{
        label: string;
        panelCount: number;
        panelManufacturer: string;
        panelModel: string;
        panelWatts: number;
        panelVoc: number;
        panelIsc: number;
        wireGauge: string;
        wireLength: number;
      }>;
    }>;
  };
  compliance: {
    overallStatus: string;
    jurisdiction?: {
      state: string;
      necVersion: string;
      ahj: string;
      permitNotes?: string;
    };
    electrical?: any;
    structural?: any;
  };
  rulesResult?: {
    overallStatus: string;
    errorCount: number;
    warningCount: number;
    autoFixCount: number;
    overrideCount: number;
    rules: Array<{
      ruleId: string;
      category: string;
      severity: string;
      title: string;
      message: string;
      value?: string | number;
      limit?: string | number;
      necReference?: string;
      asceReference?: string;
      autoFixed?: boolean;
      autoFixDescription?: string;
    }>;
    structuralAutoResolutions?: Array<{
      field: string;
      originalValue: string | number;
      resolvedValue: string | number;
      reason: string;
      necReference: string;
    }>;
  };
  bom?: Array<{
    category: string;
    manufacturer: string;
    model: string;
    partNumber: string;
    quantity: number;
    unit: string;
    ulListing?: string;
  }>;
  overrides?: Array<{
    field: string;
    overrideValue: string | number;
    justification: string;
    engineer: string;
    timestamp: string;
  }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusColor(s: string) {
  if (s === 'PASS' || s === 'pass') return '#10b981';
  if (s === 'WARNING' || s === 'warning') return '#f59e0b';
  if (s === 'FAIL' || s === 'error') return '#ef4444';
  return '#64748b';
}
function statusBg(s: string) {
  if (s === 'PASS' || s === 'pass') return '#f0fdf4';
  if (s === 'WARNING' || s === 'warning') return '#fffbeb';
  if (s === 'FAIL' || s === 'error') return '#fef2f2';
  return '#f8fafc';
}
function statusBorder(s: string) {
  if (s === 'PASS' || s === 'pass') return '#bbf7d0';
  if (s === 'WARNING' || s === 'warning') return '#fde68a';
  if (s === 'FAIL' || s === 'error') return '#fecaca';
  return '#e2e8f0';
}
function statusLabel(s: string) {
  if (s === 'PASS' || s === 'pass') return '✓ PASS';
  if (s === 'WARNING' || s === 'warning') return '⚠ WARNING';
  if (s === 'FAIL' || s === 'error') return '✗ FAIL';
  return s?.toUpperCase() || '—';
}

function roofTypeLabel(rt?: string) {
  const m: Record<string, string> = {
    shingle: 'Asphalt Shingle',
    tile: 'Concrete/Clay Tile',
    metal_standing_seam: 'Metal Standing Seam',
    metal_corrugated: 'Metal Corrugated',
    flat_tpo: 'Flat — TPO Membrane',
    flat_epdm: 'Flat — EPDM Membrane',
    flat_gravel: 'Flat — Gravel Ballast',
  };
  return rt ? (m[rt] || rt) : 'Asphalt Shingle';
}

function interconnectionLabel(m?: string) {
  const map: Record<string, string> = {
    LOAD_SIDE: 'Load Side — NEC 705.12(B)',
    SUPPLY_SIDE_TAP: 'Supply Side Tap — NEC 705.12(A)',
    MAIN_BREAKER_DERATE: 'Main Breaker Derate — NEC 705.12(B)(3)',
    PANEL_UPGRADE: 'Panel Upgrade Required',
  };
  return m ? (map[m] || m) : 'Load Side — NEC 705.12(B)';
}

// ─── Title Block (shared across all pages) ───────────────────────────────────

function titleBlock(
  input: PermitInput,
  sheetId: string,
  pageTitle: string,
  pageNum: number,
  totalPages: number
): string {
  const { project, compliance } = input;
  const necVer = compliance.jurisdiction?.necVersion || '2020';
  const state = compliance.jurisdiction?.state || '—';
  const ahj = compliance.jurisdiction?.ahj || '—';
  return `
  <div class="title-block">
    <div class="tb-left">
      <div class="tb-company">SolarPro Engineering</div>
      <div class="tb-project">${project.projectName || 'Solar PV System'}</div>
      <div class="tb-address">${project.address || '—'}</div>
      <div class="tb-client">Client: ${project.clientName || '—'}</div>
    </div>
    <div class="tb-center">
      <div class="tb-sheet-id">${sheetId}</div>
      <div class="tb-sheet-title">${pageTitle}</div>
      <div class="tb-codes">NEC ${necVer} · ${state} · AHJ: ${ahj}</div>
    </div>
    <div class="tb-right">
      <table class="tb-table">
        <tr><td class="tbl">Designer</td><td class="tbv">${project.designer || '—'}</td></tr>
        <tr><td class="tbl">Date</td><td class="tbv">${project.date}</td></tr>
        <tr><td class="tbl">Sheet</td><td class="tbv">${pageNum} of ${totalPages}</td></tr>
        <tr><td class="tbl">Rev</td><td class="tbv">A</td></tr>
        <tr><td class="tbl">Scale</td><td class="tbv">NTS</td></tr>
      </table>
    </div>
  </div>`;
}

// ─── Construction Notes (NEC-specific, system-config-aware) ──────────────────

function buildConstructionNotes(input: PermitInput): string[] {
  const { project, compliance } = input;
  const necVer = compliance.jurisdiction?.necVersion || '2020';
  const notes: string[] = [
    `All work shall conform to NEC ${necVer}, applicable state amendments, and AHJ requirements. All equipment shall be listed and labeled per NEC 110.3.`,
    `Solar PV wiring shall comply with NEC Article 690. DC wiring methods shall be per NEC 690.31. AC wiring shall be per NEC Chapters 1–4.`,
    `System shall comply with NEC 705.12 for interconnected power production sources. Interconnection method: ${interconnectionLabel(project.interconnectionMethod)}.`,
    project.rapidShutdown
      ? `Rapid shutdown system required per NEC 690.12. Module-level rapid shutdown (MLRS) shall reduce module voltage to ≤ 30V within 30 seconds of rapid shutdown initiation.`
      : `Rapid shutdown initiator shall be installed per NEC 690.12. Conductors inside the array boundary shall be de-energized within 30 seconds.`,
    `All conductors shall be sized per NEC 310.15. Temperature correction and conduit fill derating factors shall be applied. Minimum conductor size: ${project.wireGauge || '#10 AWG'}.`,
    `Conduit type: ${project.conduitType || 'EMT'}. All conduit supports per NEC 358 (EMT) or NEC 352 (PVC). Conduit fill shall not exceed 40% per NEC Chapter 9, Table 1.`,
    `Equipment grounding conductor (EGC) shall be sized per NEC 250.122. All metallic racking shall be bonded per NEC 690.43.`,
    `${project.acDisconnect ? 'AC disconnect switch required' : 'AC disconnect — see SLD for requirements'}. Disconnect shall be within sight of inverter and accessible per NEC 690.15.`,
    `Warning labels and placards shall be installed per NEC 690.54, 690.56, 705.12, IFC ${necVer === '2023' ? '2024' : '2021'}, and local amendments. See sheet PV-5 for label schedule.`,
    `Roof attachments shall be installed per manufacturer instructions and attachment detail on sheet PV-3. Lag bolts shall have minimum 2.5" embedment into rafter per structural analysis.`,
    `Installer shall verify utility interconnection requirements with ${project.utilityName || 'utility'} prior to energization. Utility notification and interconnection agreement required before PTO.`,
    `All equipment shall be installed per manufacturer installation instructions. Field modifications to listed equipment are prohibited.`,
  ];
  if (project.batteryCount && project.batteryCount > 0) {
    notes.push(`Battery energy storage system (BESS) shall comply with NEC Article 706 and NFPA 855. Battery installation shall maintain required clearances per manufacturer instructions and AHJ requirements.`);
  }
  if (project.generatorKw && project.generatorKw > 0) {
    notes.push(`Generator interconnection shall comply with NEC Article 702 and NEC 705.12. Transfer switch (ATS) shall prevent parallel operation with utility unless system is utility-interactive rated.`);
  }
  return notes;
}

// ═══════════════════════════════════════════════════════════════════
// PAGE GENERATORS
// ═══════════════════════════════════════════════════════════════════

// ─── PV-0: Cover Sheet ───────────────────────────────────────────────────────

function pageCoverSheet(input: PermitInput, pageNum: number, totalPages: number): string {
  const { project, system, compliance } = input;
  const necVer = compliance.jurisdiction?.necVersion || '2020';
  const state = compliance.jurisdiction?.state || '—';
  const ahj = compliance.jurisdiction?.ahj || '—';
  const overallStatus = input.rulesResult?.overallStatus || compliance.overallStatus || 'PASS';
  const notes = buildConstructionNotes(input);

  // Sheet index
  const sheets = [
    { id: 'PV-0', title: 'Cover Sheet, System Summary & Construction Notes', sheet: '1' },
    { id: 'PV-1', title: 'Site Information & Interconnection Details', sheet: '2' },
    { id: 'PV-2', title: 'Schematic Roof Plan with Fire Setbacks', sheet: '3' },
    { id: 'PV-3', title: 'Attachment Detail & Bill of Materials', sheet: '4' },
    { id: 'PV-4A', title: 'NEC Compliance Sheet', sheet: '5' },
    { id: 'PV-4B', title: 'Conductor & Conduit Schedule', sheet: '6' },
    { id: 'PV-4C', title: 'Structural Calculation Sheet', sheet: '7' },
    { id: 'PV-5', title: 'Warning Labels & Required Placards', sheet: '8' },
    { id: 'SCHED', title: 'Equipment Schedule', sheet: '9' },
    { id: 'CERT', title: 'Engineer Certification Block', sheet: '10' },
    { id: 'E-1', title: 'Single-Line Electrical Diagram (SLD)', sheet: 'E-1' },
  ];

  return `
  <div class="page">
    ${titleBlock(input, 'PV-0', 'COVER SHEET & SYSTEM SUMMARY', pageNum, totalPages)}
    <div class="page-content">

      <!-- Status Badge + Title -->
      <div class="cover-header">
        <div class="cover-badge" style="background:${statusBg(overallStatus)};border:2px solid ${statusBorder(overallStatus)};color:${statusColor(overallStatus)}">
          ${statusLabel(overallStatus)}
        </div>
        <div class="cover-title">SOLAR PHOTOVOLTAIC SYSTEM — PERMIT PACKAGE</div>
        <div class="cover-sub">Prepared for AHJ Submission · ${state} · NEC ${necVer} · AHJ: ${ahj}</div>
      </div>

      <div class="two-col-layout">
        <div class="col-left">
          <!-- System Summary -->
          <div class="section-title">System Summary</div>
          <div class="summary-grid-6">
            <div class="summary-card"><div class="sum-val">${system.totalDcKw?.toFixed(2) || '—'} kW</div><div class="sum-lbl">DC Size</div></div>
            <div class="summary-card"><div class="sum-val">${system.totalAcKw?.toFixed(2) || '—'} kW</div><div class="sum-lbl">AC Capacity</div></div>
            <div class="summary-card"><div class="sum-val">${system.totalPanels || '—'}</div><div class="sum-lbl">Modules</div></div>
            <div class="summary-card"><div class="sum-val">${system.dcAcRatio?.toFixed(2) || '—'}</div><div class="sum-lbl">DC/AC Ratio</div></div>
            <div class="summary-card"><div class="sum-val">${project.mainPanelAmps}A</div><div class="sum-lbl">Service</div></div>
            <div class="summary-card"><div class="sum-val">${system.topology || 'MICRO'}</div><div class="sum-lbl">Topology</div></div>
          </div>

          <!-- Project Information -->
          <div class="section-title" style="margin-top:14px">Project Information</div>
          <table class="info-table">
            <tr><td class="il">Project Name</td><td class="iv">${project.projectName || '—'}</td><td class="il">Client Name</td><td class="iv">${project.clientName || '—'}</td></tr>
            <tr><td class="il">Address</td><td class="iv" colspan="3">${project.address || '—'}</td></tr>
            <tr><td class="il">Designer / EOR</td><td class="iv">${project.designer || '—'}</td><td class="il">Design Date</td><td class="iv">${project.date}</td></tr>
            <tr><td class="il">Jurisdiction</td><td class="iv">${state}</td><td class="il">AHJ</td><td class="iv">${ahj}</td></tr>
            <tr><td class="il">Utility</td><td class="iv">${project.utilityName || project.utilityMeter || '—'}</td><td class="il">System Type</td><td class="iv">${project.systemType?.toUpperCase() || 'ROOF-MOUNTED'}</td></tr>
          </table>

          <!-- Applicable Codes -->
          <div class="section-title" style="margin-top:14px">Applicable Codes & Standards</div>
          <table class="info-table">
            <tr><td class="il">Electrical</td><td class="iv">National Electrical Code (NEC) ${necVer} — Articles 690, 705, 706</td></tr>
            <tr><td class="il">Structural</td><td class="iv">ASCE 7-22 — Minimum Design Loads for Buildings and Other Structures</td></tr>
            <tr><td class="il">Building</td><td class="iv">International Building Code (IBC) / International Residential Code (IRC)</td></tr>
            <tr><td class="il">Fire</td><td class="iv">International Fire Code (IFC) ${necVer === '2023' ? '2024' : '2021'} — Chapter 6 §605</td></tr>
            <tr><td class="il">Battery</td><td class="iv">${project.batteryCount && project.batteryCount > 0 ? 'NFPA 855 — Installation of Stationary Energy Storage Systems' : 'N/A — No Battery Storage'}</td></tr>
            <tr><td class="il">State Amendments</td><td class="iv">${state} state electrical code amendments as adopted</td></tr>
          </table>

          <!-- Battery (if present) -->
          ${project.batteryCount && project.batteryCount > 0 ? `
          <div class="section-title" style="margin-top:14px">Energy Storage System</div>
          <table class="info-table">
            <tr><td class="il">Battery</td><td class="iv">${project.batteryBrand || '—'} ${project.batteryModel || '—'}</td><td class="il">Units</td><td class="iv">${project.batteryCount}</td></tr>
            <tr><td class="il">Total Storage</td><td class="iv">${((project.batteryCount || 0) * (project.batteryKwh || 0)).toFixed(1)} kWh</td><td class="il">Backfeed Breaker</td><td class="iv">${project.batteryBackfeedA || '—'}A</td></tr>
          </table>` : ''}
        </div>

        <div class="col-right">
          <!-- Sheet Index -->
          <div class="section-title">Sheet Index</div>
          <table class="sheet-index-table">
            <thead><tr><th>Sheet</th><th>Title</th></tr></thead>
            <tbody>
              ${sheets.map(s => `<tr><td class="si-id">${s.id}</td><td>${s.title}</td></tr>`).join('')}
            </tbody>
          </table>

          <!-- Construction Notes -->
          <div class="section-title" style="margin-top:14px">Construction Notes</div>
          <ol class="construction-notes">
            ${notes.map(n => `<li>${n}</li>`).join('')}
          </ol>
        </div>
      </div>

    </div>
  </div>`;
}

// ─── PV-1: Site Information ──────────────────────────────────────────────────

function pageSiteInformation(input: PermitInput, pageNum: number, totalPages: number): string {
  const { project, compliance } = input;
  const ahj = compliance.jurisdiction?.ahj || '—';
  const necVer = compliance.jurisdiction?.necVersion || '2020';

  return `
  <div class="page">
    ${titleBlock(input, 'PV-1', 'SITE INFORMATION & INTERCONNECTION DETAILS', pageNum, totalPages)}
    <div class="page-content">

      <div class="two-col-layout">
        <div class="col-left">
          <div class="section-title">Site & Project Information</div>
          <table class="info-table">
            <tr><td class="il">Installation Address</td><td class="iv" colspan="3">${project.address || '—'}</td></tr>
            <tr><td class="il">AHJ</td><td class="iv">${ahj}</td><td class="il">Utility</td><td class="iv">${project.utilityName || project.utilityMeter || '—'}</td></tr>
            <tr><td class="il">Utility Meter #</td><td class="iv">${project.utilityMeter || '—'}</td><td class="il">System Type</td><td class="iv">${project.systemType?.toUpperCase() || 'ROOF-MOUNTED'}</td></tr>
            <tr><td class="il">Roof Type</td><td class="iv">${roofTypeLabel(project.roofType)}</td><td class="il">Roof Pitch</td><td class="iv">${project.roofPitch ? `${project.roofPitch}° (${Math.round(Math.tan(project.roofPitch * Math.PI / 180) * 12)}/12)` : '—'}</td></tr>
            <tr><td class="il">Mounting System</td><td class="iv" colspan="3">${project.mountingSystem || '—'}</td></tr>
          </table>

          <div class="section-title" style="margin-top:14px">Service & Interconnection</div>
          <table class="info-table">
            <tr><td class="il">Existing Service</td><td class="iv">${project.mainPanelAmps}A, ${project.mainPanelBrand || '—'} Panel</td><td class="il">Bus Bar Rating</td><td class="iv">${project.panelBusRating || project.mainPanelAmps}A</td></tr>
            <tr><td class="il">Interconnection Method</td><td class="iv" colspan="3">${interconnectionLabel(project.interconnectionMethod)}</td></tr>
            <tr><td class="il">Backfeed Breaker</td><td class="iv">${project.batteryBackfeedA ? `${project.batteryBackfeedA}A (PV + Battery)` : '—'}</td><td class="il">120% Rule Check</td><td class="iv">${project.mainPanelAmps ? `${project.mainPanelAmps} × 120% = ${Math.round(project.mainPanelAmps * 1.2)}A max bus load` : '—'}</td></tr>
            <tr><td class="il">AC Disconnect</td><td class="iv">${project.acDisconnect ? '✓ Required — NEC 690.15' : '— Not Required'}</td><td class="il">DC Disconnect</td><td class="iv">${project.dcDisconnect ? '✓ Required — NEC 690.15' : '— Not Required'}</td></tr>
            <tr><td class="il">Rapid Shutdown</td><td class="iv">${project.rapidShutdown ? '✓ MLRS — NEC 690.12 Compliant' : '— Check AHJ requirement'}</td><td class="il">Production Meter</td><td class="iv">${project.productionMeter ? '✓ Installed' : '— Not Required'}</td></tr>
            <tr><td class="il">Conduit Type</td><td class="iv">${project.conduitType || '—'}</td><td class="il">AC Wire Gauge</td><td class="iv">${project.wireGauge || '—'}</td></tr>
          </table>

          <div class="section-title" style="margin-top:14px">Equipment Locations (Field Verify)</div>
          <table class="info-table">
            <tr><td class="il">Utility Meter</td><td class="iv">Per site survey — see aerial map</td></tr>
            <tr><td class="il">Main Service Panel</td><td class="iv">Per site survey — field locate</td></tr>
            <tr><td class="il">Inverter / Combiner</td><td class="iv">Garage or exterior wall — see roof plan</td></tr>
            <tr><td class="il">AC Disconnect</td><td class="iv">Adjacent to inverter, within sight</td></tr>
            ${project.batteryCount && project.batteryCount > 0 ? `<tr><td class="il">Battery Storage</td><td class="iv">Interior garage or approved exterior location per NFPA 855</td></tr>` : ''}
          </table>

          ${compliance.jurisdiction?.permitNotes ? `
          <div class="section-title" style="margin-top:14px">AHJ-Specific Requirements</div>
          <div class="notes-box">${compliance.jurisdiction.permitNotes}</div>` : ''}
        </div>

        <div class="col-right">
          <!-- Vicinity / Site Map Placeholder -->
          <div class="section-title">Vicinity Map (Field Complete)</div>
          <div class="map-placeholder">
            <div class="map-inner">
              <div class="map-icon">🗺</div>
              <div class="map-title">SITE LOCATION MAP</div>
              <div class="map-addr">${project.address || '—'}</div>
              <div class="map-note">AHJ: ${ahj}</div>
              <div class="map-note" style="margin-top:8px;font-size:9px;color:#94a3b8;">
                Attach aerial photograph or Google Maps screenshot<br>
                showing property location within jurisdiction.<br>
                North arrow and scale required.
              </div>
            </div>
          </div>

          <div class="section-title" style="margin-top:14px">Structural Parameters</div>
          <table class="info-table">
            <tr><td class="il">Rafter Size</td><td class="iv">${project.rafterSize || '—'}</td></tr>
            <tr><td class="il">Rafter Spacing</td><td class="iv">${project.rafterSpacing ? `${project.rafterSpacing}" O.C.` : '—'}</td></tr>
            <tr><td class="il">Attachment Spacing</td><td class="iv">${project.attachmentSpacing ? `${project.attachmentSpacing}" max` : '—'}</td></tr>
            <tr><td class="il">Lag Bolt Spec</td><td class="iv">5/16" × 3" SS — 2.5" min embedment in rafter</td></tr>
          </table>

          <div class="section-title" style="margin-top:14px">NEC Rapid Shutdown Boundary</div>
          <div class="rapid-shutdown-box">
            <div class="rs-title">⚡ RAPID SHUTDOWN BOUNDARY</div>
            <div class="rs-body">
              <strong>Inside Array Boundary (Roof):</strong> Module-level rapid shutdown devices (MLRSD) installed per NEC 690.12(B)(2). Array voltage reduced to ≤ 30V within 30 seconds.
              <br><br>
              <strong>Outside Array Boundary:</strong> Conductors de-energized within 30 seconds of rapid shutdown initiation per NEC 690.12(B)(1).
              <br><br>
              <strong>Initiator Location:</strong> At utility service entrance and at array location per NEC 690.56(C).
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>`;
}

// ─── PV-2: Schematic Roof Plan ───────────────────────────────────────────────

function pageRoofPlan(input: PermitInput, pageNum: number, totalPages: number): string {
  const { project, system } = input;
  const pitch = project.roofPitch || 18; // degrees
  const totalPanels = system.totalPanels || 0;

  // Generate schematic SVG roof plan
  // Simple schematic: rectangular roof outline with array footprint, setback lines, labels
  const svgW = 520;
  const svgH = 380;
  const roofX = 60, roofY = 40, roofW = 400, roofH = 280;
  const setback = 22; // pixels representing 18"
  const arrayX = roofX + setback;
  const arrayY = roofY + setback;
  const arrayW = roofW - setback * 2;
  const arrayH = roofH - setback * 2 - 30;

  // Module grid calculation
  const modulesPerRow = Math.ceil(Math.sqrt(totalPanels * 1.7));
  const rows = Math.ceil(totalPanels / modulesPerRow);
  const modW = Math.floor((arrayW - 10) / modulesPerRow) - 3;
  const modH = Math.floor((arrayH - 10) / rows) - 3;

  let modules = '';
  let count = 0;
  for (let r = 0; r < rows && count < totalPanels; r++) {
    for (let c = 0; c < modulesPerRow && count < totalPanels; c++) {
      const mx = arrayX + 5 + c * (modW + 3);
      const my = arrayY + 5 + r * (modH + 3);
      modules += `<rect x="${mx}" y="${my}" width="${modW}" height="${modH}" fill="#1e40af" stroke="#93c5fd" stroke-width="0.5" rx="1"/>`;
      count++;
    }
  }

  // Attachment points (simplified grid)
  let attachments = '';
  const attSpacing = project.attachmentSpacing || 48;
  const attPixels = attSpacing * (arrayW / 240); // scale
  for (let r = 0; r < rows; r++) {
    const ay = arrayY + 5 + r * (modH + 3) + modH / 2;
    for (let ax = arrayX + attPixels / 2; ax < arrayX + arrayW; ax += attPixels) {
      attachments += `<circle cx="${ax}" cy="${ay}" r="3" fill="none" stroke="#ef4444" stroke-width="1.2"/>`;
      attachments += `<line x1="${ax - 3}" y1="${ay}" x2="${ax + 3}" y2="${ay}" stroke="#ef4444" stroke-width="0.8"/>`;
      attachments += `<line x1="${ax}" y1="${ay - 3}" x2="${ax}" y2="${ay + 3}" stroke="#ef4444" stroke-width="0.8"/>`;
    }
  }

  const roofSVG = `
  <svg viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}" xmlns="http://www.w3.org/2000/svg" style="font-family:Arial,sans-serif;">
    <!-- Background -->
    <rect width="${svgW}" height="${svgH}" fill="#f8fafc"/>

    <!-- Roof outline -->
    <rect x="${roofX}" y="${roofY}" width="${roofW}" height="${roofH}" fill="none" stroke="#374151" stroke-width="2" stroke-dasharray="8,4"/>

    <!-- Ridge line (top) -->
    <line x1="${roofX}" y1="${roofY + 15}" x2="${roofX + roofW}" y2="${roofY + 15}" stroke="#6b7280" stroke-width="1.5"/>
    <text x="${roofX + roofW / 2}" y="${roofY + 11}" text-anchor="middle" font-size="8" fill="#6b7280" font-style="italic">RIDGE</text>

    <!-- Fire setback lines -->
    <rect x="${roofX + setback}" y="${roofY + setback}" width="${roofW - setback * 2}" height="${roofH - setback * 2 - 15}"
          fill="none" stroke="#f59e0b" stroke-width="1" stroke-dasharray="5,3"/>

    <!-- Array area fill -->
    <rect x="${arrayX}" y="${arrayY}" width="${arrayW}" height="${arrayH}" fill="#dbeafe" stroke="none" rx="2"/>

    <!-- Module grid -->
    ${modules}

    <!-- Attachment points -->
    ${attachments}

    <!-- Setback dimension arrows — left -->
    <line x1="${roofX + 2}" y1="${roofY + roofH / 2}" x2="${roofX + setback - 2}" y2="${roofY + roofH / 2}" stroke="#f59e0b" stroke-width="1" marker-end="url(#arrow)"/>
    <text x="${roofX + setback / 2}" y="${roofY + roofH / 2 - 4}" text-anchor="middle" font-size="7" fill="#d97706" font-weight="bold">18"</text>

    <!-- Setback dimension arrows — bottom -->
    <line x1="${roofX + roofW / 2}" y1="${roofY + roofH - 5}" x2="${roofX + roofW / 2}" y2="${arrayY + arrayH + 3}" stroke="#f59e0b" stroke-width="1"/>
    <text x="${roofX + roofW / 2 + 25}" y="${roofY + roofH - 10}" font-size="7" fill="#d97706" font-weight="bold">18" min</text>

    <!-- Pitch annotation -->
    <text x="${roofX + roofW - 5}" y="${roofY + 12}" text-anchor="end" font-size="8" fill="#374151" font-weight="bold">
      PITCH: ${Math.round(Math.tan(pitch * Math.PI / 180) * 12)}/12 (${pitch}°)
    </text>

    <!-- Panel count -->
    <text x="${arrayX + arrayW / 2}" y="${arrayY + arrayH + 14}" text-anchor="middle" font-size="8" fill="#1e40af" font-weight="bold">
      ${totalPanels} MODULES — ${system.totalDcKw?.toFixed(2) || '—'} kW DC
    </text>

    <!-- North arrow -->
    <g transform="translate(${roofX + roofW + 20},${roofY + 20})">
      <circle cx="0" cy="0" r="18" fill="none" stroke="#374151" stroke-width="1.5"/>
      <polygon points="0,-14 5,8 0,4 -5,8" fill="#374151"/>
      <text x="0" y="28" text-anchor="middle" font-size="10" fill="#374151" font-weight="bold">N</text>
    </g>

    <!-- Arrow marker def -->
    <defs>
      <marker id="arrow" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
        <path d="M0,0 L0,6 L6,3 z" fill="#f59e0b"/>
      </marker>
    </defs>

    <!-- Legend -->
    <g transform="translate(${roofX + roofW + 10},${roofY + 60})">
      <rect x="0" y="0" width="60" height="80" fill="white" stroke="#e2e8f0" stroke-width="1" rx="3"/>
      <text x="30" y="12" text-anchor="middle" font-size="7" font-weight="bold" fill="#374151">LEGEND</text>
      <rect x="5" y="18" width="10" height="7" fill="#1e40af" rx="1"/>
      <text x="19" y="25" font-size="6.5" fill="#374151">PV Module</text>
      <rect x="5" y="30" width="10" height="7" fill="none" stroke="#f59e0b" stroke-width="1" stroke-dasharray="3,2"/>
      <text x="19" y="37" font-size="6.5" fill="#374151">18" Setback</text>
      <circle cx="10" cy="48" r="3" fill="none" stroke="#ef4444" stroke-width="1"/>
      <line x1="7" y1="48" x2="13" y2="48" stroke="#ef4444" stroke-width="0.8"/>
      <line x1="10" y1="45" x2="10" y2="51" stroke="#ef4444" stroke-width="0.8"/>
      <text x="17" y="51" font-size="6.5" fill="#374151">Attachment</text>
      <line x1="5" y1="62" x2="15" y2="62" stroke="#6b7280" stroke-width="1.5"/>
      <text x="19" y="65" font-size="6.5" fill="#374151">Ridge Line</text>
    </g>

    <!-- Scale note -->
    <text x="${roofX}" y="${roofY + roofH + 20}" font-size="8" fill="#6b7280" font-style="italic">
      SCHEMATIC ONLY — NOT TO SCALE. Field verify all dimensions. Attachment spacing per structural analysis.
    </text>
  </svg>`;

  return `
  <div class="page">
    ${titleBlock(input, 'PV-2', 'SCHEMATIC ROOF PLAN WITH FIRE SETBACKS', pageNum, totalPages)}
    <div class="page-content">

      <div class="two-col-layout">
        <div class="col-left">
          <div class="section-title">Schematic Roof Plan</div>
          <div style="background:white; border:1px solid #e2e8f0; border-radius:6px; padding:12px; display:inline-block;">
            ${roofSVG}
          </div>
        </div>
        <div class="col-right">
          <div class="section-title">Fire Access & Setback Requirements</div>
          <table class="info-table">
            <tr><td class="il">Roof Edge Setback</td><td class="iv" style="color:#d97706;font-weight:bold;">18" minimum — IFC §605.11.1</td></tr>
            <tr><td class="il">Ridge Setback</td><td class="iv" style="color:#d97706;font-weight:bold;">18" minimum — IFC §605.11.1</td></tr>
            <tr><td class="il">Hip/Valley</td><td class="iv">18" clear pathway required</td></tr>
            <tr><td class="il">Roof Access</td><td class="iv">Min. 3' clear pathways per IFC §605.11.3</td></tr>
            <tr><td class="il">Ventilation Zones</td><td class="iv">Maintain per AHJ requirements</td></tr>
          </table>

          <div class="section-title" style="margin-top:14px">Array Configuration</div>
          <table class="info-table">
            <tr><td class="il">Total Modules</td><td class="iv">${totalPanels}</td></tr>
            <tr><td class="il">DC System Size</td><td class="iv">${system.totalDcKw?.toFixed(3) || '—'} kW</td></tr>
            <tr><td class="il">Module Orientation</td><td class="iv">${project.rafterSize ? 'Portrait' : '—'} — Field verify</td></tr>
            <tr><td class="il">Roof Pitch</td><td class="iv">${project.roofPitch ? `${Math.round(Math.tan(project.roofPitch * Math.PI / 180) * 12)}/12 (${project.roofPitch}°)` : '—'}</td></tr>
            <tr><td class="il">Racking System</td><td class="iv">${project.mountingSystem || '—'}</td></tr>
            <tr><td class="il">Attachment Spacing</td><td class="iv">${project.attachmentSpacing ? `${project.attachmentSpacing}" max O.C.` : '48" max O.C.'}</td></tr>
          </table>

          <div class="section-title" style="margin-top:14px">Roof Plan Notes</div>
          <ol class="construction-notes" style="font-size:9px;">
            <li>Schematic diagram only. Installer shall field verify all roof dimensions, structural member locations, and equipment placement prior to installation.</li>
            <li>Minimum 18" fire setback required from all roof edges, ridges, hips, and valleys per IFC §605.11.1. Setbacks shall be measured from the module edge to the roof feature.</li>
            <li>Attachment points (○) to be located over rafters only. Verify rafter locations using approved method prior to drilling.</li>
            <li>All lag bolt penetrations shall be sealed with manufacturer-approved sealant. Flashing required for penetrations through roofing membrane.</li>
            <li>Module layout shown is schematic. Field adjust to maintain setbacks, avoid obstructions (vents, chimneys, skylights), and align with rafters.</li>
            <li>Roof structural elements (ridge beam, hip rafter, valley rafter) shall not be used as attachment points without structural engineering approval.</li>
          </ol>
        </div>
      </div>

    </div>
  </div>`;
}

// ─── PV-3: Attachment Detail & BOM ──────────────────────────────────────────

function pageAttachmentBOM(input: PermitInput, pageNum: number, totalPages: number): string {
  const { project, system, bom } = input;
  const mountingId = project.mountingSystemId || '';
  const roofType = project.roofType || 'shingle';

  // Pick the right attachment detail based on racking system
  const isIronRidge = mountingId.includes('ironridge');
  const isRoofTech = mountingId.includes('rooftech');
  const isSnapNrack = mountingId.includes('snapnrack');
  const isSunModo = mountingId.includes('sunmodo');
  const isQuickMount = mountingId.includes('quickmount');

  // Build SVG cross-section detail
  // Standard L-foot + rail on asphalt shingle cross-section
  const detailSVG = `
  <svg viewBox="0 0 320 220" width="320" height="220" xmlns="http://www.w3.org/2000/svg" style="font-family:Arial,sans-serif;font-size:7px;">
    <!-- Background -->
    <rect width="320" height="220" fill="#fafafa"/>

    <!-- RAFTER (left side, diagonal implied, shown as rect) -->
    <rect x="30" y="90" width="260" height="28" fill="#d4a574" stroke="#92400e" stroke-width="1.2" rx="1"/>
    <text x="155" y="108" text-anchor="middle" font-size="7.5" fill="#92400e" font-weight="bold">RAFTER / TRUSS MEMBER</text>

    <!-- SHEATHING on top of rafter -->
    <rect x="30" y="72" width="260" height="18" fill="#e8d5b0" stroke="#a78b50" stroke-width="1"/>
    <text x="155" y="84" text-anchor="middle" font-size="7" fill="#78540a">3/4" OSB SHEATHING</text>

    <!-- ROOFING (shingles) on top of sheathing -->
    ${roofType === 'shingle' ? `
    <rect x="30" y="56" width="260" height="16" fill="#6b7280" stroke="#374151" stroke-width="1" rx="1"/>
    <text x="155" y="67" text-anchor="middle" font-size="7" fill="#f9fafb">ASPHALT SHINGLE ROOFING</text>` : roofType === 'tile' ? `
    <rect x="30" y="56" width="260" height="16" fill="#b45309" stroke="#78350f" stroke-width="1" rx="1"/>
    <text x="155" y="67" text-anchor="middle" font-size="7" fill="#fff">CONCRETE/CLAY TILE</text>` : `
    <rect x="30" y="56" width="260" height="16" fill="#6b7280" stroke="#374151" stroke-width="1" rx="1"/>
    <text x="155" y="67" text-anchor="middle" font-size="7" fill="#f9fafb">${roofTypeLabel(roofType)}</text>`}

    <!-- LAG BOLT -->
    <rect x="148" y="40" width="8" height="78" fill="#94a3b8" stroke="#475569" stroke-width="1" rx="1"/>
    <polygon points="148,40 156,40 155,32 149,32" fill="#64748b" stroke="#475569" stroke-width="0.8"/>
    <!-- Bolt head -->
    <rect x="145" y="28" width="14" height="8" fill="#475569" stroke="#334155" stroke-width="1" rx="1"/>
    <text x="175" y="35" font-size="7" fill="#334155">5/16" × 3" SS LAG BOLT</text>
    <line x1="161" y1="32" x2="175" y2="32" stroke="#334155" stroke-width="0.8"/>

    <!-- L-FOOT / STANDOFF -->
    <rect x="136" y="20" width="32" height="10" fill="#3b82f6" stroke="#1d4ed8" stroke-width="1.2" rx="1"/>
    <rect x="136" y="20" width="10" height="28" fill="#3b82f6" stroke="#1d4ed8" stroke-width="1.2" rx="1"/>
    <text x="178" y="27" font-size="7" fill="#1e40af" font-weight="bold">L-FOOT / STANDOFF</text>
    <line x1="170" y1="25" x2="178" y2="24" stroke="#1e40af" stroke-width="0.7"/>

    <!-- RAIL -->
    <rect x="60" y="8" width="200" height="14" fill="#60a5fa" stroke="#2563eb" stroke-width="1.2" rx="2"/>
    <text x="155" y="18" text-anchor="middle" font-size="7.5" fill="#1e3a8a" font-weight="bold">RACKING RAIL</text>

    <!-- MODULE (sitting on rail) -->
    <rect x="80" y="-4" width="160" height="14" fill="#1e40af" stroke="#1d4ed8" stroke-width="1.5" rx="2"/>
    <text x="155" y="6" text-anchor="middle" font-size="7.5" fill="white" font-weight="bold">PV MODULE</text>

    <!-- BUTYL PAD (if Unirac Stronghold) -->
    ${mountingId.includes('unirac') ? `
    <rect x="130" y="52" width="44" height="5" fill="#fbbf24" stroke="#d97706" stroke-width="1" rx="1"/>
    <text x="183" y="57" font-size="6.5" fill="#b45309" font-weight="bold">BUTYL PAD SEAL</text>
    <line x1="176" y1="55" x2="183" y2="55" stroke="#b45309" stroke-width="0.7"/>` : ''}

    <!-- EMBEDMENT DIMENSION -->
    <line x1="170" y1="90" x2="170" y2="118" stroke="#ef4444" stroke-width="1" stroke-dasharray="3,2"/>
    <line x1="165" y1="90" x2="175" y2="90" stroke="#ef4444" stroke-width="1"/>
    <line x1="165" y1="118" x2="175" y2="118" stroke="#ef4444" stroke-width="1"/>
    <text x="178" y="108" font-size="7" fill="#dc2626" font-weight="bold">MIN 2.5"</text>
    <text x="178" y="116" font-size="6.5" fill="#dc2626">EMBEDMENT</text>

    <!-- TORQUE NOTE -->
    <text x="10" y="155" font-size="7" fill="#374151" font-weight="bold">TORQUE: 15–20 ft-lbs</text>
    <text x="10" y="164" font-size="6.5" fill="#6b7280">Pre-drill pilot hole: 17/64" dia.</text>
    <text x="10" y="173" font-size="6.5" fill="#6b7280">Seal all penetrations with</text>
    <text x="10" y="182" font-size="6.5" fill="#6b7280">approved roofing sealant.</text>

    <text x="10" y="200" font-size="6" fill="#94a3b8" font-style="italic">CROSS-SECTION — NTS — FOR ILLUSTRATION PURPOSES</text>
  </svg>`;

  // Build BOM table
  const panelItem = system.inverters?.[0]?.strings?.[0];
  const bomRows: string[] = [];

  // Auto-build BOM from system data
  const panelMfr = panelItem?.panelManufacturer || '—';
  const panelModel = panelItem?.panelModel || '—';
  bomRows.push(`<tr><td>PV Module</td><td>${panelMfr}</td><td>${panelModel}</td><td>—</td><td style="text-align:right;font-weight:bold">${system.totalPanels}</td><td>EA</td><td>UL 61730</td></tr>`);

  // Add inverters
  system.inverters?.forEach((inv, i) => {
    const invType = inv.type === 'micro' ? 'Microinverter' : inv.type === 'optimizer' ? 'Optimizer' : 'String Inverter';
    const invCount = inv.type === 'micro' ? system.totalPanels : 1;
    bomRows.push(`<tr><td>${invType}</td><td>${inv.manufacturer || '—'}</td><td>${inv.model || '—'}</td><td>—</td><td style="text-align:right;font-weight:bold">${invCount}</td><td>EA</td><td>${inv.ulListing || 'UL 1741'}</td></tr>`);
  });

  // Battery
  if (project.batteryCount && project.batteryCount > 0) {
    bomRows.push(`<tr><td>Battery Storage</td><td>${project.batteryBrand || '—'}</td><td>${project.batteryModel || '—'}</td><td>—</td><td style="text-align:right;font-weight:bold">${project.batteryCount}</td><td>EA</td><td>UL 9540</td></tr>`);
  }

  // Add BOM items from engine
  if (bom && bom.length > 0) {
    bom.filter(i => !['panels', 'inverters'].includes(i.category)).forEach(item => {
      bomRows.push(`<tr><td style="text-transform:capitalize">${item.category.replace(/_/g, ' ')}</td><td>${item.manufacturer}</td><td>${item.model}</td><td style="font-family:monospace;font-size:9px">${item.partNumber || '—'}</td><td style="text-align:right;font-weight:bold">${item.quantity}</td><td>${item.unit}</td><td>${item.ulListing || '—'}</td></tr>`);
    });
  } else {
    // Default BOM items
    bomRows.push(`<tr><td>Racking System</td><td>${project.mountingSystem?.split(' ')[0] || 'Unirac'}</td><td>${project.mountingSystem || 'NXT Umount'}</td><td>—</td><td style="text-align:right">1</td><td>SYS</td><td>UL 2703</td></tr>`);
    bomRows.push(`<tr><td>Lag Bolt</td><td>Generic SS</td><td>5/16" × 3" Stainless Steel</td><td>—</td><td style="text-align:right">${Math.ceil(system.totalPanels * 1.5)}</td><td>EA</td><td>—</td></tr>`);
    bomRows.push(`<tr><td>AC Conduit</td><td>—</td><td>${project.conduitType || 'EMT'} w/ THWN-2 conductors</td><td>—</td><td style="text-align:right">${project.wireLength || 50}</td><td>FT</td><td>—</td></tr>`);
    bomRows.push(`<tr><td>AC Disconnect</td><td>—</td><td>${project.mainPanelAmps >= 200 ? '60A' : '30A'} Non-fusible AC Disconnect</td><td>—</td><td style="text-align:right">1</td><td>EA</td><td>UL 98</td></tr>`);
  }

  return `
  <div class="page">
    ${titleBlock(input, 'PV-3', 'ATTACHMENT DETAIL & BILL OF MATERIALS', pageNum, totalPages)}
    <div class="page-content">

      <div class="two-col-layout">
        <div class="col-left">
          <div class="section-title">Attachment Cross-Section Detail</div>
          <div style="background:white;border:1px solid #e2e8f0;border-radius:6px;padding:12px;display:inline-block;">
            ${detailSVG}
          </div>

          <div class="section-title" style="margin-top:14px">Attachment Specifications</div>
          <table class="info-table">
            <tr><td class="il">Lag Bolt</td><td class="iv" style="font-weight:bold">5/16" × 3" Stainless Steel</td></tr>
            <tr><td class="il">Min. Embedment</td><td class="iv" style="color:#dc2626;font-weight:bold">2.5" into rafter — required</td></tr>
            <tr><td class="il">Pilot Hole</td><td class="iv">17/64" diameter</td></tr>
            <tr><td class="il">Torque</td><td class="iv">15–20 ft-lbs</td></tr>
            <tr><td class="il">Penetration Seal</td><td class="iv">${mountingId.includes('unirac') ? 'Pre-applied butyl pad (Stronghold Butyl)' : 'Approved roofing sealant — field apply'}</td></tr>
            <tr><td class="il">Max Spacing</td><td class="iv">${project.attachmentSpacing ? `${project.attachmentSpacing}"` : '48"'} O.C. per structural analysis</td></tr>
            <tr><td class="il">Racking System</td><td class="iv">${project.mountingSystem || '—'}</td></tr>
            <tr><td class="il">Listing</td><td class="iv">UL 2703 — Mounting Systems for PV Modules</td></tr>
          </table>

          <div class="attach-note">
            <strong>IMPORTANT:</strong> All lag bolts shall be installed into structural rafters only. 
            Minimum 1.5" structural member thickness required. 
            Verify rafter location by probing or stud finder before drilling. 
            Install per manufacturer installation instructions — field modifications prohibited.
          </div>
        </div>

        <div class="col-right">
          <div class="section-title">Bill of Materials</div>
          <table class="bom-table">
            <thead>
              <tr><th>Category</th><th>Manufacturer</th><th>Model / Description</th><th>Part #</th><th>Qty</th><th>Unit</th><th>Listing</th></tr>
            </thead>
            <tbody>
              ${bomRows.join('')}
            </tbody>
          </table>

          <div class="bom-note">
            All equipment shall be UL-listed or ETL-certified. Substitutions require engineer approval and AHJ re-submittal.
            Quantities are approximate — contractor to verify field quantities.
          </div>
        </div>
      </div>

    </div>
  </div>`;
}

// ─── PV-5: Warning Labels & Placards ────────────────────────────────────────

function pageWarningLabels(input: PermitInput, pageNum: number, totalPages: number): string {
  const { project, system, compliance } = input;
  const necVer = compliance.jurisdiction?.necVersion || '2020';
  const hasBattery = (project.batteryCount || 0) > 0;
  const hasGenerator = (project.generatorKw || 0) > 0;

  // Calculate label values
  const panelIsc = system.inverters?.[0]?.strings?.[0]?.panelIsc || 0;
  const panelVoc = system.inverters?.[0]?.strings?.[0]?.panelVoc || 0;
  const topologyType = system.topology || 'MICRO';
  const isMicro = topologyType.toLowerCase().includes('micro');

  const maxCircuitCurrent = (panelIsc * 1.25).toFixed(1);
  const maxSystemVoltage = isMicro ? '240V AC' : `${(panelVoc * 1.25).toFixed(0)}V DC`;

  interface LabelSpec {
    id: string;
    necRef: string;
    placement: string;
    text: string;
    bg: string;
    fg: string;
    required: boolean;
  }

  const labels: LabelSpec[] = [
    {
      id: 'L-1',
      necRef: `NEC 690.54 / NEC ${necVer}`,
      placement: 'On combiner box and at DC disconnect',
      text: `WARNING\
SOLAR ELECTRIC SYSTEM CONNECTED\
MAXIMUM SYSTEM VOLTAGE: ${maxSystemVoltage}\
MAXIMUM CIRCUIT CURRENT: ${maxCircuitCurrent}A`,
      bg: '#dc2626',
      fg: '#ffffff',
      required: true,
    },
    {
      id: 'L-2',
      necRef: 'NEC 690.56(B)',
      placement: 'At rapid shutdown initiator (service entrance)',
      text: 'SOLAR RAPID SHUTDOWN\
STATUS:\
□ NORMAL OPERATION\
□ RAPID SHUTDOWN ACTIVATED',
      bg: '#dc2626',
      fg: '#ffffff',
      required: project.rapidShutdown,
    },
    {
      id: 'L-3',
      necRef: 'NEC 690.56(C)(1)',
      placement: 'At the array — each roof elevation with PV',
      text: 'WARNING\
PHOTOVOLTAIC POWER SOURCE\
DO NOT REMOVE OR COVER THIS LABEL\
INSTALLATION SHUTDOWN INFORMATION INSIDE',
      bg: '#dc2626',
      fg: '#ffffff',
      required: project.rapidShutdown,
    },
    {
      id: 'L-4',
      necRef: 'NEC 705.12 / 690.64',
      placement: 'On the main service panel — inside door',
      text: 'WARNING\
DUAL POWER SOURCES\
PHOTOVOLTAIC SYSTEM CONNECTED\
SHUT OFF PV DISCONNECT BEFORE SERVICING',
      bg: '#dc2626',
      fg: '#ffffff',
      required: true,
    },
    {
      id: 'L-5',
      necRef: 'IFC §605.11 / NEC 690.56(A)',
      placement: 'Adjacent to or on the utility meter',
      text: `SOLAR PV SYSTEM CONNECTED\
${project.address || '—'}\
System Size: ${system.totalDcKw?.toFixed(2) || '—'} kW DC\
Interconnection: ${interconnectionLabel(project.interconnectionMethod)}`,
      bg: '#1d4ed8',
      fg: '#ffffff',
      required: true,
    },
    {
      id: 'L-6',
      necRef: 'NEC 690.53',
      placement: 'On PV system DC disconnect (if string inverter)',
      text: `PHOTOVOLTAIC SYSTEM DISCONNECT\
MAXIMUM INPUT VOLTAGE: ${maxSystemVoltage}\
MAXIMUM CIRCUIT CURRENT: ${maxCircuitCurrent}A\
DO NOT TOUCH — LIVE CONDUCTORS`,
      bg: '#dc2626',
      fg: '#ffffff',
      required: !isMicro,
    },
    {
      id: 'L-7',
      necRef: 'NFPA 855 §4.3 / NEC 706',
      placement: 'On battery storage enclosure — exterior',
      text: 'WARNING\
ENERGY STORAGE SYSTEM\
LITHIUM-ION BATTERY\
FIRE AND EXPLOSION HAZARD\
DO NOT OPEN — CALL 911 IF DAMAGED',
      bg: '#f97316',
      fg: '#ffffff',
      required: hasBattery,
    },
    {
      id: 'L-8',
      necRef: 'NFPA 855 §4.3.3',
      placement: 'On battery storage enclosure — near electrical terminals',
      text: `BATTERY ENERGY STORAGE SYSTEM\
Manufacturer: ${project.batteryBrand || '—'}\
Model: ${project.batteryModel || '—'}\
Nominal Voltage: 48V DC\
Capacity: ${((project.batteryCount || 0) * (project.batteryKwh || 0)).toFixed(1)} kWh TOTAL`,
      bg: '#1d4ed8',
      fg: '#ffffff',
      required: hasBattery,
    },
    {
      id: 'L-9',
      necRef: 'NEC 702 / NEC 705.12',
      placement: 'On ATS/transfer switch enclosure',
      text: 'WARNING\
TRANSFER SWITCH\
BOTH UTILITY AND GENERATOR POWER PRESENT\
ISO LATE BEFORE SERVICING',
      bg: '#dc2626',
      fg: '#ffffff',
      required: hasGenerator,
    },
  ];

  const requiredLabels = labels.filter(l => l.required);

  return `
  <div class="page">
    ${titleBlock(input, 'PV-5', 'WARNING LABELS & REQUIRED PLACARDS', pageNum, totalPages)}
    <div class="page-content">

      <div class="label-intro">
        All warning labels shall be permanently installed, weather-resistant, and meet minimum character height requirements per NEC ${necVer}.
        Lettering shall be minimum 3/8" height for field-applied labels, or as specified by manufacturer for listed labels.
        Color: white lettering on red background (NEC 690.56) unless otherwise noted.
      </div>

      <div class="labels-grid">
        ${requiredLabels.map(lbl => `
        <div class="label-card">
          <div class="label-header">
            <span class="label-id">${lbl.id}</span>
            <span class="label-nec">${lbl.necRef}</span>
          </div>
          <div class="label-visual" style="background:${lbl.bg};color:${lbl.fg};">
            ${lbl.text.split('\
').map((line, i) => `<div class="${i === 0 ? 'label-warning-line' : 'label-body-line'}">${line}</div>`).join('')}
          </div>
          <div class="label-placement">📍 <strong>Location:</strong> ${lbl.placement}</div>
        </div>`).join('')}
      </div>

      <div class="section-title" style="margin-top:16px">Label Schedule</div>
      <table class="equip-table">
        <thead>
          <tr><th>Label</th><th>Code Reference</th><th>Required</th><th>Placement Location</th></tr>
        </thead>
        <tbody>
          ${labels.map(lbl => `
          <tr style="${lbl.required ? '' : 'opacity:0.5'}">
            <td style="font-weight:bold">${lbl.id}</td>
            <td style="font-family:monospace;font-size:9px">${lbl.necRef}</td>
            <td style="text-align:center;color:${lbl.required ? '#10b981' : '#94a3b8'};font-weight:bold">${lbl.required ? '✓ YES' : '— N/A'}</td>
            <td style="font-size:10px">${lbl.placement}</td>
          </tr>`).join('')}
        </tbody>
      </table>

    </div>
  </div>`;
}

// ─── (Existing pages reused with minor upgrades) ─────────────────────────────

function pageNECCompliance(input: PermitInput, pageNum: number, totalPages: number): string {
  const { compliance, rulesResult, overrides } = input;
  const necVer = compliance.jurisdiction?.necVersion || '2020';
  return `
  <div class="page">
    ${titleBlock(input, 'PV-4A', 'NEC COMPLIANCE SHEET', pageNum, totalPages)}
    <div class="page-content">
      <div class="section-title">Electrical Compliance — NEC ${necVer}</div>
      ${rulesResult ? `
      <div class="rules-summary">
        <div class="rs" style="color:${rulesResult.errorCount > 0 ? '#ef4444' : '#10b981'}">
          <div class="rs-val">${rulesResult.errorCount}</div><div class="rs-lbl">Errors</div>
        </div>
        <div class="rs" style="color:${rulesResult.warningCount > 0 ? '#f59e0b' : '#10b981'}">
          <div class="rs-val">${rulesResult.warningCount}</div><div class="rs-lbl">Warnings</div>
        </div>
        <div class="rs" style="color:#10b981">
          <div class="rs-val">${rulesResult.autoFixCount}</div><div class="rs-lbl">Auto-Fixed</div>
        </div>
        <div class="rs" style="color:#3b82f6">
          <div class="rs-val">${rulesResult.overrideCount}</div><div class="rs-lbl">Overrides</div>
        </div>
      </div>
      <table class="equip-table">
        <thead><tr><th style="width:18%">Code Reference</th><th style="width:25%">Description</th><th style="width:30%">Result</th><th style="width:15%">Value / Limit</th><th style="width:12%">Status</th></tr></thead>
        <tbody>
          ${(rulesResult.rules || []).map(rule => `
          <tr style="background:${statusBg(rule.severity)}">
            <td style="font-family:monospace;font-size:9px">${rule.necReference || rule.asceReference || rule.ruleId}</td>
            <td>${rule.title}${rule.autoFixed ? ' <span style="background:#d1fae5;color:#065f46;padding:1px 5px;border-radius:3px;font-size:8px;font-weight:700">Auto-Fixed</span>' : ''}</td>
            <td style="font-size:9px;color:#475569">${rule.message}</td>
            <td style="font-family:monospace;font-size:9px;text-align:right">${rule.value !== undefined ? `${rule.value}${rule.limit !== undefined ? ` / ${rule.limit}` : ''}` : '—'}</td>
            <td style="text-align:center;font-weight:bold;color:${statusColor(rule.severity)}">${statusLabel(rule.severity)}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : `
      ${compliance.electrical ? `
      <table class="info-table">
        <tr><td class="il">DC Size</td><td class="iv">${compliance.electrical.summary?.totalDcKw?.toFixed(2)} kW</td><td class="il">AC Capacity</td><td class="iv">${compliance.electrical.summary?.totalAcKw?.toFixed(2)} kW</td></tr>
        <tr><td class="il">Grounding Conductor</td><td class="iv">${compliance.electrical.groundingConductor}</td><td class="il">Busbar Rule</td><td class="iv" style="color:${compliance.electrical.busbar?.passes ? '#10b981' : '#ef4444'}">${compliance.electrical.busbar?.passes ? '✓ PASS' : '✗ FAIL'}</td></tr>
      </table>` : '<p style="color:#94a3b8;font-style:italic;padding:20px;text-align:center">Run compliance check to populate this section.</p>'}
      `}
      ${overrides && overrides.length > 0 ? `
      <div class="section-title" style="margin-top:16px">Engineering Overrides Log</div>
      <table class="equip-table">
        <thead><tr><th>Field</th><th>Override Value</th><th>Justification</th><th>Engineer</th><th>Date</th></tr></thead>
        <tbody>
          ${overrides.map(o => `
          <tr style="background:#eff6ff">
            <td style="font-family:monospace;font-size:9px">${o.field}</td>
            <td style="color:#3b82f6;font-weight:bold">${o.overrideValue}</td>
            <td>${o.justification}</td>
            <td>${o.engineer}</td>
            <td>${new Date(o.timestamp).toLocaleDateString()}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : ''}
    </div>
  </div>`;
}

function pageConductorSchedule(input: PermitInput, pageNum: number, totalPages: number): string {
  const { project, system, compliance } = input;
  const elec = compliance.electrical;
  return `
  <div class="page">
    ${titleBlock(input, 'PV-4B', 'CONDUCTOR & CONDUIT SCHEDULE', pageNum, totalPages)}
    <div class="page-content">
      <div class="section-title">Conductor Schedule — NEC 310.15 Ampacity Compliance</div>
      <table class="equip-table">
        <thead>
          <tr><th>Circuit</th><th>From</th><th>To</th><th>Conductor</th><th>Ampacity</th><th>OCPD</th><th>V-Drop %</th><th>Conduit</th><th>Length</th></tr>
        </thead>
        <tbody>
          ${system.inverters?.flatMap((inv, invIdx) =>
            inv.strings?.map((str, strIdx) => `
            <tr>
              <td style="font-weight:bold">DC ${invIdx + 1}-${strIdx + 1}</td>
              <td>String ${invIdx + 1}-${strIdx + 1}</td>
              <td>Inverter ${invIdx + 1}</td>
              <td>${str.wireGauge} USE-2/PV Wire</td>
              <td>—</td><td>—</td><td>—</td>
              <td>${project.conduitType}</td>
              <td>${str.wireLength} ft</td>
            </tr>`) || []
          ).join('')}
          ${elec ? `
          <tr style="background:#f0f9ff">
            <td style="font-weight:bold">AC Output</td>
            <td>Inverter(s)</td><td>Main Panel</td>
            <td>${elec.acConductorCallout || project.wireGauge} THWN-2</td>
            <td>${elec.acWireAmpacity || '—'}A</td>
            <td>${elec.busbar?.backfeedBreakerRequired || '—'}A</td>
            <td style="color:${(elec.acVoltageDrop || 0) > 3 ? '#f59e0b' : '#10b981'}">${elec.acVoltageDrop?.toFixed(2) || '—'}%</td>
            <td>${project.conduitType}</td>
            <td>${project.wireLength} ft</td>
          </tr>
          <tr style="background:#f0fdf4">
            <td style="font-weight:bold">EGC</td>
            <td>Array</td><td>Main Panel</td>
            <td>${elec.groundingConductor || '#12 AWG'} bare Cu</td>
            <td>—</td><td>—</td><td>—</td>
            <td>${project.conduitType}</td>
            <td>${project.wireLength} ft</td>
          </tr>` : ''}
        </tbody>
      </table>
      ${elec?.conduitFill ? `
      <div class="section-title" style="margin-top:16px">Conduit Fill Analysis — NEC Chapter 9</div>
      <table class="info-table">
        <tr><td class="il">Conduit Type</td><td class="iv">${elec.conduitFill.conduitType}</td><td class="il">Conduit Size</td><td class="iv">${elec.conduitFill.conduitSize}</td></tr>
        <tr><td class="il">Fill Percentage</td><td class="iv" style="color:${elec.conduitFill.fillPercent > 40 ? '#ef4444' : '#10b981'};font-weight:bold">${elec.conduitFill.fillPercent?.toFixed(1)}% (Max: 40%)</td>
        <td class="il">Status</td><td class="iv" style="color:${elec.conduitFill.passes ? '#10b981' : '#ef4444'};font-weight:bold">${elec.conduitFill.passes ? '✓ PASS' : '✗ FAIL'}</td></tr>
      </table>` : ''}
      <div class="section-title" style="margin-top:16px">NEC Code References</div>
      <table class="equip-table">
        <thead><tr><th>Code Section</th><th>Title</th><th>Application</th></tr></thead>
        <tbody>
          <tr><td style="font-family:monospace;font-size:9px">NEC 690.8(B)</td><td>Circuit Sizing</td><td>Isc × 1.25 for OCPD sizing; conductor ampacity ≥ 1.25 × Isc</td></tr>
          <tr><td style="font-family:monospace;font-size:9px">NEC 690.7(A)</td><td>Maximum Voltage</td><td>String Voc corrected for minimum design temperature</td></tr>
          <tr><td style="font-family:monospace;font-size:9px">NEC 705.12(B)(2)</td><td>120% Busbar Rule</td><td>Backfeed breaker ≤ 20% of main panel busbar rating</td></tr>
          <tr><td style="font-family:monospace;font-size:9px">NEC 690.12</td><td>Rapid Shutdown</td><td>Module-level shutdown within 30 seconds</td></tr>
          <tr><td style="font-family:monospace;font-size:9px">NEC 310.15</td><td>Conductor Ampacity</td><td>Temperature and conduit fill derating</td></tr>
          <tr><td style="font-family:monospace;font-size:9px">NEC Ch. 9, Table 1</td><td>Conduit Fill</td><td>Maximum 40% fill for 3+ conductors</td></tr>
          <tr><td style="font-family:monospace;font-size:9px">ASCE 7-22 §26</td><td>Wind Loads</td><td>Components and cladding on roof-mounted arrays</td></tr>
          <tr><td style="font-family:monospace;font-size:9px">ASCE 7-22 §7</td><td>Snow Loads</td><td>Roof snow load with slope reduction factor</td></tr>
        </tbody>
      </table>
    </div>
  </div>`;
}

function pageStructural(input: PermitInput, pageNum: number, totalPages: number): string {
  const { compliance, rulesResult } = input;
  const structural = compliance.structural;
  const structuralRules = rulesResult?.rules?.filter(r => r.category === 'structural') || [];
  return `
  <div class="page">
    ${titleBlock(input, 'PV-4C', 'STRUCTURAL CALCULATION SHEET', pageNum, totalPages)}
    <div class="page-content">
      <div class="section-title">Structural Analysis — ASCE 7-22</div>
      ${structural ? `
      <div class="struct-grid">
        <div class="struct-card">
          <div class="sct">💨 Wind Analysis</div>
          <table class="calc-table">
            <tr><td>Design Wind Speed</td><td class="cv">${structural.wind?.windSpeed || '—'} mph</td></tr>
            <tr><td>Exposure Category</td><td class="cv">${structural.wind?.exposureCategory || '—'}</td></tr>
            <tr><td>Velocity Pressure (qz)</td><td class="cv">${structural.wind?.velocityPressure?.toFixed(2) || '—'} psf</td></tr>
            <tr><td>Net Uplift Pressure</td><td class="cv">${structural.wind?.netUpliftPressure?.toFixed(2) || '—'} psf</td></tr>
            <tr><td>Uplift per Attachment</td><td class="cv" style="font-weight:bold">${structural.wind?.upliftPerAttachment?.toFixed(0) || '—'} lbs</td></tr>
          </table>
        </div>
        <div class="struct-card">
          <div class="sct">❄ Snow Analysis</div>
          <table class="calc-table">
            <tr><td>Ground Snow Load (pg)</td><td class="cv">${structural.snow?.groundSnowLoad || '—'} psf</td></tr>
            <tr><td>Roof Snow Load (ps)</td><td class="cv">${structural.snow?.roofSnowLoad?.toFixed(1) || '—'} psf</td></tr>
            <tr><td>Snow per Attachment</td><td class="cv" style="font-weight:bold">${structural.snow?.snowLoadPerAttachment?.toFixed(0) || '—'} lbs</td></tr>
          </table>
        </div>
        <div class="struct-card">
          <div class="sct">📐 Rafter Analysis</div>
          <table class="calc-table">
            <tr><td>Bending Moment</td><td class="cv">${structural.rafter?.bendingMoment?.toFixed(0) || '—'} ft-lbs</td></tr>
            <tr><td>Allowable Moment</td><td class="cv">${structural.rafter?.allowableBendingMoment?.toFixed(0) || '—'} ft-lbs</td></tr>
            <tr><td>Utilization Ratio</td><td class="cv" style="font-weight:bold;color:${(structural.rafter?.utilizationRatio || 0) > 1 ? '#ef4444' : '#10b981'}">${((structural.rafter?.utilizationRatio || 0) * 100).toFixed(0)}%</td></tr>
            <tr><td>Deflection / Allowed</td><td class="cv">${structural.rafter?.deflection?.toFixed(3) || '—'}" / ${structural.rafter?.allowableDeflection?.toFixed(3) || '—'}"</td></tr>
          </table>
        </div>
        <div class="struct-card">
          <div class="sct">🔩 Attachment Analysis</div>
          <table class="calc-table">
            <tr><td>Lag Bolt Capacity</td><td class="cv">${structural.attachment?.lagBoltCapacity?.toFixed(0) || '—'} lbs</td></tr>
            <tr><td>Total Uplift/Attachment</td><td class="cv">${structural.attachment?.totalUpliftPerAttachment?.toFixed(0) || '—'} lbs</td></tr>
            <tr><td>Safety Factor</td><td class="cv" style="font-weight:bold;color:${(structural.attachment?.safetyFactor || 0) < 2 ? '#ef4444' : '#10b981'}">${structural.attachment?.safetyFactor?.toFixed(2) || '—'}</td></tr>
            <tr><td>Max Allowed Spacing</td><td class="cv">${structural.attachment?.maxAllowedSpacing || '—'}"</td></tr>
          </table>
        </div>
      </div>` : '<p style="color:#94a3b8;font-style:italic;padding:20px;text-align:center">Run compliance check to populate structural calculations.</p>'}
      ${structuralRules.length > 0 ? `
      <div class="section-title" style="margin-top:16px">Structural Rules Check</div>
      <table class="equip-table">
        <thead><tr><th>Reference</th><th>Description</th><th>Result</th><th>Value / Limit</th><th>Status</th></tr></thead>
        <tbody>
          ${structuralRules.map(rule => `
          <tr style="background:${statusBg(rule.severity)}">
            <td style="font-family:monospace;font-size:9px">${rule.asceReference || rule.ruleId}</td>
            <td>${rule.title}</td>
            <td style="font-size:9px;color:#475569">${rule.message}</td>
            <td style="font-family:monospace;font-size:9px;text-align:right">${rule.value !== undefined ? `${rule.value}${rule.limit !== undefined ? ` / ${rule.limit}` : ''}` : '—'}</td>
            <td style="text-align:center;font-weight:bold;color:${statusColor(rule.severity)}">${statusLabel(rule.severity)}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : ''}
      ${rulesResult?.structuralAutoResolutions && rulesResult.structuralAutoResolutions.length > 0 ? `
      <div class="section-title" style="margin-top:16px">Auto-Resolutions Applied</div>
      <table class="equip-table">
        <thead><tr><th>Field</th><th>Original</th><th>Resolved</th><th>Reason</th><th>Reference</th></tr></thead>
        <tbody>
          ${rulesResult.structuralAutoResolutions.map(r => `
          <tr style="background:#f0fdf4">
            <td style="font-family:monospace;font-size:9px">${r.field}</td>
            <td>${r.originalValue}</td>
            <td style="color:#10b981;font-weight:bold">${r.resolvedValue}</td>
            <td>${r.reason}</td>
            <td style="font-family:monospace;font-size:9px">${r.necReference}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : ''}
    </div>
  </div>`;
}

function pageEquipmentSchedule(input: PermitInput, pageNum: number, totalPages: number): string {
  const { system, bom, project } = input;
  return `
  <div class="page">
    ${titleBlock(input, 'SCHED', 'EQUIPMENT SCHEDULE', pageNum, totalPages)}
    <div class="page-content">
      <div class="section-title">Solar Modules</div>
      <table class="equip-table">
        <thead><tr><th>String</th><th>Manufacturer</th><th>Model</th><th>Qty</th><th>Watts</th><th>Voc (V)</th><th>Isc (A)</th><th>Total kW</th><th>Wire</th><th>Run (ft)</th></tr></thead>
        <tbody>
          ${system.inverters?.flatMap((inv, invIdx) =>
            inv.strings?.map((str, strIdx) => `
            <tr>
              <td style="font-weight:bold">${invIdx + 1}-${strIdx + 1}</td>
              <td>${str.panelManufacturer || '—'}</td><td>${str.panelModel || '—'}</td>
              <td style="text-align:right;font-weight:bold">${str.panelCount}</td>
              <td style="text-align:right">${str.panelWatts}W</td>
              <td style="text-align:right">${str.panelVoc}V</td>
              <td style="text-align:right">${str.panelIsc}A</td>
              <td style="text-align:right;font-weight:bold">${(str.panelCount * str.panelWatts / 1000).toFixed(2)}</td>
              <td>${str.wireGauge}</td>
              <td style="text-align:right">${str.wireLength}</td>
            </tr>`) || []
          ).join('')}
          <tr style="background:#fef3c7;font-weight:bold">
            <td colspan="3">TOTAL</td><td style="text-align:right">${system.totalPanels}</td>
            <td colspan="3"></td><td style="text-align:right">${system.totalDcKw?.toFixed(2)}</td>
            <td colspan="2"></td>
          </tr>
        </tbody>
      </table>
      <div class="section-title" style="margin-top:16px">Inverters</div>
      <table class="equip-table">
        <thead><tr><th>#</th><th>Type</th><th>Manufacturer</th><th>Model</th><th>AC kW</th><th>Max DC V</th><th>Efficiency</th><th>UL Listing</th></tr></thead>
        <tbody>
          ${system.inverters?.map((inv, idx) => `
          <tr>
            <td style="font-weight:bold">${idx + 1}</td>
            <td>${inv.type === 'micro' ? 'Microinverter' : inv.type === 'optimizer' ? 'String + Optimizer' : 'String'}</td>
            <td>${inv.manufacturer || '—'}</td><td>${inv.model || '—'}</td>
            <td style="text-align:right">${inv.acOutputKw}</td>
            <td style="text-align:right">${inv.maxDcVoltage}V</td>
            <td style="text-align:right">${inv.efficiency}%</td>
            <td>${inv.ulListing || 'UL 1741'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${bom && bom.length > 0 ? `
      <div class="section-title" style="margin-top:16px">Balance of System</div>
      <table class="equip-table">
        <thead><tr><th>Category</th><th>Manufacturer</th><th>Model</th><th>Part #</th><th>Qty</th><th>Unit</th><th>UL Listing</th></tr></thead>
        <tbody>
          ${bom.filter(i => !['panels','inverters'].includes(i.category)).map(item => `
          <tr>
            <td style="text-transform:capitalize;color:#64748b">${item.category.replace(/_/g, ' ')}</td>
            <td>${item.manufacturer}</td><td>${item.model}</td>
            <td style="font-family:monospace;font-size:9px">${item.partNumber || '—'}</td>
            <td style="text-align:right;font-weight:bold">${item.quantity}</td>
            <td>${item.unit}</td>
            <td>${item.ulListing || '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : ''}
    </div>
  </div>`;
}

function pageEngineerCert(input: PermitInput, pageNum: number, totalPages: number): string {
  const { project, compliance } = input;
  const necVer = compliance.jurisdiction?.necVersion || '2020';
  const state = compliance.jurisdiction?.state || '—';
  const ahj = compliance.jurisdiction?.ahj || '—';
  return `
  <div class="page">
    ${titleBlock(input, 'CERT', 'ENGINEER CERTIFICATION', pageNum, totalPages)}
    <div class="page-content">
      <div class="cert-header">ENGINEER OF RECORD CERTIFICATION</div>
      <div class="cert-statement">
        I hereby certify that this solar photovoltaic system design has been prepared under my direct supervision
        and complies with the following applicable codes and standards:
        <ul style="margin-top:10px;line-height:2">
          <li>National Electrical Code (NEC) ${necVer}, Article 690 — Solar Photovoltaic Systems</li>
          <li>National Electrical Code (NEC) ${necVer}, Article 705 — Interconnected Electric Power Production Sources</li>
          ${(project.batteryCount || 0) > 0 ? `<li>National Electrical Code (NEC) ${necVer}, Article 706 — Energy Storage Systems; NFPA 855</li>` : ''}
          <li>ASCE 7-22 — Minimum Design Loads and Associated Criteria for Buildings and Other Structures</li>
          <li>International Building Code (IBC) / International Residential Code (IRC) — Structural requirements</li>
          <li>International Fire Code (IFC) ${necVer === '2023' ? '2024' : '2021'} — Chapter 6 §605 Solar Photovoltaic Systems</li>
          <li>All applicable local amendments adopted by ${state} and the Authority Having Jurisdiction (${ahj})</li>
        </ul>
      </div>
      <div class="cert-grid">
        <div>
          <div class="cert-block-title">PREPARED BY</div>
          <div class="cert-field"><div class="cf-val">${project.designer || '________________________________'}</div><div class="cf-lbl">Designer / Engineer of Record</div></div>
          <div class="cert-field"><div class="cf-val">________________________________</div><div class="cf-lbl">License Number</div></div>
          <div class="cert-field"><div class="cf-val">________________________________</div><div class="cf-lbl">State of Licensure</div></div>
          <div class="cert-field"><div class="cf-val">${project.date}</div><div class="cf-lbl">Date of Certification</div></div>
          <div class="cert-field" style="margin-top:20px"><div class="cf-val" style="border-bottom:2px solid #1e293b;padding-bottom:30px">________________________________</div><div class="cf-lbl">Signature</div></div>
        </div>
        <div>
          <div class="cert-block-title">WET STAMP AREA</div>
          <div class="stamp-box">
            <div style="text-align:center">
              <div style="font-size:28px;opacity:0.2">⬡</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:8px">Engineer Wet Stamp</div>
              <div style="font-size:10px;color:#cbd5e1;margin-top:4px">Required for AHJ Submission</div>
            </div>
          </div>
          <div class="cert-block-title" style="margin-top:20px">REVISION HISTORY</div>
          <table class="equip-table" style="margin-top:8px">
            <thead><tr><th>Rev</th><th>Date</th><th>Description</th><th>By</th></tr></thead>
            <tbody>
              <tr><td style="font-weight:bold">A</td><td>${project.date}</td><td>Initial Issue for Permit</td><td>${project.designer || '—'}</td></tr>
              <tr><td style="color:#94a3b8">B</td><td style="color:#94a3b8">—</td><td style="color:#94a3b8">—</td><td style="color:#94a3b8">—</td></tr>
              <tr><td style="color:#94a3b8">C</td><td style="color:#94a3b8">—</td><td style="color:#94a3b8">—</td><td style="color:#94a3b8">—</td></tr>
            </tbody>
          </table>
          <div class="section-title" style="margin-top:16px">SLD Reference</div>
          <table class="info-table">
            <tr><td class="il">Sheet E-1</td><td class="iv">Single-Line Electrical Diagram — generated separately via Engineering → Diagram tab → Download SLD PDF</td></tr>
          </table>
        </div>
      </div>
      <div class="cert-footer">
        SolarPro Engineering Platform · Generated ${new Date().toLocaleDateString()} ·
        This document requires engineer review and wet stamp before AHJ submission.
        All equipment must be UL-listed and installed per manufacturer specifications and NEC ${necVer}.
      </div>
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════════
// FULL HTML DOCUMENT ASSEMBLY
// ═══════════════════════════════════════════════════════════════════

function generatePermitHTML(input: PermitInput): string {
  const { project } = input;
  const TOTAL = 10;

  const pages = [
    pageCoverSheet(input, 1, TOTAL),
    pageSiteInformation(input, 2, TOTAL),
    pageRoofPlan(input, 3, TOTAL),
    pageAttachmentBOM(input, 4, TOTAL),
    pageNECCompliance(input, 5, TOTAL),
    pageConductorSchedule(input, 6, TOTAL),
    pageStructural(input, 7, TOTAL),
    pageWarningLabels(input, 8, TOTAL),
    pageEquipmentSchedule(input, 9, TOTAL),
    pageEngineerCert(input, 10, TOTAL),
  ];

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Permit Package — ${project.projectName}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Arial',sans-serif; font-size:10px; color:#1e293b; background:white; }

  /* Page */
  .page { width:17in; min-height:22in; padding:0.45in; page-break-after:always; display:flex; flex-direction:column; }
  .page:last-child { page-break-after:avoid; }
  .page-content { flex:1; margin-top:10px; }

  /* Title block */
  .title-block { display:flex; align-items:stretch; border:2px solid #1e293b; margin-bottom:14px; background:#f8fafc; min-height:62px; }
  .tb-left { flex:2.5; padding:8px 12px; border-right:1px solid #cbd5e1; }
  .tb-center { flex:3.5; padding:8px 12px; border-right:1px solid #cbd5e1; display:flex; flex-direction:column; justify-content:center; }
  .tb-right { flex:1.8; padding:5px 8px; }
  .tb-company { font-size:13px; font-weight:900; color:#f59e0b; letter-spacing:0.5px; }
  .tb-project { font-size:12px; font-weight:700; color:#1e293b; margin-top:3px; }
  .tb-address { font-size:9px; color:#64748b; margin-top:1px; }
  .tb-client { font-size:9px; color:#64748b; margin-top:1px; }
  .tb-sheet-id { font-size:11px; font-weight:900; color:#f59e0b; text-align:center; }
  .tb-sheet-title { font-size:15px; font-weight:900; color:#1e293b; text-align:center; margin-top:2px; }
  .tb-codes { font-size:9px; color:#64748b; text-align:center; margin-top:3px; }
  .tb-table { width:100%; border-collapse:collapse; font-size:9px; }
  .tb-table tr { border-bottom:1px solid #e2e8f0; }
  .tbl { color:#64748b; padding:2px 5px; white-space:nowrap; }
  .tbv { font-weight:600; color:#1e293b; padding:2px 5px; }

  /* Layout */
  .two-col-layout { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  .col-left { }
  .col-right { }

  /* Section title */
  .section-title { font-size:11px; font-weight:800; color:#1e293b; text-transform:uppercase; letter-spacing:0.5px; border-bottom:2px solid #f59e0b; padding-bottom:3px; margin-bottom:10px; }

  /* Info table */
  .info-table { width:100%; border-collapse:collapse; margin-bottom:8px; font-size:10px; }
  .info-table tr { border-bottom:1px solid #e2e8f0; }
  .il { background:#f8fafc; color:#64748b; font-weight:600; padding:5px 8px; width:22%; white-space:nowrap; border:1px solid #e2e8f0; font-size:9px; }
  .iv { color:#1e293b; padding:5px 8px; border:1px solid #e2e8f0; font-size:10px; }

  /* Cover */
  .cover-header { text-align:center; padding:14px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; margin-bottom:14px; }
  .cover-badge { display:inline-block; padding:5px 18px; border-radius:20px; font-weight:900; font-size:12px; margin-bottom:8px; }
  .cover-title { font-size:18px; font-weight:900; color:#1e293b; }
  .cover-sub { font-size:10px; color:#64748b; margin-top:4px; }
  .summary-grid-6 { display:grid; grid-template-columns:repeat(6,1fr); gap:8px; margin-bottom:10px; }
  .summary-card { background:#fef3c7; border:1px solid #fde68a; border-radius:5px; padding:8px; text-align:center; }
  .sum-val { font-size:14px; font-weight:900; color:#92400e; }
  .sum-lbl { font-size:8px; color:#78350f; margin-top:2px; }

  /* Sheet index */
  .sheet-index-table { width:100%; border-collapse:collapse; font-size:10px; margin-bottom:8px; }
  .sheet-index-table th { background:#1e293b; color:white; padding:5px 8px; text-align:left; font-weight:700; font-size:9px; }
  .sheet-index-table td { padding:4px 8px; border-bottom:1px solid #e2e8f0; }
  .si-id { font-weight:700; font-family:monospace; color:#f59e0b; width:60px; }

  /* Construction notes */
  .construction-notes { padding-left:16px; font-size:9px; line-height:1.6; color:#374151; }
  .construction-notes li { margin-bottom:4px; }

  /* Equipment table */
  .equip-table { width:100%; border-collapse:collapse; font-size:10px; margin-bottom:8px; }
  .equip-table th { background:#334155; color:white; padding:5px 8px; text-align:left; font-weight:700; font-size:9.5px; }
  .equip-table td { padding:4px 8px; border-bottom:1px solid #e2e8f0; vertical-align:top; }
  .equip-table tr:nth-child(even) td { background:#f8fafc; }

  /* BOM table */
  .bom-table { width:100%; border-collapse:collapse; font-size:9.5px; margin-bottom:8px; }
  .bom-table th { background:#334155; color:white; padding:4px 7px; text-align:left; font-weight:700; font-size:9px; }
  .bom-table td { padding:4px 7px; border-bottom:1px solid #e2e8f0; vertical-align:top; }
  .bom-table tr:nth-child(even) td { background:#f8fafc; }
  .bom-note { font-size:8px; color:#94a3b8; font-style:italic; margin-top:6px; }

  /* Structural */
  .struct-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px; }
  .struct-card { border:1px solid #e2e8f0; border-radius:6px; overflow:hidden; }
  .sct { background:#1e293b; color:white; padding:5px 10px; font-weight:700; font-size:10px; }
  .calc-table { width:100%; border-collapse:collapse; }
  .calc-table tr { border-bottom:1px solid #f1f5f9; }
  .calc-table td { padding:4px 10px; font-size:9.5px; }
  .cv { text-align:right; font-weight:600; color:#1e293b; }

  /* Rules */
  .rules-summary { display:flex; gap:20px; margin-bottom:12px; padding:10px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; }
  .rs { text-align:center; }
  .rs-val { font-size:22px; font-weight:900; }
  .rs-lbl { font-size:9px; color:#64748b; }

  /* Warning labels */
  .label-intro { font-size:9.5px; color:#374151; background:#fffbeb; border:1px solid #fde68a; border-radius:6px; padding:10px; margin-bottom:12px; line-height:1.6; }
  .labels-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-bottom:14px; }
  .label-card { border:1px solid #e2e8f0; border-radius:6px; overflow:hidden; }
  .label-header { display:flex; align-items:center; justify-content:space-between; background:#f8fafc; padding:5px 8px; border-bottom:1px solid #e2e8f0; }
  .label-id { font-weight:800; font-size:10px; color:#1e293b; }
  .label-nec { font-size:8px; color:#64748b; font-family:monospace; }
  .label-visual { padding:8px; min-height:70px; display:flex; flex-direction:column; justify-content:center; }
  .label-warning-line { font-size:10px; font-weight:900; letter-spacing:0.5px; margin-bottom:3px; }
  .label-body-line { font-size:8.5px; line-height:1.5; }
  .label-placement { font-size:8.5px; color:#374151; padding:5px 8px; border-top:1px solid #e2e8f0; background:#fafafa; }

  /* Site map placeholder */
  .map-placeholder { border:2px dashed #cbd5e1; border-radius:8px; min-height:180px; display:flex; align-items:center; justify-content:center; background:#f8fafc; margin-bottom:12px; }
  .map-inner { text-align:center; padding:20px; }
  .map-icon { font-size:32px; opacity:0.4; }
  .map-title { font-size:13px; font-weight:800; color:#374151; margin-top:8px; }
  .map-addr { font-size:10px; color:#64748b; margin-top:4px; }
  .map-note { font-size:9px; color:#94a3b8; margin-top:4px; }

  /* Rapid shutdown box */
  .rapid-shutdown-box { background:#fef2f2; border:1px solid #fecaca; border-radius:6px; padding:10px; margin-top:8px; }
  .rs-title { font-size:10px; font-weight:800; color:#dc2626; margin-bottom:6px; }
  .rs-body { font-size:9px; color:#374151; line-height:1.6; }

  /* Attachment detail */
  .attach-note { background:#fffbeb; border:1px solid #fde68a; border-radius:6px; padding:8px; margin-top:10px; font-size:9px; color:#78350f; line-height:1.6; }

  /* Cert */
  .cert-header { font-size:16px; font-weight:900; text-align:center; color:#1e293b; border-bottom:3px double #1e293b; padding-bottom:10px; margin-bottom:14px; }
  .cert-statement { font-size:10px; line-height:1.8; color:#334155; background:#f8fafc; border:1px solid #e2e8f0; padding:12px; border-radius:6px; margin-bottom:16px; }
  .cert-statement li { margin-bottom:2px; }
  .cert-grid { display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-bottom:16px; }
  .cert-block-title { font-size:10px; font-weight:800; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; border-bottom:1px solid #e2e8f0; padding-bottom:5px; margin-bottom:10px; }
  .cert-field { margin-bottom:10px; }
  .cf-val { font-size:11px; font-weight:600; color:#1e293b; border-bottom:1px solid #94a3b8; padding-bottom:3px; min-height:22px; }
  .cf-lbl { font-size:8.5px; color:#94a3b8; margin-top:2px; }
  .stamp-box { border:2px dashed #cbd5e1; border-radius:8px; height:130px; display:flex; align-items:center; justify-content:center; }
  .cert-footer { font-size:8.5px; color:#94a3b8; text-align:center; border-top:1px solid #e2e8f0; padding-top:10px; margin-top:14px; }
  .notes-box { background:#fffbeb; border:1px solid #fde68a; border-radius:6px; padding:8px; font-size:9.5px; color:#78350f; }

  @page { size:17in 22in; margin:0; }
  @media print { .page { page-break-after:always; } }
</style>
</head>
<body>
${pages.join('\
')}
</body>
</html>`;
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

    const body = await req.json() as PermitInput;
    const { project } = body;

    if (!project) {
      return NextResponse.json({ success: false, error: 'Missing project data' }, { status: 400 });
    }

    const html = generatePermitHTML(body);
    const format = req.nextUrl.searchParams.get('format') || 'html';

    if (format === 'html') {
      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html',
          'Content-Disposition': `inline; filename="permit-${project.projectName || 'project'}.html"`,
        },
      });
    }

    // PDF via wkhtmltopdf
    const tmpDir = path.join(os.tmpdir(), `permit-${Date.now()}`);
    if (!existsSync(tmpDir)) await mkdir(tmpDir, { recursive: true });

    const htmlPath = path.join(tmpDir, 'permit.html');
    const pdfPath = path.join(tmpDir, 'permit.pdf');

    await writeFile(htmlPath, html, 'utf-8');

    const cmd = [
      'wkhtmltopdf',
      '--page-width 17in',
      '--page-height 22in',
      '--margin-top 0',
      '--margin-bottom 0',
      '--margin-left 0',
      '--margin-right 0',
      '--dpi 150',
      '--enable-local-file-access',
      '--disable-smart-shrinking',
      '--print-media-type',
      `"${htmlPath}"`,
      `"${pdfPath}"`,
    ].join(' ');

    await execAsync(cmd);

    const pdfBuffer = await readFile(pdfPath);

    await unlink(htmlPath).catch(() => {});
    await unlink(pdfPath).catch(() => {});

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="PermitPackage-${project.projectName || 'project'}.pdf"`,
        'Content-Length': pdfBuffer.length.toString(),
      },
    });

  } catch (error: any) {
    console.error('Permit package error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Permit package generation failed' },
      { status: 500 }
    );
  }
}
