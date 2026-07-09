// ═══════════════════════════════════════════════════════════════
// Certification Pages — Engineer Cert, PE Letters
// Extracted from route.ts — ZERO REGRESSION
// ═══════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import { titleBlock } from '../utils/titleBlock';
import { escapeH } from '../utils/drawing';
import { roofTypeLabel, hasRealBattery } from '../utils/helpers';
import { getEquipmentContext, isFence, isGround } from '@/lib/system';
import { getMountingSystemById } from '@/lib/mounting-hardware-db';
import { BUILD_VERSION } from '@/lib/version';

export function pageEngineerCert(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number): string {
  const { project, compliance } = input;
  const necVer = compliance.jurisdiction?.necVersion || '2020';
  const state = compliance.jurisdiction?.state || '—';
  const ahj = compliance.jurisdiction?.ahj || '—';
  const system = input.system;
  const sysSize = system?.totalDcKw?.toFixed(2) ?? '—';
  const sysAc = system?.totalAcKw?.toFixed(2) ?? '—';
  const panelCount = system?.totalPanels ?? 0;
  const eq_cert = getEquipmentContext(input, cad);
  const invModel = eq_cert.inverterModel !== '—' ? eq_cert.inverterModel : '';
  const address = escapeH(project.address || '—');
  return `
  <div class="page">
    ${titleBlock(input, 'CERT', 'ENGINEER CERTIFICATION', pageNum, totalPages)}
    <div class="page-content">
      <div class="cert-header">ENGINEER OF RECORD CERTIFICATION</div>
      <div class="cert-subject">
        <strong>PROJECT:</strong> ${escapeH(project.projectName || '—')} | <strong>ADDRESS:</strong> ${address} | <strong>SYSTEM:</strong> ${panelCount} modules, ${sysSize} kW DC / ${sysAc} kW AC | <strong>INVERTER:</strong> ${invModel}
      </div>
      ${(() => {
        // The compliance statement must not contradict the package's own
        // structural analysis (PE-1/PV-4C) — certifying "complies" over a
        // failing rafter check was an automatic-rejection contradiction.
        const _u = input.compliance?.structural?.rafter?.utilizationRatio;
        return _u != null && _u > 1.0 ? `
      <div style="border:3px solid #cc0000;background:#fff5f5;padding:var(--xs);margin-bottom:var(--xs);font-size:var(--f-md);line-height:1.5;">
        <strong style="color:#cc0000;">STRUCTURAL REVIEW REQUIRED:</strong>
        The roof framing analysis (PV-4C / PE-1) computes a governing utilization of ${(_u * 100).toFixed(0)}% under the modeled assumptions.
        This certification is limited to the electrical design until the structural condition is resolved by field verification of framing
        (size, spacing, span, species) or engineered reinforcement. Do not issue for construction on the structural scope.
      </div>` : '';
      })()}
      <div class="cert-statement">
        I hereby certify that the solar photovoltaic system design at <strong>${address}</strong> has been prepared under my direct supervision
        and ${(() => {
          const _u = input.compliance?.structural?.rafter?.utilizationRatio;
          return _u != null && _u > 1.0
            ? 'that the ELECTRICAL design complies with the following applicable codes and standards (structural scope pending — see notice above):'
            : 'complies with the following applicable codes and standards:';
        })()}
        <ul style="margin-top:var(--xs);line-height:1.6;padding-left:var(--md);">
          <li>National Electrical Code (NEC) ${necVer}, Article 690 — Solar Photovoltaic Systems</li>
          <li>National Electrical Code (NEC) ${necVer}, Article 705 — Interconnected Electric Power Production Sources</li>
          ${hasRealBattery(project) ? `<li>National Electrical Code (NEC) ${necVer}, Article 706 — Energy Storage Systems; NFPA 855</li>` : ''}
          <li>ASCE 7-22 — Minimum Design Loads and Associated Criteria for Buildings and Other Structures</li>
          <li>International Building Code (IBC) / International Residential Code (IRC) — Structural requirements</li>
          <li>International Fire Code (IFC) ${necVer === '2023' ? '2024' : '2021'} — §1204 Solar Photovoltaic Systems (rooftop access & pathways)</li>
          <li>All applicable local amendments adopted by ${state} and the Authority Having Jurisdiction (${ahj})</li>
        </ul>
      </div>
      <div class="cert-grid">
        <div>
          <div class="cert-block-title">PREPARED BY</div>
          <div class="cert-field"><div class="cf-val">${escapeH(project.designer || '________________________________')}</div><div class="cf-lbl">Designer / Engineer of Record</div></div>
          <div class="cert-field"><div class="cf-val">________________________________</div><div class="cf-lbl">Firm / Company Name</div></div>
          <div class="cert-field"><div class="cf-val">________________________________</div><div class="cf-lbl">PE License Number</div></div>
          <div class="cert-field"><div class="cf-val">________________________________</div><div class="cf-lbl">State of Licensure</div></div>
          <div class="cert-field"><div class="cf-val">________________________________</div><div class="cf-lbl">License Expiration Date</div></div>
          <!-- Blank — the PE dates this when signing. Prefilling the package
               issue date read as the expiration value of the field above. -->
          <div class="cert-field"><div class="cf-val">________________________________</div><div class="cf-lbl">Date of Certification</div></div>
          <div class="cert-field"><div class="cf-val">________________________________</div><div class="cf-lbl">Phone / Email</div></div>
          <div class="cert-field" style="margin-top:var(--sm)"><div class="cf-val" style="border-bottom:var(--border-hvy);padding-bottom:18px;">________________________________</div><div class="cf-lbl">Signature</div></div>
        </div>
        <div>
          <div class="cert-block-title">WET STAMP AREA</div>
          <div class="stamp-box" style="min-height:130px;border:3px solid #000;position:relative;">
            <div class=\"center\">
              <div style="font-size:28px;opacity:0.2">⬡</div>
              <div style="font-size:12px;color:#666;margin-top:6px;font-weight:700;letter-spacing:0.5px;">AFFIX SEAL HERE</div>
              <div style="font-size:9px;color:#999;margin-top:4px">Professional Engineer Wet Stamp</div>
              <div style="font-size:8px;color:#aaa;margin-top:2px">Required for AHJ Submission</div>
              <div style="font-size:8px;color:#bbb;margin-top:6px;font-style:italic;">Stamp must be raised or embossed seal</div>
            </div>
          </div>
          <div class="cert-block-title" class="mt-sm">REVISION HISTORY</div>
          <table class="equip-table" class="mt-sm">
            <thead><tr><th>Rev</th><th>Date</th><th>Description</th><th>By</th></tr></thead>
            <tbody>
              <tr><td class="fw7">A</td><td>${escapeH(String(project.date ?? ''))}</td><td>Initial Issue for Permit</td><td>${escapeH(project.designer || '—')}</td></tr>
              <tr><td class="c999">B</td><td class="c999">—</td><td class="c999">—</td><td class="c999">—</td></tr>
              <tr><td class="c999">C</td><td class="c999">—</td><td class="c999">—</td><td class="c999">—</td></tr>
            </tbody>
          </table>
          <div class="section-title">SLD Reference</div>
          <table class="info-table">
            <tr><td class="il">Sheet E-1</td><td class="iv">Single-Line Electrical Diagram — included in this plan set</td></tr>
          </table>
        </div>
      </div>
      <!-- Document Control -->
      <div style="margin-top:var(--xs);border:var(--border);font-size:var(--f-sm);">
        <div style="background:#000;color:#fff;padding:3px 6px;font-weight:900;font-size:8px;letter-spacing:0.8px;">DOCUMENT CONTROL</div>
        <table class="info-table" style="margin:0;">
          <tr><td class="il" style="width:120px;">Document ID</td><td class="iv">SP-PERMIT-${project.projectName ? project.projectName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 12).toUpperCase() : 'DRAFT'}-${project.date?.replace(/\//g, '') || 'UNDATED'}</td></tr>
          <tr><td class="il">Issue Date</td><td class="iv">${project.date || new Date().toLocaleDateString()}</td></tr>
          <tr><td class="il">Supersedes</td><td class="iv">— (Initial Issue)</td></tr>
          <tr><td class="il">Distribution</td><td class="iv">AHJ, Property Owner, Installing Contractor, Utility (as required)</td></tr>
        </table>
      </div>

      <!-- Liability Limitation -->
      <div style="margin-top:var(--xs);padding:var(--xs);font-size:7.5px;line-height:1.5;color:#666;border:var(--border);background:#fafafa;">
        <strong>LIMITATION OF LIABILITY:</strong>
        This engineering document is prepared for the specific project and installation address identified herein. It is not transferable to other projects or locations.
        The engineer of record’s liability is limited to the engineering design as documented. The installing contractor is responsible for field verification of all conditions,
        adherence to manufacturer installation requirements, and compliance with all applicable building codes. Any deviation from the approved design must be reported to the
        engineer of record prior to installation. This document expires 180 days from the date of certification unless extended in writing by the engineer of record.
      </div>

      <div class="cert-footer">
        Document date ${escapeH(String(project.date ?? '—'))} ·
        This document requires engineer review and wet stamp before AHJ submission.
        All equipment must be UL-listed and installed per manufacturer specifications and NEC ${necVer}.
      </div>
    </div>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
// PE-1: PE STRUCTURAL LETTER — THREE ISOLATED SYSTEM FAMILIES
// ══════════════════════════════════════════════════════════════════════════════
// pagePELetterFence  — fence post foundation authority, §29.4 language only
// pagePELetterGround — pile/pier authority, §27 language only
// pagePELetterRoof   — rafter + lag bolt authority, §26/27 language only
// pagePELetter()     — dispatcher: reads cad.systemType → calls correct family
// NO shared conditional blocks in letter bodies.
// ══════════════════════════════════════════════════════════════════════════════

// ─── SHARED PE LETTER PRIMITIVES ─────────────────────────────────────────────
// Signature block and footer are identical across all families — extracted once
function _peSigBlock(): string {
  return `
  <div class="sec">
    <div class="sec-hdr">PROFESSIONAL ENGINEER OF RECORD</div>
    <div class="sig-grid">
      <div class="sig-col">
        <div class="mb-sm f-sm">NAME: <span class="sig-underline-md">&nbsp;</span></div>
        <div class="mb-sm f-sm">PE LICENSE #: <span class="sig-underline-sm">&nbsp;</span></div>
        <div class="mb-sm f-sm">STATE OF LICENSURE: <span class="sig-underline-110">&nbsp;</span></div>
        <div class="mb-sm f-sm">DATE: <span class="sig-underline-md">&nbsp;</span></div>
        <div style="margin-top:20px;margin-bottom:4px;" class="f-sm">SIGNATURE: <span style="border-bottom:var(--border-hvy);display:inline-block;width:155px;">&nbsp;</span></div>
      </div>
      <div class="sig-col-stamp">
        <div class="f-sm fw9 caps mb-xs">PE SEAL / STAMP</div>
        <div class="stamp-box">
          <span class="f-xs fw7 caps c555">AFFIX<br/>SEAL<br/>HERE</span>
        </div>
      </div>
    </div>
  </div>`;
}

function _peFooter(): string {
  return `
  <div class="f-xs center mt-sm pt-xs" style="border-top:var(--border);">
    THIS LETTER IS PREPARED SPECIFICALLY FOR THE ABOVE-NAMED PROJECT AND INSTALLATION ADDRESS.
    IT IS NOT TRANSFERABLE TO OTHER PROJECTS OR LOCATIONS.
    STRUCTURAL DATA DERIVED FROM ASCE 7-22 AUTOMATED ANALYSIS. FIELD VERIFICATION REQUIRED.
  </div>`;
}

function _peProjectInfo(input: PermitInput): string {
  const { project, compliance } = input;
  const ahj   = compliance.jurisdiction?.ahj || '—';
  const state  = compliance.jurisdiction?.state || '—';
  return `
  <div class="section-title">Project Information</div>
  <table class="info-table" class="mb-xs">
    <tr><td class="il">Project Name</td><td class="iv" colspan="3">${escapeH(project.projectName || '—')}</td></tr>
    <tr><td class="il">Client / Owner</td><td class="iv">${escapeH(project.clientName || '—')}</td><td class="il">Date</td><td class="iv">${escapeH(String(project.date ?? ''))}</td></tr>
    <tr><td class="il">Installation Address</td><td class="iv" colspan="3">${escapeH(project.address || '—')}</td></tr>
    <tr><td class="il">AHJ</td><td class="iv">${ahj}</td><td class="il">State</td><td class="iv">${state}</td></tr>
    <tr><td class="il">Permit No.</td><td class="iv">___________________</td><td class="il">APN</td><td class="iv">${project.apn || '___________________'}</td></tr>
  </table>`;
}

function _peSiteLoading(input: PermitInput): string {
  const { compliance } = input;
  const structural = compliance.structural;
  const windSpeed  = structural?.wind?.windSpeed || '—';
  const snowLoad   = structural?.snow?.groundSnowLoad || '—';
  const exposure   = structural?.wind?.exposureCategory || '—';
  // AHJ-derived category before any default — the '|| D' fallback printed
  // SDC D on PE-1 while PV-0 printed the AHJ's CAT. B for the same site.
  const sdc        = compliance.structural?.seismic?.sdc || input.project.seismicCategory || '—';
  return `
  <tr class="bg-lt"><td class="il" colspan="4" style="font-weight:bold;text-align:center;">Site Loading Parameters</td></tr>
  <tr><td class="il">Design Wind Speed (Vult)</td><td class="iv">${windSpeed} mph</td><td class="il">Exposure Category</td><td class="iv">Cat. ${exposure}</td></tr>
  <tr><td class="il">Ground Snow Load (pg)</td><td class="iv">${snowLoad} psf</td><td class="il">Risk Category</td><td class="iv">II (Residential)</td></tr>
  <tr><td class="il">Seismic Design Category</td><td class="iv">${sdc}</td><td class="il">Importance Factor</td><td class="iv">1.0</td></tr>`;
}

// ─── FENCE PE LETTER ──────────────────────────────────────────────────────────
export function pagePELetterFence(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number): string {
  const { project, system, compliance } = input;
  const necVer  = compliance.jurisdiction?.necVersion || '2023';
  const ibcVer  = '2021';
  const state   = compliance.jurisdiction?.state || '—';
  const structural = compliance.structural;

  const windSpeed   = structural?.wind?.windSpeed || '—';
  const uplift      = structural?.wind?.upliftPerAttachment?.toFixed(0) || '—';
  const safetyFact  = structural?.attachment?.safetyFactor?.toFixed(2) || '—';
  const utilization = ((structural?.rafter?.utilizationRatio || 0) * 100).toFixed(0);

  const postEmbed   = cad.fence?.postEmbedM  ? (cad.fence.postEmbedM  * 3.281).toFixed(1) : '3.5';
  const postSpacing = cad.fence?.postSpacingM ? (cad.fence.postSpacingM * 3.281).toFixed(1) : '8.0';
  const panelHIn    = cad.fence?.panelHeightM ? (cad.fence.panelHeightM * 39.37).toFixed(0) + '"' : '72"';
  const exposure    = structural?.wind?.exposureCategory || project.exposureCategory || 'C';
  const mountSys    = project._canonical?.mountSystem || project.mountingSystem || 'Solar Fence Rail System';

  return `
  <div class="page">
    ${titleBlock(input, 'PE-1', 'PE STRUCTURAL LETTER OF COMPLIANCE', pageNum, totalPages)}
    <div class="page-content">

      <div class="bb-hvy pb-xs mb-sm">
        <div class="f-3xl fw9">LETTER OF STRUCTURAL COMPLIANCE</div>
        <div class="f-lg c555 mt-xs">Solar Photovoltaic System — Solar Fence Array</div>
        <div class="f-sm muted">Prepared under ASCE 7-22 &bull; ${ibcVer} IBC &bull; NEC ${necVer}</div>
      </div>

      <div class="two-col-layout">
        <div class="col-left">
          ${_peProjectInfo(input)}

          <div class="section-title">PV System Parameters</div>
          <table class="info-table" class="mb-xs">
            <tr><td class="il">Total Modules</td><td class="iv">${system.totalPanels || '—'}</td><td class="il">System Size</td><td class="iv">${system.totalDcKw?.toFixed(2) || '—'} kW DC</td></tr>
            <tr><td class="il">Module Model</td><td class="iv" colspan="3">${(() => { const _eq = getEquipmentContext(input, cad); return [_eq.panelManufacturer, _eq.panelModel].filter(s => s && s !== '—').join(' ') || '—'; })()}</td></tr>
            <tr><td class="il">Mounting System</td><td class="iv" colspan="3">${mountSys}</td></tr>
            <tr><td class="il">Rail Orientation</td><td class="iv">Horizontal along fence line</td><td class="il">Foundation</td><td class="iv">Concrete footing</td></tr>
          </table>

          <div class="section-title">Solar Fence Construction</div>
          <table class="info-table" class="mb-xs">
            <tr><td class="il">System Type</td><td class="iv">Solar Fence Array</td><td class="il">Panel Height</td><td class="iv">${panelHIn}</td></tr>
            <tr><td class="il">Post Type</td><td class="iv">Galvanized Steel Pipe / HSS</td><td class="il">Post Spacing</td><td class="iv">${postSpacing} ft O.C.</td></tr>
            <tr><td class="il">Foundation Type</td><td class="iv">Concrete Footing (cast-in-place)</td><td class="il">Embedment Depth</td><td class="iv">${postEmbed} ft min.</td></tr>
            <tr><td class="il">Concrete Strength</td><td class="iv">3,000 psi min.</td><td class="il">Hardware</td><td class="iv">Galvanized / Stainless Steel</td></tr>
            <tr><td class="il">Wind Code</td><td class="iv">ASCE 7-22 §29.4, Cf = 1.3</td><td class="il">Exposure</td><td class="iv">Category ${exposure}</td></tr>
          </table>
        </div>

        <div class="col-right">
          <div class="section-title">Structural Analysis Results (ASCE 7-22)</div>
          <table class="info-table" class="mb-xs">
            ${_peSiteLoading(input)}
            <tr class="bg-lt"><td class="il" colspan="4" style="font-weight:bold;text-align:center;">Post Foundation Capacity Analysis</td></tr>
            <tr><td class="il">Net Lateral Wind Load / Post</td><td class="iv">${uplift} lbs</td><td class="il">Post Embedment Capacity</td><td class="iv">Per ASCE 7-22 §29.4</td></tr>
            <tr><td class="il">Safety Factor (Overturning)</td><td class="iv" style="font-weight:bold;color:${Number(safetyFact) >= 1.5 ? '#000' : '#cc0000'};">${safetyFact} (min. 1.5 req.)</td><td class="il">Post Embedment Depth</td><td class="iv">${postEmbed} ft min.</td></tr>
            <tr class="bg-lt"><td class="il" colspan="4" style="font-weight:bold;text-align:center;">Governing Load Combination (ASCE 7-22 §2.4 — ASD)</td></tr>
            <tr><td class="il">Governing Combo</td><td class="iv">0.6D + 0.6W (Overturning)</td><td class="il">Code Reference</td><td class="iv">ASCE 7-22 §29.4</td></tr>
          </table>

          <div class="sec" style="margin-bottom:var(--xs);">
            <div class="sec-hdr">ENGINEER'S CERTIFICATION STATEMENT</div>
            <div class="sec-body">
              <div class="f-xs" style="line-height:1.6;">
                I, the undersigned, a licensed Professional Engineer in the State of <strong>${state}</strong>,
                hereby certify that I have reviewed the structural design of the above-described solar photovoltaic
                fence array installation and determined that the <strong>proposed solar fence post foundation system
                is adequate to support the additional loads imposed by the proposed fence-mounted PV array</strong>,
                based on the structural analysis performed in accordance with <strong>ASCE 7-22 §29.4</strong>,
                <strong>${ibcVer} IBC</strong>, and NEC ${necVer}.
              </div>
              <div class="f-sm mt-xs" style="line-height:1.6;">
                Post embedment depth, concrete footing size, and post section are confirmed adequate to resist
                wind overturning and lateral loads at the design wind speed of ${windSpeed} mph, Exposure Category ${exposure},
                per ASCE 7-22 §29.4 (Cf = 1.3). Dead load and ground snow load per ASCE 7-22 §26 and §7 respectively.
                Field conditions shall be verified by the installing contractor.
                Any deviations from the approved design shall be reported to the engineer of record prior to installation.
              </div>
            </div>
          </div>

          ${_peSigBlock()}
        </div>
      </div>

      ${_peFooter()}
    </div>
  </div>`;
}

// ─── GROUND MOUNT PE LETTER ───────────────────────────────────────────────────
export function pagePELetterGround(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number): string {
  const { project, system, compliance } = input;
  const necVer  = compliance.jurisdiction?.necVersion || '2023';
  const ibcVer  = '2021';
  const state   = compliance.jurisdiction?.state || '—';
  const structural = compliance.structural;

  const windSpeed   = structural?.wind?.windSpeed || '—';
  const uplift      = structural?.wind?.upliftPerAttachment?.toFixed(0) || '—';
  const safetyFact  = structural?.attachment?.safetyFactor?.toFixed(2) || '—';

  const arr0        = cad.ground?.arrays?.[0];
  const pileDepth   = arr0 ? (arr0.pileDepthM * 3.281).toFixed(1) : '5.0';
  const pileSpacing = arr0 ? (arr0.pileSpacingM * 3.281).toFixed(1) : '8.0';
  const groundClr   = arr0 ? (arr0.groundClearanceM * 39.37).toFixed(0) : '12';
  const tiltDeg     = arr0?.tiltDeg || 20;
  const structType  = arr0?.structureType || 'driven steel pipe pile';
  const exposure    = structural?.wind?.exposureCategory || project.exposureCategory || 'C';
  const mountSys    = project._canonical?.mountSystem || project.mountingSystem || 'Ground Mount Racking System';

  return `
  <div class="page">
    ${titleBlock(input, 'PE-1', 'PE STRUCTURAL LETTER OF COMPLIANCE', pageNum, totalPages)}
    <div class="page-content">

      <div class="bb-hvy pb-xs mb-sm">
        <div class="f-3xl fw9">LETTER OF STRUCTURAL COMPLIANCE</div>
        <div class="f-lg c555 mt-xs">Solar Photovoltaic System — Ground Mount Array</div>
        <div class="f-sm muted">Prepared under ASCE 7-22 &bull; ${ibcVer} IBC &bull; NEC ${necVer}</div>
      </div>

      <div class="two-col-layout">
        <div class="col-left">
          ${_peProjectInfo(input)}

          <div class="section-title">PV System Parameters</div>
          <table class="info-table" class="mb-xs">
            <tr><td class="il">Total Modules</td><td class="iv">${system.totalPanels || '—'}</td><td class="il">System Size</td><td class="iv">${system.totalDcKw?.toFixed(2) || '—'} kW DC</td></tr>
            <tr><td class="il">Module Model</td><td class="iv" colspan="3">${(() => { const _eq = getEquipmentContext(input, cad); return [_eq.panelManufacturer, _eq.panelModel].filter(s => s && s !== '—').join(' ') || '—'; })()}</td></tr>
            <tr><td class="il">Mounting System</td><td class="iv" colspan="3">${mountSys}</td></tr>
            <tr><td class="il">Array Tilt</td><td class="iv">${tiltDeg}°</td><td class="il">Foundation</td><td class="iv">Pile / pier</td></tr>
          </table>

          <div class="section-title">Ground Mount Construction</div>
          <table class="info-table" class="mb-xs">
            <tr><td class="il">Foundation Type</td><td class="iv">${structType}</td><td class="il">Pile Depth</td><td class="iv">${pileDepth} ft min.</td></tr>
            <tr><td class="il">Ground Clearance</td><td class="iv">${groundClr}" min.</td><td class="il">Tilt Angle</td><td class="iv">${tiltDeg}°</td></tr>
            <tr><td class="il">Pile Spacing</td><td class="iv">${pileSpacing} ft O.C.</td><td class="il">Hardware</td><td class="iv">Galvanized / Stainless Steel</td></tr>
            <tr><td class="il">Wind Code</td><td class="iv">ASCE 7-22 §27 + §29.4</td><td class="il">Exposure</td><td class="iv">Category ${exposure}</td></tr>
          </table>
        </div>

        <div class="col-right">
          <div class="section-title">Structural Analysis Results (ASCE 7-22)</div>
          <table class="info-table" class="mb-xs">
            ${_peSiteLoading(input)}
            <tr class="bg-lt"><td class="il" colspan="4" style="font-weight:bold;text-align:center;">Pile/Pier Capacity Analysis</td></tr>
            <tr><td class="il">Net Uplift / Pile</td><td class="iv">${uplift} lbs</td><td class="il">Pile Lateral Capacity</td><td class="iv">Per geotechnical report</td></tr>
            <tr><td class="il">Safety Factor</td><td class="iv" style="font-weight:bold;color:${Number(safetyFact) >= 2.0 ? '#000' : '#cc0000'};">${safetyFact} (min. 2.0 req.)</td><td class="il">Pile Embedment Depth</td><td class="iv">${pileDepth} ft min.</td></tr>
            <tr class="bg-lt"><td class="il" colspan="4" style="font-weight:bold;text-align:center;">Governing Load Combination (ASCE 7-22 §2.4 — ASD)</td></tr>
            <tr><td class="il">Governing Combo</td><td class="iv">0.6D + 0.6W (Uplift)</td><td class="il">Code Reference</td><td class="iv">ASCE 7-22 §27</td></tr>
          </table>

          <div class="sec" style="margin-bottom:var(--xs);">
            <div class="sec-hdr">ENGINEER'S CERTIFICATION STATEMENT</div>
            <div class="sec-body">
              <div class="f-xs" style="line-height:1.6;">
                I, the undersigned, a licensed Professional Engineer in the State of <strong>${state}</strong>,
                hereby certify that I have reviewed the structural design of the above-described ground-mounted
                solar photovoltaic array installation and determined that the <strong>proposed ground mount
                pile/pier foundation system is adequate to support the loads imposed by the proposed ground-mounted
                PV array</strong>, based on the structural analysis performed in accordance with
                <strong>ASCE 7-22 §27</strong>, <strong>${ibcVer} IBC</strong>, and NEC ${necVer}.
              </div>
              <div class="f-sm mt-xs" style="line-height:1.6;">
                Pile embedment depth, pile capacity, and foundation system design are confirmed adequate to resist
                wind uplift and lateral loads at the design wind speed of ${windSpeed} mph, Exposure Category ${exposure},
                per ASCE 7-22 §27. Ground snow load per ASCE 7-22 §7 (slope reduction factor per array tilt angle
                of ${tiltDeg}°). Geotechnical conditions shall be confirmed by a licensed geotechnical engineer.
                Field conditions shall be verified by the installing contractor.
                Any deviations from the approved design shall be reported to the engineer of record prior to installation.
              </div>
            </div>
          </div>

          ${_peSigBlock()}
        </div>
      </div>

      ${_peFooter()}
    </div>
  </div>`;
}

// ─── ROOF PE LETTER ───────────────────────────────────────────────────────────
export function pagePELetterRoof(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number): string {
  const { project, system, compliance } = input;
  const necVer  = compliance.jurisdiction?.necVersion || '2023';
  const ibcVer  = '2021';
  const state   = compliance.jurisdiction?.state || '—';
  const structural = compliance.structural;

  const windSpeed   = structural?.wind?.windSpeed || '—';
  const uplift      = structural?.wind?.upliftPerAttachment?.toFixed(0) || '—';
  const lagCap      = structural?.attachment?.lagBoltCapacity?.toFixed(0) || '—';
  const safetyFact  = structural?.attachment?.safetyFactor?.toFixed(2) || '—';
  // utilizationRatio carries the GOVERNING ratio (max of bending/deflection) —
  // labelling it as bending utilization made PE-1 print "145%" beside a passing
  // 90% bending check. Compute each check's own ratio and certify CONDITIONALLY:
  // the letter must never say "confirmed adequate" while its own numbers fail.
  const _bmRaw   = structural?.rafter?.bendingMoment;
  const _abmRaw  = structural?.rafter?.allowableBendingMoment;
  const _deflRaw = structural?.rafter?.deflection;
  const _adRaw   = structural?.rafter?.allowableDeflection;
  const _bendRatio = (_bmRaw != null && _abmRaw) ? _bmRaw / _abmRaw : null;
  const _deflRatio = (_deflRaw != null && _adRaw) ? _deflRaw / _adRaw : null;
  const _sfRaw     = structural?.attachment?.safetyFactor;
  const _bendPass  = _bendRatio == null || _bendRatio <= 1.0;
  const _deflPass  = _deflRatio == null || _deflRatio <= 1.0;
  const _lagPass   = _sfRaw == null || _sfRaw >= 2.0;
  const _allPass   = _bendPass && _deflPass && _lagPass;
  const bendUtil   = _bendRatio != null ? (_bendRatio * 100).toFixed(0) : '—';
  const deflUtil   = _deflRatio != null ? (_deflRatio * 100).toFixed(0) : '—';
  const _governs   = (_deflRatio ?? 0) > (_bendRatio ?? 0) ? 'deflection' : 'bending';
  const _utilRatioPresent = structural?.rafter?.utilizationRatio != null;
  const utilization = ((structural?.rafter?.utilizationRatio || 0) * 100).toFixed(0);
  const fbPrime     = structural?.rafter?.Fb_prime ? structural.rafter.Fb_prime.toFixed(0) : '—';
  const lineLoad    = structural?.rafter?.lineLoad ? structural.rafter.lineLoad.toFixed(1) : '—';
  const totalLoadPsf = structural?.rafter?.totalLoadPsf ? structural.rafter.totalLoadPsf.toFixed(1) : '—';
  const rafterSpanFt = structural?.rafter?.rafterSpan ? structural.rafter.rafterSpan.toFixed(1) : (project.rafterSpan ?? '—');
  const framingType = structural?.rafter?.framingType ?? '—';
  const _isTruss    = framingType === 'truss';
  const bendingMoment = structural?.rafter?.bendingMoment ? structural.rafter.bendingMoment.toFixed(1) : '—';
  const allowableBM = structural?.rafter?.allowableBendingMoment ? structural.rafter.allowableBendingMoment.toFixed(1) : '—';
  const deflection = structural?.rafter?.deflection ? structural.rafter.deflection.toFixed(3) : '—';
  const allowableDefl = structural?.rafter?.allowableDeflection ? structural.rafter.allowableDeflection.toFixed(3) : '—';
  const rafterSize  = project.rafterSize  || '2×6';
  const rafterSpace = project.rafterSpacing || 24;
  // Same resolution chain as PV-3 (engineering-resolved → user input → racking
  // rated max) — the raw ||48 default printed "48" max O.C." on the letter
  // while PV-3 and the PV-4C lag analysis resolved 24" for the same job.
  const _mountSel   = project.mountingSystemId ? getMountingSystemById(project.mountingSystemId) : undefined;
  const attachSpace = structural?.attachment?.maxAllowedSpacing
    || project.attachmentSpacing
    || _mountSel?.mount?.maxSpacingIn
    || 48;
  const _fracIn = (v: number) =>
    v === 0.25 ? '1/4' : v === 0.3125 ? '5/16' : v === 0.375 ? '3/8' : v === 0.5 ? '1/2' : `${v}`;
  const lagDia    = _fracIn(_mountSel?.mount?.fastenerDiameterIn ?? 0.375);
  const lagEmbed  = _mountSel?.mount?.fastenerEmbedmentIn ?? 2.5;
  // 1-decimal ratio so the printed pair is self-consistent — Math.round gave
  // "4/12 (20.0°)" where 4:12 is actually 18.4° (a checkable contradiction).
  // Pitch = what the structural engine analyzed (CAD plane[0] → project) —
  // the letter used to claim project.roofPitch (20°) while the analysis ran
  // on the CAD plane pitch (17°).
  const _pitchDeg   = cad.roof?.planes?.[0]?.pitch ?? project.roofPitch;
  const roofPitch   = _pitchDeg ? `${(Math.tan(_pitchDeg * Math.PI / 180) * 12).toFixed(1)}:12 (${_pitchDeg.toFixed(1)}°)` : '—';
  const roofType    = roofTypeLabel(project.roofType);
  const exposure    = structural?.wind?.exposureCategory || '—';
  const mountSys    = project._canonical?.mountSystem || project.mountingSystem || 'IronRidge XR100';

  return `
  <div class="page">
    ${titleBlock(input, 'PE-1', 'PE STRUCTURAL LETTER OF COMPLIANCE', pageNum, totalPages)}
    <div class="page-content pe-letter">

      <div class="bb-hvy pb-xs mb-sm" style="display:flex;justify-content:space-between;align-items:flex-end;">
        <div>
          <div class="f-3xl fw9" style="letter-spacing:1px;">LETTER OF STRUCTURAL COMPLIANCE</div>
          <div class="f-lg c555 mt-xs">Solar Photovoltaic System — Roof-Mounted Array</div>
          <div class="f-sm muted">Prepared under ASCE 7-22 &bull; ${ibcVer} IBC &bull; ${ibcVer} IRC &bull; NEC ${necVer}</div>
        </div>
        <div class="f-sm" style="text-align:right;color:#555;line-height:1.6;">
          <div>RE: <strong style="color:#000;">${escapeH(project.address || '—')}</strong></div>
          <div>DATE: ${escapeH(String(project.date || '—'))}</div>
        </div>
      </div>

      <div class="two-col-layout">
        <div class="col-left">
          ${_peProjectInfo(input)}

          <div class="section-title">PV System Parameters</div>
          <table class="info-table" class="mb-xs">
            <tr><td class="il">Total Modules</td><td class="iv">${system.totalPanels || '—'}</td><td class="il">System Size</td><td class="iv">${system.totalDcKw?.toFixed(2) || '—'} kW DC</td></tr>
            <tr><td class="il">Module Model</td><td class="iv" colspan="3">${(() => { const _eq = getEquipmentContext(input, cad); return [_eq.panelManufacturer, _eq.panelModel].filter(s => s && s !== '—').join(' ') || '—'; })()}</td></tr>
            <tr><td class="il">Mounting System</td><td class="iv" colspan="3">${mountSys}</td></tr>
            <tr><td class="il">Rail Orientation</td><td class="iv">Perpendicular to rafters</td><td class="il">Attachment</td><td class="iv">Lag bolt w/ flashing</td></tr>
          </table>

          <div class="section-title">Existing Roof Construction</div>
          <table class="info-table" class="mb-xs">
            <tr><td class="il">Roof Type</td><td class="iv">${roofType}</td><td class="il">Roof Pitch</td><td class="iv">${roofPitch}</td></tr>
            <tr><td class="il">Rafter / Framing</td><td class="iv">${_isTruss ? `Pre-Engineered Truss (${rafterSize} chords)` : `${rafterSize} Lumber`}</td><td class="il">Spacing</td><td class="iv">${rafterSpace}" O.C.</td></tr>
            <tr><td class="il">Attachment Spacing</td><td class="iv">${attachSpace}" max O.C.</td><td class="il">Lag Diameter</td><td class="iv">${lagDia}" min.</td></tr>
            <tr><td class="il">Min. Embedment</td><td class="iv">${lagEmbed}" into rafter</td><td class="il">Hardware</td><td class="iv">Stainless Steel</td></tr>
            <tr><td class="il">Roof Sheathing</td><td class="iv">No attachment to sheathing only</td><td class="il">Underlayment</td><td class="iv">Maintained per mfr. req.</td></tr>
          </table>
        </div>

        <div class="col-right">
          <div class="section-title">Structural Analysis Results (ASCE 7-22)</div>
          <table class="info-table" class="mb-xs">
            ${_peSiteLoading(input)}
                                    <tr class="bg-lt"><td class="il" colspan="4" style="font-weight:bold;text-align:center;">Rafter Bending & Deflection Analysis</td></tr>
            ${_isTruss ? `
            <tr><td class="il">Analysis Basis</td><td class="iv">BCSI capacity table</td><td class="il">Framing</td><td class="iv">Pre-Engineered Truss</td></tr>
            <tr><td class="il">Total Load</td><td class="iv">${totalLoadPsf} psf</td><td class="il">Truss Span</td><td class="iv">${rafterSpanFt} ft${!project.rafterSpan ? ' (PER ROOF GEOMETRY — FIELD VERIFY)' : ''}</td></tr>
            <tr><td class="il">Truss Capacity</td><td class="iv">${allowableBM} psf</td><td class="il">Load Utilization</td><td class="iv" style="font-weight:bold;color:${(structural?.rafter?.utilizationRatio ?? 0) <= 1.0 ? '#000' : '#cc0000'};">${utilization}%</td></tr>
            <tr><td class="il">Deflection</td><td class="iv" colspan="3">Governed by the truss manufacturer's design — verify capacity with the truss mfr for the added PV load</td></tr>` : `
            <tr><td class="il">F’b (Adjusted)</td><td class="iv">${fbPrime} psi</td><td class="il">Framing</td><td class="iv">Stick (${framingType})</td></tr>
            <tr><td class="il">Total Load</td><td class="iv">${totalLoadPsf} psf</td><td class="il">Rafter Span</td><td class="iv">${rafterSpanFt} ft${!project.rafterSpan ? ' (ASSUMED — FIELD VERIFY)' : ''}</td></tr>
            <tr><td class="il">Line Load</td><td class="iv">${lineLoad} lb/ft</td><td class="il">Bending Moment</td><td class="iv">${bendingMoment} / ${allowableBM} lb-ft</td></tr>
            <tr><td class="il">Bending Utilization</td><td class="iv" style="font-weight:bold;color:${_bendPass ? '#000' : '#cc0000'};">${bendUtil}%</td><td class="il">Deflection</td><td class="iv" style="color:${_deflPass ? '#000' : '#cc0000'};">${deflection} in (Δ_allow = ${allowableDefl} in — ${deflUtil}%)</td></tr>`}
            <tr class="bg-lt"><td class="il" colspan="4" style="font-weight:bold;text-align:center;">Lag Bolt Attachment Capacity Analysis</td></tr>
            <tr><td class="il">Net Uplift per Attachment</td><td class="iv">${uplift} lbs</td><td class="il">Lag Bolt Capacity</td><td class="iv">${lagCap} lbs</td></tr>
            <tr><td class="il">Safety Factor</td><td class="iv" style="font-weight:bold;color:${_lagPass ? '#000' : '#cc0000'};">${safetyFact} (min. 2.0 req.)</td><td class="il">Governing Check</td><td class="iv" style="font-weight:bold;color:${_allPass ? '#000' : '#cc0000'};">${_utilRatioPresent ? `${_governs} — ${utilization}% ${_allPass ? '(PASS)' : '(EXCEEDS LIMIT)'}` : '—'}</td></tr>
            <tr class="bg-lt"><td class="il" colspan="4" style="font-weight:bold;text-align:center;">Governing Load Combination (ASCE 7-22 §2.4 — ASD)</td></tr>
            <tr><td class="il">Governing Combo</td><td class="iv">0.6D + 0.6W (Uplift)</td><td class="il">Code Reference</td><td class="iv">ASCE 7-22 §26/27</td></tr>
          </table>

          <div class="sec" style="margin-bottom:var(--xs);">
            <div class="sec-hdr">ENGINEER'S CERTIFICATION STATEMENT</div>
            <div class="sec-body">
              <div class="f-xs" style="line-height:1.6;">
                I, the undersigned, a licensed Professional Engineer in the State of <strong>${state}</strong>,
                hereby certify that I have reviewed the structural design of the roof-mounted solar
                photovoltaic array installation at <strong>${escapeH(project.address || '—')}</strong> and determined that ${_allPass
                  ? `the <strong>existing roof structure and lag bolt
                attachment system are adequate to support the additional loads imposed by the proposed roof-mounted
                PV array</strong>,`
                  : `<strong>the modeled framing does not satisfy all code checks — see below</strong>,`}
                based on the structural analysis performed in accordance with
                <strong>ASCE 7-22 §26/27</strong>, <strong>${ibcVer} IBC</strong>, <strong>${ibcVer} IRC</strong>,
                and NEC ${necVer}.
              </div>
              ${_allPass ? `
              <div class="f-sm mt-xs" style="line-height:1.6;">
                ${_isTruss
                  ? `Lag bolt attachment capacity (safety factor ${safetyFact}) and the pre-engineered truss load capacity (governing utilization ${utilization}%; member deflection to be verified with the truss manufacturer for the added PV load) are confirmed adequate for`
                  : `Lag bolt attachment capacity (safety factor ${safetyFact}), rafter bending stress (F’b = ${fbPrime} psi, bending utilization ${bendUtil}%), and deflection (Δ = ${deflection} in vs Δ_allow = ${allowableDefl} in) are confirmed adequate for`}
                the design wind speed of ${windSpeed} mph, Exposure Category ${exposure},
                per ASCE 7-22 §26/27. Roof framing of ${rafterSize} @ ${rafterSpace}" O.C. (${_isTruss ? 'truss' : 'stick'} construction, span ${rafterSpanFt} ft) confirmed adequate for
                the combined dead load (${totalLoadPsf} psf), wind, and snow loading per IBC Section 1607 and ASCE 7-22 §2.3.
                Field conditions shall be verified by the installing contractor.
                Any deviations from the approved design shall be reported to the engineer of record prior to installation.
              </div>` : `
              <div class="f-sm mt-xs" style="line-height:1.6;border:2px solid #cc0000;padding:var(--xs);">
                <strong style="color:#cc0000;">STRUCTURAL REVIEW REQUIRED — DO NOT ISSUE:</strong>
                under the modeled assumptions (${rafterSize} ${_isTruss ? 'truss' : 'stick'} framing @ ${rafterSpace}" O.C., span ${rafterSpanFt} ft,
                combined load ${totalLoadPsf} psf), the ${_governs} check exceeds its code limit
                (bending ${bendUtil}% of allowable; deflection Δ = ${deflection} in vs Δ_allow = ${allowableDefl} in).
                Lag bolt attachment safety factor is ${safetyFact}${_lagPass ? ' (adequate)' : ' (below the 2.0 minimum)'}.
                Field-verify the actual framing type, member size, and clear span (pre-engineered trusses frequently
                resolve this check), correct the structural inputs, and re-run the analysis — or provide reinforcement
                designed by the engineer of record — before this letter is signed or sealed.
              </div>`}
            </div>
          </div>

          ${_peSigBlock()}
        </div>
      </div>

      ${_peFooter()}
    </div>
  </div>`;
}

// ─── DISPATCHER ───────────────────────────────────────────────────────────────
export function pagePELetter(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number): string {
  const sys = cad.systemType as string;
  if (isFence(sys))  return pagePELetterFence(input, cad, pageNum, totalPages);
  if (isGround(sys)) return pagePELetterGround(input, cad, pageNum, totalPages);
  return pagePELetterRoof(input, cad, pageNum, totalPages);
}



