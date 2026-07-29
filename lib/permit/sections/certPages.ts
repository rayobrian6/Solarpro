// ============================================================================
// Certification Pages -- Engineer Cert, PE Letters
// Extracted from route.ts -- ZERO REGRESSION
//
// ENCODING (2026-07-22, W4 correction Section 15a): this file is authored in
// plain ASCII + HTML entities ONLY. It was previously double/mixed mojibake-
// encoded (em-dashes, section signs and box glyphs became "a-euro" byte runs)
// and those corrupt bytes rendered straight into the permit package. Never
// paste a raw non-ASCII glyph here again -- use an HTML entity (&mdash; &sect;
// &deg; &Delta; &rarr; &trade; &hellip; &times;) so the output can never mojibake.
// ============================================================================

import type { PermitInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import { titleBlock } from '../utils/titleBlock';
import { escapeH } from '../utils/drawing';
import { roofTypeLabel, hasRealBattery, resolveEquipmentBySubSystem } from '../utils/helpers';
import { getEquipmentContext, isFence, isGround } from '@/lib/system';
import type { SubSystemKey } from '../utils/subSystems';

/** Wave 5B -- per-sub PE letters (hybrid). `subKey` scopes the equipment
 *  resolution to the sub's OWN fleet/carriage (never the project-wide winner)
 *  and switches the mounting label to the sub's own family default instead of
 *  the project-wide (roof) racking string. `sheetId` suffixes hybrid letters
 *  (PE-1G / PE-1F) while the primary keeps PE-1. */
export interface PELetterOpts { sheetId?: string; subKey?: SubSystemKey; }
import { MIN_ATTACHMENT_SF } from '@/lib/structural/attachmentCapacity';
import { getMountingSystemById } from '@/lib/mounting-hardware-db';
import { projectStructuralFromInput, fmt, fmtStr, findCheck, projectFastenerAssembly } from '../snapshot/structuralProjection';
import { projectCodeAuthorityFromInput } from '../snapshot/codeAuthorityProjection';
import {
  projectProjectAuthorityFromInput, projectIssueStateLanguageFromInput,
} from '../snapshot/projectAuthorityProjection';

// D-6 / snapshot V13 / W4 Section 2 -- the digest-bound certification predicate
// now lives with the PE-letter primitives (TAC WS-16) so the sheet manifest and
// the cover index can derive the sheet's IDENTITY from the same single fact
// without importing a page module. Re-exported here: every historical caller
// (and the governance test suite) keeps importing it from certPages.
import {
  certificationApproved, peLetterSheetTitle, peLetterHeadingBlock,
} from '../utils/peLetter';
export { certificationApproved };

/** The derived issue-state string for revision blocks (Section 1). While the
 *  snapshot is PENDING ENGINEERING REVIEW this is never "ISSUED FOR PERMIT" /
 *  "Initial Issue for Permit" -- it is the honest DERIVED state. */
function issueStateLabel(input: PermitInput): string {
  const pa = projectProjectAuthorityFromInput(input);
  return pa.issueStatus ?? 'DESIGN DRAFT';
}

/** PPC §10 / gate 14 — how a contractor-deviation clause on THIS sheet must refer
 *  to the design of record. Never the literal "the approved design": that phrase
 *  is produced only by the ONE issue-state language accessor, and only when a
 *  digest-bound engineering approval exists with nothing blocking release. The
 *  PE-letter certification blocks gate on `certificationApproved()` (digest-bound
 *  review) which can still be true while blocking release items are open, so the
 *  language must come from the accessor rather than from the block's own gate. */
function deviationReference(input: PermitInput): string {
  return projectIssueStateLanguageFromInput(input).deviationReferenceLabel;
}

export function certificationGateBanner(input: PermitInput): string {
  if (certificationApproved(input)) return '';
  // Section 12 -- surface the CANONICAL structural blockers from permitReadiness
  // so the existing gate states WHY (framing unverified, capacity source
  // missing, ...) rather than a generic pending line. One gate, wired to the
  // snapshot.
  const _sp = projectStructuralFromInput(input);
  // W10 (RP-D): enumerate the UNION of every active blocker (banner.blockers is
  // the registry union) — not the structural-else-everything ternary that hid
  // the equipment-identity / code / tap / fill / project-identity blockers.
  const _allReasons = _sp.banner.blockers;
  // RGM §4 — the verbatim list is capped at 6 on this sheet (was 8): the
  // package-level GATE line above now carries the totals, and the CERT page's
  // fixed box has no room for both. No requirement is lost — the remainder line
  // states the count and RS-1 prints every requirement in full.
  const _shownReasons = _allReasons.slice(0, 6);
  const _moreReasons = _allReasons.length - _shownReasons.length;
  // AAC WS-9 — PER-BULLET LENGTH CAP. The box is a FIXED-height element on a
  // fixed page; a requirement message is not. As automation clears the short
  // requirements the six survivors get LONGER (they are the ones carrying real
  // enumerated detail — segment ids, candidate shortlists), and an uncapped
  // bullet silently clipped the cert footer under `overflow:hidden`. The cap is
  // deterministic and loses nothing: RS-1 prints every requirement in full, and
  // the truncation says so on the bullet itself.
  const _CERT_REASON_CHARS = 200;
  const _capReason = (m: string): string => (m.length <= _CERT_REASON_CHARS
    ? m
    : `${m.slice(0, _CERT_REASON_CHARS).replace(/\s+\S*$/, '')}… (full text on RS-1)`);
  const _reasons = _shownReasons
    .map(b => `<li style="margin:0 0 1px 0;">${_capReason(String(b.message)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</li>`).join('')
    // RGM §4 — the remainder is a PACKAGE-level statement ⇒ requirement (child)
    // semantics with the root-gate total stated on its own line above.
    + (_moreReasons > 0 ? `<li style="margin:0 0 1px 0;font-style:italic;">+ ${_moreReasons} more unresolved release requirement${_moreReasons === 1 ? '' : 's'} — see sheet RS-1 (REVIEW STATUS)</li>` : '');
  const _hasStructural = _sp.banner.structuralBlockers.length > 0;
  // RGM §4 — package total in GATE semantics (7 root gates over 19 requirements),
  // single-sourced from the release-gate model via the structural projection.
  const _gateLine = _sp.banner.releasePackageLine
    ? `<div data-release-package-line="1" style="font-weight:900;font-size:8.5px;letter-spacing:0.4px;color:#7a0000;margin-top:2px;">${String(_sp.banner.releasePackageLine).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`
    : '';
  return `
  <div style="border:3px solid #b00000;background:#fff2f2;margin:10px 14px 6px;padding:8px 12px;text-align:center;">
    <div style="font-weight:900;font-size:13px;letter-spacing:1px;color:#b00000;">PENDING ENGINEERING REVIEW</div>
    ${_hasStructural ? `<div style="font-weight:900;font-size:11px;letter-spacing:0.8px;color:#b00000;">STRUCTURAL ENGINEERING REVIEW REQUIRED</div>` : ''}
    ${_gateLine}
    <div style="font-weight:800;font-size:10px;letter-spacing:0.8px;color:#b00000;">NOT FOR PERMIT SUBMISSION &mdash; UNSIGNED / UNSEALED</div>
    <div style="font-size:7.5px;color:#7a0000;margin-top:2px;">Certification activates only upon an approved engineering-review record covering this snapshot digest, with engineer identity, license, jurisdiction and seal on file. A design change that alters the snapshot digest invalidates any prior approval.</div>
    ${_reasons ? `<ul style="margin:4px auto 0;padding-left:16px;max-width:520px;text-align:left;font-size:7px;color:#7a0000;line-height:1.35;">${_reasons}</ul>` : ''}
  </div>`;
}

export function pageEngineerCert(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number): string {
  const { project, compliance } = input;
  const cp = projectCodeAuthorityFromInput(input);   // W4 Section 2 code editions
  const pa = projectProjectAuthorityFromInput(input); // W4 Section 3 project/cover authority
  const asce = cp.asceLabel;
  const necVer = cp.nec ?? 'PENDING';
  const ifcVer = cp.ifc ?? 'PENDING';
  const state = compliance.jurisdiction?.state || '&mdash;';
  const ahj = compliance.jurisdiction?.ahj || '&mdash;';
  const system = input.system;
  const sysSize = system?.totalDcKw?.toFixed(2) ?? '&mdash;';
  const sysAc = system?.totalAcKw?.toFixed(2) ?? '&mdash;';
  const panelCount = system?.totalPanels ?? 0;
  const eq_cert = getEquipmentContext(input, cad);
  const invModel = eq_cert.inverterModel !== '&mdash;' && eq_cert.inverterModel !== '—' ? eq_cert.inverterModel : '';
  const address = escapeH(project.address || '—');
  // Section 2 gate: the affirmative certification body renders ONLY when an
  // approved review covers the current digest. Otherwise a disabled pending
  // template renders in its place -- no affirmative conclusion, no seal-implied
  // validity, and the revision history states the DERIVED issue state.
  const approved = certificationApproved(input);
  const revDesc = approved ? 'Issued for Permit' : escapeH(issueStateLabel(input));
  // Section 11: an IFC setback COMPLIANCE claim may not render while the IFC
  // authority is unverified/pending -- the code list is only shown in the
  // approved template (which requires codeAuthorityVerified), and even there the
  // IFC edition projects from codeAuthority (PENDING when unknown).
  const _u = compliance?.structural?.rafter?.utilizationRatio;
  const _structFlag = _u != null && _u > 1.0;

  return `
  <div class="page cert-compact">
    ${titleBlock(input, 'CERT', 'ENGINEER CERTIFICATION', pageNum, totalPages)}
    ${certificationGateBanner(input)}
    <div class="page-content">
      <div class="cert-header">ENGINEER OF RECORD CERTIFICATION</div>
      <div class="cert-subject">
        <strong>PROJECT:</strong> ${escapeH(project.projectName || '—')} | <strong>ADDRESS:</strong> ${address} | <strong>SYSTEM:</strong> ${panelCount} modules, ${sysSize} kW DC / ${sysAc} kW AC | <strong>INVERTER:</strong> ${invModel}
      </div>
      ${approved ? `
      ${_structFlag ? `
      <div style="border:3px solid #cc0000;background:#fff5f5;padding:var(--xs);margin-bottom:var(--xs);font-size:var(--f-md);line-height:1.5;">
        <strong style="color:#cc0000;">STRUCTURAL REVIEW REQUIRED:</strong>
        The roof framing analysis (PV-4C / PE-1) computes a governing utilization of ${((_u as number) * 100).toFixed(0)}% under the modeled assumptions.
        This certification is limited to the electrical design until the structural condition is resolved by field verification of framing
        (size, spacing, span, species) or engineered reinforcement. Do not issue for construction on the structural scope.
      </div>` : ''}
      <div class="cert-statement">
        I hereby certify that the solar photovoltaic system design at <strong>${address}</strong> has been prepared under my direct supervision
        and ${_structFlag
          ? 'that the ELECTRICAL design complies with the following applicable codes and standards (structural scope pending &mdash; see notice above):'
          : 'complies with the following applicable codes and standards:'}
        <ul style="margin-top:var(--xs);line-height:1.6;padding-left:var(--md);">
          <li>National Electrical Code (NEC) ${necVer}, Article 690 &mdash; Solar Photovoltaic Systems</li>
          <li>National Electrical Code (NEC) ${necVer}, Article 705 &mdash; Interconnected Electric Power Production Sources</li>
          ${hasRealBattery(project) ? `<li>National Electrical Code (NEC) ${necVer}, Article 706 &mdash; Energy Storage Systems; NFPA 855</li>` : ''}
          <li>${asce} &mdash; Minimum Design Loads and Associated Criteria for Buildings and Other Structures</li>
          <li>International Building Code (IBC) / International Residential Code (IRC) &mdash; Structural requirements</li>
          <li>International Fire Code (IFC) ${ifcVer} &mdash; &sect;1204 Solar Photovoltaic Systems (rooftop access &amp; pathways)</li>
          <li>All applicable local amendments adopted by ${state} and the Authority Having Jurisdiction (${pa.present ? pa.tag('ahj') : escapeH(ahj)})</li>
        </ul>
      </div>` : `
      <!-- Section 2 DISABLED PENDING-REVIEW TEMPLATE: no affirmative
           certification, no code-compliance conclusion, no seal validity. -->
      <div class="cert-statement" style="border:2px dashed #b00000;background:#fff7f7;padding:var(--sm);">
        <div style="font-weight:900;color:#b00000;letter-spacing:0.5px;margin-bottom:4px;">CERTIFICATION PENDING ENGINEERING REVIEW &mdash; PLACEHOLDER</div>
        <div style="line-height:1.6;">
          This sheet does <strong>not</strong> assert any engineering certification, code-compliance conclusion, or professional seal
          at this time. An engineer of record will certify this design <strong>only</strong> after an approved engineering-review
          record covering this snapshot digest is on file, with engineer identity, license, jurisdiction and seal. A design change
          that alters the snapshot digest invalidates any prior approval.
        </div>
        <div style="margin-top:var(--xs);line-height:1.6;">
          Codes and standards to be applied upon review:
          <ul style="margin-top:var(--xs);line-height:1.6;padding-left:var(--md);">
            <li>NEC ${necVer} Articles 690 &amp; 705${hasRealBattery(project) ? ' &amp; 706 (NFPA 855)' : ''}</li>
            <li>${asce} &mdash; Minimum Design Loads and Associated Criteria</li>
            <li>International Building Code (IBC) / International Residential Code (IRC) &mdash; Structural requirements</li>
            <li>International Fire Code (IFC) ${ifcVer} &mdash; &sect;1204 rooftop PV access &amp; pathways (setback geometry shown on PV-1; compliance verdict pending code authority)</li>
            <li>Local amendments adopted by ${state} and the AHJ (${pa.present ? pa.tag('ahj') : escapeH(ahj)})</li>
          </ul>
        </div>
      </div>`}
      <div class="cert-grid">
        <div>
          <div class="cert-block-title">PREPARED BY</div>
          <div class="cert-field"><div class="cf-val">${escapeH(project.designer || '________________________________')}</div><div class="cf-lbl">Designer / Engineer of Record</div></div>
          <div class="cert-field"><div class="cf-val">________________________________</div><div class="cf-lbl">Firm / Company Name</div></div>
          <div class="cert-field"><div class="cf-val">________________________________</div><div class="cf-lbl">PE License Number</div></div>
          <div class="cert-field"><div class="cf-val">________________________________</div><div class="cf-lbl">State of Licensure</div></div>
          <div class="cert-field"><div class="cf-val">________________________________</div><div class="cf-lbl">License Expiration Date</div></div>
          <!-- Blank -- the PE dates this when signing. Prefilling the package
               issue date read as the expiration value of the field above. -->
          <div class="cert-field"><div class="cf-val">________________________________</div><div class="cf-lbl">Date of Certification</div></div>
          <div class="cert-field"><div class="cf-val">________________________________</div><div class="cf-lbl">Phone / Email</div></div>
          <div class="cert-field" style="margin-top:var(--xs)"><div class="cf-val" style="border-bottom:var(--border-hvy);padding-bottom:10px;">________________________________</div><div class="cf-lbl">Signature</div></div>
        </div>
        <div>
          <div class="cert-block-title">WET STAMP AREA</div>
          <div class="stamp-box" style="min-height:92px;border:3px solid #000;position:relative;">
            <div class="center">
              <div style="font-size:22px;opacity:0.2">&#x2B21;</div>
              <div style="font-size:11px;color:#666;margin-top:3px;font-weight:700;letter-spacing:0.5px;">AFFIX SEAL HERE</div>
              <div style="font-size:8.5px;color:#999;margin-top:2px">Professional Engineer Wet Stamp — required for AHJ submission</div>
              <div style="font-size:8px;color:#bbb;margin-top:3px;font-style:italic;">Stamp must be raised or embossed seal</div>
            </div>
          </div>
          <div class="cert-block-title mt-sm">REVISION HISTORY</div>
          <table class="equip-table mt-sm">
            <thead><tr><th>Rev</th><th>Date</th><th>Description</th><th>By</th></tr></thead>
            <tbody>
              <tr><td class="fw7">A</td><td>${escapeH(String(pa.issueDate ?? project.date ?? ''))}</td><td>${revDesc}</td><td>${escapeH(project.designer || '—')}</td></tr>
              <tr><td class="c999">B</td><td class="c999">&mdash;</td><td class="c999">&mdash;</td><td class="c999">&mdash;</td></tr>
            </tbody>
          </table>
          <div class="section-title">SLD Reference</div>
          <table class="info-table">
            <tr><td class="il">Sheet E-1</td><td class="iv">Single-Line Electrical Diagram &mdash; included in this plan set</td></tr>
          </table>
        </div>
      </div>
      <!-- Document Control -->
      <div style="margin-top:var(--xs);border:var(--border);font-size:var(--f-sm);">
        <div style="background:#000;color:#fff;padding:3px 6px;font-weight:900;font-size:8px;letter-spacing:0.8px;">DOCUMENT CONTROL</div>
        <table class="info-table" style="margin:0;">
          <tr><td class="il" style="width:120px;">Document ID</td><td class="iv">SP-PERMIT-${project.projectName ? project.projectName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 12).toUpperCase() : 'DRAFT'}-${project.date?.replace(/\//g, '') || 'UNDATED'}</td></tr>
          <tr><td class="il">Issue Date</td><td class="iv">${escapeH(String(pa.issueDate ?? project.date ?? ''))}</td></tr>
          <tr><td class="il">Issue State</td><td class="iv">${escapeH(issueStateLabel(input))}</td></tr>
          <tr><td class="il">Distribution</td><td class="iv">AHJ, Property Owner, Installing Contractor, Utility (as required)</td></tr>
        </table>
      </div>

      <!-- Liability Limitation — §15 page-fit: condensed to a single dense
           paragraph so the full legal text prints within the page (never clipped
           by overflow:hidden). No clause is dropped, only tightened. -->
      <div style="margin-top:var(--xs);padding:4px 6px;font-size:7.3px;line-height:1.4;color:#666;border:var(--border);background:#fafafa;">
        <strong>LIMITATION OF LIABILITY:</strong>
        This engineering document is prepared for the specific project and installation address identified herein; it is not transferable to other projects or locations.
        The engineer of record's liability is limited to the engineering design as documented. The installing contractor is responsible for field verification of all conditions,
        adherence to manufacturer installation requirements, and compliance with all applicable building codes. Any deviation from ${escapeH(deviationReference(input))} must be reported to the
        engineer of record prior to installation. This document expires 180 days from the date of certification unless extended in writing by the engineer of record.
      </div>

      <div class="cert-footer">
        Document date ${escapeH(String(pa.issueDate ?? project.date ?? '—'))} &middot;
        This document requires engineer review and wet stamp before AHJ submission.
        All equipment must be UL-listed and installed per manufacturer specifications and NEC ${necVer}.
      </div>
    </div>
  </div>`;
}

// ============================================================================
// PE-1: PE STRUCTURAL LETTER -- THREE ISOLATED SYSTEM FAMILIES
// ============================================================================
// pagePELetterFence  -- fence post foundation authority, Sec 29.4 language only
// pagePELetterGround -- pile/pier authority, Sec 27 language only
// pagePELetterRoof   -- rafter + lag bolt authority, Sec 26/27 language only
// pagePELetter()     -- dispatcher: reads cad.systemType -> calls correct family
// NO shared conditional blocks in letter bodies.
// ============================================================================

// --- SHARED PE LETTER PRIMITIVES --------------------------------------------
// Signature block and footer are identical across all families -- extracted once
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

/** Section 2 -- the DISABLED pending-review certification statement that
 *  replaces every PE-letter affirmative "I ... hereby certify ... adequate"
 *  block while no approved review covers the current digest. States what is
 *  pending; asserts no conclusion and implies no valid signature/seal. */
function _pePendingCertStatement(): string {
  return `
  <div class="sec" style="margin-bottom:var(--xs);">
    <div class="sec-hdr">ENGINEER'S CERTIFICATION STATEMENT &mdash; PENDING REVIEW</div>
    <div class="sec-body">
      <div class="f-xs" style="line-height:1.6;border:2px dashed #b00000;background:#fff7f7;padding:var(--xs);">
        <strong style="color:#b00000;">PLACEHOLDER &mdash; NO CERTIFICATION ASSERTED &mdash; NOT FOR PERMIT SUBMISSION.</strong>
        This letter does not certify structural adequacy at this time; it is an engineer-review working document (PENDING
        ENGINEERING REVIEW). Upon an approved engineering-review record covering this
        snapshot digest &mdash; with engineer identity, license, jurisdiction and seal on file &mdash; the engineer of record will
        state a structural certification based on the analysis tabulated on this sheet. The signature and seal areas below are
        unsigned and unsealed and confer no validity until that review is complete. A design change that alters the snapshot
        digest invalidates any prior approval.
      </div>
    </div>
  </div>`;
}

function _peFooter(asce: string): string {
  return `
  <div class="f-xs center mt-sm pt-xs" style="border-top:var(--border);">
    THIS LETTER IS PREPARED SPECIFICALLY FOR THE ABOVE-NAMED PROJECT AND INSTALLATION ADDRESS.
    IT IS NOT TRANSFERABLE TO OTHER PROJECTS OR LOCATIONS.
    STRUCTURAL DATA DERIVED FROM ${asce} AUTOMATED ANALYSIS. FIELD VERIFICATION REQUIRED.
  </div>`;
}

function _peProjectInfo(input: PermitInput): string {
  const { project, compliance } = input;
  const pa = projectProjectAuthorityFromInput(input); // W4 Section 3 -- AHJ single-sourced
  const ahj   = compliance.jurisdiction?.ahj || '—';
  const state  = compliance.jurisdiction?.state || '—';
  return `
  <div class="section-title">Project Information</div>
  <table class="info-table mb-xs">
    <tr><td class="il">Project Name</td><td class="iv" colspan="3">${escapeH(project.projectName || '—')}</td></tr>
    <tr><td class="il">Client / Owner</td><td class="iv">${escapeH(project.clientName || '—')}</td><td class="il">Date</td><td class="iv">${escapeH(String(project.date ?? ''))}</td></tr>
    <tr><td class="il">Installation Address</td><td class="iv" colspan="3">${escapeH(project.address || '—')}</td></tr>
    <tr><td class="il">AHJ</td><td class="iv">${pa.present ? pa.tag('ahj') : escapeH(ahj)}</td><td class="il">State</td><td class="iv">${escapeH(state)}</td></tr>
    <tr><td class="il">Permit No.</td><td class="iv">___________________</td><td class="il">APN</td><td class="iv">${escapeH(project.apn || '___________________')}</td></tr>
  </table>`;
}

function _peSiteLoading(input: PermitInput): string {
  const { compliance } = input;
  const structural = compliance.structural;
  // W3 Section 7 -- site loading parameters PROJECT from the single-sourced
  // snapshot env (wind / exposure / snow / risk category). No sheet defaults;
  // risk category is the canonical env value, not a hardcoded "II (Residential)".
  const _sp = projectStructuralFromInput(input);
  const windSpeed  = _sp.present ? fmt(_sp.windSpeedMph) : (structural?.wind?.windSpeed || '—');
  const snowLoad   = _sp.present && _sp.groundSnowPsf != null ? String(_sp.groundSnowPsf) : (structural?.snow?.groundSnowLoad ?? '—');
  const exposure   = _sp.present ? fmtStr(_sp.exposure) : (structural?.wind?.exposureCategory || '—');
  const riskCat    = _sp.riskCategory ? `${_sp.riskCategory} (Residential)` : '—';
  // AHJ-derived category before any default -- the '|| D' fallback printed
  // SDC D on PE-1 while PV-0 printed the AHJ's CAT. B for the same site.
  const sdc        = compliance.structural?.seismic?.sdc || input.project.seismicCategory || '—';
  return `
  <tr class="bg-lt"><td class="il" colspan="4" style="font-weight:bold;text-align:center;">Site Loading Parameters</td></tr>
  <tr><td class="il">Design Wind Speed (Vult)</td><td class="iv">${windSpeed} mph</td><td class="il">Exposure Category</td><td class="iv">Cat. ${exposure}</td></tr>
  <tr><td class="il">Ground Snow Load (pg)</td><td class="iv">${snowLoad} psf</td><td class="il">Risk Category</td><td class="iv">${riskCat}</td></tr>
  <tr><td class="il">Environmental Load Source</td><td class="iv" colspan="3" data-env-source="pe-1" style="color:${_sp.environmentalUnverified ? '#b45309' : '#000'};font-weight:bold;">${escapeH(_sp.environmentalSourceLine)}</td></tr>
  <tr><td class="il">Seismic Design Category</td><td class="iv">${sdc}</td><td class="il">Importance Factor</td><td class="iv">1.0</td></tr>`;
}

// --- FENCE PE LETTER --------------------------------------------------------
export function pagePELetterFence(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number, opts?: PELetterOpts): string {
  const _cpF = projectCodeAuthorityFromInput(input); const asce = _cpF.asceLabel;   // W4 Section 2
  const { project, system, compliance } = input;
  const necVer  = _cpF.nec ?? 'PENDING';
  const ibcVer  = _cpF.ibc ?? 'PENDING';
  const state   = compliance.jurisdiction?.state || '—';
  const structural = compliance.structural;
  const approved = certificationApproved(input);   // Section 2 gate
  // W3 Section 7/9 -- env single-sourced from the snapshot; fence overturning SF
  // from the canonical fence-overturning CHECK (relocated fence engine).
  const _sp = projectStructuralFromInput(input);
  const _fenceChk = findCheck(_sp, 'fence-overturning');
  const windSpeed   = _sp.present ? fmt(_sp.windSpeedMph) : (structural?.wind?.windSpeed || '—');
  const uplift      = structural?.wind?.upliftPerAttachment?.toFixed(0) || '—';
  const safetyFact  = _fenceChk?.safetyFactor != null ? _fenceChk.safetyFactor.toFixed(2) : (structural?.attachment?.safetyFactor?.toFixed(2) || '—');
  const _fenceMinSf = _fenceChk?.requiredThreshold ?? 1.5;

  const postEmbed   = cad.fence?.postEmbedM  ? (cad.fence.postEmbedM  * 3.281).toFixed(1) : '3.5';
  const postSpacing = cad.fence?.postSpacingM ? (cad.fence.postSpacingM * 3.281).toFixed(1) : '8.0';
  const panelHIn    = cad.fence?.panelHeightM ? (cad.fence.panelHeightM * 39.37).toFixed(0) + '"' : '72"';
  const exposure    = _sp.present ? fmtStr(_sp.exposure) : (structural?.wind?.exposureCategory || project.exposureCategory || 'C');
  // Per-sub letter (hybrid): the project-wide mount string is the ROOF racking
  // (IronRidge on Stowell) -- a fence letter must never certify it. Sub-scoped
  // letters print the fence family label; the primary/legacy path is unchanged.
  const mountSys    = opts?.subKey
    ? 'Solar Fence Rail System'
    : (project._canonical?.mountSystem || project.mountingSystem || 'Solar Fence Rail System');
  const _eqFence    = opts?.subKey ? resolveEquipmentBySubSystem(input, opts.subKey, cad) : null;

  return `
  <div class="page">
    ${titleBlock(input, opts?.sheetId ?? 'PE-1', peLetterSheetTitle(input), pageNum, totalPages)}
    ${certificationGateBanner(input)}
    <div class="page-content">

      <div class="bb-hvy pb-xs mb-sm">
        ${peLetterHeadingBlock(input,
          'Solar Photovoltaic System &mdash; Solar Fence Array',
          `Prepared under ${asce} &bull; ${ibcVer} IBC &bull; NEC ${necVer}`)}
      </div>

      <div class="two-col-layout">
        <div class="col-left">
          ${_peProjectInfo(input)}

          <div class="section-title">PV System Parameters</div>
          <table class="info-table mb-xs">
            <tr><td class="il">Total Modules</td><td class="iv">${system.totalPanels || '—'}</td><td class="il">System Size</td><td class="iv">${system.totalDcKw?.toFixed(2) || '—'} kW DC</td></tr>
            <tr><td class="il">Module Model</td><td class="iv" colspan="3">${(() => { const _eq = _eqFence ?? getEquipmentContext(input, cad); return [_eq.panelManufacturer, _eq.panelModel].filter(s => s && s !== '—' && s !== '&mdash;').join(' ') || '—'; })()}</td></tr>
            <tr><td class="il">Mounting System</td><td class="iv" colspan="3">${escapeH(mountSys)}</td></tr>
            <tr><td class="il">Rail Orientation</td><td class="iv">Horizontal along fence line</td><td class="il">Foundation</td><td class="iv">Concrete footing</td></tr>
          </table>

          <div class="section-title">Solar Fence Construction</div>
          <table class="info-table mb-xs">
            <tr><td class="il">System Type</td><td class="iv">Solar Fence Array</td><td class="il">Panel Height</td><td class="iv">${panelHIn}</td></tr>
            <tr><td class="il">Post Type</td><td class="iv">Galvanized Steel Pipe / HSS</td><td class="il">Post Spacing</td><td class="iv">${postSpacing} ft O.C.</td></tr>
            <tr><td class="il">Foundation Type</td><td class="iv">Concrete Footing (cast-in-place)</td><td class="il">Embedment Depth</td><td class="iv">${postEmbed} ft min.</td></tr>
            <tr><td class="il">Concrete Strength</td><td class="iv">3,000 psi min.</td><td class="il">Hardware</td><td class="iv">Galvanized / Stainless Steel</td></tr>
            <tr><td class="il">Wind Code</td><td class="iv">${asce} &sect;29.4, Cf = 1.3</td><td class="il">Exposure</td><td class="iv">Category ${exposure}</td></tr>
          </table>
        </div>

        <div class="col-right">
          <div class="section-title">Structural Analysis Results (${asce})</div>
          <table class="info-table mb-xs">
            ${_peSiteLoading(input)}
            <tr class="bg-lt"><td class="il" colspan="4" style="font-weight:bold;text-align:center;">Post Foundation Capacity Analysis</td></tr>
            <tr><td class="il">Net Lateral Wind Load / Post</td><td class="iv">${uplift} lbs</td><td class="il">Post Embedment Capacity</td><td class="iv">Per ${asce} &sect;29.4</td></tr>
            <tr><td class="il">Safety Factor (Overturning)</td><td class="iv" style="font-weight:bold;color:${Number(safetyFact) >= _fenceMinSf ? '#000' : '#cc0000'};">${safetyFact} (min. ${_fenceMinSf.toFixed(1)} req.)</td><td class="il">Post Embedment Depth</td><td class="iv">${postEmbed} ft min.</td></tr>
            <tr class="bg-lt"><td class="il" colspan="4" style="font-weight:bold;text-align:center;">Governing Load Combination (${asce} &sect;2.4 &mdash; ASD)</td></tr>
            <tr><td class="il">Governing Combo</td><td class="iv">0.6D + 0.6W (Overturning)</td><td class="il">Code Reference</td><td class="iv">${asce} &sect;29.4</td></tr>
          </table>

          ${approved ? `
          <div class="sec" style="margin-bottom:var(--xs);">
            <div class="sec-hdr">ENGINEER'S CERTIFICATION STATEMENT</div>
            <div class="sec-body">
              <div class="f-xs" style="line-height:1.6;">
                I, the undersigned, a licensed Professional Engineer in the State of <strong>${state}</strong>,
                hereby certify that I have reviewed the structural design of the above-described solar photovoltaic
                fence array installation and determined that the <strong>proposed solar fence post foundation system
                is adequate to support the additional loads imposed by the proposed fence-mounted PV array</strong>,
                based on the structural analysis performed in accordance with <strong>${asce} &sect;29.4</strong>,
                <strong>${ibcVer} IBC</strong>, and NEC ${necVer}.
              </div>
              <div class="f-sm mt-xs" style="line-height:1.6;">
                Post embedment depth, concrete footing size, and post section are confirmed adequate to resist
                wind overturning and lateral loads at the design wind speed of ${windSpeed} mph, Exposure Category ${exposure},
                per ${asce} &sect;29.4 (Cf = 1.3). Dead load and ground snow load per ${asce} &sect;26 and &sect;7 respectively.
                Field conditions shall be verified by the installing contractor.
                Any deviations from ${escapeH(deviationReference(input))} shall be reported to the engineer of record prior to installation.
              </div>
            </div>
          </div>` : _pePendingCertStatement()}

          ${_peSigBlock()}
        </div>
      </div>

      ${_peFooter(asce)}
    </div>
  </div>`;
}

// --- GROUND MOUNT PE LETTER -------------------------------------------------
export function pagePELetterGround(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number, opts?: PELetterOpts): string {
  const _cpG = projectCodeAuthorityFromInput(input); const asce = _cpG.asceLabel;   // W4 Section 2
  const { project, system, compliance } = input;
  const necVer  = _cpG.nec ?? 'PENDING';
  const ibcVer  = _cpG.ibc ?? 'PENDING';
  const state   = compliance.jurisdiction?.state || '—';
  const structural = compliance.structural;
  const approved = certificationApproved(input);   // Section 2 gate
  // W3 Section 7 -- env single-sourced from the snapshot.
  const _sp = projectStructuralFromInput(input);
  const windSpeed   = _sp.present ? fmt(_sp.windSpeedMph) : (structural?.wind?.windSpeed || '—');
  const uplift      = structural?.wind?.upliftPerAttachment?.toFixed(0) || '—';
  const safetyFact  = structural?.attachment?.safetyFactor?.toFixed(2) || '—';

  const arr0        = cad.ground?.arrays?.[0];
  const pileDepth   = arr0 ? (arr0.pileDepthM * 3.281).toFixed(1) : '5.0';
  // Speck PLP places ONE driven I-beam pylon per bay at ~20 ft O.C. (engine
  // PLP_BAY_SPAN_M). Honor a stored spacing only if it is a plausible PLP bay
  // span (>= 15 ft); a legacy ~8 ft generic default does not describe PLP.
  const _rawPylonSp = arr0 ? arr0.pileSpacingM * 3.281 : 0;
  const pileSpacing = (_rawPylonSp >= 15 ? _rawPylonSp : 20).toFixed(0);
  const groundClr   = arr0 ? (arr0.groundClearanceM * 39.37).toFixed(0) : '12';
  const tiltDeg     = arr0?.tiltDeg || 20;
  const structType  = 'Driven I-beam pylon (Speck PLP)';
  const exposure    = _sp.present ? fmtStr(_sp.exposure) : (structural?.wind?.exposureCategory || project.exposureCategory || 'C');
  // Per-sub letter (hybrid): never certify the project-wide (roof) racking
  // string on the ground letter -- see fence letter note.
  const mountSys    = opts?.subKey
    ? 'Speck PLP POWER DRIVE&trade; Ground Mount'
    : (project._canonical?.mountSystem || project.mountingSystem || 'Speck PLP POWER DRIVE&trade; Ground Mount');
  const _eqGround   = opts?.subKey ? resolveEquipmentBySubSystem(input, opts.subKey, cad) : null;

  return `
  <div class="page">
    ${titleBlock(input, opts?.sheetId ?? 'PE-1', peLetterSheetTitle(input), pageNum, totalPages)}
    ${certificationGateBanner(input)}
    <div class="page-content">

      <div class="bb-hvy pb-xs mb-sm">
        ${peLetterHeadingBlock(input,
          'Solar Photovoltaic System &mdash; Ground Mount Array',
          `Prepared under ${asce} &bull; ${ibcVer} IBC &bull; NEC ${necVer}`)}
      </div>

      <div class="two-col-layout">
        <div class="col-left">
          ${_peProjectInfo(input)}

          <div class="section-title">PV System Parameters</div>
          <table class="info-table mb-xs">
            <tr><td class="il">Total Modules</td><td class="iv">${system.totalPanels || '—'}</td><td class="il">System Size</td><td class="iv">${system.totalDcKw?.toFixed(2) || '—'} kW DC</td></tr>
            <tr><td class="il">Module Model</td><td class="iv" colspan="3">${(() => { const _eq = _eqGround ?? getEquipmentContext(input, cad); return [_eq.panelManufacturer, _eq.panelModel].filter(s => s && s !== '—' && s !== '&mdash;').join(' ') || '—'; })()}</td></tr>
            <tr><td class="il">Mounting System</td><td class="iv" colspan="3">${mountSys}</td></tr>
            <tr><td class="il">Array Tilt</td><td class="iv">${tiltDeg}&deg;</td><td class="il">Foundation</td><td class="iv">Driven pylon (PLP)</td></tr>
          </table>

          <div class="section-title">Ground Mount Construction</div>
          <table class="info-table mb-xs">
            <tr><td class="il">Foundation Type</td><td class="iv">${structType}</td><td class="il">Pylon Embed</td><td class="iv">${pileDepth} ft min.</td></tr>
            <tr><td class="il">Ground Clearance</td><td class="iv">${groundClr}" min.</td><td class="il">Tilt Angle</td><td class="iv">${tiltDeg}&deg;</td></tr>
            <tr><td class="il">Pylon Spacing</td><td class="iv">${pileSpacing} ft O.C. (1/bay)</td><td class="il">Hardware</td><td class="iv">Galvanized / Stainless Steel</td></tr>
            <tr><td class="il">Wind Code</td><td class="iv">${asce} &sect;27 + &sect;29.4</td><td class="il">Exposure</td><td class="iv">Category ${exposure}</td></tr>
          </table>
        </div>

        <div class="col-right">
          <div class="section-title">Structural Analysis Results (${asce})</div>
          <table class="info-table mb-xs">
            ${_peSiteLoading(input)}
            <tr class="bg-lt"><td class="il" colspan="4" style="font-weight:bold;text-align:center;">Pylon Capacity Analysis</td></tr>
            <tr><td class="il">Net Uplift / Pylon</td><td class="iv">${uplift} lbs</td><td class="il">Pylon Lateral Capacity</td><td class="iv">Per geotechnical report</td></tr>
            <tr><td class="il">Safety Factor</td><td class="iv" style="font-weight:bold;color:${Number(safetyFact) >= MIN_ATTACHMENT_SF ? '#000' : '#cc0000'};">${safetyFact} (ASD basis &mdash; min. ${MIN_ATTACHMENT_SF.toFixed(1)} req.)</td><td class="il">Pylon Embedment Depth</td><td class="iv">${pileDepth} ft min.</td></tr>
            <tr class="bg-lt"><td class="il" colspan="4" style="font-weight:bold;text-align:center;">Governing Load Combination (${asce} &sect;2.4 &mdash; ASD)</td></tr>
            <tr><td class="il">Governing Combo</td><td class="iv">0.6D + 0.6W (Uplift)</td><td class="il">Code Reference</td><td class="iv">${asce} &sect;27</td></tr>
          </table>

          ${approved ? `
          <div class="sec" style="margin-bottom:var(--xs);">
            <div class="sec-hdr">ENGINEER'S CERTIFICATION STATEMENT</div>
            <div class="sec-body">
              <div class="f-xs" style="line-height:1.6;">
                I, the undersigned, a licensed Professional Engineer in the State of <strong>${state}</strong>,
                hereby certify that I have reviewed the structural design of the above-described ground-mounted
                solar photovoltaic array installation and determined that the <strong>proposed driven-pylon
                (Speck PLP POWER DRIVE&trade;) foundation system is adequate to support the loads imposed by the
                proposed ground-mounted PV array</strong>, based on the structural analysis performed in accordance
                with <strong>${asce} &sect;27</strong>, <strong>${ibcVer} IBC</strong>, and NEC ${necVer}.
              </div>
              <div class="f-sm mt-xs" style="line-height:1.6;">
                Pylon embedment depth, pylon capacity, and foundation system design are confirmed adequate to resist
                wind uplift and lateral loads at the design wind speed of ${windSpeed} mph, Exposure Category ${exposure},
                per ${asce} &sect;27. Ground snow load per ${asce} &sect;7 (slope reduction factor per array tilt angle
                of ${tiltDeg}&deg;). Geotechnical conditions shall be confirmed by a licensed geotechnical engineer.
                Field conditions shall be verified by the installing contractor.
                Any deviations from ${escapeH(deviationReference(input))} shall be reported to the engineer of record prior to installation.
              </div>
            </div>
          </div>` : _pePendingCertStatement()}

          ${_peSigBlock()}
        </div>
      </div>

      ${_peFooter(asce)}
    </div>
  </div>`;
}

// --- ROOF PE LETTER ---------------------------------------------------------
export function pagePELetterRoof(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number, opts?: PELetterOpts): string {
  const { project, system, compliance } = input;
  const _eqRoof = opts?.subKey ? resolveEquipmentBySubSystem(input, opts.subKey, cad) : null;
  const _cpR = projectCodeAuthorityFromInput(input); const asce = _cpR.asceLabel;   // W4 Section 2
  const necVer  = _cpR.nec ?? 'PENDING';
  const ibcVer  = _cpR.ibc ?? 'PENDING';
  const state   = compliance.jurisdiction?.state || '—';
  const structural = compliance.structural;
  const approved = certificationApproved(input);   // Section 2 gate
  // W3 Section 5/7/9 -- env single-sourced; lag-bolt result from the snapshot
  // attachment-uplift CHECK (capacity/demand/SF), not a `(safetyFactor||2)` derive.
  const _sp = projectStructuralFromInput(input);
  const _attChk = findCheck(_sp, 'attachment-uplift');
  // W8 — PE-1 projects the SAME gated state as PV-4C. While the RT-MINI capacity
  // source is unverified (capacityGated) no allowable / SF / PASS may render; while
  // framing authority is unverified (engineeringReviewRequired) the framing check
  // renders INDETERMINATE (no utilization %, no PASS). PE-1 reads the honest
  // snapshot framing check (passes:null) rather than the legacy compliance.structural
  // .rafter.* numbers that were computed off the fabricated 45-psf / 12-ft defaults.
  const _capGated       = _sp.capacityGated === true;
  const _framingChk     = findCheck(_sp, 'framing-capacity');
  const _reviewRequired = _sp.engine?.engineeringReviewRequired ?? (_framingChk?.passes == null);
  const windSpeed   = _sp.present ? fmt(_sp.windSpeedMph) : (structural?.wind?.windSpeed || '—');
  const uplift      = _attChk?.demand != null ? _attChk.demand.toFixed(0) : (structural?.wind?.upliftPerAttachment?.toFixed(0) || '—');
  const lagCap      = _attChk?.capacity != null ? _attChk.capacity.toFixed(0) : (structural?.attachment?.lagBoltCapacity?.toFixed(0) || '—');
  const safetyFact  = _attChk?.safetyFactor != null ? _attChk.safetyFactor.toFixed(2) : (structural?.attachment?.safetyFactor?.toFixed(2) || '—');
  // utilizationRatio carries the GOVERNING ratio (max of bending/deflection) --
  // labelling it as bending utilization made PE-1 print "145%" beside a passing
  // 90% bending check. Compute each check's own ratio and certify CONDITIONALLY:
  // the letter must never say "confirmed adequate" while its own numbers fail.
  const _bmRaw   = structural?.rafter?.bendingMoment;
  const _abmRaw  = structural?.rafter?.allowableBendingMoment;
  const _deflRaw = structural?.rafter?.deflection;
  const _adRaw   = structural?.rafter?.allowableDeflection;
  const _bendRatio = (_bmRaw != null && _abmRaw) ? _bmRaw / _abmRaw : null;
  const _deflRatio = (_deflRaw != null && _adRaw) ? _deflRaw / _adRaw : null;
  const _sfRaw     = _attChk?.safetyFactor ?? structural?.attachment?.safetyFactor;
  const _bendPass  = _bendRatio == null || _bendRatio <= 1.0;
  const _deflPass  = _deflRatio == null || _deflRatio <= 1.0;
  // ASD basis: demand (0.6W) and capacity (allowable) are BOTH ASD -- the margin
  // lives inside the allowable, so the pass bar is the canonical attachment
  // check threshold (MIN_ATTACHMENT_SF = 1.0), not a second 2.0 on top.
  const _attThreshold = _attChk?.requiredThreshold ?? MIN_ATTACHMENT_SF;
  const _lagPass   = _sfRaw == null || _sfRaw >= _attThreshold;
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
  const rafterSize  = project.rafterSize  || '2&times;6';
  const rafterSpace = project.rafterSpacing || 24;
  // Same resolution chain as PV-3 (engineering-resolved -> user input -> racking
  // rated max) -- the raw ||48 default printed "48" max O.C." on the letter
  // while PV-3 and the PV-4C lag analysis resolved 24" for the same job.
  const _mountSel   = project.mountingSystemId ? getMountingSystemById(project.mountingSystemId) : undefined;
  const attachSpace = structural?.attachment?.maxAllowedSpacing
    || project.attachmentSpacing
    || _mountSel?.mount?.maxSpacingIn
    || 48;
  const _fracIn = (v: number) =>
    v === 0.25 ? '1/4' : v === 0.3125 ? '5/16' : v === 0.375 ? '3/8' : v === 0.5 ? '1/2' : `${v}`;
  // §12 — the ONE canonical fastener assembly (identical to PV-3 / APP-A / SCHED).
  // The PE letter no longer asserts a generic "5/16 minimum stainless lag"; while
  // the assembly is unverified it prints PENDING VERIFIED FASTENER ASSEMBLY.
  const _fa       = projectFastenerAssembly(input);
  // §14 — canonical spacing authority (design vs maximum-verified). PE-1 states
  // the DESIGN spacing + PENDING STRUCTURAL VERIFICATION unless a verified source
  // establishes a maximum-allowed — the letter never asserts "max O.C." unproven.
  const _spc      = _sp.spacingAuthority;
  const lagDia    = _fa.diameterLabel ?? _fracIn(_mountSel?.mount?.fastenerDiameterIn ?? 0.375);
  const lagEmbed  = _fa.embedmentIn ?? _mountSel?.mount?.fastenerEmbedmentIn ?? 2.5;
  // 1-decimal ratio so the printed pair is self-consistent -- Math.round gave
  // "4/12 (20.0 deg)" where 4:12 is actually 18.4 deg (a checkable contradiction).
  // Pitch = what the structural engine analyzed (CAD plane[0] -> project) --
  // the letter used to claim project.roofPitch (20 deg) while the analysis ran
  // on the CAD plane pitch (17 deg).
  const _pitchDeg   = cad.roof?.planes?.[0]?.pitch ?? project.roofPitch;
  const roofPitch   = _pitchDeg ? `${(Math.tan(_pitchDeg * Math.PI / 180) * 12).toFixed(1)}:12 (${_pitchDeg.toFixed(1)}&deg;)` : '—';
  const roofType    = roofTypeLabel(project.roofType);
  const exposure    = _sp.present ? fmtStr(_sp.exposure) : (structural?.wind?.exposureCategory || '—');
  const mountSys    = project._canonical?.mountSystem || project.mountingSystem || 'IronRidge XR100';

  return `
  <div class="page">
    ${titleBlock(input, opts?.sheetId ?? 'PE-1', peLetterSheetTitle(input), pageNum, totalPages)}
    ${certificationGateBanner(input)}
    <div class="page-content pe-letter">

      <div class="bb-hvy pb-xs mb-sm" style="display:flex;justify-content:space-between;align-items:flex-end;">
        <div>
          ${peLetterHeadingBlock(input,
            'Solar Photovoltaic System &mdash; Roof-Mounted Array',
            `Prepared under ${asce} &bull; ${ibcVer} IBC &bull; ${ibcVer} IRC &bull; NEC ${necVer}`)}
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
          <table class="info-table mb-xs">
            <tr><td class="il">Total Modules</td><td class="iv">${system.totalPanels || '—'}</td><td class="il">System Size</td><td class="iv">${system.totalDcKw?.toFixed(2) || '—'} kW DC</td></tr>
            <tr><td class="il">Module Model</td><td class="iv" colspan="3">${(() => { const _eq = _eqRoof ?? getEquipmentContext(input, cad); return [_eq.panelManufacturer, _eq.panelModel].filter(s => s && s !== '—' && s !== '&mdash;').join(' ') || '—'; })()}</td></tr>
            <tr><td class="il">Mounting System</td><td class="iv" colspan="3">${escapeH(mountSys)}</td></tr>
            <tr><td class="il">Rail Orientation</td><td class="iv">Perpendicular to rafters</td><td class="il">Attachment</td><td class="iv">${escapeH(_fa.present ? (_fa.fastenerType ?? 'Structural fastener') : 'Per fastener assembly')} w/ flashing</td></tr>
          </table>

          <div class="section-title">Existing Roof Construction</div>
          <table class="info-table mb-xs">
            <tr><td class="il">Roof Type</td><td class="iv">${roofType}</td><td class="il">Roof Pitch</td><td class="iv">${roofPitch}</td></tr>
            <tr><td class="il">Rafter / Framing</td><td class="iv">${_isTruss ? `Pre-Engineered Truss (${rafterSize} chords)` : `${rafterSize} Lumber`}</td><td class="il">Spacing</td><td class="iv">${rafterSpace}" O.C.</td></tr>
            <tr><td class="il">Attach Spacing</td><td class="iv">${_spc.designSpacingIn != null ? _spc.designSpacingIn : attachSpace}&quot; O.C. ${_spc.verificationState === 'verified' ? `(MAX ALLOWED, VERIFIED)` : `<span style="color:#b45309;font-weight:bold;">(design; PENDING VERIF.)</span>`}</td><td class="il">Fastener Dia.</td><td class="iv">${_fa.nonOrderable ? '<span style="color:#b45309;font-weight:bold;">PENDING VERIF.</span>' : lagDia + '"'}</td></tr>
            <tr><td class="il">Min. Embedment</td><td class="iv">${_fa.nonOrderable ? '<span style="color:#b45309;font-weight:bold;">PENDING VERIF.</span>' : lagEmbed + '" into ' + escapeH(_fa.substrate ?? 'rafter')}</td><td class="il">Fastener Status</td><td class="iv" style="font-weight:bold;color:${_fa.verification === 'verified' ? '#000' : '#b45309'};">${escapeH(_fa.certLabel)}</td></tr>
            <tr><td class="il">Fastener Assembly</td><td class="iv" colspan="3" data-pe-field="fastener">${escapeH(_fa.line)}</td></tr>
            <tr><td class="il">Roof Sheathing</td><td class="iv">No attachment to sheathing only</td><td class="il">Underlayment</td><td class="iv">Maintained per mfr. req.</td></tr>
          </table>
        </div>

        <div class="col-right">
          <div class="section-title">Structural Analysis Results (${asce})</div>
          <table class="info-table mb-xs">
            ${_peSiteLoading(input)}
                                    <tr class="bg-lt"><td class="il" colspan="4" style="font-weight:bold;text-align:center;">${_isTruss ? 'Roof Framing (Truss) Analysis' : 'Rafter Bending &amp; Deflection Analysis'}</td></tr>
            ${_reviewRequired ? `
            <tr><td class="il">Observed Framing</td><td class="iv" colspan="3" data-observed-framing="pe-1">${escapeH(_sp.observedFramingLine)} &mdash; ${escapeH(_sp.observedFramingSource)}</td></tr>
            <tr><td class="il">Framing Capacity</td><td class="iv" colspan="3" style="font-weight:bold;color:#b91c1c;">EXISTING FRAMING CAPACITY NOT VERIFIED &mdash; PROJECT-SPECIFIC STRUCTURAL REVIEW REQUIRED (operator-entered geometry is OBSERVATION, not capacity authority)</td></tr>
            <tr><td class="il">Result</td><td class="iv" colspan="3" style="font-weight:bold;color:#b45309;">ENGINEERING REVIEW REQUIRED &mdash; NO FRAMING PASS/FAIL CONCLUSION ISSUED (no utilization asserted)</td></tr>` : _isTruss ? `
            <tr><td class="il">Analysis Basis</td><td class="iv">BCSI capacity table</td><td class="il">Framing</td><td class="iv">Pre-Engineered Truss</td></tr>
            <tr><td class="il">Total Load</td><td class="iv">${totalLoadPsf} psf</td><td class="il">Truss Span</td><td class="iv">${rafterSpanFt} ft${!project.rafterSpan ? ' (PER ROOF GEOMETRY &mdash; FIELD VERIFY)' : ''}</td></tr>
            <tr><td class="il">Truss Capacity</td><td class="iv">${allowableBM} psf</td><td class="il">Load Utilization</td><td class="iv" style="font-weight:bold;color:${(structural?.rafter?.utilizationRatio ?? 0) <= 1.0 ? '#000' : '#cc0000'};">${utilization}%</td></tr>
            <tr><td class="il">Deflection</td><td class="iv" colspan="3">Governed by the truss manufacturer's design &mdash; verify capacity with the truss mfr for the added PV load</td></tr>` : `
            <tr><td class="il">F'b (Adjusted)</td><td class="iv">${fbPrime} psi</td><td class="il">Framing</td><td class="iv">Stick (${framingType})</td></tr>
            <tr><td class="il">Total Load</td><td class="iv">${totalLoadPsf} psf</td><td class="il">Rafter Span</td><td class="iv">${rafterSpanFt} ft${!project.rafterSpan ? ' (ASSUMED &mdash; FIELD VERIFY)' : ''}</td></tr>
            <tr><td class="il">Line Load</td><td class="iv">${lineLoad} lb/ft</td><td class="il">Bending Moment</td><td class="iv">${bendingMoment} / ${allowableBM} lb-ft</td></tr>
            <tr><td class="il">Bending Utilization</td><td class="iv" style="font-weight:bold;color:${_bendPass ? '#000' : '#cc0000'};">${bendUtil}%</td><td class="il">Deflection</td><td class="iv" style="color:${_deflPass ? '#000' : '#cc0000'};">${deflection} in (&Delta;_allow = ${allowableDefl} in &mdash; ${deflUtil}%)</td></tr>`}
            <tr class="bg-lt"><td class="il" colspan="4" style="font-weight:bold;text-align:center;">Lag Bolt Attachment ${_capGated ? '&mdash; Capacity Source Pending' : 'Capacity Analysis'}</td></tr>
            ${_capGated ? `
            <tr><td class="il">Net Uplift per Attachment</td><td class="iv">${uplift} lbs (ASD 0.6W, canonical)</td><td class="il">Published Allowable</td><td class="iv" style="font-weight:bold;color:#b45309;">CAPACITY SOURCE UNVERIFIED</td></tr>
            <tr><td class="il">Capacity Comparison</td><td class="iv" colspan="3" style="font-weight:bold;color:#b45309;">ENGINEERING REVIEW REQUIRED &mdash; NO PASS/FAIL CONCLUSION ISSUED (RT-MINI structural capacity source not archived / applicability to the selected assembly unconfirmed &mdash; &sect;9)</td></tr>` : `
            <tr><td class="il">Net Uplift per Attachment</td><td class="iv">${uplift} lbs</td><td class="il">Lag Bolt Capacity</td><td class="iv">${lagCap} lbs</td></tr>
            <tr><td class="il">Safety Factor</td><td class="iv" style="font-weight:bold;color:${_lagPass ? '#000' : '#cc0000'};">${safetyFact} (ASD basis &mdash; min. ${_attThreshold.toFixed(1)} req.)</td><td class="il">Governing Check</td><td class="iv" style="font-weight:bold;color:${_allPass ? '#000' : '#cc0000'};">${_utilRatioPresent ? `${_governs} &mdash; ${utilization}% ${_allPass ? '(PASS)' : '(EXCEEDS LIMIT)'}` : '—'}</td></tr>`}
            <tr class="bg-lt"><td class="il" colspan="4" style="font-weight:bold;text-align:center;">Governing Load Combination (${asce} &sect;2.4 &mdash; ASD)</td></tr>
            <tr><td class="il">Governing Combo</td><td class="iv">0.6D + 0.6W (Uplift)</td><td class="il">Code Reference</td><td class="iv">${asce} &sect;26/27</td></tr>
          </table>

          ${!approved ? _pePendingCertStatement() : `
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
                  : `<strong>the modeled framing does not satisfy all code checks &mdash; see below</strong>,`}
                based on the structural analysis performed in accordance with
                <strong>${asce} &sect;26/27</strong>, <strong>${ibcVer} IBC</strong>, <strong>${ibcVer} IRC</strong>,
                and NEC ${necVer}.
              </div>
              ${_allPass ? `
              <div class="f-sm mt-xs" style="line-height:1.6;">
                ${_isTruss
                  ? `Lag bolt attachment capacity (safety factor ${safetyFact}) and the pre-engineered truss load capacity (governing utilization ${utilization}%; member deflection to be verified with the truss manufacturer for the added PV load) are confirmed adequate for`
                  : `Lag bolt attachment capacity (safety factor ${safetyFact}), rafter bending stress (F'b = ${fbPrime} psi, bending utilization ${bendUtil}%), and deflection (&Delta; = ${deflection} in vs &Delta;_allow = ${allowableDefl} in) are confirmed adequate for`}
                the design wind speed of ${windSpeed} mph, Exposure Category ${exposure},
                per ${asce} &sect;26/27. Roof framing of ${rafterSize} @ ${rafterSpace}" O.C. (${_isTruss ? 'truss' : 'stick'} construction, span ${rafterSpanFt} ft) confirmed adequate for
                the combined dead load (${totalLoadPsf} psf), wind, and snow loading per IBC Section 1607 and ${asce} &sect;2.3.
                Field conditions shall be verified by the installing contractor.
                Any deviations from ${escapeH(deviationReference(input))} shall be reported to the engineer of record prior to installation.
              </div>` : `
              <div class="f-sm mt-xs" style="line-height:1.6;border:2px solid #cc0000;padding:var(--xs);">
                <strong style="color:#cc0000;">STRUCTURAL REVIEW REQUIRED &mdash; DO NOT ISSUE:</strong>
                under the modeled assumptions (${rafterSize} ${_isTruss ? 'truss' : 'stick'} framing @ ${rafterSpace}" O.C., span ${rafterSpanFt} ft,
                combined load ${totalLoadPsf} psf), the ${_governs} check exceeds its code limit
                (bending ${bendUtil}% of allowable; deflection &Delta; = ${deflection} in vs &Delta;_allow = ${allowableDefl} in).
                Lag bolt attachment safety factor is ${safetyFact}${_lagPass ? ' (adequate)' : ` (below the ${_attThreshold.toFixed(1)} ASD minimum)`}.
                Field-verify the actual framing type, member size, and clear span (pre-engineered trusses frequently
                resolve this check), correct the structural inputs, and re-run the analysis &mdash; or provide reinforcement
                designed by the engineer of record &mdash; before this letter is signed or sealed.
              </div>`}
            </div>
          </div>`}

          ${_peSigBlock()}
        </div>
      </div>

      ${_peFooter(asce)}
    </div>
  </div>`;
}

// --- DISPATCHER -------------------------------------------------------------
export function pagePELetter(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number): string {
  const sys = cad.systemType as string;
  if (isFence(sys))  return pagePELetterFence(input, cad, pageNum, totalPages);
  if (isGround(sys)) return pagePELetterGround(input, cad, pageNum, totalPages);
  return pagePELetterRoof(input, cad, pageNum, totalPages);
}
