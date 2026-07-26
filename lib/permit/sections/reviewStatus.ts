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

// ═══════════════════════════════════════════════════════════════════════════
// PPC §2 — BLOCKER-DETAIL COMPONENT SELECTION BY CANONICAL PAYLOAD SCHEMA
//
// THE defect this replaces: there was no selection at all. `payloadBlock(r)` was
// invoked unconditionally for every registry row and its only predicate was
// "payload is a non-null object" — so the ONE hardcoded template in the codebase,
// the Q-Cable PROCUREMENT-DEFICIT template, was bolted onto every blocker that
// carried any structured payload. The grounding blocker (which has a rich, fully
// correct payload of its own) shared exactly ONE field name with that template, so
// RS-1 rendered a "DEFICIT PAYLOAD" box of em-dashes — SKU —, drop spacing —,
// deficit — ft — on a blocker that has no deficit, plus a hardcoded literal string
// "mfr-doc authority null" that read no field at all.
//
// THE RULE: the detail component is chosen by the blocker's canonical PAYLOAD
// SCHEMA, keyed on its code. A schema-less code renders the GENERIC component
// (honest key/value pairs of what the payload actually carries) — never a foreign
// template's empty fields. Fail-safe: an unmapped code ⇒ 'generic'.
// ═══════════════════════════════════════════════════════════════════════════

/** The canonical payload schemas RS-1 can render. */
export type BlockerPayloadSchema =
  /** electrical.procurementSufficiency → procurementInsufficiencyPayload() */
  | 'qcable-procurement-deficit'
  /** electrical.openAirGroundingAuthority → the grounding-authority payload */
  | 'qcable-grounding-authority'
  /** no dedicated schema — render only the fields the payload actually has. */
  | 'generic';

/**
 * Code → payload schema. EVERY code the snapshot build can push is listed
 * explicitly (documentary + testable), so adding a payload-carrying blocker
 * without giving it a component is a visible omission rather than a silent
 * mis-render. Codes with no structured payload map to 'generic'.
 */
export const BLOCKER_PAYLOAD_SCHEMA: Record<string, BlockerPayloadSchema> = {
  // ── the TWO schema-typed payloads ─────────────────────────────────────────
  'QCABLE-PROCUREMENT-INSUFFICIENT': 'qcable-procurement-deficit',
  'QCABLE-GROUNDING-AUTHORITY-UNVERIFIED': 'qcable-grounding-authority',
  // ── electrical ────────────────────────────────────────────────────────────
  'ROUTE-LENGTH-ESTIMATE': 'generic',
  'FEEDER-RACEWAY-AUTHORITY': 'generic',
  'BRANCH-RACEWAY-AUTHORITY': 'generic',
  'RACEWAY-SEGMENT-CONFLICT': 'generic',
  'CONDUIT-FILL-PENDING': 'generic',
  'TAP-CONDUCTOR-LENGTH-PENDING': 'generic',
  // ── structural (structuralAuthority.blockers) ─────────────────────────────
  'FRAMING-AUTHORITY-UNVERIFIED': 'generic',
  'PENDING-RACKING-ASSEMBLY-SELECTION': 'generic',
  'FASTENER-ASSEMBLY-UNVERIFIED': 'generic',
  'FASTENER-CONFIG-MISSING': 'generic',
  'ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED': 'generic',
  'ATTACHMENT-CAPACITY-SOURCE-MISSING': 'generic',
  'MIXED-MANUFACTURER-ASSEMBLY-UNSUPPORTED': 'generic',
  'MOUNT-TOPOLOGY-UNKNOWN': 'generic',
  'DIRECT-MOUNT-GEOMETRY-MISSING': 'generic',
  'REACTIONS-UNTRACEABLE': 'generic',
  'RAIL-QUANTITY-UNTRACEABLE': 'generic',
  'STRUCTURAL-UTILIZATION-EXCEEDED': 'generic',
  'STRUCTURAL-BOM-RECONCILIATION-FAILED': 'generic',
  'STRUCTURAL-REACTION-RECONCILIATION-FAILED': 'generic',
  'SITE-GEOMETRY-MISSING': 'generic',
  'MODULE-DIMENSIONS-UNVERIFIED': 'generic',
  // ── racking capacity provenance (rackingAssembly.structuralAuthorityGaps) ──
  'RACKING-CAPACITY-SOURCE-NOT-ARCHIVED': 'generic',
  'RACKING-CAPACITY-APPLICABILITY-GAP': 'generic',
  'RACKING-CAPACITY-ULTIMATE-BASIS-REFUSED': 'generic',
  // ── equipment / document ──────────────────────────────────────────────────
  'EQUIPMENT-IDENTITY-CONFLICT': 'generic',
  'EQUIPMENT-DOCUMENT-APPLICABILITY': 'generic',
  'EQUIPMENT-DOCUMENT-UNVERIFIED': 'generic',
  'MODULE-EXACT-DATASHEET-PENDING': 'generic',
  // ── code / project / review ───────────────────────────────────────────────
  'CODE-AUTHORITY-INCOMPLETE': 'generic',
  'PROJECT-AUTHORITY-UNVERIFIED': 'generic',
  'PROJECT-NAME-NONPRODUCTION': 'generic',
  'DESIGNER-OF-RECORD-MISSING': 'generic',
  'ENGINEERING-REVIEW-PENDING': 'generic',
};

