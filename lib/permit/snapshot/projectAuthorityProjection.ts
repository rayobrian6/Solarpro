// ═══════════════════════════════════════════════════════════════════════════
// W4 §3 — PROJECT / COVER AUTHORITY PROJECTION.
// THE read/format seam every project-facing renderer consumes. Mirrors
// codeAuthorityProjection / structuralProjection: the cover, title block and
// certification sheets read project identity, equipment summary, issue status
// and the sheet index THROUGH here and hold no vendor default, no stale
// equipment, no default engineer name and no independent sheet index of their
// own.
//
// Rules (Ray, W4 §3/§12):
//   • Every value comes from snapshot.projectAuthority (one record). A missing
//     value renders PENDING / '—' — never a fabricated default.
//   • The values the truth matrix compares cross-sheet are TAGGED with a
//     data-project-field="<field>" attribute so the evidence harness can extract
//     the printed value per sheet and prove single-sourcing. At minimum: ahj,
//     utility, system-type, module-model, inverter-model, issue-status,
//     snapshot-id, digest.
// ═══════════════════════════════════════════════════════════════════════════
import type { PermitInput } from '../types';
import type { PermitDesignSnapshot } from './types';
import type { ProjectAuthorityRecord, ProjectIssueState } from './projectAuthority';
import { peekSnapshot } from './read';
import {
  resolveProjectStateAuthority, stateNameForCode, type ProjectStateAuthority,
} from './locationAuthority';

/** Printed when a project value is unknown (null). Explicit, never blank. */
export const PENDING_PROJECT_VALUE = 'PENDING';

/** Minimal HTML escape for user-controlled project values injected into tags. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The tagged fields the truth matrix extracts. */
export type ProjectField =
  | 'project-name' | 'customer' | 'address' | 'apn' | 'ahj' | 'utility'
  | 'system-type' | 'dc-kw' | 'ac-kw' | 'module-count'
  | 'module-model' | 'inverter-model' | 'mount-model' | 'battery-model'
  | 'designer' | 'contractor' | 'issue-status' | 'engineer-review-status'
  | 'snapshot-id' | 'digest'
  // THE canonical location projection. Tagged so the truth matrix can prove one
  // state across every sheet, and so the render-level V47 invariant can find any
  // sheet that printed an 'Unknown'-class sentinel for a known state.
  | 'state-code' | 'state-name';

export interface ProjectAuthorityProjection {
  present: boolean;
  record: ProjectAuthorityRecord | null;
  // raw values (null ⇒ unknown)
  projectName: string | null;
  customer: string | null;
  address: string | null;
  cityStateZip: string | null;
  apn: string | null;
  /** canonical 2-letter state code ('IL'). null ⇒ genuinely unknown. */
  stateCode: string | null;
  /** canonical full state name ('Illinois'). null ⇒ genuinely unknown. */
  stateName: string | null;
  ahj: string | null;
  utility: string | null;
  systemType: string | null;
  dcKw: number | null; acKw: number | null; moduleCount: number | null;
  moduleDisplay: string | null;
  inverterDisplay: string | null;
  mountDisplay: string | null;
  batteryDisplay: string | null;
  designer: string | null;
  contractor: string | null;
  issueStatus: ProjectIssueState | null;
  engineerReviewStatus: string | null;
  issuedForPermitGatePasses: boolean;
  issueDate: string | null;
  revisionHistory: ProjectAuthorityRecord['revisionHistory'];
  sheetIndex: { id: string; title: string; section?: 'drawing' | 'appendix' }[];
  governingCodesRef: ProjectAuthorityRecord['governingCodesRef'] | null;
  generalNotes: string[];
  snapshotId: string | null;
  digest: string | null;
  /** raw value for a tagged field (null ⇒ unknown). */
  value(field: ProjectField): string | null;
  /** display value for a tagged field (PENDING when unknown). */
  display(field: ProjectField): string;
  /** HTML span carrying data-project-field="<field>" for harness extraction. */
  tag(field: ProjectField): string;
}

