// ============================================================
// lib/plan-set/cover-sheet.ts
// Plan Set Sheet G-1: Cover Sheet (v44.0)
// Includes: project summary, system summary with DC/AC ratio,
// array configuration, contractor info with license numbers,
// AHJ & codes, scope of work, general notes, sheet index,
// revision block table.
// ============================================================

import { wrapPage, escHtml, fmtDate, type TitleBlockData } from './title-block';

export interface CoverSheetInput {
  tb: TitleBlockData;

  // Project
  projectName:          string;
  clientName:           string;
  ownerContact?:        string;   // v44.0: owner phone / email
  siteAddress:          string;
  city:                 string;
  state:                string;
  zip:                  string;
  county:               string;
  parcelNumber?:        string;
  projectDate:          string;

  // System
  systemKw:             number;   // DC kW
  inverterKw?:          number;   // AC kW (for DC/AC ratio)
  panelCount:           number;
  panelModel:           string;
  panelWatts:           number;
  inverterType:         string;
  inverterModel:        string;
  mountType:            string;
  roofType?:            string;
  batteryModel?:        string;
  batteryKwh?:          number;
  annualKwh?:           number;

  // Array configuration (v44.0)
  stringCount?:         number;   // number of strings
  panelsPerString?:     number;   // panels per string
  interconnectionMethod?: string; // 'load-side' | 'supply-side'

  // AHJ
  ahj:                  string;
  ahjPhone?:            string;
  ahjWebsite?:          string;
  utilityName:          string;
  utilityPhone?:        string;
  necVersion:           string;
  ibcVersion?:          string;
  asceVersion?:         string;
  windSpeedMph?:        number;
  groundSnowPsf?:       number;
  seismicCategory?:     string;
  fireZone?:            string;
  rapidShutdownReq:     boolean;

  // Contractor
  contractorName:       string;
  contractorLicense?:   string;
  electricalLicense?:   string;   // v44.0: electrical contractor license
  contractorPhone?:     string;
  contractorEmail?:     string;
  designerName:         string;

  // Sheet index (v44.0)
  sheets?: Array<{ number: string; title: string; description: string }>;
}