/** Fail-safe accessor: an unmapped code can only ever reach the GENERIC
 *  component — it can never inherit another blocker's template. */
export function blockerPayloadSchema(code: string): BlockerPayloadSchema {
  return BLOCKER_PAYLOAD_SCHEMA[code] ?? 'generic';
}

const _pBox = (accent: string, title: string, body: string, schema: BlockerPayloadSchema): string =>
  // PPC §2 / gate 3 — the box carries the SCHEMA it was selected by, so a rendered-
  // truth harness can assert "this blocker's payload component is the one its
  // canonical schema mandates" per row, rather than inferring it from a heading.
  `<div data-blocker-payload-schema="${schema}" style="margin-top:1px;font-size:${RS_FONT.justification};line-height:1.25;color:#334155;border-left:2px solid ${accent};padding-left:4px;">`
  + `<span style="font-weight:900;color:${accent};">${title}</span> ${body}</div>`;

const _s = (v: unknown): string => escapeH(v == null || v === '' ? '—' : String(v));

/** COMPONENT — Q-Cable procurement deficit (electrical.procurementSufficiency). */
function payloadProcurementDeficit(p: Record<string, unknown>): string {
  const perBranch = Array.isArray(p.perBranchPaths)
    ? (p.perBranchPaths as Array<Record<string, unknown>>)
      .map(b => `${escapeH(String(b.branchLabel))} ${b.dropCount}d ${b.designedInstalledLengthFt ?? '—'}/${b.procurementLengthFt ?? '—'}ft`)
      .join(' · ')
    : '';
  const opts = Array.isArray(p.resolutionOptions)
    ? (p.resolutionOptions as Array<Record<string, unknown>>)
      .map(o => `${escapeH(String(o.kind))}=${o.selected ? 'SEL' : 'NOT SEL'}`).join(' · ')
    : '';
  return _pBox('#b91c1c', 'DEFICIT PAYLOAD:',
    `SKU ${_s(p.selectedQCableSku)} @ ${_s(p.connectorDropSpacingFt)}ft drop · `
    + `designed ${_s(p.totalDesignedInstalledFt)}ft + allowance ${_s(p.requiredServiceLoopAllowanceFt)}ft (${_s(p.allowanceProvenance)}) `
    + `vs procurement ${_s(p.procurementLengthFt)}ft ⇒ <span style="color:#b91c1c;font-weight:900;">deficit ${_s(p.deficitFt)} ft</span> · `
    + `branches ${escapeH(perBranch)} · affected ${escapeH((p.affectedBranchIds as unknown[] ?? []).join(', ') || '—')} · `
    // reads the FIELD (the retired template hardcoded the literal string "null")
    + `mfr-doc authority ${_s(p.manufacturerDocumentAuthority)} · status ${_s(p.verificationStatus)} · resolution: ${escapeH(opts)}`,
    'qcable-procurement-deficit');
}

/** COMPONENT — open-air grounding authority (electrical.openAirGroundingAuthority).
 *  Ray's field list: selected micro SKU, Q-Cable SKU, authority result, verification
 *  state, applicable manufacturer document, document hash, applicability, equipment
 *  classification, candidate EGC quantity + orderability, resolution action,
 *  affected segment ids. NO procurement-deficit fields. */
