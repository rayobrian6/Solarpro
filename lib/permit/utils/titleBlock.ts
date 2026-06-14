// ═══════════════════════════════════════════════════════════════
// Title Block & Construction Notes
// Extracted from route.ts — ZERO REGRESSION
// ═══════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import { utilityDisplayName, resolveEquipment } from './helpers';
import type { ResolvedEquipment } from '../types';


// ─── Title Block (shared across all pages) ───────────────────────────────────

export function titleBlock(
  input: PermitInput,
  sheetId: string,
  pageTitle: string,
  pageNum: number,
  totalPages: number
): string {
  const { project, compliance, system } = input;
  const necVer  = compliance.jurisdiction?.necVersion || '2023';
  const ibcVer  = '2021';
  const ircVer  = '2021';
  const ifcVer  = necVer === '2023' ? '2024' : '2021';
  const state   = compliance.jurisdiction?.state || '—';
  const ahj     = compliance.jurisdiction?.ahj   || project.ahj || '—';
  // FIX v47.341: Convert utility slug to display name in title block
  const utility = utilityDisplayName(project.utilityName || project.utilityMeter || '') || '—';
  const apn     = project.apn || '—';

  // Resolve module and inverter models for title block
  const firstInv = system?.inverters?.[0];
  const firstStr = firstInv?.strings?.[0];
  const moduleModel   = firstStr?.panelModel    || project.moduleModel    || project.panelModel    || '—';
  const moduleMfr     = firstStr?.panelManufacturer || project.moduleMfr  || '';
  const inverterModel = firstInv?.model          || project.inverterModel || '—';
  const inverterMfr   = firstInv?.manufacturer   || project.inverterMfr  || '';
  const moduleDisplay   = [moduleMfr, moduleModel].filter(Boolean).join(' ') || '—';
  const inverterDisplay = [inverterMfr, inverterModel].filter(Boolean).join(' ') || '—';
  const systemSizeKw    = system?.totalDcKw ? `${system.totalDcKw.toFixed(2)} kW DC` : '—';
  const panelCount      = system?.totalPanels ? `${system.totalPanels} modules` : '';

  return `
  <div class="title-block">
    <div class="tb-left">
      <div class="tb-company">SOLARPRO ENGINEERING</div>
      <div class="tb-project">${project.projectName || 'SOLAR PV SYSTEM'}</div>
      <div class="tb-address">${project.address || '—'}</div>
      <div class="tb-client">CLIENT: ${project.clientName || '—'}</div>
      <div class="tb-meta">APN: ${apn} &nbsp;|&nbsp; UTILITY: ${utility}</div>
      <div class="tb-meta">AHJ: ${ahj} &nbsp;|&nbsp; ${state}</div>
    </div>
    <div class="tb-center">
      <div class="tb-sheet-id">${sheetId}</div>
      <div class="tb-sheet-title">${pageTitle}</div>
      <div class="tb-codes">NEC ${necVer} &middot; IBC ${ibcVer} &middot; IRC ${ircVer} &middot; IFC ${ifcVer} &middot; ASCE 7-22</div>
      <div class="tb-size">SHEET SIZE: ANSI B &mdash; 11&Prime; &times; 17&Prime;</div>
    </div>
    <div class="tb-right">
      <table class="tb-table">
        <tr><td class="tbl">DESIGNER</td><td class="tbv">${project.designer || '—'}</td></tr>
        <tr><td class="tbl">DATE</td><td class="tbv">${project.date}</td></tr>
        <tr><td class="tbl">SHEET</td><td class="tbv">${pageNum} OF ${totalPages}</td></tr>
        <tr><td class="tbl">SYSTEM</td><td class="tbv">${systemSizeKw}${panelCount ? ' / ' + panelCount : ''}</td></tr>
        <tr><td class="tbl">MODULE</td><td class="tbv">${moduleDisplay}</td></tr>
        <tr><td class="tbl">INVERTER</td><td class="tbv">${inverterDisplay}</td></tr>
        <tr><td class="tbl">UTILITY</td><td class="tbv">${utility}</td></tr>
        <tr><td class="tbl">AHJ</td><td class="tbv">${ahj}</td></tr>
        <tr class="tb-rev-hdr"><td class="tbl" colspan="2" style="text-align:center;font-weight:900;background:#000;color:#fff;letter-spacing:0.5px;">REVISIONS</td></tr>
        <tr><td class="tbl">REV A</td><td class="tbv">ISSUED FOR PERMIT &mdash; ${project.date}</td></tr>
        <tr><td class="tbl">SCALE</td><td class="tbv">NTS</td></tr>
        <tr><td class="tbl">PE SEAL</td><td class="tbv"><div class="pe-seal-box">SEAL / STAMP REQUIRED</div></td></tr>
      </table>
    </div>
  </div>`;
}