export function buildCoverSheet(inp: CoverSheetInput): string {
  // Compute DC/AC ratio
  const dcAcRatio = inp.inverterKw && inp.inverterKw > 0
    ? (inp.systemKw / inp.inverterKw).toFixed(2)
    : null;

  // Array configuration string
  const arrayConfig = inp.stringCount && inp.panelsPerString
    ? `${inp.stringCount} string${inp.stringCount > 1 ? 's' : ''} × ${inp.panelsPerString} panels`
    : inp.panelCount
    ? `${inp.panelCount} panels total`
    : 'See Sheet E-1';

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
          <tr><td style="width:38%;color:#555;">Client / Owner</td><td><strong>${escHtml(inp.clientName)}</strong></td></tr>
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
          <tr><td style="width:42%;color:#555;">System Size (DC)</td><td><strong>${inp.systemKw.toFixed(3)} kW<sub>DC</sub></strong></td></tr>
          ${inp.inverterKw ? `<tr><td style="color:#555;">Inverter Rating (AC)</td><td><strong>${inp.inverterKw.toFixed(3)} kW<sub>AC</sub></strong></td></tr>` : ''}
          ${dcAcRatio ? `<tr><td style="color:#555;">DC/AC Ratio</td><td><strong>${dcAcRatio}</strong></td></tr>` : ''}
          <tr><td style="color:#555;">Total Modules</td><td>${inp.panelCount} modules</td></tr>
          <tr><td style="color:#555;">Module Wattage</td><td>${inp.panelWatts}W STC</td></tr>
          <tr><td style="color:#555;">Module Model</td><td>${escHtml(inp.panelModel)}</td></tr>
          <tr><td style="color:#555;">Array Configuration</td><td>${escHtml(arrayConfig)}</td></tr>
          <tr><td style="color:#555;">Inverter Type</td><td>${escHtml(inp.inverterType)}</td></tr>
          <tr><td style="color:#555;">Inverter Model</td><td>${escHtml(inp.inverterModel)}</td></tr>
          ${inp.interconnectionMethod ? `<tr><td style="color:#555;">Interconnection</td><td>${escHtml(inp.interconnectionMethod)}</td></tr>` : ''}
          <tr><td style="color:#555;">Mounting System</td><td>${escHtml(inp.mountType)}</td></tr>
          ${inp.roofType ? `<tr><td style="color:#555;">Roof Type</td><td>${escHtml(inp.roofType)}</td></tr>` : ''}
          ${inp.batteryModel ? `<tr><td style="color:#555;">Battery Storage</td><td>${escHtml(inp.batteryModel)} (${inp.batteryKwh?.toFixed(1)} kWh)</td></tr>` : ''}
          ${inp.annualKwh ? `<tr><td style="color:#555;">Est. Annual Production</td><td>${inp.annualKwh.toLocaleString()} kWh/yr</td></tr>` : ''}
        </table>

        <!-- Contractor / Designer -->
        <div class="section-header" style="margin-top:8px;">Contractor / Designer</div>
        <table>
          <tr><td style="width:42%;color:#555;">Contractor</td><td>${escHtml(inp.contractorName)}</td></tr>
          <tr>
            <td style="color:#555;">Contractor Lic #</td>
            <td>${inp.contractorLicense ? escHtml(inp.contractorLicense) : '<span style="color:#aaa;">________________</span>'}</td>
          </tr>
          <tr>
            <td style="color:#555;">Electrical Lic #</td>
            <td>${inp.electricalLicense ? escHtml(inp.electricalLicense) : '<span style="color:#aaa;">________________</span>'}</td>
          </tr>
          ${inp.contractorPhone ? `<tr><td style="color:#555;">Phone</td><td>${escHtml(inp.contractorPhone)}</td></tr>` : ''}
          ${inp.contractorEmail ? `<tr><td style="color:#555;">Email</td><td>${escHtml(inp.contractorEmail)}</td></tr>` : ''}
          <tr><td style="color:#555;">Designer / Engineer</td><td>${escHtml(inp.designerName)}</td></tr>
          <tr><td style="color:#555;">Prepared By</td><td>SolarPro Engineering Engine v44.0</td></tr>
        </table>

        <!-- Revision Block -->
        <div class="section-header" style="margin-top:8px;">Revision History</div>
        <table>
          <thead>
            <tr>
              <th style="width:10%;">Rev</th>
              <th style="width:22%;">Date</th>
              <th style="width:40%;">Description</th>
              <th style="width:14%;">By</th>
              <th>Approved</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="text-align:center;"><strong>0</strong></td>
              <td>${fmtDate(inp.projectDate)}</td>
              <td>Initial Issue for Permit Submission</td>
              <td>SolarPro</td>
              <td>___________</td>
            </tr>
            <tr>
              <td style="text-align:center; color:#aaa;">1</td>
              <td style="color:#aaa;">___________</td>
              <td style="color:#aaa;"></td>
              <td style="color:#aaa;"></td>
              <td style="color:#aaa;">___________</td>
            </tr>
            <tr>
              <td style="text-align:center; color:#aaa;">2</td>
              <td style="color:#aaa;">___________</td>
              <td style="color:#aaa;"></td>
              <td style="color:#aaa;"></td>
              <td style="color:#aaa;">___________</td>
            </tr>
          </tbody>
        </table>

      </div>

      <!-- RIGHT COLUMN -->
      <div>

        <!-- AHJ & Codes -->
        <div class="section-header">Authority Having Jurisdiction &amp; Applicable Codes</div>
        <table>
          <tr><td style="width:42%;color:#555;">AHJ</td><td><strong>${escHtml(inp.ahj)}</strong></td></tr>
          ${inp.ahjPhone ? `<tr><td style="color:#555;">AHJ Phone</td><td>${escHtml(inp.ahjPhone)}</td></tr>` : ''}
          ${inp.ahjWebsite ? `<tr><td style="color:#555;">AHJ Website</td><td>${escHtml(inp.ahjWebsite)}</td></tr>` : ''}
          <tr><td style="color:#555;">Utility</td><td>${escHtml(inp.utilityName)}</td></tr>
          ${inp.utilityPhone ? `<tr><td style="color:#555;">Utility Phone</td><td>${escHtml(inp.utilityPhone)}</td></tr>` : ''}
          <tr><td style="color:#555;">Electrical Code</td><td><strong>${escHtml(inp.necVersion)}</strong></td></tr>
          ${inp.ibcVersion ? `<tr><td style="color:#555;">Building Code</td><td>${escHtml(inp.ibcVersion)}</td></tr>` : ''}
          ${inp.asceVersion ? `<tr><td style="color:#555;">Structural Standard</td><td>${escHtml(inp.asceVersion)}</td></tr>` : ''}
          ${inp.windSpeedMph ? `<tr><td style="color:#555;">Design Wind Speed</td><td>${inp.windSpeedMph} mph (3-sec gust, ASCE 7-22)</td></tr>` : ''}
          ${inp.groundSnowPsf !== undefined ? `<tr><td style="color:#555;">Ground Snow Load</td><td>${inp.groundSnowPsf} psf (Pg, ASCE 7-22)</td></tr>` : ''}
          ${inp.seismicCategory ? `<tr><td style="color:#555;">Seismic Design Cat.</td><td>${escHtml(inp.seismicCategory)}</td></tr>` : ''}
          ${inp.fireZone ? `<tr><td style="color:#555;">Fire Zone</td><td>${escHtml(inp.fireZone)}</td></tr>` : ''}
          <tr><td style="color:#555;">Rapid Shutdown</td><td>${inp.rapidShutdownReq ? '✓ Required — NEC 690.12' : 'Not Required'}</td></tr>
        </table>

        <!-- Scope of Work -->
        <div class="section-header" style="margin-top:8px;">Scope of Work</div>
        <div style="font-size:7pt; line-height:1.6; padding:4px 6px; background:#f7f8fc; border:0.5px solid #ccd; border-radius:2px;">
          Install a grid-tied photovoltaic (PV) solar energy system consisting of
          <strong>${inp.panelCount} × ${inp.panelWatts}W solar modules</strong>
          (${inp.systemKw.toFixed(3)} kW<sub>DC</sub>)
          ${inp.inverterKw ? `/ ${inp.inverterKw.toFixed(3)} kW<sub>AC</sub>` : ''}
          ${inp.stringCount && inp.panelsPerString ? `configured as ${inp.stringCount} string${inp.stringCount > 1 ? 's' : ''} of ${inp.panelsPerString} modules each,` : ','}
          with <strong>${escHtml(inp.inverterType)} inverter(s)</strong>
          (${escHtml(inp.inverterModel)}) on a
          <strong>${escHtml(inp.mountType)}</strong> mounting system.
          ${inp.batteryModel ? `Battery energy storage system (${escHtml(inp.batteryModel)}, ${inp.batteryKwh?.toFixed(1)} kWh) included.` : ''}
          Interconnection: <strong>${inp.interconnectionMethod ? escHtml(inp.interconnectionMethod) : inp.rapidShutdownReq ? 'Load-side' : 'See Sheet E-1'}</strong>.
          System shall be installed per ${escHtml(inp.necVersion)},
          ${inp.ibcVersion ? `${escHtml(inp.ibcVersion)},` : ''}
          ASCE 7-22, and all applicable local codes and AHJ requirements.
          ${inp.rapidShutdownReq ? 'Rapid shutdown system required per NEC 690.12.' : ''}
        </div>

        <!-- General Notes -->
        <div class="section-header" style="margin-top:8px;">General Notes</div>
        <div style="font-size:6.5pt; line-height:1.6; padding:4px 6px;">
          ${GENERAL_NOTES.map((n, i) => `<div style="margin-bottom:2px;"><strong>${i+1}.</strong> ${n}</div>`).join('')}
        </div>

        <!-- Sheet Index -->
        <div class="section-header" style="margin-top:8px;">Sheet Index</div>
        <table>
          <thead>
            <tr>
              <th style="width:15%;">Sheet</th>
              <th style="width:35%;">Title</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr><td><strong>G-1</strong></td><td>Cover Sheet</td><td>Project info, system summary, AHJ, sheet index</td></tr>
            <tr><td><strong>E-1</strong></td><td>Electrical — SLD</td><td>Single-line diagram, wire schedule, NEC calcs, rapid shutdown</td></tr>
            <tr><td><strong>E-2</strong></td><td>Equipment Schedule</td><td>Bill of materials, equipment specifications, UL listings</td></tr>
            <tr><td><strong>S-1</strong></td><td>Structural</td><td>ASCE 7-22 load analysis, attachment schedule, fire setbacks</td></tr>
            <tr><td><strong>A-1</strong></td><td>Site / Roof Layout</td><td>Roof outline, panel placement, fire setback diagram, north arrow</td></tr>
            <tr><td><strong>M-1</strong></td><td>Mounting Details</td><td>Rail profile, flashing, lag bolt, bonding, grounding details</td></tr>
            <tr><td><strong>C-1</strong></td><td>Compliance Checklist</td><td>NEC 690/705, structural, fire access — code compliance verification</td></tr>
          </tbody>
        </table>

      </div>
    </div>
  `;

  return wrapPage(content, inp.tb);
}

// ─── General Notes ────────────────────────────────────────────────────────────
const GENERAL_NOTES = [
  'All work shall comply with the latest adopted edition of the National Electrical Code (NEC), International Building Code (IBC), ASCE 7-22, and all applicable local amendments.',
  'Contractor shall verify all dimensions and field conditions prior to installation. Report any discrepancies to the engineer of record before proceeding.',
  'All electrical work shall be performed by a licensed electrical contractor holding a valid electrical contractor license in the jurisdiction. All permits shall be obtained prior to commencement of work.',
  'All equipment shall be listed and labeled per applicable UL standards. Substitutions require written approval from the engineer of record prior to installation.',
  'All conductors shall be copper (CU) unless otherwise noted. Minimum conductor temperature rating: 90°C (USE-2 or THWN-2).',
  'All conduit shall be Schedule 40 PVC or EMT unless otherwise noted. Conduit fill shall not exceed 40% per NEC Chapter 9, Table 1.',
  'Grounding and bonding shall comply with NEC Article 250 and NEC 690.43/690.47. All mounting hardware shall be bonded to equipment grounding conductor.',
  'Rapid shutdown system shall comply with NEC 690.12. Initiation device shall be located at the utility meter or as required by AHJ. Label: "PV SYSTEM EQUIPPED WITH RAPID SHUTDOWN".',
  'All roof penetrations shall be flashed and sealed per manufacturer requirements and local building code. No penetrations in valley flashings.',
  'Structural attachments shall be made to rafters/structural members only. Attachment spacing per structural calculations on Sheet S-1.',
  'This plan set was generated by SolarPro Engineering Engine v44.0. A licensed professional engineer stamp is required for permit submission where required by the AHJ.',
];