// ═══════════════════════════════════════════════════════════════════════════
// RS-1: REVIEW STATUS — ACTIVE RELEASE BLOCKERS & RECONCILIATION
//
// W10 (RP-D): the dedicated, dense review-status sheet that enumerates EVERY
// active release blocker from the canonical permitReadiness.registry — blocking
// AND advisory, across every authority domain (electrical, structural, code,
// project/document, equipment-identity, equipment/document, project-identity).
//
// This is the renderer surface that ends the structural-else-everything ternary
// era: the REC-405-vs-Qcells-400 equipment-identity conflict, the code /
// tap-length / conduit-fill / route-estimate / designer-blank / TEST-name
// blockers are ALL listed here with their authority path, affected sheets, a
// human explanation and the resolution action. It reads ONLY the snapshot
// registry (never a renderer-local re-derivation) so gate 14 holds: no active
// blocker is absent from the rendered registry.
//
// Referenced from the cover's SHEET INDEX (RS-1). ASCII + HTML entities only.
// ═══════════════════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import type { PermitReadinessBlocker } from '../snapshot/types';
import { titleBlock } from '../utils/titleBlock';
import { escapeH } from '../utils/drawing';
import { peekSnapshot } from '../snapshot/read';
import { projectProjectAuthorityFromInput } from '../snapshot/projectAuthorityProjection';

const DOMAIN_LABEL: Record<string, string> = {
  electrical: 'ELECTRICAL',
  structural: 'STRUCTURAL',
  code: 'CODE AUTHORITY',
  equipment: 'EQUIPMENT IDENTITY',
  document: 'PROJECT / DOCUMENT',
  review: 'ENGINEERING REVIEW',
  other: 'OTHER',
};
// Ordered so the reviewer reads the most consequential lanes first.
const DOMAIN_ORDER = ['equipment', 'structural', 'electrical', 'code', 'document', 'review', 'other'];

// §18 (closeout 2026-07-23) — RS-1 legibility floor. Core blocker text was
// 6–6.5px (≈4.9pt at 17x11) — below the readable floor for a permit reviewer.
// Every blocker's authority path + resolution action is now printed at an
// effective ≥6.5pt (8.5px) and the registry paginates onto formal RS-1.n
// continuation sheets when it no longer fits one page at the larger size.
// Core blocker text at ≥6.5pt effective (8.7px ≈ 6.53pt at 17x11 96dpi) — was
// 6–6.5px (≈4.9pt), below the readable floor. Every authority path + resolution
// action is preserved (never abbreviated) at this size; page-fit stays strict.
const RS_FONT = {
  badge: '7.5px',
  code: '8.7px',
  issue: '8.7px',
  justification: '7.6px',
  resolution: '8.7px',
  sheets: '8.2px',
  domainHdr: '9px',
};

function sevBadge(sev: string): string {
  const blocking = sev === 'blocking';
  const bg = blocking ? '#b91c1c' : '#b45309';
  const label = blocking ? 'BLOCKING' : 'ADVISORY';
  return `<span style="display:inline-block;background:${bg};color:#fff;font-weight:900;font-size:${RS_FONT.badge};letter-spacing:0.5px;padding:1px 4px;border-radius:2px;white-space:nowrap;">${label}</span>`;
}

