// ============================================================
// lib/plan-set/cover-sheet.ts  (v44.0 — AHJ-grade rewrite)
// Sheet G-1: Cover Sheet
// ============================================================

import { wrapPage, escHtml, fmtDate, type TitleBlockData } from './title-block';
import { BUILD_VERSION } from '@/lib/version';

export interface CoverSheetInput {
  tb: TitleBlockData;

  // Project
  projectName:           string;
  clientName:            string;
  ownerContact?:         string;   // NEW: phone/email of owner
  siteAddress:           string;
  city:                  string;
  state:                 string;
  zip:                   string;
  county:                string;
  parcelNumber?:         string;
  projectDate:           string;

  // System
  systemKw:              number;
  inverterKw:            number;   // NEW: AC rating
  panelCount:            number;
  panelModel:            string;
  panelWatts:            number;
  panelVoc:              number;   // NEW
  panelIsc:              number;   // NEW
  stringCount:           number;   // NEW
  panelsPerString:       number;   // NEW
  inverterType:          string;
  inverterModel:         string;
  inverterManufacturer?: string;   // NEW
  mountType:             string;
  roofType?:             string;
  interconnectionMethod: string;   // NEW
  batteryModel?:         string;
  batteryKwh?:           number;
  annualKwh?:            number;

  // AHJ
  ahj:                   string;
  ahjPhone?:             string;
  ahjWebsite?:           string;
  utilityName:           string;
  utilityPhone?:         string;
  necVersion:            string;
  ibcVersion?:           string;
  asceVersion?:          string;
  windSpeedMph?:         number;
  groundSnowPsf?:        number;
  seismicCategory?:      string;
  fireZone?:             string;
  rapidShutdownReq:      boolean;

  // Contractor
  contractorName:        string;
  contractorLicense?:    string;
  contractorPhone?:      string;
  contractorEmail?:      string;
  electricalLicense?:    string;   // NEW
  designerName:          string;

  // Sheet index
  sheets: { number: string; title: string; description: string }[];
}

