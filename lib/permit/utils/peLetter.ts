// ═══════════════════════════════════════════════════════════════
// PE Letter Shared Primitives
// Extracted from route.ts — ZERO REGRESSION
// ═══════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';

// ─── SHARED PE LETTER PRIMITIVES ─────────────────────────────────────────────
// Signature block and footer are identical across all families — extracted once
export function _peSigBlock(): string {
  return `
  <div class=\\"sec\\">
    <div class=\\"sec-hdr\\">PROFESSIONAL ENGINEER OF RECORD</div>
    <div class=\\"sig-grid\\">
      <div class=\\"sig-col\\">
        <div class=\\"mb-sm f-sm\\">NAME: <span class=\\"sig-underline-md\\">&nbsp;</span></div>
        <div class=\\"mb-sm f-sm\\">PE LICENSE #: <span class=\\"sig-underline-sm\\">&nbsp;</span></div>
        <div class=\\"mb-sm f-sm\\">STATE OF LICENSURE: <span class=\\"sig-underline-110\\">&nbsp;</span></div>
        <div class=\\"mb-sm f-sm\\">DATE: <span class=\\"sig-underline-md\\">&nbsp;</span></div>
        <div style=\\"margin-top:20px;margin-bottom:4px;\\" class=\\"f-sm\\">SIGNATURE: <span style=\\"border-bottom:var(--border-hvy);display:inline-block;width:155px;\\">&nbsp;</span></div>
      </div>
      <div class=\\"sig-col-stamp\\">
        <div class=\\"f-sm fw9 caps mb-xs\\">PE SEAL / STAMP</div>
        <div class=\\"stamp-box\\">
          <span class=\\"f-xs fw7 caps c555\\">AFFIX<br/>SEAL<br/>HERE</span>
        </div>
      </div>
    </div>
  </div>`;
}

export function _peFooter(): string {
  return `
  <div class=\\"f-xs center mt-sm pt-xs\\" style=\\"border-top:var(--border);\\">
    THIS LETTER IS PREPARED SPECIFICALLY FOR THE ABOVE-NAMED PROJECT AND INSTALLATION ADDRESS.
    IT IS NOT TRANSFERABLE TO OTHER PROJECTS OR LOCATIONS.
    STRUCTURAL DATA DERIVED FROM ASCE 7-22 AUTOMATED ANALYSIS. FIELD VERIFICATION REQUIRED.
  </div>`;
}

export function _peProjectInfo(input: PermitInput): string {
  const { project, compliance } = input;
  const ahj   = compliance.jurisdiction?.ahj || '—';
  const state  = compliance.jurisdiction?.state || '—';
  return `
  <div class=\\"section-title\\">Project Information</div>
  <table class=\\"info-table\\" class=\\"mb-xs\\">
    <tr><td class=\\"il\\">Project Name</td><td class=\\"iv\\" colspan=\\"3\\">${project.projectName || '—'}</td></tr>
    <tr><td class=\\"il\\">Client / Owner</td><td class=\\"iv\\">${project.clientName || '—'}</td><td class=\\"il\\">Date</td><td class=\\"iv\\">${project.date}</td></tr>
    <tr><td class=\\"il\\">Installation Address</td><td class=\\"iv\\" colspan=\\"3\\">${project.address || '—'}</td></tr>
    <tr><td class=\\"il\\">AHJ</td><td class=\\"iv\\">${ahj}</td><td class=\\"il\\">State</td><td class=\\"iv\\">${state}</td></tr>
    <tr><td class=\\"il\\">Permit No.</td><td class=\\"iv\\">___________________</td><td class=\\"il\\">APN</td><td class=\\"iv\\">${(project as any).apn || '___________________'}</td></tr>
  </table>`;
}

export function _peSiteLoading(input: PermitInput): string {
  const { compliance } = input;
  const structural = compliance.structural;
  const windSpeed  = structural?.wind?.windSpeed || '—';
  const snowLoad   = structural?.snow?.groundSnowLoad || '—';
  const exposure   = structural?.wind?.exposureCategory || '—';
  const sdc        = (compliance as any).structural?.seismic?.sdc || 'D';
  return `
  <tr class=\\"bg-lt\\"><td class=\\"il\\" colspan=\\"4\\" style=\\"font-weight:bold;text-align:center;\\">Site Loading Parameters</td></tr>
  <tr><td class=\\"il\\">Design Wind Speed (Vult)</td><td class=\\"iv\\">${windSpeed} mph</td><td class=\\"il\\">Exposure Category</td><td class=\\"iv\\">Cat. ${exposure}</td></tr>
  <tr><td class=\\"il\\">Ground Snow Load (pg)</td><td class=\\"iv\\">${snowLoad} psf</td><td class=\\"il\\">Risk Category</td><td class=\\"iv\\">II (Residential)</td></tr>
  <tr><td class=\\"il\\">Seismic Design Category</td><td class=\\"iv\\">${sdc}</td><td class=\\"il\\">Importance Factor</td><td class=\\"iv\\">1.0</td></tr>`;
}