function joinNonEmpty(parts: (string | null | undefined)[], sep = ' '): string | null {
  const v = parts.filter(s => s && String(s).trim() && s !== '—').join(sep).trim();
  return v || null;
}

/** Build the project-authority projection from a snapshot (null-safe). */
export function projectProjectAuthority(
  snap: PermitDesignSnapshot | null | undefined,
): ProjectAuthorityProjection {
  const record = (snap as unknown as { projectAuthority?: ProjectAuthorityRecord } | null)?.projectAuthority ?? null;
  const meta = (snap as unknown as { meta?: { snapshotId?: string; digest?: string } } | null)?.meta ?? null;
  const eqs = record?.equipmentSummary;

  const cityStateZip = joinNonEmpty([
    record?.city,
    record?.stateCode,
    record?.zip,
  ], ', ');
  const moduleDisplay = joinNonEmpty([eqs?.moduleManufacturer, eqs?.moduleModel]);
  const inverterDisplay = joinNonEmpty([eqs?.inverterManufacturer, eqs?.inverterModel]);
  const mountDisplay = joinNonEmpty([eqs?.mountManufacturer, eqs?.mountModel]);
  const batteryDisplay = eqs?.batteryModel ? joinNonEmpty([eqs.batteryBrand, eqs.batteryModel]) : null;

  const snapshotId = meta?.snapshotId || null;
  const digest = meta?.digest || null;

  const rawValue = (field: ProjectField): string | null => {
    switch (field) {
      case 'project-name': return record?.projectName ?? null;
      case 'customer': return record?.customer ?? null;
      case 'address': return record?.installationAddress ?? null;
      case 'apn': return record?.parcelApn ?? null;
      case 'ahj': return record?.ahjName ?? null;
      case 'utility': return record?.utilityName ?? null;
      case 'system-type': return record?.systemType ?? null;
      case 'dc-kw': return record?.capacities.dcKw != null ? record.capacities.dcKw.toFixed(2) : null;
      case 'ac-kw': return record?.capacities.acKw != null ? record.capacities.acKw.toFixed(2) : null;
      case 'module-count': return record?.capacities.moduleCount != null ? String(record.capacities.moduleCount) : null;
      case 'module-model': return moduleDisplay;
      case 'inverter-model': return inverterDisplay;
      case 'mount-model': return mountDisplay;
      case 'battery-model': return batteryDisplay;
      case 'designer': return record?.designer ?? null;
      case 'contractor': return record?.contractor ?? null;
      case 'issue-status': return record?.issueState ?? null;
      case 'engineer-review-status': return record?.engineerReviewStatus ?? null;
      case 'state-code': return record?.stateCode ?? null;
      case 'state-name': return record?.stateName ?? null;
      case 'snapshot-id': return snapshotId;
      case 'digest': return digest;
      default: return null;
    }
  };

  return {
    present: !!record,
    record,
    projectName: record?.projectName ?? null,
    customer: record?.customer ?? null,
    address: record?.installationAddress ?? null,
    cityStateZip,
    apn: record?.parcelApn ?? null,
    stateCode: record?.stateCode ?? null,
    stateName: record?.stateName ?? null,
    ahj: record?.ahjName ?? null,
    utility: record?.utilityName ?? null,
    systemType: record?.systemType ?? null,
    dcKw: record?.capacities.dcKw ?? null,
    acKw: record?.capacities.acKw ?? null,
    moduleCount: record?.capacities.moduleCount ?? null,
    moduleDisplay, inverterDisplay, mountDisplay, batteryDisplay,
    designer: record?.designer ?? null,
    contractor: record?.contractor ?? null,
    issueStatus: record?.issueState ?? null,
    engineerReviewStatus: record?.engineerReviewStatus ?? null,
    issuedForPermitGatePasses: !!record?.issuedForPermitGate?.pass,
    issueDate: record?.issueDate ?? null,
    revisionHistory: record?.revisionHistory ?? [],
    sheetIndex: record?.sheetIndex ?? [],
    governingCodesRef: record?.governingCodesRef ?? null,
    generalNotes: record?.generalNotes ?? [],
    snapshotId, digest,
    value(field) { return rawValue(field); },
    display(field) { return rawValue(field) ?? PENDING_PROJECT_VALUE; },
    tag(field) {
      return `<span data-project-field="${field}">${esc(rawValue(field) ?? PENDING_PROJECT_VALUE)}</span>`;
    },
  };
}