export function buildCoverSheet(inp: CoverSheetInput): string {
  const content = `
    <!-- Sheet Header -->
    <div class="sheet-header">
      <div>
        <div class="sh-title">PHOTOVOLTAIC SYSTEM — PERMIT PLAN SET</div>
        <div class="sh-sub">${escHtml(inp.siteAddress)}, ${escHtml(inp.city)}, ${escHtml(inp.state)} ${escHtml(inp.zip)}</div>
      </div>
      <div class="sh-badge">G-1 COVER SHEET</div>
    </div>

    <div class="two-col" style="gap:12px; margin-top:6px;">

      <!-- LEFT COLUMN -->
      <div>

        <!-- Project Information -->
        <div class="section-header">Project Information</div>
        <table>
          <tr><td style="width:40%;color:#555;">Owner / Client</td><td><strong>${escHtml(inp.clientName)}</strong></td></tr>
          ${inp.ownerContact ? `<tr><td style="color:#555;">Owner Contact</td><td>${escHtml(inp.ownerContact)}</td></tr>` : ''}
          <tr><td style="color:#555;">Project Name</td><td>${escHtml(inp.projectName)}</td></tr>
          <tr><td style="color:#555;">Site Address</td><td>${escHtml(inp.siteAddress)}</td></tr>
          <tr><td style="color:#555;">City / State / ZIP</td><td>${escHtml(inp.city)}, ${escHtml(inp.state)} ${escHtml(inp.zip)}</td></tr>
          <tr><td style="color:#555;">County</td><td>${escHtml(inp.county)}</td></tr>
          ${inp.parcelNumber ? `<tr><td style="color:#555;">Parcel / APN</td><td>${escHtml(inp.parcelNumber)}</td></tr>` : ''}
          <tr><td style="color:#555;">Prepared Date</td><td>${fmtDate(inp.projectDate)}</td></tr>
        </table>

        <!-- System Summary -->
        <div class="section-header" style="margin-top:8px;">System Summary</div>
        <table>
          <tr><td style="width:40%;color:#555;">Total Modules</td><td><strong>${inp.panelCount} modules</strong></td></tr>
          <tr><td style="color:#555;">Module Wattage</td><td>${inp.panelWatts}W STC</td></tr>
          <tr><td style="color:#555;">DC System Size</td><td><strong>${inp.systemKw.toFixed(2)} kW DC</strong></td></tr>
          <tr><td style="color:#555;">Inverter AC Rating</td><td><strong>${inp.inverterKw.toFixed(2)} kW AC</strong></td></tr>
          <tr><td style="color:#555;">DC/AC Ratio</td><td>${(inp.systemKw / (inp.inverterKw || inp.systemKw)).toFixed(2)}</td></tr>
          <tr><td style="color:#555;">Array Configuration</td><td>${inp.stringCount} string${inp.stringCount !== 1 ? 's' : ''} × ${inp.panelsPerString} modules</td></tr>
          <tr><td style="color:#555;">Module Model</td><td>${escHtml(inp.panelModel)}</td></tr>
          <tr><td style="color:#555;">Inverter Type</td><td>${escHtml(inp.inverterType)}</td></tr>
          <tr><td style="color:#555;">Inverter Model</td><td>${escHtml(inp.inverterModel)}</td></tr>
          <tr><td style="color:#555;">Mounting Type</td><td>${escHtml(inp.mountType)}</td></tr>
          ${inp.roofType ? `<tr><td style="color:#555;">Roof Type</td><td>${escHtml(inp.roofType)}</td></tr>` : ''}
          <tr><td style="color:#555;">Interconnection</td><td>${escHtml(inp.interconnectionMethod)}</td></tr>
          ${inp.batteryModel ? `<tr><td style="color:#555;">Battery Storage</td><td>${escHtml(inp.batteryModel)} — ${inp.batteryKwh?.toFixed(1)} kWh</td></tr>` : ''}
          ${inp.annualKwh ? `<tr><td style="color:#555;">Est. Annual Output</td><td>${inp.annualKwh.toLocaleString()} kWh/yr</td></tr>` : ''}
        </table>

        <!-- Contractor Info -->
        <div class="section-header" style="margin-top:8px;">Contractor / Designer</div>
        <table>
          <tr><td style="width:40%;color:#555;">Contractor</td><td><strong>${escHtml(inp.contractorName)}</strong></td></tr>
          ${inp.contractorLicense ? `<tr><td style="color:#555;">Contractor Lic. #</td><td>${escHtml(inp.contractorLicense)}</td></tr>` : '<tr><td style="color:#555;">Contractor Lic. #</td><td>________________________________</td></tr>'}
          ${inp.electricalLicense ? `<tr><td style="color:#555;">Electrical Lic. #</td><td>${escHtml(inp.electricalLicense)}</td></tr>` : '<tr><td style="color:#555;">Electrical Lic. #</td><td>________________________________</td></tr>'}
          ${inp.contractorPhone ? `<tr><td style="color:#555;">Phone</td><td>${escHtml(inp.contractorPhone)}</td></tr>` : ''}
          ${inp.contractorEmail ? `<tr><td style="color:#555;">Email</td><td>${escHtml(inp.contractorEmail)}</td></tr>` : ''}
          <tr><td style="color:#555;">Designer</td><td>${escHtml(inp.designerName)}</td></tr>
          <tr><td style="color:#555;">Prepared By</td><td>SolarPro Engineering Engine ${BUILD_VERSION}</td></tr>
        </table>

      </div>

      <!-- RIGHT COLUMN -->
      <div>

        <!-- AHJ & Codes -->
        <div class="section-header">Authority Having Jurisdiction &amp; Applicable Codes</div>
        <table>
          <tr><td style="width:44%;color:#555;">AHJ Name</td><td><strong>${escHtml(inp.ahj)}</strong></td></tr>
          ${inp.ahjPhone ? `<tr><td style="color:#555;">AHJ Phone</td><td>${escHtml(inp.ahjPhone)}</td></tr>` : ''}
          ${inp.ahjWebsite ? `<tr><td style="color:#555;">AHJ Website</td><td>${escHtml(inp.ahjWebsite)}</td></tr>` : ''}
          <tr><td style="color:#555;">Utility Name</td><td><strong>${escHtml(inp.utilityName)}</strong></td></tr>
          ${inp.utilityPhone ? `<tr><td style="color:#555;">Utility Phone</td><td>${escHtml(inp.utilityPhone)}</td></tr>` : ''}
          <tr><td style="color:#555;">Electrical Code</td><td><strong>${escHtml(inp.necVersion)}</strong></td></tr>
          ${inp.ibcVersion ? `<tr><td style="color:#555;">Building Code</td><td>${escHtml(inp.ibcVersion)}</td></tr>` : ''}
          ${inp.asceVersion ? `<tr><td style="color:#555;">Structural Standard</td><td>${escHtml(inp.asceVersion)}</td></tr>` : ''}
          ${inp.windSpeedMph ? `<tr><td style="color:#555;">Design Wind Speed</td><td>${inp.windSpeedMph} mph (3-sec gust, Exp. ${inp.seismicCategory ? '' : 'C'})</td></tr>` : ''}
          ${inp.groundSnowPsf !== undefined ? `<tr><td style="color:#555;">Ground Snow Load</td><td>${inp.groundSnowPsf} psf</td></tr>` : ''}
          ${inp.seismicCategory ? `<tr><td style="color:#555;">Seismic Design Cat.</td><td>${escHtml(inp.seismicCategory)}</td></tr>` : ''}
          ${inp.fireZone ? `<tr><td style="color:#555;">Fire Zone</td><td>${escHtml(inp.fireZone)}</td></tr>` : ''}
          <tr><td style="color:#555;">Rapid Shutdown</td><td>${inp.rapidShutdownReq ? '✓ Required — NEC 690.12' : 'Not Required'}</td></tr>
        </table>

        <!-- Scope of Work -->
        <div class="section-header" style="margin-top:8px;">Scope of Work</div>
        <div style="font-size:7pt; line-height:1.6; padding:4px 6px; background:#f7f8fc; border:0.5px solid #ccd; border-radius:2px;">
          Install a grid-tied photovoltaic (PV) solar energy system consisting of
          <strong>${inp.panelCount} × ${inp.panelWatts}W solar modules</strong>
          (${inp.systemKw.toFixed(2)} kW DC) with
          <strong>${escHtml(inp.inverterType)} inverter(s)</strong>
          (${escHtml(inp.inverterModel)}, ${inp.inverterKw.toFixed(2)} kW AC) on a
          <strong>${escHtml(inp.mountType)}</strong> mounting system.
          Interconnection via <strong>${escHtml(inp.interconnectionMethod)}</strong>.
          ${inp.batteryModel ? `Battery energy storage (${escHtml(inp.batteryModel)}, ${inp.batteryKwh?.toFixed(1)} kWh) included.` : ''}
          System shall be installed per ${escHtml(inp.necVersion)},
          ${inp.ibcVersion ? `${escHtml(inp.ibcVersion)},` : ''}
          and all applicable local codes and AHJ requirements.
          ${inp.rapidShutdownReq ? 'Rapid shutdown system required per NEC 690.12.' : ''}
        </div>

        <!-- General Notes -->
        <div class="section-header" style="margin-top:8px;">General Notes</div>
        <div style="font-size:6.5pt; line-height:1.55; padding:4px 6px;">
          ${GENERAL_NOTES.map((n, i) => `<div style="margin-bottom:2px;"><strong>${i+1}.</strong> ${n}</div>`).join('')}
        </div>

        <!-- Sheet Index -->
        <div class="section-header" style="margin-top:8px;">Sheet Index</div>
        <table>
          <thead>
            <tr>
              <th style="width:12%;">Sheet</th>
              <th style="width:28%;">Title</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            ${inp.sheets.map(s => `
            <tr>
              <td><strong>${escHtml(s.number)}</strong></td>
              <td>${escHtml(s.title)}</td>
              <td>${escHtml(s.description)}</td>
            </tr>`).join('')}
          </tbody>
        </table>

      </div>
    </div>

    <!-- Revision Block -->
    <div style="margin-top:8px; border:0.5px solid #aab; border-radius:2px;">
      <table style="font-size:6pt;">
        <thead>
          <tr style="background:#1a3a6b; color:white;">
            <th style="width:8%;">Rev.</th>
            <th style="width:15%;">Date</th>
            <th style="width:50%;">Description</th>
            <th style="width:15%;">By</th>
            <th>Approved</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="text-align:center;">0</td>
            <td>${fmtDate(inp.projectDate)}</td>
            <td>Initial Issue for Permit Submission</td>
            <td>${escHtml(inp.designerName)}</td>
            <td>__________</td>
          </tr>
          <tr><td style="text-align:center;">1</td><td></td><td></td><td></td><td></td></tr>
          <tr><td style="text-align:center;">2</td><td></td><td></td><td></td><td></td></tr>
        </tbody>
      </table>
    </div>
  `;

  return wrapPage(content, inp.tb);
}

// ─── General Notes ────────────────────────────────────────────────────────────
const GENERAL_NOTES = [
  'All work shall comply with the latest adopted edition of the National Electrical Code (NEC), International Building Code (IBC), and all applicable local amendments.',
  'Contractor shall verify all dimensions and conditions at the job site prior to installation. Report any discrepancies to the engineer of record.',
  'All electrical work shall be performed by a licensed electrical contractor. All permits shall be obtained prior to commencement of work.',
  'Equipment shall be listed and labeled per UL standards. Substitutions require written approval from the engineer of record.',
  'All conductors shall be copper unless otherwise noted. Minimum conductor temperature rating: 90°C (THWN-2 or USE-2 for DC circuits).',
  'All conduit shall be Schedule 40 PVC or EMT unless otherwise noted. Conduit fill shall not exceed NEC Chapter 9 limits.',
  'Grounding and bonding shall comply with NEC Article 250 and NEC 690.47. All metallic racking components shall be bonded.',
  'Rapid shutdown system shall comply with NEC 690.12. Initiation device shall be located at the utility meter or service entrance as required by AHJ.',
  'Roof penetrations shall be flashed and sealed per mounting manufacturer requirements and local building code.',
  'Structural attachments shall be made to rafters/structural members only. Minimum lag bolt embedment: 2.5" into rafter. Pre-drill pilot holes.',
  'This plan set was generated by SolarPro Engineering Engine. A licensed professional engineer stamp is required for permit submission as required by the AHJ.',
];