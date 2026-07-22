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
  | 'snapshot-id' | 'digest';

export interface ProjectAuthorityProjection {
  present: boolean;
  record: ProjectAuthorityRecord | null;
  // raw values (null ⇒ unknown)
  projectName: string | null;
  customer: string | null;
  address: string | null;
  cityStateZip: string | null;
  apn: string | null;
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
  sheetIndex: { id: string; title: string }[];
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