/** Convenience: project straight from a PermitInput (renderers hold `input`).
 *  Non-throwing — an absent snapshot yields an empty projection whose values are
 *  all PENDING, so a standalone path degrades honestly instead of fabricating. */
export function projectProjectAuthorityFromInput(input: PermitInput): ProjectAuthorityProjection {
  return projectProjectAuthority(peekSnapshot(input));
}

// ═══════════════════════════════════════════════════════════════════════════
// THE ONE STATE ACCESSOR every sheet consumes.
//
// Before this, thirteen renderers each read `compliance.jurisdiction?.state`
// — a CLIENT-COMPUTED value frozen into the posted permit_input. When the
// client computed it without an address it produced the literal 'Unknown', and
// because that sentinel is truthy every `|| '—'` fallback printed it: 16 title
// blocks, the cover CITY/STATE cell, the cover address chip, the governing-code
// amendments row and the PE-1 project table, on a project whose address is
// "…, GRANITE CITY, IL 62040" and whose record says IL.
//
// Now: the frozen snapshot's canonical record leads; a package built without a
// snapshot re-derives from THE SAME pure resolver over the project's own
// identity. `compliance.jurisdiction.state` is accepted only as the LAST
// candidate and only after normalization, so the sentinel can never print again.
// A genuinely unknown state stays null and every consumer prints '—'.
// ═══════════════════════════════════════════════════════════════════════════

export interface ProjectStateProjection {
  /** canonical 2-letter code ('IL'), or null. Use for CODE lookups. */
  code: string | null;
  /** canonical full name ('Illinois'), or null. Use for DISPLAY. */
  name: string | null;
  /** display name, '—' when unknown. NEVER 'Unknown'. */
  display: string;
  /** display code, '—' when unknown. */
  displayCode: string;
  /** the derivation trace (which input won, what disagreed). */
  authority: ProjectStateAuthority;
  /** true ⇒ the value came from the frozen snapshot record. */
  fromSnapshot: boolean;
  /** HTML span carrying data-project-field="state-name"|"state-code" so the
   *  truth matrix can prove ONE state across every sheet and V47 can catch any
   *  sheet that printed a sentinel. Always emitted, snapshot or not. */
  tag(field: 'state-name' | 'state-code'): string;
}

/** Printed for an unknown state. Explicit em-dash, never a word. */
export const UNKNOWN_STATE_DISPLAY = '—';

export function projectProjectState(
  snap: PermitDesignSnapshot | null | undefined,
  input: PermitInput,
): ProjectStateProjection {
  const record = (snap as unknown as { projectAuthority?: ProjectAuthorityRecord } | null)?.projectAuthority ?? null;
  const fromSnapshot = !!record?.stateCode;
  const authority: ProjectStateAuthority = fromSnapshot
    ? (record!.stateAuthority ?? resolveProjectStateAuthority({ projectState: record!.stateCode }))
    : resolveProjectStateAuthority({
        projectState: (input?.project as { state?: string | null } | undefined)?.state ?? null,
        address: (input?.project as { address?: string | null } | undefined)?.address ?? null,
        complianceState: (input?.compliance?.jurisdiction as { state?: string } | undefined)?.state ?? null,
      });
  const code = fromSnapshot ? record!.stateCode : authority.stateCode;
  const name = fromSnapshot ? (record!.stateName ?? stateNameForCode(record!.stateCode)) : authority.stateName;
  const p: ProjectStateProjection = {
    code, name,
    display: name ?? UNKNOWN_STATE_DISPLAY,
    displayCode: code ?? UNKNOWN_STATE_DISPLAY,
    authority, fromSnapshot,
    tag(field) {
      const v = field === 'state-code' ? (code ?? UNKNOWN_STATE_DISPLAY) : (name ?? UNKNOWN_STATE_DISPLAY);
      return `<span data-project-field="${field}">${esc(v)}</span>`;
    },
  };
  return p;
}