// ─── Construction Notes (NEC-specific, system-config-aware) ──────────────────

export function buildConstructionNotes(input: PermitInput): string[] {
  const { project, compliance } = input;
  const necVer = compliance.jurisdiction?.necVersion || '2023';
  const ibcVer = '2021';
  const ifcVer = necVer === '2023' ? '2024' : '2021';
  const notes: string[] = [
    `All work shall conform to NEC ${necVer}, ${ibcVer} IBC, ${ibcVer} IRC, ${ifcVer} IFC, ASCE 7-22, applicable state amendments, and AHJ requirements. All equipment shall be listed and labeled per NEC 110.3(B).`,
    `Solar PV wiring shall comply with NEC Article 690. DC wiring methods shall be per NEC 690.31. PV source and output circuit conductors shall be identified at all access points per NEC 690.31(B).`,
    `System shall comply with NEC 705.12 for interconnected power production equipment. Backfeed breaker shall be sized per NEC 705.12(B)(2)(3)(b). Sum of all supply breakers shall not exceed 120% of bus rating.`,
    project.rapidShutdown
      ? `Rapid shutdown system required per NEC 690.12. Module-level rapid shutdown (MLRS) shall reduce array conductors to \u2264 30V within 30 seconds. Initiator shall be located at utility meter per NEC 690.56(B).`
      : `Rapid shutdown initiator shall be installed per NEC 690.12. Array boundary conductors shall be de-energized to \u2264 30V within 30 seconds of initiation.`,
    `All conductors shall be sized per NEC 310.15. Temperature correction (NEC 310.15(B)(1)) and conduit fill derating (NEC 310.15(C)(1)) shall be applied. PV conductor ampacity minimum 125% of maximum circuit current per NEC 690.8(B).`,
    `Conduit type: ${project.conduitType || 'EMT'}. All conduit supports per NEC 358.30 (EMT) or NEC 352.30 (PVC). Conduit fill shall not exceed 40% per NEC Chapter 9, Table 1.`,
    `Equipment grounding conductor (EGC) shall be sized per NEC 250.122. All metallic racking, module frames, and enclosures shall be bonded per NEC 690.43. DC EGC minimum: ${project.wireGauge || '#10 AWG'} per NEC 690.45.`,
    `${project.acDisconnect ? 'AC disconnect switch required and shown on SLD' : 'AC disconnect — see SLD for requirements'}. Disconnect shall be within sight of inverter, accessible, and rated for available fault current per NEC 690.15.`,
    `Inverter(s) shall be UL 1741-listed and comply with IEEE 1547 for grid interconnection. Anti-islanding protection required per NEC 705.40. Inverter output circuit rated per NEC 705.12 and manufacturer requirements.`,
    `Photovoltaic source circuit conductors shall be marked or tagged "PHOTOVOLTAIC POWER SOURCE" at all accessible locations per NEC 690.31(B). Markings shall be sunlight-resistant and moisture-resistant.`,
    `GFDI (Ground Fault Detection and Interruption) shall be provided as integrated in the listed inverter(s) per NEC 690.41. DC arc-fault circuit interrupter (AFCI) shall be provided per NEC 690.11.`,
    `Warning labels and placards shall be installed per NEC 690.54, NEC 690.56(C), NEC 705.12(B)(2)(3)(e), and IFC ${ifcVer} \u00a7605.11.6. See sheet PV-5 for complete label schedule and placement diagram.`,
    // FIX v47.295: Only include roof attachment / flashing notes for roof systems
    ...((input.project)?.systemType === 'fence' || input.project?.systemType === 'solar_fence'
      ? [
          `Solar fence post foundations shall be installed per structural engineer specifications and attachment detail on sheet PV-3. Minimum embedment depth 3.5 ft below finish grade. Concrete footing min. 3,000 psi, 12" diameter min.`,
          `All metallic fence posts and frames shall be bonded to the equipment grounding conductor (EGC) per NEC 250.169 and NEC 690.43. Minimum #6 AWG copper bonding conductor required throughout fence structure.`,
        ]
      : input.project?.systemType === 'ground' || input.project?.systemType === 'ground_mount'
      ? [
          `Ground mount pile/pier foundations shall be installed per structural engineer specifications and attachment detail on sheet PV-3. Embedment depth per geotechnical requirements and ASCE 7-22.`,
          `All metallic racking, module frames, and enclosures shall be bonded per NEC 690.43. DC EGC minimum: #10 AWG per NEC 690.45. Ground array grounding per NEC 690.47 and 250.166.`,
        ]
      : [
          `Roof attachments shall be installed per manufacturer instructions and attachment detail on sheet PV-3. Lag bolts minimum 3/8" diameter, minimum 2.5" embedment into rafter. Use stainless steel hardware throughout.`,
          `Flashing shall be installed under all roof penetrations and sealed with approved sealant per manufacturer instructions. Verify roof framing at each attachment point. No attachments to sheathing only.`,
        ]),
    `Module-to-rail torque shall be per rail manufacturer specification. Rail splices installed per manufacturer details. All exposed hardware shall be stainless steel or corrosion-resistant equivalent per NEC 110.3(B).`,
    `All junction boxes, combiner boxes, and conduit bodies shall be accessible per NEC 314.29. Cover plates shall be secured and labeled. Box fill calculated per NEC 314.16.`,
    `Electrical contractor shall obtain all required permits prior to beginning work. Work shall be inspected by the AHJ before concealment per NEC 110.13. Maintain as-built drawings on-site during installation.`,
    `Installer shall verify utility interconnection requirements with ${utilityDisplayName(project.utilityName || '') || 'the serving utility'} prior to energization. Utility NEM/interconnection agreement required. Obtain AHJ final inspection and utility PTO before energizing.`,
    `All equipment shall be installed per manufacturer installation instructions. Field modifications to listed equipment are prohibited per NEC 110.3(B). Substitutions require engineer approval and AHJ re-submission.`,
    `System annual production estimate: ${(input.system.totalDcKw || 0) > 0 ? `${((input.system.totalDcKw || 0) * 1400).toFixed(0)} kWh/yr (estimated at 1,400 kWh/kW DC — site-specific irradiance not included)` : 'Per energy model — see engineering report'}. Production estimate does not constitute a performance guarantee.`,
  ];
  if (project.batteryCount && project.batteryCount > 0) {
    notes.push(`Battery energy storage system (BESS) shall comply with NEC Article 706 and NFPA 855. Installation location, clearances, and ventilation per manufacturer requirements and AHJ. BESS shall be UL 9540-listed.`);
    notes.push(`BESS automatic disconnect required for ground fault, overcurrent, or thermal runaway per NEC 706.20. Battery management system (BMS) shall be integrated. Thermal runaway protection per NFPA 855 \u00a74.3.3.`);
  }
  if (project.generatorKw && project.generatorKw > 0) {
    notes.push(`Generator interconnection shall comply with NEC Article 702 and NEC 705.12. Automatic transfer switch (ATS) shall prevent parallel operation with utility. ATS shall be UL 1008-listed.`);
  }
  return notes;
}



