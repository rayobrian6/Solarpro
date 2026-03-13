// ============================================================
// Permit Package PDF Generator — SolarPro V3
// POST /api/engineering/permit
// Generates a multi-page permit-ready PDF package:
//   Page 1: Cover Page + System Summary
//   Page 2: NEC Compliance Sheet (Rules Engine Results)
//   Page 3: Structural Calculation Sheet
//   Page 4: Equipment Schedule
//   Page 5: Conductor & Conduit Schedule
//   Page 6: Engineer Certification Block
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { handleRouteDbError } from '@/lib/db-neon';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
    acDisconnect: boolean;
    dcDisconnect: boolean;
    productionMeter: boolean;
    rapidShutdown: boolean;
    conduitType: string;
    wireGauge: string;
    wireLength: number;
    batteryBrand?: string;
    batteryModel?: string;
    batteryCount?: number;
    batteryKwh?: number;
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
  }>;
  overrides?: Array<{
    field: string;
    overrideValue: string | number;
    justification: string;
    engineer: string;
    timestamp: string;
  }>;
}

// ─── HTML Generator ──────────────────────────────────────────────────────────

function statusColor(status: string): string {
  if (status === 'PASS' || status === 'pass') return '#10b981';
  if (status === 'WARNING' || status === 'warning') return '#f59e0b';
  if (status === 'FAIL' || status === 'error') return '#ef4444';
  return '#64748b';
}

function statusBg(status: string): string {
  if (status === 'PASS' || status === 'pass') return '#f0fdf4';
  if (status === 'WARNING' || status === 'warning') return '#fffbeb';
  if (status === 'FAIL' || status === 'error') return '#fef2f2';
  return '#f8fafc';
}

function statusBorder(status: string): string {
  if (status === 'PASS' || status === 'pass') return '#bbf7d0';
  if (status === 'WARNING' || status === 'warning') return '#fde68a';
  if (status === 'FAIL' || status === 'error') return '#fecaca';
  return '#e2e8f0';
}

function statusLabel(status: string): string {
  if (status === 'PASS' || status === 'pass') return '✓ PASS';
  if (status === 'WARNING' || status === 'warning') return '⚠ WARNING';
  if (status === 'FAIL' || status === 'error') return '✗ FAIL';
  return status?.toUpperCase() || '—';
}

function titleBlock(input: PermitInput, pageTitle: string, pageNum: number, totalPages: number): string {
  const { project, compliance } = input;
  return `
  <div class="title-block">
    <div class="title-block-left">
      <div class="company-name">SolarPro Engineering</div>
      <div class="project-title">${project.projectName || 'Solar PV System'}</div>
      <div class="project-sub">${project.address || '—'}</div>
    </div>
    <div class="title-block-center">
      <div class="sheet-title">${pageTitle}</div>
      <div class="sheet-sub">NEC ${compliance.jurisdiction?.necVersion || '2020'} · ${compliance.jurisdiction?.state || 'State'} · ${compliance.jurisdiction?.ahj || 'AHJ'}</div>
    </div>
    <div class="title-block-right">
      <table class="tb-table">
        <tr><td class="tb-label">Designer</td><td class="tb-value">${project.designer || '—'}</td></tr>
        <tr><td class="tb-label">Date</td><td class="tb-value">${project.date}</td></tr>
        <tr><td class="tb-label">Sheet</td><td class="tb-value">${pageNum} of ${totalPages}</td></tr>
        <tr><td class="tb-label">Rev</td><td class="tb-value">A</td></tr>
      </table>
    </div>
  </div>`;
}