/** Convenience for renderers holding only `input`. */
export function projectProjectStateFromInput(input: PermitInput): ProjectStateProjection {
  return projectProjectState(peekSnapshot(input), input);
}

// ═══════════════════════════════════════════════════════════════════════════
// PPC §10 — THE ONE ISSUE-STATE LANGUAGE ACCESSOR.
//
// Before this, every sheet hand-rolled its own phrase for the package's issue
// state (coverSheet's "DESIGN REVIEW PACKAGE", SCHED's re-derived blocker gate,
// PV-5's flatly false "SITE-COMPUTED FROM THE APPROVED DESIGN"). The authority
// already existed and was digest-bound (`deriveIssueState` → `issueStatus`,
// validated by V33/V34); only the LANGUAGE was missing, so the false phrase
// survived four campaigns.
//
// Rule: APPROVED-DESIGN language ('approved design', 'approved plans', 'engineer
// approved', 'permit approved', 'construction approved') may be produced ONLY by
// this accessor, and ONLY when a digest-bound engineering approval exists —
// i.e. issueStatus ∈ {REVIEWED, PERMIT-READY, ISSUED FOR PERMIT} (V34 already
// requires those to be bound to the CURRENT digest) AND no blocking release item
// is open. Everything else prints the design-review-snapshot wording.
// ═══════════════════════════════════════════════════════════════════════════

const APPROVED_ISSUE_STATES = new Set<ProjectIssueState>([
  'REVIEWED', 'PERMIT-READY', 'ISSUED FOR PERMIT',
]);

export interface IssueStateLanguage {
  /** the canonical issue state (null ⇒ no project-authority record). */
  issueStatus: ProjectIssueState | null;
  /** true ⇒ a digest-bound engineering approval exists AND nothing blocks release. */
  approved: boolean;
  /** count of open blocking release items (registry-derived). */
  openBlockers: number;
  /** the package noun: 'DESIGN REVIEW PACKAGE' | 'APPROVED DESIGN'. */
  packageLabel: string;
  /** basis clause for site-computed values ('…FROM THE CURRENT DESIGN-REVIEW
   *  SNAPSHOT — NOT YET APPROVED' while pending). */
  computedFromLabel: string;
  /** how a contractor-deviation note must refer to the design of record. */
  deviationReferenceLabel: string;
  /** short state tag for a badge ('DESIGN REVIEW — NOT VERIFIED'). */
  stateTag: string;
}

/** Project the ONE issue-state language set from a snapshot (null-safe). */
export function projectIssueStateLanguage(
  snap: PermitDesignSnapshot | null | undefined,
): IssueStateLanguage {
  const proj = projectProjectAuthority(snap);
  const openBlockers = (snap?.permitReadiness?.registry ?? [])
    .filter(r => r.severity === 'blocking' && !r.resolved).length;
  const _ready = snap?.permitReadiness?.ready !== false;
  const approved = !!proj.issueStatus
    && APPROVED_ISSUE_STATES.has(proj.issueStatus)
    && openBlockers === 0
    && _ready;
  return {
    issueStatus: proj.issueStatus,
    approved,
    openBlockers,
    packageLabel: approved ? 'APPROVED DESIGN' : 'DESIGN REVIEW PACKAGE',
    computedFromLabel: approved
      ? 'SITE-COMPUTED FROM THE APPROVED DESIGN'
      : 'SITE-COMPUTED FROM THE CURRENT DESIGN-REVIEW SNAPSHOT — NOT YET APPROVED',
    deviationReferenceLabel: approved
      ? 'the approved design'
      : 'the design of record as issued for review',
    stateTag: approved
      ? (proj.issueStatus ?? 'REVIEWED')
      : 'DESIGN REVIEW — NOT VERIFIED',
  };
}

/** Convenience: issue-state language straight from a PermitInput. */
export function projectIssueStateLanguageFromInput(input: PermitInput): IssueStateLanguage {
  return projectIssueStateLanguage(peekSnapshot(input));
}