function payloadGroundingAuthority(p: Record<string, unknown>): string {
  const av = (p.applicabilityVerification ?? null) as {
    verdict?: string; failures?: string[];
  } | null;
  const bond = (p.rackingModuleBondingRequirement ?? null) as
    { required?: boolean; codeBasis?: string } | null;
  const hash = p.documentHash ? String(p.documentHash).slice(0, 12) : null;
  const nonOrderable = p.bomRowState === 'design-quantity-non-orderable';
  const segIds = Array.isArray(p.affectedSegmentIds)
    ? (p.affectedSegmentIds as unknown[]).join(', ')
    : Array.isArray(p.segmentIds) ? (p.segmentIds as unknown[]).join(', ')
      : Array.isArray(p.branchIds) ? (p.branchIds as unknown[]).join(', ') : '';
  return _pBox('#b45309', 'GROUNDING AUTHORITY PAYLOAD:',
    `selected micro <span class="mono">${_s(p.selectedMicroinverterSku)}</span> + cable assembly <span class="mono">${_s(p.selectedCableAssemblySku)}</span>`
    + ` (module ${_s(p.selectedModuleSku)}, mount/bonding ${_s(p.selectedMountingBondingSystem)}, jurisdiction ${_s(p.projectJurisdiction)}) · `
    + `<span style="font-weight:900;color:#b45309;">authority result ${_s(p.outcome)}</span> · verification ${_s(p.verificationStatus)} · `
    + `manufacturer document ${_s(p.documentId)}${p.documentSectionOrPage ? ` (${_s(p.documentSectionOrPage)})` : ''} · SHA-256 ${hash ? escapeH(hash) : 'NONE'} · `
    + `applicability ${_s(av?.verdict)}${av?.failures?.length ? ` — ${escapeH(String(av.failures[0]))}` : ''} · `
    + `equipment classification ${_s(p.equipmentInsulationClassification)} · `
    + `conductor construction ${_s(p.cableConductorCount)}-conductor${p.cableConductorConstruction ? ` (${_s(p.cableConductorConstruction)})` : ''} `
    + `— <strong>NON-DETERMINATIVE</strong> · `
    + `candidate EGC ${_s(p.candidateQuantityFt)} ft — <span style="font-weight:900;color:#b45309;">${nonOrderable ? 'NON-ORDERABLE (candidate design quantity, not part of the approved installation)' : escapeH(String(p.bomRowState ?? '—'))}</span> · `
    + `affected segments ${escapeH(segIds || '—')} · `
    + `module/racking bonding ${bond?.required ? 'REQUIRED — independent' : _s(bond?.required)} (${_s(bond?.codeBasis)}) · `
    + `resolution: archive + verify the exact-SKU manufacturer grounding document (see RESOLUTION ACTION)`,
    'qcable-grounding-authority');
}

/** COMPONENT — GENERIC. Renders ONLY the primitive fields the payload actually
 *  carries, so an unknown schema can never print another template's empty fields. */
function payloadGeneric(p: Record<string, unknown>): string {
  const pairs = Object.entries(p)
    .filter(([, v]) => v != null && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))
    .map(([k, v]) => `${escapeH(k)} ${escapeH(String(v))}`);
  const nested = Object.entries(p)
    .filter(([, v]) => v != null && typeof v === 'object')
    .map(([k]) => escapeH(k));
  if (!pairs.length && !nested.length) return '';
  return _pBox('#475569', 'BLOCKER PAYLOAD:',
    `${pairs.join(' · ')}${nested.length ? `${pairs.length ? ' · ' : ''}structured: ${nested.join(', ')} (see the canonical object model)` : ''}`,
    'generic');
}

/** THE dispatcher — component selected by canonical payload schema, never by
 *  "payload is an object". */
export function renderBlockerPayload(r: PermitReadinessBlocker): string {
  const p = r.payload;
  if (!p || typeof p !== 'object') return '';
  const schema = blockerPayloadSchema(r.code);
  switch (schema) {
    case 'qcable-procurement-deficit': return payloadProcurementDeficit(p);
    case 'qcable-grounding-authority': return payloadGroundingAuthority(p);
    default: return payloadGeneric(p);
  }
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

  const payloadBlock = (r: PermitReadinessBlocker): string => renderBlockerPayload(r);

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