export function pageReviewStatus(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number): string {
  const snap = peekSnapshot(input);
  const registry: PermitReadinessBlocker[] = (snap?.permitReadiness?.registry ?? []).filter(r => !r.resolved);
  const pa = projectProjectAuthorityFromInput(input);
  const issueStatus = pa.issueStatus ?? 'DESIGN DRAFT';

  const blockingCount = registry.filter(r => r.severity === 'blocking').length;
  const advisoryCount = registry.length - blockingCount;
  const ready = snap?.permitReadiness?.ready === true;

  // Group by domain (fixed reading order); unknown domains fall to 'other'.
  const byDomain = new Map<string, PermitReadinessBlocker[]>();
  for (const r of registry) {
    const d = DOMAIN_ORDER.includes(r.domain) ? r.domain : 'other';
    const arr = byDomain.get(d) ?? [];
    arr.push(r);
    byDomain.set(d, arr);
  }
  const orderedDomains = DOMAIN_ORDER.filter(d => byDomain.has(d));

  // §Q — render a blocker's STRUCTURED payload (currently the Q-Cable procurement
  // deficit) as a DENSE 2-line block beneath its explanation, so RS-1 carries the
  // machine-readable detail (SKU, spacing, per-branch paths, procurement derivation,
  // deficit, resolution options, verification status) verbatim while staying page-fit.
  const payloadBlock = (r: PermitReadinessBlocker): string => {
    const p = r.payload;
    if (!p || typeof p !== 'object') return '';
    const perBranch = Array.isArray(p.perBranchPaths)
      ? (p.perBranchPaths as any[]).map(b => `${escapeH(String(b.branchLabel))} ${b.dropCount}d ${b.designedInstalledLengthFt ?? '—'}/${b.procurementLengthFt ?? '—'}ft`).join(' · ')
      : '';
    const opts = Array.isArray(p.resolutionOptions)
      ? (p.resolutionOptions as any[]).map(o => `${escapeH(String(o.kind))}=${o.selected ? 'SEL' : 'NOT SEL'}`).join(' · ')
      : '';
    return `<div style="margin-top:1px;font-size:${RS_FONT.justification};line-height:1.25;color:#334155;border-left:2px solid #b91c1c;padding-left:4px;">`
      + `<span style="font-weight:900;color:#b91c1c;">DEFICIT PAYLOAD:</span> SKU ${escapeH(String(p.selectedQCableSku ?? '—'))} @ ${escapeH(String(p.connectorDropSpacingFt ?? '—'))}ft drop · `
      + `designed ${escapeH(String(p.totalDesignedInstalledFt ?? '—'))}ft + allowance ${escapeH(String(p.requiredServiceLoopAllowanceFt ?? '—'))}ft (${escapeH(String(p.allowanceProvenance ?? ''))}) `
      + `vs procurement ${escapeH(String(p.procurementLengthFt ?? '—'))}ft ⇒ <span style="color:#b91c1c;font-weight:900;">deficit ${escapeH(String(p.deficitFt ?? '—'))} ft</span> · `
      + `branches ${escapeH(perBranch)} · affected ${escapeH((p.affectedBranchIds as any[] ?? []).join(', ') || '—')} · `
      + `mfr-doc authority null · status ${escapeH(String(p.verificationStatus ?? ''))} · resolution: ${escapeH(opts)}</div>`;
  };

  const rowFor = (r: PermitReadinessBlocker): string => {
    // §17 — an ADVISORY blocker MUST render its written justification (why the
    // missing fact cannot affect safety, code compliance, procurement, engineering
    // approval, or permit acceptance). Single-sourced from the snapshot registry.
    const justification = (r.severity === 'warning' && r.justification)
      ? `<div style="margin-top:2px;font-size:${RS_FONT.justification};line-height:1.3;color:#7c5b12;"><span style="font-weight:900;">ADVISORY JUSTIFICATION:</span> ${escapeH(r.justification)}</div>`
      : '';
    return `
    <tr>
      <td style="text-align:center;">${sevBadge(r.severity)}</td>
      <!-- The CODE cell lives in a table-layout:fixed column, so nowrap made a long
           code overrun into the ISSUE column instead of widening its own cell (worst
           case ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED, 39 chars). Wrap inside the
           cell — codes break naturally at their hyphens and stay legible. -->
      <td class="mono" style="font-weight:900;font-size:${RS_FONT.code};white-space:normal;overflow-wrap:anywhere;word-break:break-word;line-height:1.15;">${escapeH(r.code)}</td>
      <td style="font-size:${RS_FONT.issue};line-height:1.22;">${escapeH(r.explanation)}${justification}${payloadBlock(r)}</td>
      <td style="font-size:${RS_FONT.resolution};line-height:1.22;color:#1e3a5f;">${escapeH(r.resolutionAction)}</td>
      <td style="font-size:${RS_FONT.sheets};line-height:1.25;color:#555;">${escapeH(r.affectedSheets.join(', ') || '—')}</td>
    </tr>`;
  };

  const sectionFor = (domain: string): string => {
    const rows = (byDomain.get(domain) ?? []);
    if (!rows.length) return '';
    return `
      <div style="margin-top:2px;">
        <div style="background:#111;color:#fff;font-weight:900;font-size:${RS_FONT.domainHdr};letter-spacing:0.7px;padding:1px 6px;">
          ${DOMAIN_LABEL[domain] ?? domain.toUpperCase()} &mdash; ${rows.length} ${rows.length === 1 ? 'BLOCKER' : 'BLOCKERS'}
        </div>
        <table class="equip-table" style="width:100%;table-layout:fixed;">
          <thead><tr>
            <!-- 52px was narrower than the severity badge itself, so the badge bled
                 over the first character of the CODE cell. 66px clears BLOCKING/ADVISORY. -->
            <th style="width:66px;">STATUS</th>
            <th style="width:168px;text-align:left;">CODE</th>
            <th style="text-align:left;">ISSUE (AUTHORITY GAP)</th>
            <th style="width:33%;text-align:left;">RESOLUTION ACTION</th>
            <th style="width:64px;text-align:left;">SHEETS</th>
          </tr></thead>
          <tbody>${rows.map(rowFor).join('')}</tbody>
        </table>
      </div>`;
  };

  const emptyState = `
    <div style="border:2px solid #166534;background:#f0fdf4;padding:10px 14px;margin-top:8px;">
      <div style="font-weight:900;font-size:12px;color:#166534;letter-spacing:0.5px;">NO ACTIVE RELEASE BLOCKERS</div>
      <div style="font-size:8px;color:#166534;margin-top:2px;">All tracked authority gaps are resolved for this snapshot. See CERT / PE-1 for the engineering review + seal status.</div>
    </div>`;

  const bodyDomains = orderedDomains.map(sectionFor).join('');

  return `
  <div class="page">

    ${titleBlock(input, 'RS-1', 'REVIEW STATUS &mdash; ACTIVE RELEASE BLOCKERS', pageNum, totalPages)}

    <div class="page-content">

      <!-- STATUS SUMMARY STRIP -->
      <div style="display:flex;gap:8px;align-items:stretch;margin-top:1px;">
        <div style="flex:2 1 auto;border:2px solid ${ready ? '#166534' : '#b91c1c'};background:${ready ? '#f0fdf4' : '#fef2f2'};padding:3px 10px;">
          <div style="font-weight:900;font-size:13px;letter-spacing:0.6px;color:${ready ? '#166534' : '#b91c1c'};">
            ${ready ? 'CLEARED FOR ISSUE &mdash; NO OPEN BLOCKERS' : 'NOT FOR PERMIT SUBMISSION &mdash; ' + blockingCount + ' OPEN RELEASE BLOCKER' + (blockingCount === 1 ? '' : 'S')}
          </div>
          <div style="font-size:7.5px;color:${ready ? '#166534' : '#7f1d1d'};margin-top:1px;line-height:1.25;">
            EVERY active release blocker on the validated design snapshot. A blocker listed here is unresolved in the current package
            regardless of any sheet that renders a passing value. Derived issue state: <strong>${escapeH(issueStatus)}</strong>.
          </div>
        </div>
        <div style="flex:1 1 auto;display:flex;flex-direction:column;gap:4px;justify-content:center;">
          <div style="border:var(--border);padding:3px 8px;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:7px;font-weight:700;letter-spacing:0.4px;">BLOCKING</span>
            <span style="font-size:14px;font-weight:900;color:#b91c1c;">${blockingCount}</span>
          </div>
          <div style="border:var(--border);padding:3px 8px;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:7px;font-weight:700;letter-spacing:0.4px;">ADVISORY</span>
            <span style="font-size:14px;font-weight:900;color:#b45309;">${advisoryCount}</span>
          </div>
        </div>
      </div>

      ${registry.length ? bodyDomains : emptyState}

      <div style="margin-top:3px;padding:2px 6px;font-size:6.3px;color:#555;line-height:1.25;border:var(--border);">
        Source: <span class="mono">permitReadiness.registry</span> on snapshot <span class="mono">${escapeH(snap?.meta.snapshotId ?? '—')}</span>.
        BLOCKING = prevents permit-ready / issue; ADVISORY = surfaced, not gating (each advisory carries a written justification).
        Equipment-identity conflicts require OPERATOR reconciliation (never auto-resolved). Full machine-readable per-attachment /
        per-segment data is retained in the canonical object model referenced on PV-4B / PV-4C / E-1 / SCHED.
      </div>

    </div>
  </div>`;
}
