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

function sevBadge(sev: string): string {
  const blocking = sev === 'blocking';
  const bg = blocking ? '#b91c1c' : '#b45309';
  const label = blocking ? 'BLOCKING' : 'ADVISORY';
  return `<span style="display:inline-block;background:${bg};color:#fff;font-weight:900;font-size:6px;letter-spacing:0.5px;padding:1px 4px;border-radius:2px;white-space:nowrap;">${label}</span>`;
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

  const rowFor = (r: PermitReadinessBlocker): string => {
    // §17 — an ADVISORY blocker MUST render its written justification (why the
    // missing fact cannot affect safety, code compliance, procurement, engineering
    // approval, or permit acceptance). Single-sourced from the snapshot registry.
    const justification = (r.severity === 'warning' && r.justification)
      ? `<div style="margin-top:2px;font-size:5.8px;line-height:1.3;color:#7c5b12;"><span style="font-weight:900;">ADVISORY JUSTIFICATION:</span> ${escapeH(r.justification)}</div>`
      : '';
    return `
    <tr>
      <td style="text-align:center;">${sevBadge(r.severity)}</td>
      <td class="mono" style="font-weight:900;font-size:6.5px;white-space:nowrap;">${escapeH(r.code)}</td>
      <td style="font-size:6.5px;line-height:1.3;">${escapeH(r.explanation)}${justification}</td>
      <td style="font-size:6.3px;line-height:1.3;color:#1e3a5f;">${escapeH(r.resolutionAction)}</td>
      <td style="font-size:6px;line-height:1.25;color:#555;">${escapeH(r.affectedSheets.join(', ') || '—')}</td>
    </tr>`;
  };

  const sectionFor = (domain: string): string => {
    const rows = (byDomain.get(domain) ?? []);
    if (!rows.length) return '';
    return `
      <div style="margin-top:5px;">
        <div style="background:#111;color:#fff;font-weight:900;font-size:7px;letter-spacing:0.7px;padding:2px 6px;">
          ${DOMAIN_LABEL[domain] ?? domain.toUpperCase()} &mdash; ${rows.length} ${rows.length === 1 ? 'BLOCKER' : 'BLOCKERS'}
        </div>
        <table class="equip-table" style="width:100%;table-layout:fixed;">
          <thead><tr>
            <th style="width:52px;">STATUS</th>
            <th style="width:150px;text-align:left;">CODE</th>
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
      <div style="display:flex;gap:8px;align-items:stretch;margin-top:2px;">
        <div style="flex:2 1 auto;border:2px solid ${ready ? '#166534' : '#b91c1c'};background:${ready ? '#f0fdf4' : '#fef2f2'};padding:6px 12px;">
          <div style="font-weight:900;font-size:13px;letter-spacing:0.6px;color:${ready ? '#166534' : '#b91c1c'};">
            ${ready ? 'CLEARED FOR ISSUE &mdash; NO OPEN BLOCKERS' : 'NOT FOR PERMIT SUBMISSION &mdash; ' + blockingCount + ' OPEN RELEASE BLOCKER' + (blockingCount === 1 ? '' : 'S')}
          </div>
          <div style="font-size:7.5px;color:${ready ? '#166534' : '#7f1d1d'};margin-top:2px;line-height:1.35;">
            This sheet enumerates EVERY active release blocker carried on the validated design snapshot. It is the authoritative
            reconciliation status: a blocker listed here is unresolved in the current package regardless of any sheet that renders a
            passing value. Derived issue state: <strong>${escapeH(issueStatus)}</strong>.
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

      <div style="margin-top:6px;padding:3px 6px;font-size:6.3px;color:#555;line-height:1.35;border:var(--border);">
        Source: <span class="mono">permitReadiness.registry</span> on snapshot <span class="mono">${escapeH(snap?.meta.snapshotId ?? '—')}</span>.
        BLOCKING = prevents permit-ready / issue; ADVISORY = surfaced, not gating (each advisory carries a written justification).
        Equipment-identity conflicts require OPERATOR reconciliation (never auto-resolved). Full per-attachment / per-segment machine-readable
        data is retained in the canonical object model (structural + electrical authority) referenced on PV-4B / PV-4C / E-1 / SCHED.
      </div>

    </div>
  </div>`;
}
