// Permit HTML generator - standalone
import { existsSync } from 'fs';
const execAsync = async () => {}; // stub - not needed for HTML generation
const dynamic = 'force-dynamic';
function statusColor(s) {
  if (s === "PASS" || s === "pass") return "#10b981";
  if (s === "WARNING" || s === "warning") return "#f59e0b";
  if (s === "FAIL" || s === "error" || s === "fail") return "#ef4444";
  if (s === "info" || s === "INFO") return "#3b82f6";
  return "#64748b";
}
function statusBg(s) {
  if (s === "PASS" || s === "pass") return "#f0fdf4";
  if (s === "WARNING" || s === "warning") return "#fffbeb";
  if (s === "FAIL" || s === "error" || s === "fail") return "#fef2f2";
  if (s === "info" || s === "INFO") return "#eff6ff";
  return "#f8fafc";
}
function statusBorder(s) {
  if (s === "PASS" || s === "pass") return "#bbf7d0";
  if (s === "WARNING" || s === "warning") return "#fde68a";
  if (s === "FAIL" || s === "error" || s === "fail") return "#fecaca";
  if (s === "info" || s === "INFO") return "#bfdbfe";
  return "#e2e8f0";
}
function statusLabel(s) {
  if (s === "PASS" || s === "pass") return "\u2713 PASS";
  if (s === "WARNING" || s === "warning") return "\u26A0 WARNING";
  if (s === "FAIL" || s === "error" || s === "fail") return "\u2717 FAIL";
  if (s === "info" || s === "INFO") return "\u2139 INFO";
  return s?.toUpperCase() || "\u2014";
}
function roofTypeLabel(rt) {
  const m = {
    shingle: "Asphalt Shingle",
    tile: "Concrete/Clay Tile",
    metal_standing_seam: "Metal Standing Seam",
    metal_corrugated: "Metal Corrugated",
    flat_tpo: "Flat \u2014 TPO Membrane",
    flat_epdm: "Flat \u2014 EPDM Membrane",
    flat_gravel: "Flat \u2014 Gravel Ballast"
  };
  return rt ? m[rt] || rt : "Asphalt Shingle";
}
function interconnectionLabel(m) {
  const map = {
    LOAD_SIDE: "Load Side \u2014 NEC 705.12(B)",
    SUPPLY_SIDE_TAP: "Supply Side Tap \u2014 NEC 705.12(A)",
    MAIN_BREAKER_DERATE: "Main Breaker Derate \u2014 NEC 705.12(B)(3)",
    PANEL_UPGRADE: "Panel Upgrade Required"
  };
  return m ? map[m] || m : "Load Side \u2014 NEC 705.12(B)";
}
function titleBlock(input, sheetId, pageTitle, pageNum, totalPages) {
  const { project, compliance } = input;
  const necVer = compliance.jurisdiction?.necVersion || "2020";
  const state = compliance.jurisdiction?.state || "\u2014";
  const ahj = compliance.jurisdiction?.ahj || "\u2014";
  return `
  <div class="title-block">
    <div class="tb-left">
      <div class="tb-company">SolarPro Engineering</div>
      <div class="tb-project">${project.projectName || "Solar PV System"}</div>
      <div class="tb-address">${project.address || "\u2014"}</div>
      <div class="tb-client">Client: ${project.clientName || "\u2014"}</div>
    </div>
    <div class="tb-center">
      <div class="tb-sheet-id">${sheetId}</div>
      <div class="tb-sheet-title">${pageTitle}</div>
      <div class="tb-codes">NEC ${necVer} \xB7 ${state} \xB7 AHJ: ${ahj}</div>
    </div>
    <div class="tb-right">
      <table class="tb-table">
        <tr><td class="tbl">Designer</td><td class="tbv">${project.designer || "\u2014"}</td></tr>
        <tr><td class="tbl">Date</td><td class="tbv">${project.date}</td></tr>
        <tr><td class="tbl">Sheet</td><td class="tbv">${pageNum} of ${totalPages}</td></tr>
        <tr><td class="tbl">Rev</td><td class="tbv">A</td></tr>
        <tr><td class="tbl">Scale</td><td class="tbv">NTS</td></tr>
      </table>
    </div>
  </div>`;
}
function buildConstructionNotes(input) {
  const { project, compliance } = input;
  const necVer = compliance.jurisdiction?.necVersion || "2020";
  const notes = [
    `All work shall conform to NEC ${necVer}, applicable state amendments, and AHJ requirements. All equipment shall be listed and labeled per NEC 110.3.`,
    `Solar PV wiring shall comply with NEC Article 690. DC wiring methods shall be per NEC 690.31. AC wiring shall be per NEC Chapters 1\u20134.`,
    `System shall comply with NEC 705.12 for interconnected power production sources. Interconnection method: ${interconnectionLabel(project.interconnectionMethod)}.`,
    project.rapidShutdown ? `Rapid shutdown system required per NEC 690.12. Module-level rapid shutdown (MLRS) shall reduce module voltage to \u2264 30V within 30 seconds of rapid shutdown initiation.` : `Rapid shutdown initiator shall be installed per NEC 690.12. Conductors inside the array boundary shall be de-energized within 30 seconds.`,
    `All conductors shall be sized per NEC 310.15. Temperature correction and conduit fill derating factors shall be applied. Minimum conductor size: ${project.wireGauge || "#10 AWG"}.`,
    `Conduit type: ${project.conduitType || "EMT"}. All conduit supports per NEC 358 (EMT) or NEC 352 (PVC). Conduit fill shall not exceed 40% per NEC Chapter 9, Table 1.`,
    `Equipment grounding conductor (EGC) shall be sized per NEC 250.122. All metallic racking shall be bonded per NEC 690.43.`,
    `${project.acDisconnect ? "AC disconnect switch required" : "AC disconnect \u2014 see SLD for requirements"}. Disconnect shall be within sight of inverter and accessible per NEC 690.15.`,
    `Warning labels and placards shall be installed per NEC 690.54, 690.56, 705.12, IFC ${necVer === "2023" ? "2024" : "2021"}, and local amendments. See sheet PV-5 for label schedule.`,
    `Roof attachments shall be installed per manufacturer instructions and attachment detail on sheet PV-3. Lag bolts shall have minimum 2.5" embedment into rafter per structural analysis.`,
    `Installer shall verify utility interconnection requirements with ${project.utilityName || "utility"} prior to energization. Utility notification and interconnection agreement required before PTO.`,
    `All equipment shall be installed per manufacturer installation instructions. Field modifications to listed equipment are prohibited.`
  ];
  if (project.batteryCount && project.batteryCount > 0) {
    notes.push(`Battery energy storage system (BESS) shall comply with NEC Article 706 and NFPA 855. Battery installation shall maintain required clearances per manufacturer instructions and AHJ requirements.`);
  }
  if (project.generatorKw && project.generatorKw > 0) {
    notes.push(`Generator interconnection shall comply with NEC Article 702 and NEC 705.12. Transfer switch (ATS) shall prevent parallel operation with utility unless system is utility-interactive rated.`);
  }
  return notes;
}
function pageCoverSheet(input, pageNum, totalPages) {
  const { project, system, compliance } = input;
  const necVer = compliance.jurisdiction?.necVersion || "2020";
  const state = compliance.jurisdiction?.state || "\u2014";
  const ahj = compliance.jurisdiction?.ahj || "\u2014";
  const overallStatus = input.rulesResult?.overallStatus || compliance.overallStatus || "PASS";
  const notes = buildConstructionNotes(input);
  const sheets = [
    { id: "PV-0", title: "Cover Sheet, System Summary & Construction Notes", sheet: "1" },
    { id: "PV-1", title: "Site Information & Interconnection Details", sheet: "2" },
    { id: "PV-2", title: "Schematic Roof Plan with Fire Setbacks", sheet: "3" },
    { id: "PV-3", title: "Attachment Detail & Bill of Materials", sheet: "4" },
    { id: "PV-4A", title: "NEC Compliance Sheet", sheet: "5" },
    { id: "PV-4B", title: "Conductor & Conduit Schedule", sheet: "6" },
    { id: "PV-4C", title: "Structural Calculation Sheet", sheet: "7" },
    { id: "PV-5", title: "Warning Labels & Required Placards", sheet: "8" },
    { id: "SCHED", title: "Equipment Schedule", sheet: "9" },
    { id: "CERT", title: "Engineer Certification Block", sheet: "10" },
    { id: "E-1", title: "Single-Line Electrical Diagram (SLD)", sheet: "11" }
  ];
  return `
  <div class="page">
    ${titleBlock(input, "PV-0", "COVER SHEET & SYSTEM SUMMARY", pageNum, totalPages)}
    <div class="page-content">

      <!-- Status Badge + Title -->
      <div class="cover-header">
        <div class="cover-badge" style="background:${statusBg(overallStatus)};border:2px solid ${statusBorder(overallStatus)};color:${statusColor(overallStatus)}">
          ${statusLabel(overallStatus)}
        </div>
        <div class="cover-title">SOLAR PHOTOVOLTAIC SYSTEM \u2014 PERMIT PACKAGE</div>
        <div class="cover-sub">Prepared for AHJ Submission \xB7 ${state} \xB7 NEC ${necVer} \xB7 AHJ: ${ahj}</div>
      </div>

      <div class="two-col-layout">
        <div class="col-left">
          <!-- System Summary -->
          <div class="section-title">System Summary</div>
          <div class="summary-grid-6">
            <div class="summary-card"><div class="sum-val">${system.totalDcKw?.toFixed(2) || "\u2014"} kW</div><div class="sum-lbl">DC Size</div></div>
            <div class="summary-card"><div class="sum-val">${system.totalAcKw?.toFixed(2) || "\u2014"} kW</div><div class="sum-lbl">AC Capacity</div></div>
            <div class="summary-card"><div class="sum-val">${system.totalPanels || "\u2014"}</div><div class="sum-lbl">Modules</div></div>
            <div class="summary-card"><div class="sum-val">${system.dcAcRatio?.toFixed(2) || "\u2014"}</div><div class="sum-lbl">DC/AC Ratio</div></div>
            <div class="summary-card"><div class="sum-val">${project.mainPanelAmps}A</div><div class="sum-lbl">Service</div></div>
            <div class="summary-card"><div class="sum-val">${system.topology || "MICRO"}</div><div class="sum-lbl">Topology</div></div>
          </div>

          <!-- Project Information -->
          <div class="section-title" style="margin-top:14px">Project Information</div>
          <table class="info-table">
            <tr><td class="il">Project Name</td><td class="iv">${project.projectName || "\u2014"}</td><td class="il">Client Name</td><td class="iv">${project.clientName || "\u2014"}</td></tr>
            <tr><td class="il">Address</td><td class="iv" colspan="3">${project.address || "\u2014"}</td></tr>
            <tr><td class="il">Designer / EOR</td><td class="iv">${project.designer || "\u2014"}</td><td class="il">Design Date</td><td class="iv">${project.date}</td></tr>
            <tr><td class="il">Jurisdiction</td><td class="iv">${state}</td><td class="il">AHJ</td><td class="iv">${ahj}</td></tr>
            <tr><td class="il">Utility</td><td class="iv">${project.utilityName || project.utilityMeter || "\u2014"}</td><td class="il">System Type</td><td class="iv">${project.systemType?.toUpperCase() || "ROOF-MOUNTED"}</td></tr>
          </table>

          <!-- Applicable Codes -->
          <div class="section-title" style="margin-top:14px">Applicable Codes & Standards</div>
          <table class="info-table">
            <tr><td class="il">Electrical</td><td class="iv">National Electrical Code (NEC) ${necVer} \u2014 Articles 690, 705, 706</td></tr>
            <tr><td class="il">Structural</td><td class="iv">ASCE 7-22 \u2014 Minimum Design Loads for Buildings and Other Structures</td></tr>
            <tr><td class="il">Building</td><td class="iv">International Building Code (IBC) / International Residential Code (IRC)</td></tr>
            <tr><td class="il">Fire</td><td class="iv">International Fire Code (IFC) ${necVer === "2023" ? "2024" : "2021"} \u2014 Chapter 6 \xA7605</td></tr>
            <tr><td class="il">Battery</td><td class="iv">${project.batteryCount && project.batteryCount > 0 ? "NFPA 855 \u2014 Installation of Stationary Energy Storage Systems" : "N/A \u2014 No Battery Storage"}</td></tr>
            <tr><td class="il">State Amendments</td><td class="iv">${state} state electrical code amendments as adopted</td></tr>
          </table>

          <!-- Battery (if present) -->
          ${project.batteryCount && project.batteryCount > 0 ? `
          <div class="section-title" style="margin-top:14px">Energy Storage System</div>
          <table class="info-table">
            <tr><td class="il">Battery</td><td class="iv">${project.batteryBrand || "\u2014"} ${project.batteryModel || "\u2014"}</td><td class="il">Units</td><td class="iv">${project.batteryCount}</td></tr>
            <tr><td class="il">Total Storage</td><td class="iv">${((project.batteryCount || 0) * (project.batteryKwh || 0)).toFixed(1)} kWh</td><td class="il">Backfeed Breaker</td><td class="iv">${project.batteryBackfeedA || "\u2014"}A</td></tr>
          </table>` : ""}
        </div>

        <div class="col-right">
          <!-- Sheet Index -->
          <div class="section-title">Sheet Index</div>
          <table class="sheet-index-table">
            <thead><tr><th>Sheet</th><th>Title</th></tr></thead>
            <tbody>
              ${sheets.map((s) => `<tr><td class="si-id">${s.id}</td><td>${s.title}</td></tr>`).join("")}
            </tbody>
          </table>

          <!-- Construction Notes -->
          <div class="section-title" style="margin-top:14px">Construction Notes</div>
          <ol class="construction-notes">
            ${notes.map((n) => `<li>${n}</li>`).join("")}
          </ol>
        </div>
      </div>

    </div>
  </div>`;
}
function pageSiteInformation(input, pageNum, totalPages) {
  const { project, compliance } = input;
  const ahj = compliance.jurisdiction?.ahj || "\u2014";
  const necVer = compliance.jurisdiction?.necVersion || "2020";
  return `
  <div class="page">
    ${titleBlock(input, "PV-1", "SITE INFORMATION & INTERCONNECTION DETAILS", pageNum, totalPages)}
    <div class="page-content">

      <div class="two-col-layout">
        <div class="col-left">
          <div class="section-title">Site & Project Information</div>
          <table class="info-table">
            <tr><td class="il">Installation Address</td><td class="iv" colspan="3">${project.address || "\u2014"}</td></tr>
            <tr><td class="il">AHJ</td><td class="iv">${ahj}</td><td class="il">Utility</td><td class="iv">${project.utilityName || project.utilityMeter || "\u2014"}</td></tr>
            <tr><td class="il">Utility Meter #</td><td class="iv">${project.utilityMeter || "\u2014"}</td><td class="il">System Type</td><td class="iv">${project.systemType?.toUpperCase() || "ROOF-MOUNTED"}</td></tr>
            <tr><td class="il">Roof Type</td><td class="iv">${roofTypeLabel(project.roofType)}</td><td class="il">Roof Pitch</td><td class="iv">${project.roofPitch ? `${project.roofPitch}\xB0 (${Math.round(Math.tan(project.roofPitch * Math.PI / 180) * 12)}/12)` : "\u2014"}</td></tr>
            <tr><td class="il">Mounting System</td><td class="iv" colspan="3">${project.mountingSystem || "\u2014"}</td></tr>
          </table>

          <div class="section-title" style="margin-top:14px">Service & Interconnection</div>
          <table class="info-table">
            <tr><td class="il">Existing Service</td><td class="iv">${project.mainPanelAmps}A, ${project.mainPanelBrand || "\u2014"} Panel</td><td class="il">Bus Bar Rating</td><td class="iv">${project.panelBusRating || project.mainPanelAmps}A</td></tr>
            <tr><td class="il">Interconnection Method</td><td class="iv" colspan="3">${interconnectionLabel(project.interconnectionMethod)}</td></tr>
            <tr><td class="il">Backfeed Breaker</td><td class="iv">${project.batteryBackfeedA ? `${project.batteryBackfeedA}A (PV + Battery)` : "\u2014"}</td><td class="il">120% Rule Check</td><td class="iv">${project.mainPanelAmps ? `${project.mainPanelAmps} \xD7 120% = ${Math.round(project.mainPanelAmps * 1.2)}A max bus load` : "\u2014"}</td></tr>
            <tr><td class="il">AC Disconnect</td><td class="iv">${project.acDisconnect ? "\u2713 Required \u2014 NEC 690.15" : "\u2014 Not Required"}</td><td class="il">DC Disconnect</td><td class="iv">${project.dcDisconnect ? "\u2713 Required \u2014 NEC 690.15" : "\u2014 Not Required"}</td></tr>
            <tr><td class="il">Rapid Shutdown</td><td class="iv">${project.rapidShutdown ? "\u2713 MLRS \u2014 NEC 690.12 Compliant" : "\u2014 Check AHJ requirement"}</td><td class="il">Production Meter</td><td class="iv">${project.productionMeter ? "\u2713 Installed" : "\u2014 Not Required"}</td></tr>
            <tr><td class="il">Conduit Type</td><td class="iv">${project.conduitType || "\u2014"}</td><td class="il">AC Wire Gauge</td><td class="iv">${project.wireGauge || "\u2014"}</td></tr>
          </table>

          <div class="section-title" style="margin-top:14px">Equipment Locations (Field Verify)</div>
          <table class="info-table">
            <tr><td class="il">Utility Meter</td><td class="iv">Per site survey \u2014 see aerial map</td></tr>
            <tr><td class="il">Main Service Panel</td><td class="iv">Per site survey \u2014 field locate</td></tr>
            <tr><td class="il">Inverter / Combiner</td><td class="iv">Garage or exterior wall \u2014 see roof plan</td></tr>
            <tr><td class="il">AC Disconnect</td><td class="iv">Adjacent to inverter, within sight</td></tr>
            ${project.batteryCount && project.batteryCount > 0 ? `<tr><td class="il">Battery Storage</td><td class="iv">Interior garage or approved exterior location per NFPA 855</td></tr>` : ""}
          </table>

          ${compliance.jurisdiction?.permitNotes ? `
          <div class="section-title" style="margin-top:14px">AHJ-Specific Requirements</div>
          <div class="notes-box">${compliance.jurisdiction.permitNotes}</div>` : ""}
          ${project.ahjName ? `
          <div class="section-title" style="margin-top:14px">AHJ Contact Information</div>
          <table class="info-table">
            <tr><td class="il">AHJ Name</td><td class="iv">${project.ahjName}</td></tr>
            ${project.ahjAddress ? `<tr><td class="il">Address</td><td class="iv">${project.ahjAddress}</td></tr>` : ""}
            ${project.ahjPhone ? `<tr><td class="il">Phone</td><td class="iv">${project.ahjPhone}</td></tr>` : ""}
            <tr><td class="il">Utility</td><td class="iv">${project.utilityName || "\u2014"} \u2014 Interconnection application required prior to PTO</td></tr>
          </table>` : ""}
        </div>

        <div class="col-right">
          <!-- Vicinity / Site Map Placeholder -->
          <div class="section-title">Vicinity Map (Field Complete)</div>
          <div class="map-placeholder">
            <div class="map-inner">
              <div class="map-icon">\u{1F5FA}</div>
              <div class="map-title">SITE LOCATION MAP</div>
              <div class="map-addr">${project.address || "\u2014"}</div>
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
            <tr><td class="il">Rafter Size</td><td class="iv">${project.rafterSize || "\u2014"}</td></tr>
            <tr><td class="il">Rafter Spacing</td><td class="iv">${project.rafterSpacing ? `${project.rafterSpacing}" O.C.` : "\u2014"}</td></tr>
            <tr><td class="il">Attachment Spacing</td><td class="iv">${project.attachmentSpacing ? `${project.attachmentSpacing}" max` : "\u2014"}</td></tr>
            <tr><td class="il">Lag Bolt Spec</td><td class="iv">5/16" \xD7 3" SS \u2014 2.5" min embedment in rafter</td></tr>
            <tr><td class="il">Roof Material</td><td class="iv">${project.roofMaterial || roofTypeLabel(project.roofType)}</td></tr>
            <tr><td class="il">Roof Azimuth</td><td class="iv">${project.roofAzimuth !== undefined ? project.roofAzimuth + "\xB0 (True South = 180\xB0)" : "\u2014 Field verify"}</td></tr>
            <tr><td class="il">Approx. Dimensions</td><td class="iv">${project.roofDimWidth ? project.roofDimWidth + "ft W \xD7 " + project.roofDimLength + "ft L (field verify)" : "Field verify with aerial measurement"}</td></tr>
          </table>

          <div class="section-title" style="margin-top:14px">NEC Rapid Shutdown Boundary</div>
          <div class="rapid-shutdown-box">
            <div class="rs-title">\u26A1 RAPID SHUTDOWN BOUNDARY</div>
            <div class="rs-body">
              <strong>Inside Array Boundary (Roof):</strong> Module-level rapid shutdown devices (MLRSD) installed per NEC 690.12(B)(2). Array voltage reduced to \u2264 30V within 30 seconds.
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
function pageRoofPlan(input, pageNum, totalPages) {
  const { project, system } = input;
  const pitch = project.roofPitch || 18;
  const totalPanels = system.totalPanels || 0;
  const svgW = 520;
  const svgH = 380;
  const roofX = 60, roofY = 40, roofW = 400, roofH = 280;
  const setback = 22;
  const arrayX = roofX + setback;
  const arrayY = roofY + setback;
  const arrayW = roofW - setback * 2;
  const arrayH = roofH - setback * 2 - 30;
  const modulesPerRow = Math.ceil(Math.sqrt(totalPanels * 1.7));
  const rows = Math.ceil(totalPanels / modulesPerRow);
  const modW = Math.floor((arrayW - 10) / modulesPerRow) - 3;
  const modH = Math.floor((arrayH - 10) / rows) - 3;
  let modules = "";
  let count = 0;
  for (let r = 0; r < rows && count < totalPanels; r++) {
    for (let c = 0; c < modulesPerRow && count < totalPanels; c++) {
      const mx = arrayX + 5 + c * (modW + 3);
      const my = arrayY + 5 + r * (modH + 3);
      modules += `<rect x="${mx}" y="${my}" width="${modW}" height="${modH}" fill="#1e40af" stroke="#93c5fd" stroke-width="0.5" rx="1"/>`;
      count++;
    }
  }
  let attachments = "";
  const attSpacing = project.attachmentSpacing || 48;
  const attPixels = attSpacing * (arrayW / 240);
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

    <!-- Setback dimension arrows \u2014 left -->
    <line x1="${roofX + 2}" y1="${roofY + roofH / 2}" x2="${roofX + setback - 2}" y2="${roofY + roofH / 2}" stroke="#f59e0b" stroke-width="1" marker-end="url(#arrow)"/>
    <text x="${roofX + setback / 2}" y="${roofY + roofH / 2 - 4}" text-anchor="middle" font-size="7" fill="#d97706" font-weight="bold">18"</text>

    <!-- Setback dimension arrows \u2014 bottom -->
    <line x1="${roofX + roofW / 2}" y1="${roofY + roofH - 5}" x2="${roofX + roofW / 2}" y2="${arrayY + arrayH + 3}" stroke="#f59e0b" stroke-width="1"/>
    <text x="${roofX + roofW / 2 + 25}" y="${roofY + roofH - 10}" font-size="7" fill="#d97706" font-weight="bold">18" min</text>

    <!-- Pitch annotation -->
    <text x="${roofX + roofW - 5}" y="${roofY + 12}" text-anchor="end" font-size="8" fill="#374151" font-weight="bold">
      PITCH: ${Math.round(Math.tan(pitch * Math.PI / 180) * 12)}/12 (${pitch}\xB0)
    </text>

    <!-- Panel count -->
    <text x="${arrayX + arrayW / 2}" y="${arrayY + arrayH + 14}" text-anchor="middle" font-size="8" fill="#1e40af" font-weight="bold">
      ${totalPanels} MODULES \u2014 ${system.totalDcKw?.toFixed(2) || "\u2014"} kW DC
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
      SCHEMATIC ONLY \u2014 NOT TO SCALE. Field verify all dimensions. Attachment spacing per structural analysis.
    </text>
  </svg>`;
  return `
  <div class="page">
    ${titleBlock(input, "PV-2", "SCHEMATIC ROOF PLAN WITH FIRE SETBACKS", pageNum, totalPages)}
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
            <tr><td class="il">Roof Edge Setback</td><td class="iv" style="color:#d97706;font-weight:bold;">18" minimum \u2014 IFC \xA7605.11.1</td></tr>
            <tr><td class="il">Ridge Setback</td><td class="iv" style="color:#d97706;font-weight:bold;">18" minimum \u2014 IFC \xA7605.11.1</td></tr>
            <tr><td class="il">Hip/Valley</td><td class="iv">18" clear pathway required</td></tr>
            <tr><td class="il">Roof Access</td><td class="iv">Min. 3' clear pathways per IFC \xA7605.11.3</td></tr>
            <tr><td class="il">Ventilation Zones</td><td class="iv">Maintain per AHJ requirements</td></tr>
          </table>

          <div class="section-title" style="margin-top:14px">Array Configuration</div>
          <table class="info-table">
            <tr><td class="il">Total Modules</td><td class="iv">${totalPanels}</td></tr>
            <tr><td class="il">DC System Size</td><td class="iv">${system.totalDcKw?.toFixed(3) || "\u2014"} kW</td></tr>
            <tr><td class="il">Module Orientation</td><td class="iv">${project.rafterSize ? "Portrait" : "\u2014"} \u2014 Field verify</td></tr>
            <tr><td class="il">Roof Pitch</td><td class="iv">${project.roofPitch ? `${Math.round(Math.tan(project.roofPitch * Math.PI / 180) * 12)}/12 (${project.roofPitch}\xB0)` : "\u2014"}</td></tr>
            <tr><td class="il">Racking System</td><td class="iv">${project.mountingSystem || "\u2014"}</td></tr>
            <tr><td class="il">Attachment Spacing</td><td class="iv">${project.attachmentSpacing ? `${project.attachmentSpacing}" max O.C.` : '48" max O.C.'}</td></tr>
          </table>

          <div class="section-title" style="margin-top:14px">Roof Plan Notes</div>
          <ol class="construction-notes" style="font-size:9px;">
            <li>Schematic diagram only. Installer shall field verify all roof dimensions, structural member locations, and equipment placement prior to installation.</li>
            <li>Minimum 18" fire setback required from all roof edges, ridges, hips, and valleys per IFC \xA7605.11.1. Setbacks shall be measured from the module edge to the roof feature.</li>
            <li>Attachment points (\u25CB) to be located over rafters only. Verify rafter locations using approved method prior to drilling.</li>
            <li>All lag bolt penetrations shall be sealed with manufacturer-approved sealant. Flashing required for penetrations through roofing membrane.</li>
            <li>Module layout shown is schematic. Field adjust to maintain setbacks, avoid obstructions (vents, chimneys, skylights), and align with rafters.</li>
            <li>Roof structural elements (ridge beam, hip rafter, valley rafter) shall not be used as attachment points without structural engineering approval.</li>
          </ol>
        </div>
      </div>

    </div>
  </div>`;
}
function pageAttachmentBOM(input, pageNum, totalPages) {
  const { project, system, bom } = input;
  const mountingId = project.mountingSystemId || "";
  const roofType = project.roofType || "shingle";
  const isIronRidge = mountingId.includes("ironridge");
  const isRoofTech = mountingId.includes("rooftech");
  const isSnapNrack = mountingId.includes("snapnrack");
  const isSunModo = mountingId.includes("sunmodo");
  const isQuickMount = mountingId.includes("quickmount");
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
    ${roofType === "shingle" ? `
    <rect x="30" y="56" width="260" height="16" fill="#6b7280" stroke="#374151" stroke-width="1" rx="1"/>
    <text x="155" y="67" text-anchor="middle" font-size="7" fill="#f9fafb">ASPHALT SHINGLE ROOFING</text>` : roofType === "tile" ? `
    <rect x="30" y="56" width="260" height="16" fill="#b45309" stroke="#78350f" stroke-width="1" rx="1"/>
    <text x="155" y="67" text-anchor="middle" font-size="7" fill="#fff">CONCRETE/CLAY TILE</text>` : `
    <rect x="30" y="56" width="260" height="16" fill="#6b7280" stroke="#374151" stroke-width="1" rx="1"/>
    <text x="155" y="67" text-anchor="middle" font-size="7" fill="#f9fafb">${roofTypeLabel(roofType)}</text>`}

    <!-- LAG BOLT -->
    <rect x="148" y="40" width="8" height="78" fill="#94a3b8" stroke="#475569" stroke-width="1" rx="1"/>
    <polygon points="148,40 156,40 155,32 149,32" fill="#64748b" stroke="#475569" stroke-width="0.8"/>
    <!-- Bolt head -->
    <rect x="145" y="28" width="14" height="8" fill="#475569" stroke="#334155" stroke-width="1" rx="1"/>
    <text x="175" y="35" font-size="7" fill="#334155">5/16" \xD7 3" SS LAG BOLT</text>
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
    ${mountingId.includes("unirac") ? `
    <rect x="130" y="52" width="44" height="5" fill="#fbbf24" stroke="#d97706" stroke-width="1" rx="1"/>
    <text x="183" y="57" font-size="6.5" fill="#b45309" font-weight="bold">BUTYL PAD SEAL</text>
    <line x1="176" y1="55" x2="183" y2="55" stroke="#b45309" stroke-width="0.7"/>` : ""}

    <!-- EMBEDMENT DIMENSION -->
    <line x1="170" y1="90" x2="170" y2="118" stroke="#ef4444" stroke-width="1" stroke-dasharray="3,2"/>
    <line x1="165" y1="90" x2="175" y2="90" stroke="#ef4444" stroke-width="1"/>
    <line x1="165" y1="118" x2="175" y2="118" stroke="#ef4444" stroke-width="1"/>
    <text x="178" y="108" font-size="7" fill="#dc2626" font-weight="bold">MIN 2.5"</text>
    <text x="178" y="116" font-size="6.5" fill="#dc2626">EMBEDMENT</text>

    <!-- TORQUE NOTE -->
    <text x="10" y="155" font-size="7" fill="#374151" font-weight="bold">TORQUE: 15\u201320 ft-lbs</text>
    <text x="10" y="164" font-size="6.5" fill="#6b7280">Pre-drill pilot hole: 17/64" dia.</text>
    <text x="10" y="173" font-size="6.5" fill="#6b7280">Seal all penetrations with</text>
    <text x="10" y="182" font-size="6.5" fill="#6b7280">approved roofing sealant.</text>

    <text x="10" y="200" font-size="6" fill="#94a3b8" font-style="italic">CROSS-SECTION \u2014 NTS \u2014 FOR ILLUSTRATION PURPOSES</text>
  </svg>`;
  const panelItem = system.inverters?.[0]?.strings?.[0];
  const bomRows = [];
  const panelMfr = panelItem?.panelManufacturer || "\u2014";
  const panelModel = panelItem?.panelModel || "\u2014";
  bomRows.push(`<tr><td>PV Module</td><td>${panelMfr}</td><td>${panelModel}</td><td>\u2014</td><td style="text-align:right;font-weight:bold">${system.totalPanels}</td><td>EA</td><td>UL 61730</td></tr>`);
  system.inverters?.forEach((inv, i) => {
    const invType = inv.type === "micro" ? "Microinverter" : inv.type === "optimizer" ? "Optimizer" : "String Inverter";
    const invCount = inv.type === "micro" ? system.totalPanels : 1;
    bomRows.push(`<tr><td>${invType}</td><td>${inv.manufacturer || "\u2014"}</td><td>${inv.model || "\u2014"}</td><td>\u2014</td><td style="text-align:right;font-weight:bold">${invCount}</td><td>EA</td><td>${inv.ulListing || "UL 1741"}</td></tr>`);
  });
  if (project.batteryCount && project.batteryCount > 0) {
    bomRows.push(`<tr><td>Battery Storage</td><td>${project.batteryBrand || "\u2014"}</td><td>${project.batteryModel || "\u2014"}</td><td>\u2014</td><td style="text-align:right;font-weight:bold">${project.batteryCount}</td><td>EA</td><td>UL 9540</td></tr>`);
    bomRows.push(`<tr><td>System Controller</td><td>Enphase</td><td>IQ System Controller 3/3G (SC2000TRC240US01)</td><td>SC3-1p-na</td><td style="text-align:right;font-weight:bold">1</td><td>EA</td><td>UL 9540A</td></tr>`);
    bomRows.push(`<tr><td>AC Combiner</td><td>Enphase</td><td>IQ Combiner 5/5C (ENV-IQ-AM1-240)</td><td>ENV-IQ-AM1-240</td><td style="text-align:right;font-weight:bold">1</td><td>EA</td><td>UL 1741</td></tr>`);
  }
  if (bom && bom.length > 0) {
    bom.filter((i) => !["panels", "inverters"].includes(i.category)).forEach((item) => {
      bomRows.push(`<tr><td style="text-transform:capitalize">${item.category.replace(/_/g, " ")}</td><td>${item.manufacturer}</td><td>${item.model}</td><td style="font-family:monospace;font-size:9px">${item.partNumber || "\u2014"}</td><td style="text-align:right;font-weight:bold">${item.quantity}</td><td>${item.unit}</td><td>${item.ulListing || "\u2014"}</td></tr>`);
    });
  } else {
    bomRows.push(`<tr><td>Racking System</td><td>${project.mountingSystem?.split(" ")[0] || "Unirac"}</td><td>${project.mountingSystem || "NXT Umount"}</td><td>\u2014</td><td style="text-align:right">1</td><td>SYS</td><td>UL 2703</td></tr>`);
    bomRows.push(`<tr><td>Lag Bolt</td><td>Generic SS</td><td>5/16" \xD7 3" Stainless Steel</td><td>\u2014</td><td style="text-align:right">${Math.ceil(system.totalPanels * 1.5)}</td><td>EA</td><td>\u2014</td></tr>`);
    bomRows.push(`<tr><td>AC Conduit</td><td>\u2014</td><td>${project.conduitType || "EMT"} w/ THWN-2 conductors</td><td>\u2014</td><td style="text-align:right">${project.wireLength || 50}</td><td>FT</td><td>\u2014</td></tr>`);
    bomRows.push(`<tr><td>AC Disconnect</td><td>\u2014</td><td>${project.mainPanelAmps >= 200 ? "60A" : "30A"} Non-fusible AC Disconnect</td><td>\u2014</td><td style="text-align:right">1</td><td>EA</td><td>UL 98</td></tr>`);
  }
  return `
  <div class="page">
    ${titleBlock(input, "PV-3", "ATTACHMENT DETAIL & BILL OF MATERIALS", pageNum, totalPages)}
    <div class="page-content">

      <div class="two-col-layout">
        <div class="col-left">
          <div class="section-title">Attachment Cross-Section Detail</div>
          <div style="background:white;border:1px solid #e2e8f0;border-radius:6px;padding:12px;display:inline-block;">
            ${detailSVG}
          </div>

          <div class="section-title" style="margin-top:14px">Attachment Specifications</div>
          <table class="info-table">
            <tr><td class="il">Lag Bolt</td><td class="iv" style="font-weight:bold">5/16" \xD7 3" Stainless Steel</td></tr>
            <tr><td class="il">Min. Embedment</td><td class="iv" style="color:#dc2626;font-weight:bold">2.5" into rafter \u2014 required</td></tr>
            <tr><td class="il">Pilot Hole</td><td class="iv">17/64" diameter</td></tr>
            <tr><td class="il">Torque</td><td class="iv">15\u201320 ft-lbs</td></tr>
            <tr><td class="il">Penetration Seal</td><td class="iv">${mountingId.includes("unirac") ? "Pre-applied butyl pad (Stronghold Butyl)" : "Approved roofing sealant \u2014 field apply"}</td></tr>
            <tr><td class="il">Max Spacing</td><td class="iv">${project.attachmentSpacing ? `${project.attachmentSpacing}"` : '48"'} O.C. per structural analysis</td></tr>
            <tr><td class="il">Racking System</td><td class="iv">${project.mountingSystem || "\u2014"}</td></tr>
            <tr><td class="il">Listing</td><td class="iv">UL 2703 \u2014 Mounting Systems for PV Modules</td></tr>
          </table>

          <div class="attach-note">
            <strong>IMPORTANT:</strong> All lag bolts shall be installed into structural rafters only. 
            Minimum 1.5" structural member thickness required. 
            Verify rafter location by probing or stud finder before drilling. 
            Install per manufacturer installation instructions \u2014 field modifications prohibited.
          </div>
        </div>

        <div class="col-right">
          <div class="section-title">Bill of Materials</div>
          <table class="bom-table">
            <thead>
              <tr><th>Category</th><th>Manufacturer</th><th>Model / Description</th><th>Part #</th><th>Qty</th><th>Unit</th><th>Listing</th></tr>
            </thead>
            <tbody>
              ${bomRows.join("")}
            </tbody>
          </table>

          <div class="bom-note">
            All equipment shall be UL-listed or ETL-certified. Substitutions require engineer approval and AHJ re-submittal.
            Quantities are approximate \u2014 contractor to verify field quantities.
          </div>
        </div>
      </div>

    </div>
  </div>`;
}
function pageWarningLabels(input, pageNum, totalPages) {
  const { project, system, compliance } = input;
  const necVer = compliance.jurisdiction?.necVersion || "2020";
  const hasBattery = (project.batteryCount || 0) > 0;
  const hasGenerator = (project.generatorKw || 0) > 0;
  const panelIsc = system.inverters?.[0]?.strings?.[0]?.panelIsc || 0;
  const panelVoc = system.inverters?.[0]?.strings?.[0]?.panelVoc || 0;
  const topologyType = system.topology || "MICRO";
  const isMicro = topologyType.toLowerCase().includes("micro");
  const maxCircuitCurrent = (panelIsc * 1.25).toFixed(1);
  const maxSystemVoltage = isMicro ? "240V AC" : `${(panelVoc * 1.25).toFixed(0)}V DC`;
  const labels = [
    {
      id: "L-1",
      necRef: "NEC 690.54 / NEC 110.21(B)",
      placement: "On combiner box and at DC disconnect",
      text: `WARNING
SOLAR ELECTRIC SYSTEM CONNECTED
MAXIMUM SYSTEM VOLTAGE: ${maxSystemVoltage}
MAXIMUM CIRCUIT CURRENT: ${maxCircuitCurrent}A`,
      bg: "#dc2626",
      fg: "#ffffff",
      required: true
    },
    {
      id: "L-2",
      necRef: "NEC 690.56(B)",
      placement: "At rapid shutdown initiator (service entrance)",
      text: "SOLAR RAPID SHUTDOWN\nSTATUS:\n\u25A1 NORMAL OPERATION\n\u25A1 RAPID SHUTDOWN ACTIVATED",
      bg: "#dc2626",
      fg: "#ffffff",
      required: project.rapidShutdown
    },
    {
      id: "L-3",
      necRef: "NEC 690.56(C)(1)",
      placement: "At the array \u2014 each roof elevation with PV",
      text: "WARNING\nPHOTOVOLTAIC POWER SOURCE\nDO NOT REMOVE OR COVER THIS LABEL\nINSTALLATION SHUTDOWN INFORMATION INSIDE",
      bg: "#dc2626",
      fg: "#ffffff",
      required: project.rapidShutdown
    },
    {
      id: "L-4",
      necRef: "NEC 705.12 / 690.64",
      placement: "On the main service panel \u2014 inside door",
      text: "WARNING\nDUAL POWER SOURCES\nPHOTOVOLTAIC SYSTEM CONNECTED\nSHUT OFF PV DISCONNECT BEFORE SERVICING",
      bg: "#dc2626",
      fg: "#ffffff",
      required: true
    },
    {
      id: "L-5",
      necRef: "IFC \xA7605.11 / NEC 690.56(A)",
      placement: "Adjacent to or on the utility meter",
      text: `SOLAR PV SYSTEM CONNECTED
${project.address || "\u2014"}
System Size: ${system.totalDcKw?.toFixed(2) || "\u2014"} kW DC / ${system.totalAcKw?.toFixed(2) || "\u2014"} kW AC
Interconnection: ${interconnectionLabel(project.interconnectionMethod)}`,
      bg: "#1d4ed8",
      fg: "#ffffff",
      required: true
    },
    {
      id: "L-6",
      necRef: "NEC 690.53",
      placement: "On PV system DC disconnect (if string inverter)",
      text: `PHOTOVOLTAIC SYSTEM DISCONNECT
MAXIMUM INPUT VOLTAGE: ${maxSystemVoltage}
MAXIMUM CIRCUIT CURRENT: ${maxCircuitCurrent}A
DO NOT TOUCH \u2014 LIVE CONDUCTORS`,
      bg: "#dc2626",
      fg: "#ffffff",
      required: !isMicro
    },
    {
      id: "L-7",
      necRef: "NFPA 855 \xA74.3 / NEC 706",
      placement: "On battery storage enclosure \u2014 exterior",
      text: "WARNING\nENERGY STORAGE SYSTEM\nLITHIUM-ION BATTERY\nFIRE AND EXPLOSION HAZARD\nDO NOT OPEN \u2014 CALL 911 IF DAMAGED",
      bg: "#f97316",
      fg: "#ffffff",
      required: hasBattery
    },
    {
      id: "L-8",
      necRef: "NFPA 855 \xA74.3.3",
      placement: "On battery storage enclosure \u2014 near electrical terminals",
      text: `BATTERY ENERGY STORAGE SYSTEM
Manufacturer: ${project.batteryBrand || "\u2014"}
Model: ${project.batteryModel || "\u2014"}
Nominal Voltage: ${project.batteryVoltage || "76.8V DC nominal"}
Capacity: ${((project.batteryCount || 0) * (project.batteryKwh || 0)).toFixed(1)} kWh TOTAL`,
      bg: "#1d4ed8",
      fg: "#ffffff",
      required: hasBattery
    },
    {
      id: "L-9",
      necRef: "NEC 702 / NEC 705.12",
      placement: "On ATS/transfer switch enclosure",
      text: "WARNING\nTRANSFER SWITCH\nBOTH UTILITY AND GENERATOR POWER PRESENT\nISO LATE BEFORE SERVICING",
      bg: "#dc2626",
      fg: "#ffffff",
      required: hasGenerator
    }
  ];
  const requiredLabels = labels.filter((l) => l.required);
  return `
  <div class="page">
    ${titleBlock(input, "PV-5", "WARNING LABELS & REQUIRED PLACARDS", pageNum, totalPages)}
    <div class="page-content">

      <div class="label-intro">
        All warning labels shall be permanently installed, weather-resistant, and meet minimum character height requirements per NEC ${necVer}.
        Lettering shall be minimum 3/8" height for field-applied labels, or as specified by manufacturer for listed labels.
        Color: white lettering on red background (NEC 690.56) unless otherwise noted.
      </div>

      <div class="labels-grid">
        ${requiredLabels.map((lbl) => `
        <div class="label-card">
          <div class="label-header">
            <span class="label-id">${lbl.id}</span>
            <span class="label-nec">${lbl.necRef}</span>
          </div>
          <div class="label-visual" style="background:${lbl.bg};color:${lbl.fg};">
            ${lbl.text.split("\n").map((line, i) => `<div class="${i === 0 ? "label-warning-line" : "label-body-line"}">${line}</div>`).join("")}
          </div>
          <div class="label-placement">\u{1F4CD} <strong>Location:</strong> ${lbl.placement}</div>
        </div>`).join("")}
      </div>

      <div class="section-title" style="margin-top:16px">Label Schedule</div>
      <table class="equip-table">
        <thead>
          <tr><th>Label</th><th>Code Reference</th><th>Required</th><th>Placement Location</th></tr>
        </thead>
        <tbody>
          ${labels.map((lbl) => `
          <tr style="${lbl.required ? "" : "opacity:0.5"}">
            <td style="font-weight:bold">${lbl.id}</td>
            <td style="font-family:monospace;font-size:9px">${lbl.necRef}</td>
            <td style="text-align:center;color:${lbl.required ? "#10b981" : "#94a3b8"};font-weight:bold">${lbl.required ? "\u2713 YES" : "\u2014 N/A"}</td>
            <td style="font-size:10px">${lbl.placement}</td>
          </tr>`).join("")}
        </tbody>
      </table>

    </div>
  </div>`;
}
function pageNECCompliance(input, pageNum, totalPages) {
  const { compliance, rulesResult, overrides } = input;
  const necVer = compliance.jurisdiction?.necVersion || "2020";
  return `
  <div class="page">
    ${titleBlock(input, "PV-4A", "NEC COMPLIANCE SHEET", pageNum, totalPages)}
    <div class="page-content">
      <div class="section-title">Electrical Compliance \u2014 NEC ${necVer}</div>
      ${rulesResult ? `
      <div class="rules-summary">
        <div class="rs" style="color:${rulesResult.errorCount > 0 ? "#ef4444" : "#10b981"}">
          <div class="rs-val">${rulesResult.errorCount}</div><div class="rs-lbl">Errors</div>
        </div>
        <div class="rs" style="color:${rulesResult.warningCount > 0 ? "#f59e0b" : "#10b981"}">
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
          ${(rulesResult.rules || []).map((rule) => `
          <tr style="background:${statusBg(rule.severity)}">
            <td style="font-family:monospace;font-size:9px">${rule.necReference || rule.asceReference || rule.ruleId}</td>
            <td>${rule.title}${rule.autoFixed ? ' <span style="background:#d1fae5;color:#065f46;padding:1px 5px;border-radius:3px;font-size:8px;font-weight:700">Auto-Fixed</span>' : ""}</td>
            <td style="font-size:9px;color:#475569">${rule.message}</td>
            <td style="font-family:monospace;font-size:9px;text-align:right">${rule.value !== void 0 ? `${rule.value}${rule.limit !== void 0 ? ` / ${rule.limit}` : ""}` : "\u2014"}</td>
            <td style="text-align:center;font-weight:bold;color:${statusColor(rule.severity)}">${statusLabel(rule.severity)}</td>
          </tr>`).join("")}
        </tbody>
      </table>` : `
      ${compliance.electrical ? `
      <table class="info-table">
        <tr><td class="il">DC Size</td><td class="iv">${compliance.electrical.summary?.totalDcKw?.toFixed(2)} kW</td><td class="il">AC Capacity</td><td class="iv">${compliance.electrical.summary?.totalAcKw?.toFixed(2)} kW</td></tr>
        <tr><td class="il">Grounding Conductor</td><td class="iv">${compliance.electrical.groundingConductor}</td><td class="il">Busbar Rule</td><td class="iv" style="color:${compliance.electrical.busbar?.passes ? "#10b981" : "#ef4444"}">${compliance.electrical.busbar?.passes ? "\u2713 PASS" : "\u2717 FAIL"}</td></tr>
      </table>` : '<p style="color:#94a3b8;font-style:italic;padding:20px;text-align:center">Run compliance check to populate this section.</p>'}
      `}
      ${compliance.electrical?.loadCalc ? `
      <div class="section-title" style="margin-top:16px">NEC 220.82 — Residential Optional Load Calculation</div>
      <table class="equip-table">
        <thead><tr><th>Step</th><th>Description</th><th>Calculation</th><th style="text-align:right">VA</th><th style="text-align:right">Amps @ 240V</th></tr></thead>
        <tbody>
          <tr><td style="font-weight:bold">1</td><td>General Loads (3 VA/sq-ft)</td><td>${compliance.electrical.loadCalc.squareFootage} sq-ft × 3 VA + small appliance + laundry circuits</td><td style="text-align:right">${compliance.electrical.loadCalc.generalLoadsVA?.toLocaleString()}</td><td style="text-align:right">${(compliance.electrical.loadCalc.generalLoadsVA/240).toFixed(1)}A</td></tr>
          <tr><td style="font-weight:bold">2</td><td>Fixed Appliances</td><td>HVAC 3,500W + Water Heater 4,500W + Range 8,000W</td><td style="text-align:right">${compliance.electrical.loadCalc.fixedAppliancesVA?.toLocaleString()}</td><td style="text-align:right">${(compliance.electrical.loadCalc.fixedAppliancesVA/240).toFixed(1)}A</td></tr>
          <tr style="background:#fef9c3"><td style="font-weight:bold">3</td><td>Demand Factor Applied</td><td>First 10,000 VA @ 100% = 10,000 VA + Remainder ${(compliance.electrical.loadCalc.totalLoadVA - 10000).toLocaleString()} VA @ 40% = ${compliance.electrical.loadCalc.remainderVA?.toLocaleString()} VA</td><td style="text-align:right;font-weight:bold">${compliance.electrical.loadCalc.calculatedLoadVA?.toLocaleString()}</td><td style="text-align:right;font-weight:bold">${compliance.electrical.loadCalc.calculatedAmps?.toFixed(1)}A</td></tr>
          <tr style="background:#f0fdf4;font-weight:bold"><td colspan="3" style="font-weight:bold">RESULT — Service Adequacy Check</td><td style="text-align:right;color:#10b981">${compliance.electrical.loadCalc.calculatedAmps?.toFixed(1)}A calculated</td><td style="text-align:right;color:#10b981">≤ ${compliance.electrical.loadCalc.serviceAmps}A service ✓ PASS</td></tr>
        </tbody>
      </table>` : ""}

      ${compliance.electrical?.tempDerating ? `
      <div class="section-title" style="margin-top:16px">NEC 310.15(B)(2) — Temperature Correction Factors</div>
      <table class="equip-table">
        <thead><tr><th>Parameter</th><th>Value</th><th>Reference</th><th>Notes</th></tr></thead>
        <tbody>
          <tr><td>Ambient Temp (rooftop)</td><td style="font-weight:bold">${compliance.electrical.tempDerating.ambientTemp}°F (40°C)</td><td style="font-family:monospace;font-size:9px">NEC 310.15(B)(2)(a)</td><td>ASHRAE 2% summer design temp + rooftop adder</td></tr>
          <tr><td>Correction Factor (75°C rated)</td><td style="font-weight:bold;color:#f59e0b">${compliance.electrical.tempDerating.correctionFactor}</td><td style="font-family:monospace;font-size:9px">NEC Table 310.15(B)(2)(a)</td><td>For 40°C ambient, THHN-2 (75°C rated)</td></tr>
          <tr><td>#10 AWG THHN Base Ampacity</td><td>30A</td><td style="font-family:monospace;font-size:9px">NEC Table 310.15(B)(16)</td><td>At 60°C terminal rating</td></tr>
          <tr><td>Derated Ampacity</td><td style="font-weight:bold;color:#10b981">${compliance.electrical.tempDerating.deratedAmpacity}A</td><td style="font-family:monospace;font-size:9px">30A × ${compliance.electrical.tempDerating.correctionFactor}</td><td>After temperature correction</td></tr>
          <tr><td>Required Ampacity (Isc × 1.25)</td><td>${compliance.electrical.tempDerating.required}A</td><td style="font-family:monospace;font-size:9px">NEC 690.8(B)(1)</td><td>12.26A × 1.25 = 15.33A</td></tr>
          <tr style="background:#f0fdf4;font-weight:bold"><td colspan="2">RESULT: ${compliance.electrical.tempDerating.deratedAmpacity}A derated ≥ ${compliance.electrical.tempDerating.required}A required</td><td colspan="2" style="color:#10b981">✓ PASS — #10 AWG THHN-2 adequate</td></tr>
        </tbody>
      </table>` : ""}

      ${overrides && overrides.length > 0 ? `
      <div class="section-title" style="margin-top:16px">Engineering Overrides Log</div>
      <table class="equip-table">
        <thead><tr><th>Field</th><th>Override Value</th><th>Justification</th><th>Engineer</th><th>Date</th></tr></thead>
        <tbody>
          ${overrides.map((o) => `
          <tr style="background:#eff6ff">
            <td style="font-family:monospace;font-size:9px">${o.field}</td>
            <td style="color:#3b82f6;font-weight:bold">${o.overrideValue}</td>
            <td>${o.justification}</td>
            <td>${o.engineer}</td>
            <td>${new Date(o.timestamp).toLocaleDateString()}</td>
          </tr>`).join("")}
        </tbody>
      </table>` : ""}
    </div>
  </div>`;
}
function pageConductorSchedule(input, pageNum, totalPages) {
  const { project, system, compliance } = input;
  const elec = compliance.electrical;
  return `
  <div class="page">
    ${titleBlock(input, "PV-4B", "CONDUCTOR & CONDUIT SCHEDULE", pageNum, totalPages)}
    <div class="page-content">
      <div class="section-title">Conductor Schedule \u2014 NEC 310.15 Ampacity Compliance</div>
      <table class="equip-table">
        <thead>
          <tr><th>Circuit</th><th>From</th><th>To</th><th>Conductor</th><th>Ampacity</th><th>OCPD</th><th>V-Drop %</th><th>Conduit</th><th>Length</th></tr>
        </thead>
        <tbody>
          ${system.inverters?.flatMap(
    (inv, invIdx) => inv.strings?.map((str, strIdx) => `
            <tr>
              <td style="font-weight:bold">DC ${invIdx + 1}-${strIdx + 1}</td>
              <td>String ${invIdx + 1}-${strIdx + 1}</td>
              <td>Inverter ${invIdx + 1}</td>
              <td>${str.wireGauge} USE-2/PV Wire</td>
              <td>${elec?.dcWireAmpacity ? elec.dcWireAmpacity + 'A' : (str.panelIsc ? (str.panelIsc * 1.25).toFixed(1) + 'A min' : '\u2014')}</td>
              <td style="font-size:9px">${elec?.dcOCPD || (inv.type === 'micro' ? 'None \u2014 NEC 690.9(A)(2)' : '\u2014')}</td>
              <td>\u2014</td>
              <td>${project.conduitType}</td>
              <td>${str.wireLength} ft</td>
            </tr>`) || []
  ).join("")}
          ${elec ? `
          <tr style="background:#f0f9ff">
            <td style="font-weight:bold">AC Output</td>
            <td>Inverter(s)</td><td>Main Panel</td>
            <td>${elec.acConductorCallout || project.wireGauge} THWN-2</td>
            <td>${elec.acWireAmpacity || "\u2014"}A</td>
            <td>${elec.busbar?.backfeedBreakerRequired || "\u2014"}A</td>
            <td style="color:${(elec.acVoltageDrop || 0) > 3 ? "#f59e0b" : "#10b981"}">${elec.acVoltageDrop?.toFixed(2) || "\u2014"}%</td>
            <td>${project.conduitType}</td>
            <td>${project.wireLength} ft</td>
          </tr>
          <tr style="background:#f0fdf4">
            <td style="font-weight:bold">EGC</td>
            <td>Array</td><td>Main Panel</td>
            <td>${elec.groundingConductor || "#12 AWG"} bare Cu</td>
            <td>\u2014</td><td>\u2014</td><td>\u2014</td>
            <td>${project.conduitType}</td>
            <td>${project.wireLength} ft</td>
          </tr>
          ${project.batteryCount && project.batteryCount > 0 ? `
          <tr style="background:#f5f3ff">
            <td style="font-weight:bold">Battery DC</td>
            <td>IQ Battery 5P</td><td>IQ System Controller</td>
            <td>#6 AWG USE-2 (per Enphase spec)</td>
            <td>55A min</td><td>${project.batteryOCPD || "80A"} per unit</td><td>\u2014</td>
            <td>Conduit or cable assembly</td>
            <td>Per site layout</td>
          </tr>
          <tr style="background:#f5f3ff">
            <td style="font-weight:bold">Battery AC</td>
            <td>IQ System Controller</td><td>Main Panel</td>
            <td>#6 AWG THHN-2</td>
            <td>65A</td><td>60A OCPD</td><td>\u2014</td>
            <td>${project.conduitType}</td>
            <td>Per site layout</td>
          </tr>` : ""}` : ""}
        </tbody>
      </table>
      ${elec?.conduitFill ? `
      <div class="section-title" style="margin-top:16px">Conduit Fill Analysis \u2014 NEC Chapter 9</div>
      <table class="info-table">
        <tr><td class="il">Conduit Type</td><td class="iv">${elec.conduitFill.conduitType}</td><td class="il">Conduit Size</td><td class="iv">${elec.conduitFill.conduitSize}</td></tr>
        <tr><td class="il">Fill Percentage</td><td class="iv" style="color:${elec.conduitFill.fillPercent > 40 ? "#ef4444" : "#10b981"};font-weight:bold">${elec.conduitFill.fillPercent?.toFixed(1)}% (Max: 40%)</td>
        <td class="il">Status</td><td class="iv" style="color:${elec.conduitFill.passes ? "#10b981" : "#ef4444"};font-weight:bold">${elec.conduitFill.passes ? "\u2713 PASS" : "\u2717 FAIL"}</td></tr>
      </table>` : ""}
      ${elec?.tempDerating ? `
      <div class="section-title" style="margin-top:16px">NEC 310.15(B)(2) — Temperature Derating Summary</div>
      <table class="equip-table">
        <thead><tr><th>Circuit</th><th>Wire</th><th>Base Ampacity</th><th>Ambient Temp</th><th>Corr. Factor</th><th>Derated Ampacity</th><th>Required</th><th>Status</th></tr></thead>
        <tbody>
          <tr>
            <td>DC 1-1 (USE-2)</td>
            <td>#10 AWG USE-2</td>
            <td>40A</td>
            <td>${elec.tempDerating.ambientTemp}°F</td>
            <td>${elec.tempDerating.correctionFactor}</td>
            <td style="font-weight:bold">${(40 * elec.tempDerating.correctionFactor).toFixed(1)}A</td>
            <td>${elec.tempDerating.required}A</td>
            <td style="color:#10b981;font-weight:bold">\u2713 PASS</td>
          </tr>
          <tr style="background:#f0f9ff">
            <td>AC Output (THHN-2)</td>
            <td>#10 AWG THHN-2</td>
            <td>30A</td>
            <td>${elec.tempDerating.ambientTemp}°F</td>
            <td>${elec.tempDerating.correctionFactor}</td>
            <td style="font-weight:bold">${elec.tempDerating.deratedAmpacity}A</td>
            <td>${elec.tempDerating.required}A</td>
            <td style="color:#10b981;font-weight:bold">\u2713 PASS</td>
          </tr>
        </tbody>
      </table>` : ""}

      <div class="section-title" style="margin-top:16px">NEC Code References</div>
      <table class="equip-table">
        <thead><tr><th>Code Section</th><th>Title</th><th>Application</th></tr></thead>
        <tbody>
          <tr><td style="font-family:monospace;font-size:9px">NEC 690.8(B)(1)</td><td>Circuit Sizing</td><td>Microinverter system — self-protected per NEC 690.9(A)(2); conductor ampacity \u2265 1.25 \xD7 Isc</td></tr>
          <tr><td style="font-family:monospace;font-size:9px">NEC 690.7(A)</td><td>Maximum Voltage</td><td>Each IQ8M limited to 60V DC — no string Voc correction required</td></tr>
          <tr><td style="font-family:monospace;font-size:9px">NEC 705.12(B)(2)</td><td>120% Busbar Rule</td><td>Backfeed breaker \u2264 20% of main panel busbar rating</td></tr>
          <tr><td style="font-family:monospace;font-size:9px">NEC 690.12</td><td>Rapid Shutdown</td><td>Module-level shutdown within 30 seconds</td></tr>
          <tr><td style="font-family:monospace;font-size:9px">NEC 310.15(B)(2)</td><td>Conductor Ampacity</td><td>Temperature correction and conduit fill derating required</td></tr>
          <tr><td style="font-family:monospace;font-size:9px">NEC Ch. 9, Table 1</td><td>Conduit Fill</td><td>Maximum 40% fill for 3+ conductors</td></tr>
          <tr><td style="font-family:monospace;font-size:9px">NEC 220.82</td><td>Residential Load Calc</td><td>Optional method — total load vs. service capacity</td></tr>
          <tr><td style="font-family:monospace;font-size:9px">ASCE 7-22 \xA726</td><td>Wind Loads</td><td>Components and cladding on roof-mounted arrays</td></tr>
          <tr><td style="font-family:monospace;font-size:9px">ASCE 7-22 \xA77</td><td>Snow Loads</td><td>Roof snow load with slope reduction factor</td></tr>
        </tbody>
      </table>
    </div>
  </div>`;
}
function pageStructural(input, pageNum, totalPages) {
  const { compliance, rulesResult } = input;
  const structural = compliance.structural;
  const structuralRules = rulesResult?.rules?.filter((r) => r.category === "structural") || [];
  return `
  <div class="page">
    ${titleBlock(input, "PV-4C", "STRUCTURAL CALCULATION SHEET", pageNum, totalPages)}
    <div class="page-content">
      <div class="section-title">Structural Analysis \u2014 ASCE 7-22</div>
      ${structural ? `
      <div class="struct-grid">
        <div class="struct-card">
          <div class="sct">\u{1F4A8} Wind Analysis</div>
          <table class="calc-table">
            <tr><td>Design Wind Speed</td><td class="cv">${structural.wind?.windSpeed || "\u2014"} mph</td></tr>
            <tr><td>Exposure Category</td><td class="cv">${structural.wind?.exposureCategory || "\u2014"}</td></tr>
            <tr><td>Velocity Pressure (qz)</td><td class="cv">${structural.wind?.velocityPressure?.toFixed(2) || "\u2014"} psf</td></tr>
            <tr><td>Net Uplift Pressure</td><td class="cv">${structural.wind?.netUpliftPressure?.toFixed(2) || "\u2014"} psf</td></tr>
            <tr><td>Uplift per Attachment</td><td class="cv" style="font-weight:bold">${structural.wind?.upliftPerAttachment?.toFixed(0) || "\u2014"} lbs</td></tr>
          </table>
        </div>
        <div class="struct-card">
          <div class="sct">\u2744 Snow Analysis</div>
          <table class="calc-table">
            <tr><td>Ground Snow Load (pg)</td><td class="cv">${structural.snow?.groundSnowLoad || "\u2014"} psf</td></tr>
            <tr><td>Roof Snow Load (ps)</td><td class="cv">${structural.snow?.roofSnowLoad?.toFixed(1) || "\u2014"} psf</td></tr>
            <tr><td>Snow per Attachment</td><td class="cv" style="font-weight:bold">${structural.snow?.snowLoadPerAttachment?.toFixed(0) || "\u2014"} lbs</td></tr>
          </table>
        </div>
        <div class="struct-card">
          <div class="sct">\u{1F4D0} Rafter Analysis</div>
          <table class="calc-table">
            <tr><td>Bending Moment</td><td class="cv">${structural.rafter?.bendingMoment?.toFixed(0) || "\u2014"} ft-lbs</td></tr>
            <tr><td>Allowable Moment</td><td class="cv">${structural.rafter?.allowableBendingMoment?.toFixed(0) || "\u2014"} ft-lbs</td></tr>
            <tr><td>Utilization Ratio</td><td class="cv" style="font-weight:bold;color:${(structural.rafter?.utilizationRatio || 0) > 1 ? "#ef4444" : "#10b981"}">${((structural.rafter?.utilizationRatio || 0) * 100).toFixed(0)}%</td></tr>
            <tr><td>Deflection / Allowed</td><td class="cv">${structural.rafter?.deflection?.toFixed(3) || "\u2014"}" / ${structural.rafter?.allowableDeflection?.toFixed(3) || "\u2014"}"</td></tr>
          </table>
        </div>
        <div class="struct-card">
          <div class="sct">\u{1F529} Attachment Analysis</div>
          <table class="calc-table">
            <tr><td>Lag Bolt Capacity</td><td class="cv">${structural.attachment?.lagBoltCapacity?.toFixed(0) || "\u2014"} lbs</td></tr>
            <tr><td>Total Uplift/Attachment</td><td class="cv">${structural.attachment?.totalUpliftPerAttachment?.toFixed(0) || "\u2014"} lbs</td></tr>
            <tr><td>Safety Factor</td><td class="cv" style="font-weight:bold;color:${(structural.attachment?.safetyFactor || 0) < 2 ? "#ef4444" : "#10b981"}">${structural.attachment?.safetyFactor?.toFixed(2) || "\u2014"}</td></tr>
            <tr><td>Max Allowed Spacing</td><td class="cv">${structural.attachment?.maxAllowedSpacing || "\u2014"}"</td></tr>
          </table>
        </div>
      </div>` : '<p style="color:#94a3b8;font-style:italic;padding:20px;text-align:center">Run compliance check to populate structural calculations.</p>'}
      ${structuralRules.length > 0 ? `
      <div class="section-title" style="margin-top:16px">Structural Rules Check</div>
      <table class="equip-table">
        <thead><tr><th>Reference</th><th>Description</th><th>Result</th><th>Value / Limit</th><th>Status</th></tr></thead>
        <tbody>
          ${structuralRules.map((rule) => `
          <tr style="background:${statusBg(rule.severity)}">
            <td style="font-family:monospace;font-size:9px">${rule.asceReference || rule.ruleId}</td>
            <td>${rule.title}</td>
            <td style="font-size:9px;color:#475569">${rule.message}</td>
            <td style="font-family:monospace;font-size:9px;text-align:right">${rule.value !== void 0 ? `${rule.value}${rule.limit !== void 0 ? ` / ${rule.limit}` : ""}` : "\u2014"}</td>
            <td style="text-align:center;font-weight:bold;color:${statusColor(rule.severity)}">${statusLabel(rule.severity)}</td>
          </tr>`).join("")}
        </tbody>
      </table>` : ""}
      ${rulesResult?.structuralAutoResolutions && rulesResult.structuralAutoResolutions.length > 0 ? `
      <div class="section-title" style="margin-top:16px">Auto-Resolutions Applied</div>
      <table class="equip-table">
        <thead><tr><th>Field</th><th>Original</th><th>Resolved</th><th>Reason</th><th>Reference</th></tr></thead>
        <tbody>
          ${rulesResult.structuralAutoResolutions.map((r) => `
          <tr style="background:#f0fdf4">
            <td style="font-family:monospace;font-size:9px">${r.field}</td>
            <td>${r.originalValue}</td>
            <td style="color:#10b981;font-weight:bold">${r.resolvedValue}</td>
            <td>${r.reason}</td>
            <td style="font-family:monospace;font-size:9px">${r.necReference}</td>
          </tr>`).join("")}
        </tbody>
      </table>` : ""}
    </div>
  </div>`;
}
function pageEquipmentSchedule(input, pageNum, totalPages) {
  const { system, bom, project } = input;
  return `
  <div class="page">
    ${titleBlock(input, "SCHED", "EQUIPMENT SCHEDULE", pageNum, totalPages)}
    <div class="page-content">
      <div class="section-title">Solar Modules</div>
      <table class="equip-table">
        <thead><tr><th>String</th><th>Manufacturer</th><th>Model</th><th>Qty</th><th>Watts</th><th>Voc (V)</th><th>Isc (A)</th><th>Total kW</th><th>Wire</th><th>Run (ft)</th></tr></thead>
        <tbody>
          ${system.inverters?.flatMap(
    (inv, invIdx) => inv.strings?.map((str, strIdx) => `
            <tr>
              <td style="font-weight:bold">${invIdx + 1}-${strIdx + 1}</td>
              <td>${str.panelManufacturer || "\u2014"}</td><td>${str.panelModel || "\u2014"}</td>
              <td style="text-align:right;font-weight:bold">${str.panelCount}</td>
              <td style="text-align:right">${str.panelWatts}W</td>
              <td style="text-align:right">${str.panelVoc}V</td>
              <td style="text-align:right">${str.panelIsc}A</td>
              <td style="text-align:right;font-weight:bold">${(str.panelCount * str.panelWatts / 1e3).toFixed(2)}</td>
              <td>${str.wireGauge}</td>
              <td style="text-align:right">${str.wireLength}</td>
            </tr>`) || []
  ).join("")}
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
            <td>${inv.type === "micro" ? "Microinverter" : inv.type === "optimizer" ? "String + Optimizer" : "String"}</td>
            <td>${inv.manufacturer || "\u2014"}</td><td>${inv.model || "\u2014"}</td>
            <td style="text-align:right">${inv.acOutputKw}</td>
            <td style="text-align:right">${inv.maxDcVoltage}V</td>
            <td style="text-align:right">${inv.efficiency}%</td>
            <td>${inv.ulListing || "UL 1741"}</td>
          </tr>`).join("")}
        </tbody>
      </table>
      ${project.batteryCount && project.batteryCount > 0 ? `
      <div class="section-title" style="margin-top:16px">Energy Storage System</div>
      <table class="equip-table">
        <thead><tr><th>Component</th><th>Manufacturer</th><th>Model</th><th>Qty</th><th>Capacity / Rating</th><th>Voltage</th><th>UL Listing</th></tr></thead>
        <tbody>
          <tr><td style="font-weight:bold">Battery Unit</td><td>${project.batteryBrand || "\u2014"}</td><td>${project.batteryModel || "\u2014"}</td><td style="text-align:right;font-weight:bold">${project.batteryCount}</td><td>${project.batteryKwh?.toFixed(1)} kWh / 3.84 kVA each</td><td>${project.batteryVoltage || "76.8V DC"}</td><td>UL 9540</td></tr>
          <tr><td style="font-weight:bold">System Controller</td><td>Enphase</td><td>IQ System Controller 3/3G (SC2000TRC240US01)</td><td style="text-align:right;font-weight:bold">1</td><td>160A cont. / 200A OCPD</td><td>240V AC</td><td>UL 9540A</td></tr>
          <tr><td style="font-weight:bold">AC Combiner</td><td>Enphase</td><td>IQ Combiner 5/5C (ENV-IQ-AM1-240)</td><td style="text-align:right;font-weight:bold">1</td><td>125A busbar / 64A max cont.</td><td>120/240V AC 60Hz</td><td>UL 1741</td></tr>
          <tr style="background:#fef3c7;font-weight:bold"><td colspan="2">TOTAL ESS STORAGE</td><td colspan="2">${((project.batteryCount || 0) * (project.batteryKwh || 0)).toFixed(1)} kWh / ${((project.batteryCount || 0) * 3.84).toFixed(2)} kVA</td><td colspan="3" style="color:#10b981">NEC Art. 706 / NFPA 855 Compliant</td></tr>
        </tbody>
      </table>` : ""}
      ${bom && bom.length > 0 ? `
      <div class="section-title" style="margin-top:16px">Balance of System</div>
      <table class="equip-table">
        <thead><tr><th>Category</th><th>Manufacturer</th><th>Model</th><th>Part #</th><th>Qty</th><th>Unit</th><th>UL Listing</th></tr></thead>
        <tbody>
          ${bom.filter((i) => !["panels", "inverters"].includes(i.category)).map((item) => `
          <tr>
            <td style="text-transform:capitalize;color:#64748b">${item.category.replace(/_/g, " ")}</td>
            <td>${item.manufacturer}</td><td>${item.model}</td>
            <td style="font-family:monospace;font-size:9px">${item.partNumber || "\u2014"}</td>
            <td style="text-align:right;font-weight:bold">${item.quantity}</td>
            <td>${item.unit}</td>
            <td>${item.ulListing || "\u2014"}</td>
          </tr>`).join("")}
        </tbody>
      </table>` : ""}
    </div>
  </div>`;
}
function pageEngineerCert(input, pageNum, totalPages) {
  const { project, compliance } = input;
  const necVer = compliance.jurisdiction?.necVersion || "2020";
  const state = compliance.jurisdiction?.state || "\u2014";
  const ahj = compliance.jurisdiction?.ahj || "\u2014";
  return `
  <div class="page">
    ${titleBlock(input, "CERT", "ENGINEER CERTIFICATION", pageNum, totalPages)}
    <div class="page-content">
      <div class="cert-header">ENGINEER OF RECORD CERTIFICATION</div>
      <div class="cert-statement">
        I hereby certify that this solar photovoltaic system design has been prepared under my direct supervision
        and complies with the following applicable codes and standards:
        <ul style="margin-top:10px;line-height:2">
          <li>National Electrical Code (NEC) ${necVer}, Article 690 \u2014 Solar Photovoltaic Systems</li>
          <li>National Electrical Code (NEC) ${necVer}, Article 705 \u2014 Interconnected Electric Power Production Sources</li>
          ${(project.batteryCount || 0) > 0 ? `<li>National Electrical Code (NEC) ${necVer}, Article 706 \u2014 Energy Storage Systems; NFPA 855</li>` : ""}
          <li>ASCE 7-22 \u2014 Minimum Design Loads and Associated Criteria for Buildings and Other Structures</li>
          <li>International Building Code (IBC) / International Residential Code (IRC) \u2014 Structural requirements</li>
          <li>International Fire Code (IFC) ${necVer === "2023" ? "2024" : "2021"} \u2014 Chapter 6 \xA7605 Solar Photovoltaic Systems</li>
          <li>All applicable local amendments adopted by ${state} and the Authority Having Jurisdiction (${ahj})</li>
        </ul>
      </div>
      <div class="cert-grid">
        <div>
          <div class="cert-block-title">PREPARED BY</div>
          <div class="cert-field"><div class="cf-val">${project.designer || "________________________________"}</div><div class="cf-lbl">Designer / Engineer of Record</div></div>
          <div class="cert-field"><div class="cf-val">________________________________</div><div class="cf-lbl">License Number</div></div>
          <div class="cert-field"><div class="cf-val">________________________________</div><div class="cf-lbl">State of Licensure</div></div>
          <div class="cert-field"><div class="cf-val">${project.date}</div><div class="cf-lbl">Date of Certification</div></div>
          <div class="cert-field" style="margin-top:20px"><div class="cf-val" style="border-bottom:2px solid #1e293b;padding-bottom:30px">________________________________</div><div class="cf-lbl">Signature</div></div>
        </div>
        <div>
          <div class="cert-block-title">WET STAMP AREA</div>
          <div class="stamp-box">
            <div style="text-align:center">
              <div style="font-size:28px;opacity:0.2">\u2B21</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:8px">Engineer Wet Stamp</div>
              <div style="font-size:10px;color:#cbd5e1;margin-top:4px">Required for AHJ Submission</div>
            </div>
          </div>
          <div class="cert-block-title" style="margin-top:20px">REVISION HISTORY</div>
          <table class="equip-table" style="margin-top:8px">
            <thead><tr><th>Rev</th><th>Date</th><th>Description</th><th>By</th></tr></thead>
            <tbody>
              <tr><td style="font-weight:bold">A</td><td>${project.date}</td><td>Initial Issue for Permit</td><td>${project.designer || "\u2014"}</td></tr>
              <tr><td style="color:#94a3b8">B</td><td style="color:#94a3b8">\u2014</td><td style="color:#94a3b8">\u2014</td><td style="color:#94a3b8">\u2014</td></tr>
              <tr><td style="color:#94a3b8">C</td><td style="color:#94a3b8">\u2014</td><td style="color:#94a3b8">\u2014</td><td style="color:#94a3b8">\u2014</td></tr>
            </tbody>
          </table>
          <div class="section-title" style="margin-top:16px">SLD Reference</div>
          <table class="info-table">
            <tr><td class="il">Sheet E-1</td><td class="iv">Single-Line Electrical Diagram \u2014 See Sheet E-1 (next sheet) for complete SLD with all conductors, OCPD ratings, grounding paths, and NEC labels</td></tr>
          </table>
        </div>
      </div>
      <div class="cert-footer">
        SolarPro Engineering Platform \xB7 Issued: ${project.date} \xB7
        This document requires engineer review and wet stamp before AHJ submission.
        All equipment must be UL-listed and installed per manufacturer specifications and NEC ${necVer}.
      </div>
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════
// PAGE E-1: SINGLE LINE DIAGRAM (adapted from sld-professional-renderer.ts V14)
// ═══════════════════════════════════════════════════════════
// ============================================================
// pageSingleLineDiagram() — Self-contained SLD page for permit_gen.mjs
// Adapted from Solarpro-git/lib/sld-professional-renderer.ts (V14)
// IEEE/ANSI standard symbols, ANSI B (17"×22") landscape format
// ============================================================

function pageSingleLineDiagram(input, pageNum, totalPages) {
  const { project, system, compliance } = input;

  // ── Canvas ─────────────────────────────────────────────────
  const W = 2304, H = 1728, MAR = 40;
  const TB_W = 260;
  const TB_X = W - TB_W - MAR;
  const DX = MAR, DY = MAR;
  const DW = TB_X - MAR - 10;
  const DH = H - MAR * 2;
  const SCH_X = DX, SCH_Y = DY + 30;
  const SCH_W = DW;
  const SCH_H = Math.round(DH * 0.50);
  const BUS_Y = SCH_Y + Math.round(SCH_H * 0.46);
  const GND_Y = BUS_Y + 100;
  const CALC_Y  = SCH_Y + SCH_H + 8;
  const CALC_H  = 180;
  const SCHED_Y = CALC_Y + CALC_H + 8;
  const SCHED_H = H - MAR - SCHED_Y;

  // ── Colors ─────────────────────────────────────────────────
  const BLK = '#000000', WHT = '#FFFFFF', GRN = '#005500';
  const LGY = '#F5F5F5', PASS = '#004400', FAIL = '#AA0000';
  const LOAD_CLR = '#1B5E20';

  // ── Stroke widths ──────────────────────────────────────────
  const SW_BORDER=2.5, SW_HEAVY=2.0, SW_MED=1.5, SW_THIN=1.0, SW_HAIR=0.5, SW_BUS=3.5;

  // ── Font sizes ─────────────────────────────────────────────
  const F = { title:12, hdr:8.5, label:7.5, sub:7, seg:6.5, tiny:6.5, tb:7, tbTitle:10 };

  // ── SVG Primitives ─────────────────────────────────────────
  function esc(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function txt(x,y,s,o={}) {
    const sz=o.sz??F.label, bld=o.bold?'font-weight="bold"':'', anc=`text-anchor="${o.anc??'start'}"`;
    const clr=`fill="${o.fill??BLK}"`, itl=o.italic?'font-style="italic"':'';
    return `<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${sz}" ${bld} ${anc} ${clr} ${itl} dominant-baseline="auto">${esc(s)}</text>`;
  }

  function tspan(x,y,lines,o={}) {
    if(!lines.length) return '';
    const sz=o.sz??F.seg, bld=o.bold?'font-weight="bold"':'', anc=`text-anchor="${o.anc??'middle'}"`;
    const clr=`fill="${o.fill??BLK}"`, lh=o.lh??Math.round(sz*1.4);
    const spans=lines.map((l,i)=>`<tspan x="${x}" dy="${i===0?0:lh}">${esc(l)}</tspan>`).join('');
    return `<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${sz}" ${bld} ${anc} ${clr} dominant-baseline="auto">${spans}</text>`;
  }

  function rect(x,y,w,h,o={}) {
    const f=o.fill??WHT, s=o.stroke??BLK, sw=o.sw??SW_THIN, rx=o.rx?`rx="${o.rx}"`:'', da=o.dash?`stroke-dasharray="${o.dash}"`:'';
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}" stroke="${s}" stroke-width="${sw}" ${rx} ${da}/>`;
  }

  function ln(x1,y1,x2,y2,o={}) {
    const s=o.stroke??BLK, sw=o.sw??SW_MED, da=o.dash?`stroke-dasharray="${o.dash}"`:'';
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${s}" stroke-width="${sw}" ${da}/>`;
  }

  function circ(cx,cy,r,o={}) {
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${o.fill??WHT}" stroke="${o.stroke??BLK}" stroke-width="${o.sw??SW_THIN}"/>`;
  }

  function gnd(x,y,color=GRN) {
    return [ln(x,y,x,y+8,{stroke:color,sw:SW_MED}),ln(x-9,y+8,x+9,y+8,{stroke:color,sw:SW_MED}),
            ln(x-6,y+12,x+6,y+12,{stroke:color,sw:SW_MED}),ln(x-3,y+16,x+3,y+16,{stroke:color,sw:SW_MED})].join('');
  }

  function callout(cx,cy,n) {
    return circ(cx,cy,10,{fill:WHT,stroke:BLK,sw:SW_MED})+txt(cx,cy+1,String(n),{sz:F.hdr,bold:true,anc:'middle'});
  }

  // ── IEEE Standard Equipment Symbols ────────────────────────
  function pvModuleSymbol(cx,cy,w=28,h=20) {
    return [rect(cx-w/2,cy-h/2,w,h,{fill:WHT,sw:SW_MED}),ln(cx-w/2,cy+h/2,cx+w/2,cy-h/2,{sw:SW_THIN})].join('');
  }

  function fuseSymbol(cx,cy,w=16,h=8) {
    return [ln(cx-w/2-6,cy,cx-w/2,cy,{sw:SW_MED}),rect(cx-w/2,cy-h/2,w,h,{fill:WHT,sw:SW_MED}),ln(cx+w/2,cy,cx+w/2+6,cy,{sw:SW_MED})].join('');
  }

  function breakerSymbol(cx,cy,w=18,h=12,amps) {
    const p=[rect(cx-w/2,cy-h/2,w,h,{fill:WHT,sw:SW_THIN}),
             `<path d="M${cx-5},${cy+3} Q${cx},${cy-5} ${cx+5},${cy+3}" fill="none" stroke="${BLK}" stroke-width="${SW_HAIR}"/>`];
    if(amps) p.push(txt(cx,cy-h/2-2,`${amps}A`,{sz:5.5,anc:'middle',bold:true}));
    return p.join('');
  }

  function lug(cx,cy) { return circ(cx,cy,3,{fill:WHT,sw:SW_MED})+circ(cx,cy,1,{fill:BLK,sw:0}); }

  function busbar(x1,x2,y,label) {
    const p=[ln(x1,y,x2,y,{stroke:BLK,sw:SW_BUS})];
    if(label) p.push(txt((x1+x2)/2,y-5,label,{sz:5.5,anc:'middle',bold:true}));
    return p.join('');
  }

  function knifeSwitch(cx,cy,w=40) {
    const lx=cx-w/2, rx=cx+w/2;
    return [ln(lx,cy,lx+10,cy,{sw:SW_MED}),circ(lx+10,cy,3,{fill:BLK,sw:0}),
            ln(lx+10,cy,rx-10,cy-10,{sw:SW_MED}),circ(rx-10,cy,3,{fill:WHT,sw:SW_MED}),
            ln(rx-10,cy,rx,cy,{sw:SW_MED})].join('');
  }

  // ── Overlap Guard ──────────────────────────────────────────
  function makeOverlapGuard() {
    const used=[];
    return function(x1,x2,y) {
      const xMin=Math.min(x1,x2), xMax=Math.max(x1,x2);
      let c=y, att=0;
      while(att<10) {
        const conf=used.find(r=>Math.abs(r.y-c)<4&&r.x1<xMax&&r.x2>xMin);
        if(!conf) break; c+=4; att++;
      }
      used.push({x1:xMin,x2:xMax,y:c}); return c;
    };
  }

  // ── Wire Segment ───────────────────────────────────────────
  function wireSeg(x1,x2,y,lines,opts={}) {
    const isOA=opts.openAir??false, color=isOA?GRN:BLK, dash=isOA?'10,5':undefined;
    const cnt=Math.min(opts.bundleCount??1,6), cx=(x1+x2)/2, above=opts.above??true;
    const p=[];
    if(cnt<=1) { p.push(ln(x1,y,x2,y,{stroke:color,sw:SW_MED,dash})); }
    else {
      const sp=3, span=(cnt-1)*sp, sy=y-span/2;
      for(let i=0;i<cnt;i++) p.push(ln(x1,sy+i*sp,x2,sy+i*sp,{stroke:color,sw:SW_THIN,dash}));
      p.push(ln(x1,sy,x1,sy+span,{stroke:color,sw:SW_HAIR}));
      p.push(ln(x2,sy,x2,sy+span,{stroke:color,sw:SW_HAIR}));
    }
    if(lines.length>0) {
      const lh=Math.round(F.seg*1.35), th=lines.length*lh;
      const ty=above?y-7-th+lh:y+11;
      p.push(tspan(cx,ty,lines,{sz:F.seg,anc:'middle',fill:color}));
    }
    return p.join('');
  }

  // ── Equipment Renderers ────────────────────────────────────
  function renderBattery(cx,cy,model,kwh,backfeedA,calloutN) {
    const W2=88,H2=72, bx=cx-W2/2, by2=cy-H2/2, BAT_CLR='#1565C0', p=[];
    p.push(rect(bx,by2,W2,H2,{fill:WHT,stroke:BAT_CLR,sw:SW_MED}));
    p.push(ln(bx,by2+14,bx+W2,by2+14,{stroke:BAT_CLR,sw:SW_THIN}));
    p.push(txt(cx,by2+10,'BATTERY STORAGE',{sz:5.5,bold:true,anc:'middle',fill:BAT_CLR}));
    const cellX=cx-14, cellY=cy-4;
    for(let i=0;i<3;i++){
      const lx2=cellX+i*7;
      p.push(ln(lx2,cellY-10,lx2,cellY+10,{stroke:BAT_CLR,sw:2.5}));
      if(i<2) p.push(ln(lx2+3,cellY-6,lx2+3,cellY+6,{stroke:BAT_CLR,sw:1.5}));
    }
    p.push(txt(cellX-8,cellY+4,'\u2212',{sz:9,bold:true,anc:'middle',fill:BAT_CLR}));
    p.push(txt(cellX+22,cellY+4,'+',{sz:9,bold:true,anc:'middle',fill:BAT_CLR}));
    const acOutX=cx, acOutY=by2+H2;
    p.push(lug(acOutX,acOutY-6));
    p.push(ln(acOutX,acOutY-6,acOutX,acOutY,{stroke:BAT_CLR,sw:SW_MED}));
    p.push(txt(acOutX,acOutY+6,'AC OUT',{sz:4,anc:'middle',fill:BAT_CLR}));
    p.push(txt(cx,by2+H2+16,model?(model.substring(0,22)):'BATTERY STORAGE',{sz:F.tiny,anc:'middle',italic:true}));
    p.push(txt(cx,by2+H2+25,kwh>0?`${kwh} kWh`:'',{sz:F.tiny,anc:'middle',bold:true,fill:BAT_CLR}));
    if(backfeedA>0) p.push(txt(cx,by2+H2+34,`${backfeedA}A BACKFEED \u2014 NEC 705.12(B)`,{sz:F.tiny,anc:'middle',fill:BAT_CLR}));
    p.push(callout(bx+W2+14,by2-5,calloutN));
    return {svg:p.join(''),lx:bx,rx:bx+W2,ty:by2,by:by2+H2,acOutX,acOutY};
  }

  function renderBUI(cx,cy,brand,model,ampRating,isEnphase,hasGenerator,calloutN) {
    const W2=100,H2=90, bx=cx-W2/2, by2=cy-H2/2;
    const BUI_CLR=isEnphase?'#0D47A1':'#1565C0', p=[];
    p.push(rect(bx,by2,W2,H2,{fill:WHT,stroke:BUI_CLR,sw:SW_MED}));
    p.push(ln(bx,by2+14,bx+W2,by2+14,{stroke:BUI_CLR,sw:SW_THIN}));
    const headerText=isEnphase?'IQ SYSTEM CONTROLLER 3':'BACKUP INTERFACE UNIT';
    p.push(txt(cx,by2+10,headerText,{sz:5.5,bold:true,anc:'middle',fill:BUI_CLR}));
    const gridY=cy-14;
    p.push(lug(bx+8,gridY)); p.push(txt(bx+8,gridY-8,'GRID',{sz:4.5,anc:'middle',fill:'#444'}));
    p.push(ln(bx,gridY,bx+8,gridY,{stroke:BUI_CLR,sw:SW_MED}));
    const genInputY=cy+14;
    if(hasGenerator) {
      p.push(lug(bx+8,genInputY)); p.push(txt(bx+8,genInputY+9,'GEN',{sz:4.5,anc:'middle',fill:'#2E7D32'}));
      p.push(ln(bx,genInputY,bx+8,genInputY,{stroke:'#2E7D32',sw:SW_MED}));
    }
    p.push(ln(bx+11,gridY,bx+42,gridY,{stroke:BUI_CLR,sw:SW_MED}));
    p.push(circ(bx+11,gridY,2.5,{fill:BUI_CLR,stroke:BUI_CLR,sw:0}));
    p.push(circ(bx+42,gridY,2.5,{fill:WHT,stroke:BUI_CLR,sw:SW_THIN}));
    if(hasGenerator){
      p.push(ln(bx+11,genInputY,bx+32,genInputY-12,{stroke:'#2E7D32',sw:SW_MED}));
      p.push(circ(bx+11,genInputY,2.5,{fill:'#2E7D32',stroke:'#2E7D32',sw:0}));
      p.push(circ(bx+42,genInputY,2.5,{fill:WHT,stroke:'#2E7D32',sw:SW_THIN}));
    }
    const busX2=bx+55;
    p.push(ln(busX2,gridY,busX2,hasGenerator?genInputY:gridY+20,{stroke:BUI_CLR,sw:2.5}));
    p.push(ln(bx+42,gridY,busX2,gridY,{stroke:BUI_CLR,sw:SW_THIN}));
    if(hasGenerator) p.push(ln(bx+42,genInputY,busX2,genInputY,{stroke:BUI_CLR,sw:SW_THIN}));
    const loadY=cy;
    p.push(lug(bx+W2-8,loadY)); p.push(txt(bx+W2-8,loadY-8,'LOAD',{sz:4.5,anc:'middle',fill:'#444'}));
    p.push(ln(busX2,loadY,bx+W2-8,loadY,{stroke:BUI_CLR,sw:SW_MED}));
    p.push(ln(bx+W2-8,loadY,bx+W2,loadY,{stroke:BUI_CLR,sw:SW_MED}));
    const batPortX2=cx, batPortY2=by2+H2;
    p.push(lug(batPortX2,batPortY2-4));
    p.push(txt(batPortX2,batPortY2+8,'BATTERY',{sz:4.5,anc:'middle',fill:BUI_CLR}));
    p.push(ln(batPortX2,batPortY2-4,batPortX2,batPortY2,{stroke:BUI_CLR,sw:SW_MED}));
    p.push(txt(cx,by2+H2+18,`${brand||'Enphase'} ${model||'IQ SC3'}`,{sz:F.tiny,anc:'middle',italic:true,fill:BUI_CLR}));
    p.push(txt(cx,by2+H2+27,ampRating>0?`${ampRating}A`:'200A',{sz:F.tiny,anc:'middle',bold:true,fill:BUI_CLR}));
    p.push(txt(cx,by2+H2+36,'NEC 706 / NEC 230.82 / UL 1741-SA',{sz:F.tiny,anc:'middle',italic:true,fill:BUI_CLR}));
    p.push(callout(bx+W2+14,by2-5,calloutN));
    return {svg:p.join(''),lx:bx-10,rx:bx+W2+10,ty:by2,by:by2+H2,
            batPortX:batPortX2,batPortY:batPortY2,
            loadPortX:bx+W2,loadPortY:loadY,
            gridPortX:bx,gridPortY:cy-14,
            genPortX:bx,genPortY:cy+14};
  }

  function renderCombiner(cx,cy,nBranches,branchOcpd,label,calloutN) {
    const W2=80,H2=90, bx=cx-W2/2, by2=cy-H2/2, p=[];
    p.push(rect(bx,by2,W2,H2,{fill:WHT,sw:SW_MED}));
    p.push(ln(bx,by2+14,bx+W2,by2+14,{sw:SW_THIN}));
    p.push(txt(cx,by2+10,'AC COMBINER',{sz:6,bold:true,anc:'middle'}));
    const busY=cy+8;
    p.push(busbar(bx+10,bx+W2-10,busY));
    p.push(txt(cx,busY-5,'BUS',{sz:5,anc:'middle'}));
    const nShow=Math.min(nBranches,4), brkSpacing=(H2-22)/(nShow+1);
    for(let b=0;b<nShow;b++){
      const brY=by2+18+brkSpacing*(b+1);
      p.push(lug(bx+4,brY)); p.push(ln(bx+7,brY,bx+20,brY,{sw:SW_THIN}));
      p.push(breakerSymbol(bx+29,brY,16,10,branchOcpd));
      p.push(ln(bx+37,brY,cx-5,busY,{sw:SW_THIN}));
    }
    if(nBranches>4) p.push(txt(bx+29,busY-12,`+${nBranches-4}`,{sz:5,anc:'middle',fill:'#666'}));
    p.push(ln(bx+W2-10,busY,bx+W2-4,busY,{sw:SW_THIN})); p.push(lug(bx+W2-4,busY));
    p.push(ln(bx+W2,busY,bx+W2+10,busY,{sw:SW_MED}));
    p.push(txt(cx,by2+H2+10,esc(label),{sz:F.tiny,anc:'middle',italic:true}));
    p.push(txt(cx,by2+H2+19,`${nBranches} branch inputs`,{sz:F.tiny,anc:'middle'}));
    p.push(txt(cx,by2+H2+28,'NEC 690.9',{sz:F.tiny,anc:'middle',italic:true}));
    p.push(callout(bx+W2+14,by2-5,calloutN));
    p.push(ln(bx-10,busY,bx,busY,{sw:SW_MED}));
    const feederOutX=bx+W2+10, feederOutY=cy+8;
    return {svg:p.join(''),lx:bx-10,rx:bx+W2+10,ty:by2,by:by2+H2,feederOutX,feederOutY};
  }

  function renderDisco(cx,cy,ocpd,calloutN) {
    const W2=90,H2=70, bx=cx-W2/2, by2=cy-H2/2, p=[];
    p.push(rect(bx,by2,W2,H2,{fill:WHT,sw:SW_MED}));
    p.push(ln(bx,by2+14,bx+W2,by2+14,{sw:SW_THIN}));
    p.push(txt(cx,by2+10,'AC DISCONNECT',{sz:6,bold:true,anc:'middle'}));
    const poleY1=cy-8, poleY2=cy+8;
    p.push(lug(bx+10,poleY1)); p.push(lug(bx+10,poleY2));
    p.push(txt(bx+10,poleY2+13,'LOAD',{sz:5,anc:'middle',bold:true,fill:'#333'}));
    p.push(txt(bx+10,poleY2+20,'(FROM COMBINER)',{sz:4.5,anc:'middle',fill:'#555'}));
    p.push(ln(bx+13,poleY1,bx+30,poleY1,{sw:SW_THIN}));
    p.push(ln(bx+13,poleY2,bx+30,poleY2,{sw:SW_THIN}));
    p.push(knifeSwitch(cx,poleY1,30)); p.push(knifeSwitch(cx,poleY2,30));
    p.push(ln(bx+W2-30,poleY1,bx+W2-13,poleY1,{sw:SW_THIN}));
    p.push(ln(bx+W2-30,poleY2,bx+W2-13,poleY2,{sw:SW_THIN}));
    p.push(lug(bx+W2-10,poleY1)); p.push(lug(bx+W2-10,poleY2));
    p.push(txt(bx+W2-10,poleY2+13,'LINE',{sz:5,anc:'middle',bold:true,fill:'#333'}));
    p.push(txt(bx+W2-10,poleY2+20,'(TO MSP)',{sz:4.5,anc:'middle',fill:'#555'}));
    p.push(ln(bx+W2*0.55,by2+14,bx+W2-2,by2+14,{sw:2,stroke:'#888'}));
    p.push(txt(bx+W2-2,by2+12,'\u26a1',{sz:5,anc:'end',fill:'#888'}));
    p.push(ln(bx-10,cy,bx,poleY1,{sw:SW_MED})); p.push(ln(bx-10,cy,bx,poleY2,{sw:SW_MED}));
    p.push(ln(bx+W2,poleY1,bx+W2+10,cy,{sw:SW_MED})); p.push(ln(bx+W2,poleY2,bx+W2+10,cy,{sw:SW_MED}));
    p.push(txt(cx,by2+H2+10,`${ocpd}A NON-FUSED`,{sz:F.tiny,anc:'middle'}));
    p.push(txt(cx,by2+H2+19,'NEC 690.14 \u2014 UTILITY ACCESSIBLE',{sz:F.tiny,anc:'middle',italic:true}));
    p.push(callout(bx+W2+14,by2-5,calloutN));
    return {svg:p.join(''),lx:bx-10,rx:bx+W2+10,loadInX:bx,loadInY:cy,lineOutX:bx+W2,lineOutY:cy};
  }

  function renderMSPLoad(cx,cy,mainAmps,pvAmps,calloutN) {
    const W2=96,H2=120, bx=cx-W2/2, by2=cy-H2/2, p=[];
    p.push(rect(bx,by2,W2,H2,{fill:WHT,sw:SW_MED}));
    p.push(ln(bx,by2+14,bx+W2,by2+14,{sw:SW_THIN}));
    p.push(txt(cx,by2+10,'MAIN SERVICE PANEL',{sz:5.5,bold:true,anc:'middle'}));
    const mbY=by2+28;
    p.push(txt(cx,mbY-4,`${mainAmps}A MAIN BREAKER`,{sz:5.5,anc:'middle',bold:true}));
    p.push(breakerSymbol(cx,mbY,32,14,mainAmps));
    const busY=mbY+20;
    p.push(busbar(bx+8,bx+W2-8,busY,'MAIN BUS')); p.push(ln(cx,mbY+7,cx,busY,{sw:SW_MED}));
    const nX=bx+10;
    p.push(ln(nX,busY+8,nX,busY+38,{stroke:'#444',sw:3})); p.push(txt(nX,busY+46,'N',{sz:6,anc:'middle',bold:true,fill:'#444'}));
    const gX=bx+W2-10;
    p.push(ln(gX,busY+8,gX,busY+38,{stroke:GRN,sw:3})); p.push(txt(gX,busY+46,'G',{sz:6,anc:'middle',bold:true,fill:GRN}));
    p.push(gnd(gX,busY+48,GRN));
    const pvBrkX=cx+20, pvBrkY=busY+28;
    p.push(ln(pvBrkX,busY,pvBrkX,pvBrkY-6,{sw:SW_THIN}));
    p.push(breakerSymbol(pvBrkX,pvBrkY,20,12,pvAmps));
    p.push(txt(pvBrkX,pvBrkY+10,'PV',{sz:5.5,anc:'middle',bold:true,fill:LOAD_CLR}));
    const lugY=pvBrkY+22;
    p.push(ln(pvBrkX,pvBrkY+6,pvBrkX,lugY-3,{sw:SW_THIN})); p.push(lug(pvBrkX,lugY));
    p.push(txt(pvBrkX,lugY+9,'LOAD LUG',{sz:5,anc:'middle'}));
    p.push(ln(bx-10,cy,bx,cy,{sw:SW_MED})); p.push(ln(bx,cy,pvBrkX,lugY,{sw:SW_MED}));
    p.push(ln(bx+W2-8,busY,bx+W2+10,busY,{sw:SW_MED}));
    p.push(txt(cx,by2+H2+10,`${mainAmps}A RATED`,{sz:F.tiny,anc:'middle'}));
    p.push(txt(cx,by2+H2+19,'LOAD SIDE TAP \u2014 NEC 705.12(B)',{sz:F.tiny,anc:'middle',bold:true,fill:LOAD_CLR}));
    p.push(txt(cx,by2+H2+28,`${pvAmps}A PV BREAKER`,{sz:F.tiny,anc:'middle',fill:LOAD_CLR}));
    p.push(callout(bx+W2+14,by2-5,calloutN));
    return {svg:p.join(''),lx:bx-10,rx:bx+W2+10,bkfdInX:bx,bkfdInY:cy,busOutX:bx+W2,busOutY:mbY+20};
  }

  // ── Build the SLD SVG ──────────────────────────────────────
  function buildSLD() {
    const parts = [];
    const resolveSegY = makeOverlapGuard();

    const totalDcKw = system.totalDcKw ?? 9.6;
    const totalAcKw = system.totalAcKw ?? 7.68;
    const totalPanels = system.totalPanels ?? 24;
    const panelWatts = project.panelWatts ?? 400;
    const panelModel = project.panelModel ?? 'Q.PEAK DUO BLK ML-G10+ 400';
    const panelVoc   = project.panelVoc ?? 49.6;
    const panelIsc   = project.panelIsc ?? 10.5;
    const inverterModel = project.inverterModel ?? 'IQ8M-72-2-US';
    const inverterMfr   = project.inverterBrand ?? 'Enphase';
    const acOutputKw  = totalAcKw;
    const acOutputAmps = (totalAcKw * 1000 / 240);
    const acWireGauge  = compliance?.electrical?.acConductorCallout ?? '#10 AWG';
    const acConduit    = '3/4"';
    const acCondType   = 'EMT';
    const acOCPD       = project.backfeedBreakerA ?? project.pvBackfeedA ?? 40;
    const mainAmps     = project.mainPanelAmps ?? 200;
    const backfeedAmps = project.backfeedBreakerA ?? 46;
    const pvBreakerAmps = backfeedAmps;
    const utilityName  = project.utilityName ?? 'Ameren Illinois';
    const hasBattery   = !!(project.batteryCount && project.batteryCount > 0);
    const batteryModel = project.batteryModel ?? 'IQ Battery 5P';
    const batteryKwh   = (project.batteryCount ?? 2) * (project.batteryKwh ?? 5.0);
    const batteryBackfeedA = project.batteryBackfeedA ?? 46;
    const egcNum = '10';
    const branchOcpd = 20;
    const nBranches = Math.ceil(totalPanels / 16);  // 2 branches for 24 panels
    const deviceCount = totalPanels;

    // X positions
    const xPad=50, uW=SCH_W-xPad*2;
    const xPV   = SCH_X + xPad;
    const xJBox = SCH_X + xPad + uW*0.17;
    const xComb = SCH_X + xPad + uW*0.36;
    const xDisco= SCH_X + xPad + uW*0.56;
    const xMSP  = SCH_X + xPad + uW*0.75;
    const xUtil = SCH_X + xPad + uW;

    // SVG root
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="background:${WHT};display:block;min-height:19in;max-height:21in;">`);
    parts.push(rect(0,0,W,H,{fill:WHT,stroke:WHT,sw:0}));
    parts.push(rect(MAR/2,MAR/2,W-MAR,H-MAR,{fill:WHT,stroke:BLK,sw:SW_BORDER}));

    // Title
    const tcx=(DX+TB_X)/2;
    parts.push(txt(tcx,DY+16,'SINGLE LINE DIAGRAM \u2014 PHOTOVOLTAIC SYSTEM',{sz:F.title,bold:true,anc:'middle'}));
    parts.push(txt(tcx,DY+26,`${esc(project.address||'')}  |  MICROINVERTER  |  ${totalPanels} MODULES  |  ${totalAcKw.toFixed(2)} kW AC`,{sz:F.sub,anc:'middle',fill:'#444'}));

    // Schematic border
    parts.push(rect(SCH_X,SCH_Y,SCH_W,SCH_H,{fill:WHT,stroke:BLK,sw:SW_THIN}));

    // NODE 1: PV ARRAY
    const pvW=80, pvH=68, pvCX=xPV, pvCY=BUS_Y;
    parts.push(rect(pvCX-pvW/2,pvCY-pvH/2,pvW,pvH,{fill:WHT,sw:SW_MED}));
    for(let row=0;row<2;row++) for(let col=0;col<3;col++) {
      const mx=pvCX-pvW/2+10+col*22, my=pvCY-pvH/2+12+row*26;
      parts.push(pvModuleSymbol(mx+9,my+9,18,14));
    }
    parts.push(txt(pvCX,pvCY-pvH/2-18,'PV ARRAY',{sz:F.hdr,bold:true,anc:'middle'}));
    parts.push(txt(pvCX,pvCY-pvH/2-8,`${totalPanels} \u00d7 ${panelWatts}W`,{sz:F.sub,anc:'middle'}));
    parts.push(txt(pvCX,pvCY+pvH/2+9,esc(panelModel),{sz:F.tiny,anc:'middle',italic:true}));
    parts.push(txt(pvCX,pvCY+pvH/2+18,`${deviceCount} \u00d7 ${esc(inverterModel)}`,{sz:F.tiny,anc:'middle'}));
    parts.push(callout(pvCX+pvW/2+14,pvCY-pvH/2-5,1));
    const pvOutX=pvCX+pvW/2;

    // NODE 2: ROOF J-BOX
    const jbW=40, jbH=40, jbCX=xJBox, jbCY=BUS_Y;
    parts.push(rect(jbCX-jbW/2,jbCY-jbH/2,jbW,jbH,{fill:WHT,sw:SW_MED}));
    parts.push(ln(jbCX-jbW/2+5,jbCY-jbH/2+5,jbCX+jbW/2-5,jbCY+jbH/2-5,{sw:SW_HAIR}));
    parts.push(ln(jbCX+jbW/2-5,jbCY-jbH/2+5,jbCX-jbW/2+5,jbCY+jbH/2-5,{sw:SW_HAIR}));
    parts.push(lug(jbCX-jbW/2+6,jbCY)); parts.push(lug(jbCX+jbW/2-6,jbCY));
    parts.push(txt(jbCX,jbCY-jbH/2-15,'ROOF J-BOX',{sz:F.sub,bold:true,anc:'middle'}));
    parts.push(txt(jbCX,jbCY-jbH/2-7,'AC JUNCTION',{sz:F.tiny,anc:'middle'}));
    parts.push(txt(jbCX,jbCY+jbH/2+9,`${nBranches} branches`,{sz:F.tiny,anc:'middle'}));
    parts.push(txt(jbCX,jbCY+jbH/2+18,`${branchOcpd}A OCPD ea.`,{sz:F.tiny,anc:'middle'}));
    parts.push(callout(jbCX+jbW/2+12,jbCY-jbH/2-5,2));

    // SEGMENT 1: PV → J-Box (open air)
    parts.push(wireSeg(pvOutX,jbCX-jbW/2,resolveSegY(pvOutX,jbCX-jbW/2,BUS_Y),
      ['#10 AWG THWN-2','1\u00d7#'+egcNum+' GRN EGC','OPEN AIR \u2014 NEC 690.31'],{openAir:true}));

    // NODE 3: AC COMBINER
    const combLabel=`${inverterMfr} IQ Combiner 5C`;
    const cr=renderCombiner(xComb,BUS_Y,nBranches,branchOcpd,combLabel,3);
    parts.push(cr.svg);
    parts.push(txt(xComb,cr.ty-8,'AC COMBINER',{sz:F.hdr,bold:true,anc:'middle'}));
    const node3RX=cr.feederOutX;

    // SEGMENT 2: J-Box → Combiner
    parts.push(wireSeg(jbCX+jbW/2,cr.lx,resolveSegY(jbCX+jbW/2,cr.lx,BUS_Y),
      ['#10 AWG THWN-2','1\u00d7#'+egcNum+' GRN EGC','IN 3/4" EMT']));

    // NODE 5: AC DISCONNECT
    const discoResult=renderDisco(xDisco,BUS_Y,acOCPD,4);
    parts.push(discoResult.svg);
    parts.push(txt(xDisco,BUS_Y-40,'(N) AC DISCONNECT',{sz:F.hdr,bold:true,anc:'middle'}));

    // SEGMENT: Combiner → AC Disco
    parts.push(wireSeg(node3RX,discoResult.loadInX,resolveSegY(node3RX,discoResult.loadInX,BUS_Y),
      ['#10 AWG THWN-2','1\u00d7#'+egcNum+' GRN EGC','IN 3/4" EMT']));

    // NODE 6: MSP
    const mspResult=renderMSPLoad(xMSP,BUS_Y,mainAmps,pvBreakerAmps,5);
    parts.push(mspResult.svg);

    // SEGMENT: AC Disco LINE → MSP
    parts.push(wireSeg(discoResult.lineOutX,mspResult.bkfdInX,resolveSegY(discoResult.lineOutX,mspResult.bkfdInX,BUS_Y),
      ['#10 AWG THWN-2','1\u00d7#'+egcNum+' GRN EGC','IN 3/4" EMT']));

    let buiRX=mspResult.rx;

    // NODE 8: BUI + BATTERY (if battery)
    if(hasBattery) {
      const buiCX=xMSP+130, buiCY=BUS_Y;
      const buiResult=renderBUI(buiCX,buiCY,'Enphase','IQ System Controller 3',200,true,false,7);
      parts.push(buiResult.svg);
      buiRX=buiResult.rx;

      // Wire: MSP → BUI GRID
      parts.push(ln(mspResult.rx,buiResult.gridPortY,buiResult.gridPortX,buiResult.gridPortY,{stroke:BLK,sw:SW_MED}));
      if(Math.abs(buiResult.gridPortY-BUS_Y)>2) parts.push(ln(mspResult.rx,BUS_Y,mspResult.rx,buiResult.gridPortY,{stroke:BLK,sw:SW_MED}));

      // Battery backfeed breaker at MSP
      const bfX=xMSP+30;
      parts.push(breakerSymbol(bfX,BUS_Y+30,20,12,batteryBackfeedA));
      parts.push(ln(bfX,BUS_Y,bfX,BUS_Y+24,{sw:SW_THIN,stroke:'#1565C0'}));
      parts.push(txt(bfX,BUS_Y+48,`${batteryBackfeedA}A BATT`,{sz:5,anc:'middle',bold:true,fill:'#1565C0'}));
      parts.push(txt(bfX,BUS_Y+56,'NEC 705.12(B)',{sz:4.5,anc:'middle',italic:true,fill:'#1565C0'}));

      // Battery symbol above BUI
      const batCX=buiCX, batCY=BUS_Y-120;
      const batResult=renderBattery(batCX,batCY,batteryModel,batteryKwh,batteryBackfeedA,8);
      parts.push(batResult.svg);

      // Wire: Battery → BUI BATTERY port
      parts.push(ln(batResult.acOutX,batResult.acOutY,buiResult.batPortX,buiResult.batPortY,{stroke:'#1565C0',sw:SW_MED,dash:'6,3'}));
      parts.push(tspan(batResult.acOutX+8,batResult.acOutY+(buiResult.batPortY-batResult.acOutY)/2,
        ['#10 AWG THWN-2',`${batteryBackfeedA}A CIRCUIT`],{sz:F.tiny,anc:'start',fill:'#1565C0'}));
    }

    // NODE 7: UTILITY METER
    const utilCX=xUtil, utilCY=BUS_Y, mR=24;
    parts.push(wireSeg(buiRX,utilCX-mR-10,resolveSegY(buiRX,utilCX-mR-10,BUS_Y),
      ['#10 AWG THWN-2','1\u00d7#'+egcNum+' GRN EGC','IN 3/4" EMT']));
    parts.push(`<circle cx="${utilCX}" cy="${utilCY}" r="${mR}" fill="${WHT}" stroke="${BLK}" stroke-width="${SW_MED}"/>`);
    parts.push(txt(utilCX,utilCY+3,'M',{sz:14,bold:true,anc:'middle'}));
    parts.push(ln(utilCX-mR-10,utilCY,utilCX-mR,utilCY,{sw:SW_MED}));
    parts.push(txt(utilCX,utilCY-mR-15,'UTILITY METER',{sz:F.hdr,bold:true,anc:'middle'}));
    parts.push(txt(utilCX,utilCY-mR-6,esc(utilityName),{sz:F.sub,anc:'middle'}));
    parts.push(txt(utilCX,utilCY+mR+9,'120/240V, 1\u00d8, 3W',{sz:F.tiny,anc:'middle'}));
    parts.push(callout(utilCX+mR+14,utilCY-mR-5,6));

    // Utility grid drop
    const gridCY=utilCY+mR+48;
    parts.push(ln(utilCX,utilCY+mR,utilCX,gridCY-16,{sw:SW_MED}));
    parts.push(circ(utilCX,gridCY,16,{fill:WHT,sw:SW_MED}));
    parts.push(txt(utilCX,gridCY-1,'UTIL',{sz:5.5,bold:true,anc:'middle'}));
    parts.push(txt(utilCX,gridCY+7,'GRID',{sz:5,anc:'middle'}));
    parts.push(txt(utilCX,gridCY+24,'UTILITY GRID',{sz:F.tiny,anc:'middle',bold:true}));
    parts.push(txt(utilCX,gridCY+33,esc(utilityName),{sz:F.tiny,anc:'middle'}));
    parts.push(ln(utilCX,gridCY+16,utilCX,gridCY+26,{sw:SW_MED}));
    parts.push(gnd(utilCX,gridCY+26));

    // GROUNDING RAIL
    const gndPts=[xJBox,xComb,xDisco,xMSP];
    const gx1=gndPts[0], gx2=gndPts[gndPts.length-1];
    parts.push(ln(gx1,GND_Y,gx2,GND_Y,{stroke:GRN,sw:SW_MED}));
    for(const gx of gndPts) {
      parts.push(ln(gx,BUS_Y+36,gx,GND_Y,{stroke:GRN,sw:SW_MED}));
      parts.push(gnd(gx,GND_Y));
    }
    parts.push(txt((gx1+gx2)/2,GND_Y-5,'EQUIPMENT GROUNDING CONDUCTORS \u2014 NEC 250.122 / NEC 690.43',{sz:F.tiny,anc:'middle',fill:GRN}));

    // RAPID SHUTDOWN
    const rY=SCH_Y+SCH_H-22;
    parts.push(rect(SCH_X+5,rY-10,290,16,{fill:WHT,stroke:BLK,sw:SW_THIN}));
    parts.push(txt(SCH_X+10,rY,'RAPID SHUTDOWN \u2014 NEC 690.12 COMPLIANT \u2014 INTEGRATED IN IQ8M MICROINVERTERS',{sz:F.tiny,bold:true}));

    // LEGEND
    const legEntries=[
      {dash:'',    stroke:BLK,       label:'AC Conductor in Conduit (THWN-2)'},
      {dash:'10,5',stroke:GRN,       label:'Open Air \u2014 PV Wire/THWN-2 (NEC 690.31)'},
      {dash:'',    stroke:GRN,       label:'Equipment Grounding Conductor (EGC)'},
      ...(hasBattery?[{dash:'6,3',stroke:'#1565C0',label:'Battery AC-Coupled Connection'}]:[]),
    ];
    const legH=16+legEntries.length*11;
    const legX=SCH_X+SCH_W-195, legY=SCH_Y+SCH_H-legH-4;
    parts.push(rect(legX,legY,188,legH,{fill:WHT,stroke:BLK,sw:SW_THIN}));
    parts.push(txt(legX+4,legY+10,'LEGEND',{sz:F.sub,bold:true}));
    parts.push(ln(legX,legY+13,legX+188,legY+13,{sw:SW_THIN}));
    legEntries.forEach((item,i)=>{
      const ly=legY+19+i*11;
      parts.push(ln(legX+4,ly,legX+38,ly,{stroke:item.stroke,sw:SW_MED,dash:item.dash||undefined}));
      parts.push(txt(legX+44,ly+3,item.label,{sz:F.tiny}));
    });

    // CALCULATION PANELS (3 panels)
    const cW=Math.floor(DW/3)-4;
    const dcKw=totalPanels*panelWatts/1000;
    const md=deviceCount, ab=nBranches;
    const ba=branchOcpd;

    // Panel 1: AC Branch Circuit Info
    const p1x=DX;
    parts.push(rect(p1x,CALC_Y,cW,CALC_H,{fill:WHT,stroke:BLK,sw:SW_THIN}));
    parts.push(rect(p1x,CALC_Y,cW,14,{fill:BLK,sw:0}));
    parts.push(txt(p1x+cW/2,CALC_Y+10,'AC BRANCH CIRCUIT INFO',{sz:F.hdr,bold:true,anc:'middle',fill:WHT}));
    const rows1=[
      ['Topology','MICROINVERTER'],
      ['Microinverters',`${md} units`],
      ['Total DC Power',`${dcKw.toFixed(2)} kW`],
      ['AC per Micro',`${Math.round(totalAcKw*1000/md)} W`],
      ['Branch Circuits',`${ab}`],
      ['Max Micros/Branch','16 (NEC 690.8)'],
      ['Branch OCPD',`${ba} A`],
      ['Branch Wire','#10 AWG THWN-2'],
      ['Feeder Wire',acWireGauge],
      ['Feeder Conduit',`3/4" ${acCondType}`],
      ['Module Voc',`${panelVoc} V`],
      ['Module Isc',`${panelIsc} A`],
    ];
    const rh1=Math.min(13,(CALC_H-17)/rows1.length);
    rows1.forEach(([l,v],i)=>{
      const ry=CALC_Y+19+i*rh1;
      if(i%2===1) parts.push(rect(p1x,ry-rh1+2,cW,rh1,{fill:LGY,stroke:'none',sw:0}));
      parts.push(txt(p1x+4,ry,l,{sz:F.tiny}));
      parts.push(txt(p1x+cW-4,ry,v,{sz:F.tiny,anc:'end',bold:true}));
    });

    // Panel 2: AC System Calculations
    const p2x=DX+cW+4;
    const _batBfA = hasBattery ? batteryBackfeedA : 0;
    const _totalBfA = pvBreakerAmps + _batBfA;
    const _busLimit = mainAmps * 1.2;
    const _120pass = _busLimit >= mainAmps + _totalBfA;
    parts.push(rect(p2x,CALC_Y,cW,CALC_H,{fill:WHT,stroke:BLK,sw:SW_THIN}));
    parts.push(rect(p2x,CALC_Y,cW,14,{fill:BLK,sw:0}));
    parts.push(txt(p2x+cW/2,CALC_Y+10,'AC SYSTEM CALCULATIONS',{sz:F.hdr,bold:true,anc:'middle',fill:WHT}));
    const rows2=[
      ['AC Output (kW)',`${totalAcKw.toFixed(2)} kW`],
      ['AC Output Amps',`${acOutputAmps.toFixed(1)} A`],
      ['AC OCPD (125%)',`${acOCPD} A`],
      ['AC Wire Gauge',acWireGauge],
      ['AC Conduit Type',acCondType],
      ['Conduit Size',acConduit],
      ['Service Voltage','120/240V, 1\u00d8'],
      ['Main Panel Rating',`${mainAmps} A`],
      ['Interconnection','Load Side Tap'],
      ['NEC Reference','NEC 705.12(B)'],
      ['PV Breaker',`${pvBreakerAmps} A`],
      ...(_batBfA>0?[['Batt. Backfeed Bkr',`${_batBfA} A`]]:[]),
      ['Total Backfeed',`${_totalBfA} A`],
      ['Bus 120% Limit',`${_busLimit.toFixed(0)} A`],
      ['120% Rule',`${_120pass?'PASS \u2713':'FAIL \u2717'}`],
    ];
    const rh2=Math.min(13,(CALC_H-17)/rows2.length);
    rows2.forEach(([l,v],i)=>{
      const ry=CALC_Y+19+i*rh2;
      if(i%2===1) parts.push(rect(p2x,ry-rh2+2,cW,rh2,{fill:LGY,stroke:'none',sw:0}));
      parts.push(txt(p2x+4,ry,l,{sz:F.tiny}));
      const isPF=v.includes('\u2713')||v.includes('\u2717');
      const vc2=isPF?(v.includes('\u2713')?PASS:FAIL):BLK;
      parts.push(txt(p2x+cW-4,ry,v,{sz:F.tiny,anc:'end',bold:true,fill:vc2}));
    });

    // Panel 3: Equipment Schedule
    const p3x=DX+(cW+4)*2;
    parts.push(rect(p3x,CALC_Y,cW,CALC_H,{fill:WHT,stroke:BLK,sw:SW_THIN}));
    parts.push(rect(p3x,CALC_Y,cW,14,{fill:BLK,sw:0}));
    parts.push(txt(p3x+cW/2,CALC_Y+10,'EQUIPMENT SCHEDULE',{sz:F.hdr,bold:true,anc:'middle',fill:WHT}));
    const rows3=[
      ['PV Module',esc(panelModel)],
      ['Module Wattage',`${panelWatts} W`],
      ['Total Modules',`${totalPanels}`],
      ['Microinverters',`${md} units`],
      ['Branch Circuits',`${ab}`],
      ['Inverter Mfr.',esc(inverterMfr)],
      ['Inverter Model',esc(inverterModel)],
      ['Inverter Output',`${totalAcKw.toFixed(2)} kW AC`],
      ['AC Combiner','Enphase IQ Combiner 5C'],
      ['AC Disconnect',`${acOCPD}A Non-Fused`],
      ['Main Panel',`${mainAmps} A`],
      ['Utility',esc(utilityName)],
      ['Interconnection','LOAD_SIDE'],
      ['Rapid Shutdown','INTEGRATED'],
      ['Battery Storage',hasBattery?esc(batteryModel):'NONE'],
      ...(hasBattery&&batteryKwh?[['Battery Capacity',`${batteryKwh.toFixed(1)} kWh`]]:[]),
      ...(hasBattery?[['Batt. Backfeed',`${batteryBackfeedA}A \u2014 NEC 705.12(B)`]]:[]),
    ];
    const rh3=Math.min(12,(CALC_H-17)/rows3.length);
    rows3.forEach(([l,v],i)=>{
      const ry=CALC_Y+19+i*rh3;
      if(i%2===1) parts.push(rect(p3x,ry-rh3+2,cW,rh3,{fill:LGY,stroke:'none',sw:0}));
      parts.push(txt(p3x+4,ry,l,{sz:F.tiny}));
      parts.push(txt(p3x+cW-4,ry,v,{sz:F.tiny,anc:'end',bold:true}));
    });

    // CONDUIT & CONDUCTOR SCHEDULE
    parts.push(rect(DX,SCHED_Y,DW,SCHED_H,{fill:WHT,stroke:BLK,sw:SW_THIN}));
    parts.push(rect(DX,SCHED_Y,DW,14,{fill:BLK,sw:0}));
    parts.push(txt(DX+6,SCHED_Y+10,'CONDUIT & CONDUCTOR SCHEDULE \u2014 NEC 310 / NEC CHAPTER 9 TABLE 1',{sz:F.hdr,bold:true,fill:WHT}));
    const sCols=[
      {label:'RUN ID',w:0.07},{label:'FROM',w:0.11},{label:'TO',w:0.11},
      {label:'CONDUCTORS',w:0.28},{label:'CONDUIT',w:0.10},{label:'FILL %',w:0.06},
      {label:'AMPACITY',w:0.07},{label:'OCPD',w:0.06},{label:'V-DROP %',w:0.07},
      {label:'LENGTH',w:0.06},{label:'PASS',w:0.05},
    ];
    const hY=SCHED_Y+24, rH=13;
    let cx2=DX;
    sCols.forEach(col=>{
      const cw2=col.w*DW;
      parts.push(txt(cx2+3,hY,col.label,{sz:F.tiny,bold:true}));
      parts.push(ln(cx2,SCHED_Y+14,cx2,SCHED_Y+SCHED_H,{sw:SW_HAIR}));
      cx2+=cw2;
    });
    parts.push(ln(DX,hY+2,DX+DW,hY+2,{sw:SW_THIN}));

    const acAmp=(totalAcKw*1000/240).toFixed(1);
    const sRows=[
      {id:'BR-1',from:'PV ARRAY',to:'ROOF J-BOX',conductors:'#10 AWG THWN-2 + 1\u00d7#10 GRN EGC',conduit:'OPEN AIR',fill:0,amp:parseFloat(acAmp),ocpd:branchOcpd,vdrop:0.8,len:50,pass:true},
      {id:'BR-2',from:'ROOF J-BOX',to:'AC COMBINER',conductors:'#10 AWG THWN-2 + 1\u00d7#10 GRN EGC',conduit:'3/4" EMT',fill:38.2,amp:parseFloat(acAmp),ocpd:branchOcpd,vdrop:1.2,len:30,pass:true},
      {id:'A-1', from:'AC COMBINER',to:'AC DISCONNECT',conductors:'#10 AWG THWN-2 + 1\u00d7#10 GRN EGC',conduit:'3/4" EMT',fill:38.2,amp:parseFloat(acAmp),ocpd:acOCPD,vdrop:1.4,len:20,pass:true},
      {id:'A-2', from:'AC DISCONNECT',to:'MSP',conductors:'#10 AWG THWN-2 + 1\u00d7#10 GRN EGC',conduit:'3/4" EMT',fill:38.2,amp:parseFloat(acAmp),ocpd:acOCPD,vdrop:1.4,len:15,pass:true},
      ...(hasBattery?[{id:'BAT-1',from:'IQ BATTERY 5P',to:'IQ SYS CTRL',conductors:'#10 AWG THWN-2 + 1\u00d7#10 GRN EGC',conduit:'3/4" EMT',fill:38,amp:46,ocpd:batteryBackfeedA,vdrop:0.5,len:10,pass:true}]:[]),
      {id:'SVC', from:'MSP',to:'UTILITY METER',conductors:'SEE UTILITY SERVICE ENTRANCE',conduit:'SEE UTILITY',fill:0,amp:mainAmps,ocpd:mainAmps,vdrop:0,len:5,pass:true},
    ];
    const maxRows=Math.floor((SCHED_H-30)/rH);
    sRows.slice(0,maxRows).forEach((row,ri)=>{
      const ry=hY+4+(ri+1)*rH;
      if(ri%2===1) parts.push(rect(DX,ry-rH+2,DW,rH,{fill:LGY,stroke:'none',sw:0}));
      const pc=row.pass?PASS:FAIL, pv=row.pass?'\u2713 PASS':'\u2717 FAIL';
      const vals=[row.id,row.from,row.to,row.conductors,row.conduit,
        row.fill>0?`${row.fill.toFixed(1)}%`:(row.conduit==='OPEN AIR'?'N/A':'\u2014'),
        row.amp>0?`${row.amp}A`:'\u2014',
        row.ocpd>0?`${row.ocpd}A`:'\u2014',
        row.vdrop>0?`${row.vdrop.toFixed(2)}%`:'\u2014',
        row.len>0?`${row.len} FT`:'\u2014',
        pv];
      let cx3=DX;
      sCols.forEach((col,ci)=>{
        const cw3=col.w*DW;
        parts.push(txt(cx3+3,ry,String(vals[ci]??''),{sz:F.tiny,fill:ci===10?pc:BLK,bold:ci===10}));
        cx3+=cw3;
      });
    });

    // TITLE BLOCK
    const tbX=TB_X, tbY=DY, tbH=DH;
    parts.push(rect(tbX,tbY,TB_W,tbH,{fill:WHT,stroke:BLK,sw:SW_HEAVY}));
    parts.push(rect(tbX,tbY,TB_W,38,{fill:BLK,sw:0}));
    parts.push(txt(tbX+TB_W/2,tbY+15,'SOLARPRO',{sz:13,bold:true,anc:'middle',fill:WHT}));
    parts.push(txt(tbX+TB_W/2,tbY+28,'ENGINEERING',{sz:F.tb,anc:'middle',fill:'#AAAAAA'}));
    parts.push(rect(tbX,tbY+38,TB_W,30,{fill:WHT,stroke:BLK,sw:SW_THIN}));
    parts.push(txt(tbX+TB_W/2,tbY+51,'SINGLE LINE DIAGRAM',{sz:F.tbTitle,bold:true,anc:'middle'}));
    parts.push(txt(tbX+TB_W/2,tbY+63,'PHOTOVOLTAIC SYSTEM',{sz:F.tb,anc:'middle'}));
    parts.push(rect(tbX,tbY+68,TB_W,10,{fill:'#1B5E20',stroke:'none',sw:0}));
    parts.push(txt(tbX+TB_W/2,tbY+76,'SolarPro V4 \u2014 IEEE/ANSI SLD',{sz:4.5,bold:true,anc:'middle',fill:WHT}));

    const tbRowData=[
      ['PROJECT',project.projectName||'\u2014'],
      ['CLIENT',project.clientName||'\u2014'],
      ['ADDRESS',(project.address||'\u2014').substring(0,30)],
      ['DESIGNER',project.designer||'\u2014'],
      ['DATE',project.date||'\u2014'],
      ['DWG NO.','E-1'],
      ['REVISION','A'],
      ['SCALE','NOT TO SCALE'],
    ];
    let tbY2=tbY+78;
    const tbRH=20;
    tbRowData.forEach(([l,v])=>{
      parts.push(rect(tbX,tbY2,TB_W,tbRH,{fill:WHT,stroke:BLK,sw:SW_HAIR}));
      parts.push(txt(tbX+4,tbY2+13,l,{sz:F.tiny,bold:true,fill:'#555'}));
      parts.push(txt(tbX+62,tbY2+13,esc(String(v??'')),{sz:F.tb}));
      tbY2+=tbRH;
    });

    // System summary in title block
    const sysY=tbY2+3;
    parts.push(rect(tbX,sysY,TB_W,12,{fill:BLK,sw:0}));
    parts.push(txt(tbX+TB_W/2,sysY+9,'SYSTEM SUMMARY',{sz:F.sub,bold:true,anc:'middle',fill:WHT}));
    const sysRows=[
      ['TOPOLOGY','MICROINVERTER'],
      ['DC SIZE',`${dcKw.toFixed(2)} kW`],
      ['AC OUTPUT',`${totalAcKw.toFixed(2)} kW`],
      ['MODULES',`${totalPanels} \u00d7 ${panelWatts}W`],
      ['INVERTER',esc(inverterMfr)],
      ['MODEL',esc(inverterModel)],
      ['SERVICE',`${mainAmps}A`],
      ['UTILITY',esc(utilityName)],
      ['INTERCONN.','LOAD_SIDE'],
    ];
    let sysY2=sysY+12;
    const sysRH=16;
    sysRows.forEach(([l,v])=>{
      parts.push(rect(tbX,sysY2,TB_W,sysRH,{fill:WHT,stroke:BLK,sw:SW_HAIR}));
      parts.push(txt(tbX+4,sysY2+11,l,{sz:F.tiny,bold:true,fill:'#555'}));
      parts.push(txt(tbX+70,sysY2+11,esc(String(v??'')),{sz:F.tb}));
      sysY2+=sysRH;
    });

    // Code references
    const codeY=sysY2+3;
    parts.push(rect(tbX,codeY,TB_W,12,{fill:BLK,sw:0}));
    parts.push(txt(tbX+TB_W/2,codeY+9,'CODE REFERENCES',{sz:F.sub,bold:true,anc:'middle',fill:WHT}));
    const codes=[
      '\u2022 NEC 690 \u2014 PV SYSTEMS',
      '\u2022 NEC 705 \u2014 INTERCONNECTED ELEC.',
      '\u2022 NEC 706 \u2014 ENERGY STORAGE',
      '\u2022 NEC 310 \u2014 CONDUCTORS',
      '\u2022 NEC 250 \u2014 GROUNDING/BONDING',
      '\u2022 NEC 358/352 \u2014 CONDUIT',
      '\u2022 NEC 230 \u2014 SERVICES',
      '\u2022 IBC / ASCE 7 \u2014 STRUCTURAL',
    ];
    let codeY2=codeY+12;
    codes.forEach(c=>{ parts.push(txt(tbX+4,codeY2+9,c,{sz:F.tiny})); codeY2+=12; });

    // Revisions
    const revY=codeY2+3, revH=Math.min(80,tbY+tbH-revY-50);
    if(revH>24){
      parts.push(rect(tbX,revY,TB_W,12,{fill:BLK,sw:0}));
      parts.push(txt(tbX+TB_W/2,revY+9,'REVISIONS',{sz:F.sub,bold:true,anc:'middle',fill:WHT}));
      parts.push(rect(tbX,revY+12,TB_W,revH,{fill:WHT,stroke:BLK,sw:SW_THIN}));
      const rcw=TB_W/3;
      parts.push(txt(tbX+3,revY+22,'REV',{sz:F.tiny,bold:true}));
      parts.push(txt(tbX+rcw+3,revY+22,'DESCRIPTION',{sz:F.tiny,bold:true}));
      parts.push(txt(tbX+rcw*2+3,revY+22,'DATE',{sz:F.tiny,bold:true}));
      parts.push(ln(tbX,revY+24,tbX+TB_W,revY+24,{sw:SW_HAIR}));
      parts.push(ln(tbX+rcw,revY+12,tbX+rcw,revY+revH,{sw:SW_HAIR}));
      parts.push(ln(tbX+rcw*2,revY+12,tbX+rcw*2,revY+revH,{sw:SW_HAIR}));
      parts.push(txt(tbX+3,revY+34,'A',{sz:F.tiny}));
      parts.push(txt(tbX+rcw+3,revY+34,'INITIAL ISSUE FOR PERMIT',{sz:F.tiny}));
      parts.push(txt(tbX+rcw*2+3,revY+34,project.date||'\u2014',{sz:F.tiny}));
    }

    // Engineer seal
    const sealY=tbY+tbH-50;
    parts.push(rect(tbX,sealY,TB_W,50,{fill:WHT,stroke:BLK,sw:SW_THIN}));
    parts.push(circ(tbX+TB_W/2,sealY+22,18,{fill:WHT,stroke:BLK,sw:SW_THIN}));
    parts.push(txt(tbX+TB_W/2,sealY+19,'ENGINEER',{sz:F.tiny,anc:'middle',fill:'#888'}));
    parts.push(txt(tbX+TB_W/2,sealY+28,'SEAL',{sz:F.tiny,anc:'middle',fill:'#888'}));
    parts.push(txt(tbX+TB_W/2,sealY+44,`${esc(project.designer||'SolarPro Engineering')} \u2014 ${esc(project.date||'')}`,{sz:F.tiny,anc:'middle',fill:'#555'}));

    parts.push('</svg>');
    return parts.join('\n');
  }

  // Build the SVG content
  const svgContent = buildSLD();

  // Wrap in the permit page structure
  return `
  <div class="page sld-page">
    ${titleBlock(input, "E-1", "SINGLE-LINE ELECTRICAL DIAGRAM", pageNum, totalPages)}
    <div style="padding:0;overflow:hidden;width:100%;flex:1;margin:0;display:flex;align-items:flex-start;justify-content:center;">
        ${svgContent}
    </div>
  </div>`;
}

function generatePermitHTML(input) {
  const { project } = input;
  const TOTAL = 11;
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
    pageSingleLineDiagram(input, 11, TOTAL)
  ];
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Permit Package \u2014 ${project.projectName}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Arial',sans-serif; font-size:10px; color:#1e293b; background:white; }

  /* Page */
  .page { width:17in; min-height:22in; padding:0.45in; page-break-after:always; display:flex; flex-direction:column; }
  .sld-page { padding:0.2in 0.2in 0.1in 0.2in; }
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
${pages.join("\n")}
</body>
</html>`;
}

export { generatePermitHTML };