function generatePermitHTML(input: PermitInput): string {
  const { project, system, compliance, rulesResult, bom, overrides } = input;
  const totalPages = 6;
  const necVer = compliance.jurisdiction?.necVersion || '2020';
  const state = compliance.jurisdiction?.state || '—';

  const overallStatus = rulesResult?.overallStatus || compliance.overallStatus || 'PASS';

  // ─── Page 1: Cover + System Summary ───────────────────────────────────────
  const page1 = `
  <div class="page">
    ${titleBlock(input, 'COVER PAGE & SYSTEM SUMMARY', 1, totalPages)}
    <div class="page-content">

      <!-- Cover Header -->
      <div class="cover-header">
        <div class="cover-badge" style="background:${statusBg(overallStatus)};border:2px solid ${statusBorder(overallStatus)};color:${statusColor(overallStatus)}">
          ${statusLabel(overallStatus)}
        </div>
        <div class="cover-title">SOLAR PV SYSTEM — PERMIT PACKAGE</div>
        <div class="cover-sub">Prepared for AHJ Submission · ${state} · NEC ${necVer}</div>
      </div>

      <!-- Project Info Grid -->
      <div class="section-title">Project Information</div>
      <table class="info-table">
        <tr>
          <td class="info-label">Project Name</td><td class="info-value">${project.projectName || '—'}</td>
          <td class="info-label">Client Name</td><td class="info-value">${project.clientName || '—'}</td>
        </tr>
        <tr>
          <td class="info-label">Installation Address</td><td class="info-value" colspan="3">${project.address || '—'}</td>
        </tr>
        <tr>
          <td class="info-label">Designer / EOR</td><td class="info-value">${project.designer || '—'}</td>
          <td class="info-label">Design Date</td><td class="info-value">${project.date}</td>
        </tr>
        <tr>
          <td class="info-label">Jurisdiction</td><td class="info-value">${state}</td>
          <td class="info-label">AHJ</td><td class="info-value">${compliance.jurisdiction?.ahj || '—'}</td>
        </tr>
        <tr>
          <td class="info-label">Applicable Code</td><td class="info-value">NEC ${necVer}</td>
          <td class="info-label">System Type</td><td class="info-value">${project.systemType?.toUpperCase() || 'ROOF-MOUNTED'}</td>
        </tr>
      </table>

      <!-- System Summary -->
      <div class="section-title" style="margin-top:20px">System Summary</div>
      <div class="summary-grid">
        <div class="summary-card">
          <div class="summary-value">${system.totalDcKw?.toFixed(2) || '—'} kW</div>
          <div class="summary-label">DC System Size</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">${system.totalAcKw?.toFixed(2) || '—'} kW</div>
          <div class="summary-label">AC Inverter Capacity</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">${system.totalPanels || '—'}</div>
          <div class="summary-label">Total Modules</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">${system.dcAcRatio?.toFixed(2) || '—'}</div>
          <div class="summary-label">DC/AC Ratio</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">${project.mainPanelAmps}A</div>
          <div class="summary-label">Main Panel Rating</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">${system.topology || 'STRING'}</div>
          <div class="summary-label">Topology</div>
        </div>
      </div>

      <!-- Utility Interconnection -->
      <div class="section-title" style="margin-top:20px">Utility Interconnection</div>
      <table class="info-table">
        <tr>
          <td class="info-label">Main Panel</td><td class="info-value">${project.mainPanelBrand || '—'} ${project.mainPanelAmps}A</td>
          <td class="info-label">Utility Meter</td><td class="info-value">${project.utilityMeter || '—'}</td>
        </tr>
        <tr>
          <td class="info-label">AC Disconnect</td><td class="info-value">${project.acDisconnect ? '✓ Required' : '✗ Not Required'}</td>
          <td class="info-label">DC Disconnect</td><td class="info-value">${project.dcDisconnect ? '✓ Required' : '✗ Not Required'}</td>
        </tr>
        <tr>
          <td class="info-label">Rapid Shutdown</td><td class="info-value">${project.rapidShutdown ? '✓ NEC 690.12 Compliant' : '✗ Not Provided'}</td>
          <td class="info-label">Production Meter</td><td class="info-value">${project.productionMeter ? '✓ Installed' : '✗ Not Installed'}</td>
        </tr>
        <tr>
          <td class="info-label">Conduit Type</td><td class="info-value">${project.conduitType || '—'}</td>
          <td class="info-label">AC Wire Gauge</td><td class="info-value">${project.wireGauge || '—'}</td>
        </tr>
      </table>

      ${project.batteryCount && project.batteryCount > 0 ? `
      <div class="section-title" style="margin-top:20px">Energy Storage</div>
      <table class="info-table">
        <tr>
          <td class="info-label">Battery Brand</td><td class="info-value">${project.batteryBrand || '—'}</td>
          <td class="info-label">Battery Model</td><td class="info-value">${project.batteryModel || '—'}</td>
        </tr>
        <tr>
          <td class="info-label">Unit Count</td><td class="info-value">${project.batteryCount}</td>
          <td class="info-label">Total Storage</td><td class="info-value">${((project.batteryCount || 0) * (project.batteryKwh || 0)).toFixed(1)} kWh</td>
        </tr>
      </table>` : ''}

      ${project.notes ? `<div class="notes-box"><strong>Notes:</strong> ${project.notes}</div>` : ''}
    </div>
  </div>`;

  // ─── Page 2: NEC Compliance Sheet ─────────────────────────────────────────
  const electricalRules = rulesResult?.rules?.filter(r => r.category === 'electrical') || [];
  const equipmentRules = rulesResult?.rules?.filter(r => r.category === 'equipment') || [];
  const allElecRules = [...electricalRules, ...equipmentRules];

  const page2 = `
  <div class="page">
    ${titleBlock(input, 'NEC COMPLIANCE SHEET', 2, totalPages)}
    <div class="page-content">
      <div class="section-title">Electrical Compliance — NEC ${necVer}</div>

      ${rulesResult ? `
      <!-- Rules Summary -->
      <div class="rules-summary">
        <div class="rules-stat" style="color:${rulesResult.errorCount > 0 ? '#ef4444' : '#10b981'}">
          <div class="rules-stat-val">${rulesResult.errorCount}</div>
          <div class="rules-stat-lbl">Errors</div>
        </div>
        <div class="rules-stat" style="color:${rulesResult.warningCount > 0 ? '#f59e0b' : '#10b981'}">
          <div class="rules-stat-val">${rulesResult.warningCount}</div>
          <div class="rules-stat-lbl">Warnings</div>
        </div>
        <div class="rules-stat" style="color:#10b981">
          <div class="rules-stat-val">${rulesResult.autoFixCount}</div>
          <div class="rules-stat-lbl">Auto-Fixed</div>
        </div>
        <div class="rules-stat" style="color:#3b82f6">
          <div class="rules-stat-val">${rulesResult.overrideCount}</div>
          <div class="rules-stat-lbl">Overrides</div>
        </div>
      </div>

      <!-- Rules Table -->
      <table class="rules-table">
        <thead>
          <tr>
            <th style="width:20%">Rule ID</th>
            <th style="width:28%">Description</th>
            <th style="width:22%">Result</th>
            <th style="width:15%">Value / Limit</th>
            <th style="width:15%">Status</th>
          </tr>
        </thead>
        <tbody>
          ${(rulesResult.rules || []).map(rule => `
          <tr style="background:${statusBg(rule.severity)}">
            <td class="rule-id">${rule.necReference || rule.asceReference || rule.ruleId}</td>
            <td>${rule.title}${rule.autoFixed ? ' <span class="auto-fix-badge">Auto-Fixed</span>' : ''}</td>
            <td class="rule-msg">${rule.message}</td>
            <td class="rule-val">${rule.value !== undefined ? `${rule.value}${rule.limit !== undefined ? ` / ${rule.limit}` : ''}` : '—'}</td>
            <td style="text-align:center;font-weight:bold;color:${statusColor(rule.severity)}">${statusLabel(rule.severity)}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : `
      <!-- Legacy Electrical Results -->
      ${compliance.electrical ? `
      <table class="info-table">
        <tr>
          <td class="info-label">DC System Size</td><td class="info-value">${compliance.electrical.summary?.totalDcKw?.toFixed(2)} kW</td>
          <td class="info-label">AC Capacity</td><td class="info-value">${compliance.electrical.summary?.totalAcKw?.toFixed(2)} kW</td>
        </tr>
        <tr>
          <td class="info-label">Grounding Conductor</td><td class="info-value">${compliance.electrical.groundingConductor}</td>
          <td class="info-label">Busbar Rule</td><td class="info-value" style="color:${compliance.electrical.busbar?.passes ? '#10b981' : '#ef4444'}">${compliance.electrical.busbar?.passes ? '✓ PASS' : '✗ FAIL'}</td>
        </tr>
      </table>` : '<p class="no-data">Run compliance check to populate this section.</p>'}
      `}

      ${overrides && overrides.length > 0 ? `
      <div class="section-title" style="margin-top:20px">Engineering Overrides Log</div>
      <table class="rules-table">
        <thead><tr><th>Field</th><th>Override Value</th><th>Justification</th><th>Engineer</th><th>Date</th></tr></thead>
        <tbody>
          ${overrides.map(o => `
          <tr style="background:#eff6ff">
            <td class="rule-id">${o.field}</td>
            <td style="color:#3b82f6;font-weight:bold">${o.overrideValue}</td>
            <td>${o.justification}</td>
            <td>${o.engineer}</td>
            <td>${new Date(o.timestamp).toLocaleDateString()}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : ''}
    </div>
  </div>`;

  // ─── Page 3: Structural Calculation Sheet ─────────────────────────────────
  const structuralRules = rulesResult?.rules?.filter(r => r.category === 'structural') || [];
  const structural = compliance.structural;

  const page3 = `
  <div class="page">
    ${titleBlock(input, 'STRUCTURAL CALCULATION SHEET', 3, totalPages)}
    <div class="page-content">
      <div class="section-title">Structural Analysis — ASCE 7-22</div>

      ${structural ? `
      <div class="struct-grid">
        <!-- Wind Analysis -->
        <div class="struct-card">
          <div class="struct-card-title">💨 Wind Analysis</div>
          <table class="calc-table">
            <tr><td>Design Wind Speed</td><td class="calc-val">${structural.wind?.windSpeed || '—'} mph</td></tr>
            <tr><td>Exposure Category</td><td class="calc-val">${structural.wind?.exposureCategory || '—'}</td></tr>
            <tr><td>Velocity Pressure (qz)</td><td class="calc-val">${structural.wind?.velocityPressure?.toFixed(2) || '—'} psf</td></tr>
            <tr><td>Net Uplift Pressure</td><td class="calc-val">${structural.wind?.netUpliftPressure?.toFixed(2) || '—'} psf</td></tr>
            <tr><td>Uplift per Attachment</td><td class="calc-val" style="font-weight:bold">${structural.wind?.upliftPerAttachment?.toFixed(0) || '—'} lbs</td></tr>
          </table>
        </div>
        <!-- Snow Analysis -->
        <div class="struct-card">
          <div class="struct-card-title">❄ Snow Analysis</div>
          <table class="calc-table">
            <tr><td>Ground Snow Load (pg)</td><td class="calc-val">${structural.snow?.groundSnowLoad || '—'} psf</td></tr>
            <tr><td>Roof Snow Load (ps)</td><td class="calc-val">${structural.snow?.roofSnowLoad?.toFixed(1) || '—'} psf</td></tr>
            <tr><td>Snow per Attachment</td><td class="calc-val" style="font-weight:bold">${structural.snow?.snowLoadPerAttachment?.toFixed(0) || '—'} lbs</td></tr>
          </table>
        </div>
        <!-- Rafter Analysis -->
        <div class="struct-card">
          <div class="struct-card-title">📐 Rafter Analysis</div>
          <table class="calc-table">
            <tr><td>Bending Moment</td><td class="calc-val">${structural.rafter?.bendingMoment?.toFixed(0) || '—'} ft-lbs</td></tr>
            <tr><td>Allowable Moment</td><td class="calc-val">${structural.rafter?.allowableBendingMoment?.toFixed(0) || '—'} ft-lbs</td></tr>
            <tr><td>Utilization Ratio</td><td class="calc-val" style="font-weight:bold;color:${(structural.rafter?.utilizationRatio || 0) > 1 ? '#ef4444' : (structural.rafter?.utilizationRatio || 0) > 0.85 ? '#f59e0b' : '#10b981'}">${((structural.rafter?.utilizationRatio || 0) * 100).toFixed(0)}%</td></tr>
            <tr><td>Deflection / Allowable</td><td class="calc-val">${structural.rafter?.deflection?.toFixed(3) || '—'}" / ${structural.rafter?.allowableDeflection?.toFixed(3) || '—'}"</td></tr>
          </table>
        </div>
        <!-- Attachment Analysis -->
        <div class="struct-card">
          <div class="struct-card-title">🔩 Attachment Analysis</div>
          <table class="calc-table">
            <tr><td>Lag Bolt Capacity</td><td class="calc-val">${structural.attachment?.lagBoltCapacity?.toFixed(0) || '—'} lbs</td></tr>
            <tr><td>Total Uplift/Attachment</td><td class="calc-val">${structural.attachment?.totalUpliftPerAttachment?.toFixed(0) || '—'} lbs</td></tr>
            <tr><td>Safety Factor</td><td class="calc-val" style="font-weight:bold;color:${(structural.attachment?.safetyFactor || 0) < 2 ? '#ef4444' : (structural.attachment?.safetyFactor || 0) < 3 ? '#f59e0b' : '#10b981'}">${structural.attachment?.safetyFactor?.toFixed(2) || '—'}</td></tr>
            <tr><td>Max Allowed Spacing</td><td class="calc-val">${structural.attachment?.maxAllowedSpacing || '—'}"</td></tr>
          </table>
        </div>
      </div>` : '<p class="no-data">Run compliance check to populate structural calculations.</p>'}

      ${structuralRules.length > 0 ? `
      <div class="section-title" style="margin-top:20px">Structural Rules Check</div>
      <table class="rules-table">
        <thead><tr><th>Reference</th><th>Description</th><th>Result</th><th>Value / Limit</th><th>Status</th></tr></thead>
        <tbody>
          ${structuralRules.map(rule => `
          <tr style="background:${statusBg(rule.severity)}">
            <td class="rule-id">${rule.asceReference || rule.ruleId}</td>
            <td>${rule.title}</td>
            <td class="rule-msg">${rule.message}</td>
            <td class="rule-val">${rule.value !== undefined ? `${rule.value}${rule.limit !== undefined ? ` / ${rule.limit}` : ''}` : '—'}</td>
            <td style="text-align:center;font-weight:bold;color:${statusColor(rule.severity)}">${statusLabel(rule.severity)}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : ''}

      ${rulesResult?.structuralAutoResolutions && rulesResult.structuralAutoResolutions.length > 0 ? `
      <div class="section-title" style="margin-top:20px">Auto-Resolutions Applied</div>
      <table class="rules-table">
        <thead><tr><th>Field</th><th>Original</th><th>Resolved</th><th>Reason</th><th>Reference</th></tr></thead>
        <tbody>
          ${rulesResult.structuralAutoResolutions.map(r => `
          <tr style="background:#f0fdf4">
            <td class="rule-id">${r.field}</td>
            <td>${r.originalValue}</td>
            <td style="color:#10b981;font-weight:bold">${r.resolvedValue}</td>
            <td>${r.reason}</td>
            <td class="rule-id">${r.necReference}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : ''}
    </div>
  </div>`;

  // ─── Page 4: Equipment Schedule ───────────────────────────────────────────
  const page4 = `
  <div class="page">
    ${titleBlock(input, 'EQUIPMENT SCHEDULE', 4, totalPages)}
    <div class="page-content">
      <div class="section-title">Solar Modules</div>
      <table class="equip-table">
        <thead>
          <tr>
            <th>String</th><th>Manufacturer</th><th>Model</th><th>Qty</th>
            <th>Watts</th><th>Voc (V)</th><th>Isc (A)</th><th>Total kW</th>
            <th>Wire</th><th>Run (ft)</th>
          </tr>
        </thead>
        <tbody>
          ${system.inverters?.flatMap((inv, invIdx) =>
            inv.strings?.map((str, strIdx) => `
            <tr>
              <td style="font-weight:bold">${invIdx + 1}-${strIdx + 1}</td>
              <td>${str.panelManufacturer || '—'}</td>
              <td>${str.panelModel || '—'}</td>
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
            <td colspan="3">TOTAL</td>
            <td style="text-align:right">${system.totalPanels}</td>
            <td colspan="3"></td>
            <td style="text-align:right">${system.totalDcKw?.toFixed(2)}</td>
            <td colspan="2"></td>
          </tr>
        </tbody>
      </table>

      <div class="section-title" style="margin-top:20px">Inverters</div>
      <table class="equip-table">
        <thead>
          <tr>
            <th>#</th><th>Type</th><th>Manufacturer</th><th>Model</th>
            <th>AC kW</th><th>Max DC V</th><th>Efficiency</th><th>UL Listing</th>
          </tr>
        </thead>
        <tbody>
          ${system.inverters?.map((inv, idx) => `
          <tr>
            <td style="font-weight:bold">${idx + 1}</td>
            <td>${inv.type === 'micro' ? 'Microinverter' : inv.type === 'optimizer' ? 'String + Optimizer' : 'String'}</td>
            <td>${inv.manufacturer || '—'}</td>
            <td>${inv.model || '—'}</td>
            <td style="text-align:right">${inv.acOutputKw}</td>
            <td style="text-align:right">${inv.maxDcVoltage}V</td>
            <td style="text-align:right">${inv.efficiency}%</td>
            <td>${inv.ulListing || 'UL 1741'}</td>
          </tr>`).join('')}
        </tbody>
      </table>

      ${bom && bom.length > 0 ? `
      <div class="section-title" style="margin-top:20px">Balance of System (BOM Summary)</div>
      <table class="equip-table">
        <thead><tr><th>Category</th><th>Manufacturer</th><th>Model / Description</th><th>Part #</th><th>Qty</th><th>Unit</th></tr></thead>
        <tbody>
          ${bom.filter(i => !['panels', 'inverters'].includes(i.category)).map(item => `
          <tr>
            <td style="text-transform:capitalize;color:#64748b">${item.category.replace(/_/g, ' ')}</td>
            <td>${item.manufacturer}</td>
            <td>${item.model}</td>
            <td style="font-family:monospace;font-size:10px">${item.partNumber || '—'}</td>
            <td style="text-align:right;font-weight:bold">${item.quantity}</td>
            <td>${item.unit}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : ''}
    </div>
  </div>`;

  // ─── Page 5: Conductor & Conduit Schedule ─────────────────────────────────
  const elec = compliance.electrical;
  const page5 = `
  <div class="page">
    ${titleBlock(input, 'CONDUCTOR & CONDUIT SCHEDULE', 5, totalPages)}
    <div class="page-content">
      <div class="section-title">Conductor Schedule</div>
      <table class="equip-table">
        <thead>
          <tr>
            <th>Circuit</th><th>From</th><th>To</th><th>Conductor</th>
            <th>Ampacity</th><th>OCPD</th><th>V-Drop</th><th>Conduit</th>
          </tr>
        </thead>
        <tbody>
          ${system.inverters?.flatMap((inv, invIdx) =>
            inv.strings?.map((str, strIdx) => `
            <tr>
              <td style="font-weight:bold">DC ${invIdx + 1}-${strIdx + 1}</td>
              <td>String ${invIdx + 1}-${strIdx + 1}</td>
              <td>Inverter ${invIdx + 1}</td>
              <td>${str.wireGauge} THWN-2</td>
              <td>—</td>
              <td>—</td>
              <td>—</td>
              <td>${project.conduitType}</td>
            </tr>`) || []
          ).join('')}
          ${elec ? `
          <tr style="background:#f0f9ff">
            <td style="font-weight:bold">AC Output</td>
            <td>Inverter(s)</td>
            <td>Main Panel</td>
            <td>${elec.acConductorCallout || project.wireGauge}</td>
            <td>${elec.acWireAmpacity || '—'}A</td>
            <td>${elec.busbar?.backfeedBreakerRequired || '—'}A</td>
            <td style="color:${(elec.acVoltageDrop || 0) > 3 ? '#f59e0b' : '#10b981'}">${elec.acVoltageDrop?.toFixed(2) || '—'}%</td>
            <td>${project.conduitType}</td>
          </tr>
          <tr style="background:#f0fdf4">
            <td style="font-weight:bold">EGC</td>
            <td>Array</td>
            <td>Main Panel</td>
            <td>${elec.groundingConductor || '#12 AWG'} bare copper</td>
            <td>—</td>
            <td>—</td>
            <td>—</td>
            <td>${project.conduitType}</td>
          </tr>` : ''}
        </tbody>
      </table>

      ${elec?.conduitFill ? `
      <div class="section-title" style="margin-top:20px">Conduit Fill Analysis — NEC Chapter 9</div>
      <table class="info-table">
        <tr>
          <td class="info-label">Conduit Type</td><td class="info-value">${elec.conduitFill.conduitType}</td>
          <td class="info-label">Conduit Size</td><td class="info-value">${elec.conduitFill.conduitSize}</td>
        </tr>
        <tr>
          <td class="info-label">Fill Percentage</td>
          <td class="info-value" style="color:${elec.conduitFill.fillPercent > 40 ? '#ef4444' : '#10b981'};font-weight:bold">
            ${elec.conduitFill.fillPercent?.toFixed(1)}% (Max: 40%)
          </td>
          <td class="info-label">Status</td>
          <td class="info-value" style="color:${elec.conduitFill.passes ? '#10b981' : '#ef4444'};font-weight:bold">
            ${elec.conduitFill.passes ? '✓ PASS' : '✗ FAIL'}
          </td>
        </tr>
      </table>` : ''}

      <div class="section-title" style="margin-top:20px">NEC Code References</div>
      <table class="equip-table">
        <thead><tr><th>Code Section</th><th>Title</th><th>Application</th></tr></thead>
        <tbody>
          <tr><td class="rule-id">NEC 690.8(B)</td><td>Circuit Sizing</td><td>Isc × 1.25 for OCPD sizing; conductor ampacity ≥ 1.25 × Isc</td></tr>
          <tr><td class="rule-id">NEC 690.7(A)</td><td>Maximum Voltage</td><td>String Voc corrected for minimum design temperature</td></tr>
          <tr><td class="rule-id">NEC 705.12(B)(2)</td><td>120% Busbar Rule</td><td>Backfeed breaker ≤ 20% of main panel busbar rating</td></tr>
          <tr><td class="rule-id">NEC 690.12</td><td>Rapid Shutdown</td><td>Module-level shutdown within 30 seconds for roof-mounted systems</td></tr>
          <tr><td class="rule-id">NEC 310.15</td><td>Conductor Ampacity</td><td>Temperature and conduit fill derating per NEC 310.15(B)</td></tr>
          <tr><td class="rule-id">NEC Ch. 9, Table 1</td><td>Conduit Fill</td><td>Maximum 40% fill for 3+ conductors</td></tr>
          <tr><td class="rule-id">ASCE 7-22 §26</td><td>Wind Loads</td><td>Components and cladding wind pressure on roof-mounted arrays</td></tr>
          <tr><td class="rule-id">ASCE 7-22 §7</td><td>Snow Loads</td><td>Roof snow load with slope reduction factor</td></tr>
        </tbody>
      </table>
    </div>
  </div>`;

  // ─── Page 6: Engineer Certification ───────────────────────────────────────
  const page6 = `
  <div class="page">
    ${titleBlock(input, 'ENGINEER CERTIFICATION', 6, totalPages)}
    <div class="page-content">
      <div class="cert-header">ENGINEER OF RECORD CERTIFICATION</div>

      <div class="cert-statement">
        I hereby certify that this solar photovoltaic system design has been prepared under my direct supervision
        and complies with the following applicable codes and standards:
        <ul style="margin-top:10px;line-height:2">
          <li>National Electrical Code (NEC) ${necVer}, Article 690 — Solar Photovoltaic Systems</li>
          <li>National Electrical Code (NEC) ${necVer}, Article 705 — Interconnected Electric Power Production Sources</li>
          <li>ASCE 7-22 — Minimum Design Loads and Associated Criteria for Buildings and Other Structures</li>
          <li>International Building Code (IBC) — Structural requirements for roof-mounted systems</li>
          <li>All applicable local amendments adopted by ${state} and the Authority Having Jurisdiction (${compliance.jurisdiction?.ahj || 'AHJ'})</li>
        </ul>
      </div>

      <div class="cert-grid">
        <div class="cert-block">
          <div class="cert-block-title">PREPARED BY</div>
          <div class="cert-field">
            <div class="cert-field-value">${project.designer || '________________________________'}</div>
            <div class="cert-field-label">Designer / Engineer of Record</div>
          </div>
          <div class="cert-field">
            <div class="cert-field-value">________________________________</div>
            <div class="cert-field-label">License Number</div>
          </div>
          <div class="cert-field">
            <div class="cert-field-value">________________________________</div>
            <div class="cert-field-label">State of Licensure</div>
          </div>
          <div class="cert-field">
            <div class="cert-field-value">${project.date}</div>
            <div class="cert-field-label">Date of Certification</div>
          </div>
          <div class="cert-field" style="margin-top:20px">
            <div class="cert-field-value" style="border-bottom:2px solid #1e293b;padding-bottom:30px">________________________________</div>
            <div class="cert-field-label">Signature</div>
          </div>
        </div>
        <div class="cert-block">
          <div class="cert-block-title">WET STAMP AREA</div>
          <div class="stamp-box">
            <div class="stamp-inner">
              <div style="font-size:28px;opacity:0.2">⬡</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:8px">Engineer Wet Stamp</div>
              <div style="font-size:10px;color:#cbd5e1;margin-top:4px">Required for AHJ Submission</div>
            </div>
          </div>
          <div class="cert-block-title" style="margin-top:20px">REVISION HISTORY</div>
          <table class="equip-table" style="margin-top:8px">
            <thead><tr><th>Rev</th><th>Date</th><th>Description</th><th>By</th></tr></thead>
            <tbody>
              <tr><td style="font-weight:bold">A</td><td>${project.date}</td><td>Initial Issue</td><td>${project.designer || '—'}</td></tr>
              <tr><td style="color:#94a3b8">B</td><td style="color:#94a3b8">—</td><td style="color:#94a3b8">—</td><td style="color:#94a3b8">—</td></tr>
              <tr><td style="color:#94a3b8">C</td><td style="color:#94a3b8">—</td><td style="color:#94a3b8">—</td><td style="color:#94a3b8">—</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="cert-footer">
        SolarPro Engineering Platform V3 · Generated ${new Date().toLocaleDateString()} ·
        This document is computer-generated and requires engineer review and wet stamp before AHJ submission.
        All equipment must be UL-listed and installed per manufacturer specifications and NEC ${necVer}.
      </div>
    </div>
  </div>`;

  // ─── Full HTML Document ────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Permit Package — ${project.projectName}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Arial', sans-serif; font-size: 11px; color: #1e293b; background: white; }

  .page {
    width: 18in; min-height: 24in;
    padding: 0.5in;
    page-break-after: always;
    display: flex; flex-direction: column;
  }
  .page:last-child { page-break-after: avoid; }

  /* Title Block */
  .title-block {
    display: flex; align-items: stretch;
    border: 2px solid #1e293b; margin-bottom: 20px;
    background: #f8fafc;
  }
  .title-block-left { flex: 2; padding: 10px 14px; border-right: 1px solid #cbd5e1; }
  .title-block-center { flex: 3; padding: 10px 14px; border-right: 1px solid #cbd5e1; display: flex; flex-direction: column; justify-content: center; }
  .title-block-right { flex: 1.5; padding: 6px; }
  .company-name { font-size: 14px; font-weight: 900; color: #f59e0b; letter-spacing: 0.5px; }
  .project-title { font-size: 13px; font-weight: 700; color: #1e293b; margin-top: 4px; }
  .project-sub { font-size: 10px; color: #64748b; margin-top: 2px; }
  .sheet-title { font-size: 16px; font-weight: 900; color: #1e293b; text-align: center; }
  .sheet-sub { font-size: 10px; color: #64748b; text-align: center; margin-top: 4px; }
  .tb-table { width: 100%; border-collapse: collapse; font-size: 10px; }
  .tb-table tr { border-bottom: 1px solid #e2e8f0; }
  .tb-label { color: #64748b; padding: 3px 6px; white-space: nowrap; }
  .tb-value { font-weight: 600; color: #1e293b; padding: 3px 6px; }

  .page-content { flex: 1; }
  .section-title { font-size: 12px; font-weight: 800; color: #1e293b; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #f59e0b; padding-bottom: 4px; margin-bottom: 12px; }

  /* Cover */
  .cover-header { text-align: center; padding: 20px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 20px; }
  .cover-badge { display: inline-block; padding: 6px 20px; border-radius: 20px; font-weight: 900; font-size: 14px; margin-bottom: 10px; }
  .cover-title { font-size: 22px; font-weight: 900; color: #1e293b; }
  .cover-sub { font-size: 12px; color: #64748b; margin-top: 6px; }

  /* Info Table */
  .info-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  .info-table tr { border-bottom: 1px solid #e2e8f0; }
  .info-label { background: #f8fafc; color: #64748b; font-weight: 600; padding: 6px 10px; width: 18%; white-space: nowrap; border: 1px solid #e2e8f0; }
  .info-value { color: #1e293b; padding: 6px 10px; border: 1px solid #e2e8f0; }

  /* Summary Grid */
  .summary-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin-bottom: 8px; }
  .summary-card { background: #fef3c7; border: 1px solid #fde68a; border-radius: 6px; padding: 10px; text-align: center; }
  .summary-value { font-size: 16px; font-weight: 900; color: #92400e; }
  .summary-label { font-size: 9px; color: #78350f; margin-top: 3px; }

  /* Rules Table */
  .rules-summary { display: flex; gap: 20px; margin-bottom: 16px; padding: 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; }
  .rules-stat { text-align: center; }
  .rules-stat-val { font-size: 24px; font-weight: 900; }
  .rules-stat-lbl { font-size: 10px; color: #64748b; }
  .rules-table { width: 100%; border-collapse: collapse; font-size: 10px; }
  .rules-table th { background: #1e293b; color: white; padding: 6px 8px; text-align: left; font-weight: 700; }
  .rules-table td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  .rule-id { font-family: monospace; font-size: 9px; color: #475569; white-space: nowrap; }
  .rule-msg { font-size: 9px; color: #475569; }
  .rule-val { font-family: monospace; font-size: 9px; text-align: right; }
  .auto-fix-badge { background: #d1fae5; color: #065f46; padding: 1px 5px; border-radius: 3px; font-size: 8px; font-weight: 700; }

  /* Structural */
  .struct-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
  .struct-card { border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; }
  .struct-card-title { background: #1e293b; color: white; padding: 6px 10px; font-weight: 700; font-size: 11px; }
  .calc-table { width: 100%; border-collapse: collapse; }
  .calc-table tr { border-bottom: 1px solid #f1f5f9; }
  .calc-table td { padding: 5px 10px; font-size: 10px; }
  .calc-val { text-align: right; font-weight: 600; color: #1e293b; }

  /* Equipment Table */
  .equip-table { width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 8px; }
  .equip-table th { background: #334155; color: white; padding: 5px 8px; text-align: left; font-weight: 700; }
  .equip-table td { padding: 4px 8px; border-bottom: 1px solid #e2e8f0; }
  .equip-table tr:nth-child(even) { background: #f8fafc; }

  /* Certification */
  .cert-header { font-size: 18px; font-weight: 900; text-align: center; color: #1e293b; border-bottom: 3px double #1e293b; padding-bottom: 12px; margin-bottom: 16px; }
  .cert-statement { font-size: 11px; line-height: 1.7; color: #334155; background: #f8fafc; border: 1px solid #e2e8f0; padding: 14px; border-radius: 6px; margin-bottom: 20px; }
  .cert-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 20px; }
  .cert-block { }
  .cert-block-title { font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 12px; }
  .cert-field { margin-bottom: 12px; }
  .cert-field-value { font-size: 12px; font-weight: 600; color: #1e293b; border-bottom: 1px solid #94a3b8; padding-bottom: 4px; min-height: 24px; }
  .cert-field-label { font-size: 9px; color: #94a3b8; margin-top: 3px; }
  .stamp-box { border: 2px dashed #cbd5e1; border-radius: 8px; height: 140px; display: flex; align-items: center; justify-content: center; }
  .stamp-inner { text-align: center; }
  .cert-footer { font-size: 9px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 12px; margin-top: 20px; }
  .notes-box { background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 10px; margin-top: 12px; font-size: 10px; color: #78350f; }
  .no-data { color: #94a3b8; font-style: italic; padding: 20px; text-align: center; }

  @page { size: 18in 24in; margin: 0; }
  @media print { .page { page-break-after: always; } }
</style>
</head>
<body>
${page1}
${page2}
${page3}
${page4}
${page5}
${page6}
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

    // Check if PDF requested
    const format = req.nextUrl.searchParams.get('format') || 'html';

    if (format === 'html') {
      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html',
          'Content-Disposition': `inline; filename="permit-package-${project.projectName || 'project'}.html"`,
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
      '--page-width 18in',
      '--page-height 24in',
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

    // Cleanup
    await unlink(htmlPath).catch(() => {});
    await unlink(pdfPath).catch(() => {});

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="permit-package-${project.projectName || 'project'}.pdf"`,
        'Content-Length': pdfBuffer.length.toString(),
      },
    });

  } catch (error: unknown) {
    return handleRouteDbError('[Permi]', error);
  }
}