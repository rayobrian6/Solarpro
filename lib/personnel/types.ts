// lib/personnel/types.ts
// AAC WS-6 — Personnel roles of record (pure contract, no DB).
//
// Five DISTINCT roles. The whole point of the separation is that a configured
// DESIGNER can never be presented as, or promoted into, an engineer of record.
// Authority comes from the ROLE, never from the presence of a licence string on
// a row (audit §2.18 hard boundary).

export const PERSONNEL_ROLES = [
  'designer',
  'preparer',
  'reviewer',
  'engineer_of_record',
  'approving_engineer',
] as const;
export type PersonnelRole = (typeof PERSONNEL_ROLES)[number];

export function isPersonnelRole(v: unknown): v is PersonnelRole {
  return typeof v === 'string' && (PERSONNEL_ROLES as readonly string[]).includes(v);
}

/** The roles that REQUIRE a licence to be meaningful. A configuration resolver
 *  may never populate these — they belong to the professional-release path
 *  (signature / seal / digest-bound approval). */
export const LICENSED_ROLES: readonly PersonnelRole[] = ['engineer_of_record', 'approving_engineer'];

/** The roles a CONFIGURATION record is allowed to auto-populate onto a project.
 *  This list is the enforcement point for the WS-6 hard boundary and is asserted
 *  by the designer tests. */
export const AUTO_POPULATABLE_ROLES: readonly PersonnelRole[] = ['designer', 'preparer', 'reviewer'];

export function isLicensedRole(role: PersonnelRole): boolean {
  return LICENSED_ROLES.includes(role);
}

export function isAutoPopulatable(role: PersonnelRole): boolean {
  return AUTO_POPULATABLE_ROLES.includes(role);
}

export const PERSONNEL_ROLE_LABEL: Record<PersonnelRole, string> = {
  designer: 'Designer',
  preparer: 'Preparer',
  reviewer: 'Reviewer',
  engineer_of_record: 'Engineer of Record',
  approving_engineer: 'Approving Engineer',
};

/** One configured roster row (personnel_roles). */
export interface PersonnelRecord {
  id: string;
  orgId: string | null;
  userId: string | null;
  role: PersonnelRole;
  personName: string;
  personTitle: string | null;
  email: string | null;
  phone: string | null;
  licenseNumber: string | null;
  licenseState: string | null;
  licenseExpiresOn: string | null;
  isDefault: boolean;
  active: boolean;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One per-project assignment (project_personnel_assignments). */
export interface ProjectPersonnelAssignment {
  id: string;
  projectId: string;
  role: PersonnelRole;
  personnelId: string | null;
  personName: string;
  personTitle: string | null;
  licenseNumber: string | null;
  licenseState: string | null;
  assignedBy: string;
  reason: string | null;
  assignedAt: string;
  supersededAt: string | null;
  supersededBy: string | null;
}

/** Where a resolved role came from — never "somewhere". */
export type PersonnelResolutionSource =
  | 'project-assignment'      // an authorized per-project override
  | 'org-default'             // the organisation's configured default
  | 'user-default'            // the owning user's configured default
  | 'project-record';         // already present on the posted project record

export interface ResolvedPersonnelRole {
  role: PersonnelRole;
  personName: string;
  personTitle: string | null;
  licenseNumber: string | null;
  licenseState: string | null;
  source: PersonnelResolutionSource;
  /** the roster / assignment row id this came from (null for 'project-record'). */
  recordId: string | null;
  /** the exact record path, for the audit reference. */
  path: string;
  /** ISO timestamp of the record that supplied it. */
  atIso: string | null;
  /** true when a project override REPLACED a configured default. */
  overridesDefault: boolean;
  /** the default it superseded, when it did. */
  supersededDefault: { recordId: string; personName: string } | null;
}

/** The WS-6 authority record threaded into the snapshot as evidence. */
export interface ProjectPersonnelAuthority {
  projectId: string | null;
  scope: { orgId: string | null; userId: string | null };
  /** per-role resolution; a role with no configured record is simply absent. */
  roles: Partial<Record<PersonnelRole, ResolvedPersonnelRole>>;
  /** roles the platform has NO configured record for. */
  unconfiguredRoles: PersonnelRole[];
  /** true ⇔ the personnel store itself could not be read (migration not run). */
  storeUnavailable: boolean;
  /** the exact store failure, when unavailable. */
  storeError: string | null;
  /** HARD BOUNDARY, asserted: the roles this resolution WROTE onto the project.
   *  Never contains a licensed role. */
  populatedRoles: PersonnelRole[];
  basis: string;
}

/** Validation of a roster row before it is written (pure). */
export interface PersonnelValidation { ok: boolean; error?: string }

export function validatePersonnelInput(input: {
  role?: string; personName?: string; orgId?: string | null; userId?: string | null;
  licenseNumber?: string | null;
}): PersonnelValidation {
  if (!isPersonnelRole(input.role)) {
    return { ok: false, error: `role must be one of ${PERSONNEL_ROLES.join(' | ')}; got '${String(input.role)}'` };
  }
  if (!input.personName || !input.personName.trim()) return { ok: false, error: 'personName is required' };
  if (!input.orgId && !input.userId) return { ok: false, error: 'either orgId or userId scope is required' };
  // A licensed role without a licence number is not an authority — refuse to
  // store a half-record that a downstream reader could mistake for one.
  if (isLicensedRole(input.role) && !(input.licenseNumber && input.licenseNumber.trim())) {
    return { ok: false, error: `${input.role} requires a licenseNumber — a licensed role without a licence is not an authority` };
  }
  return { ok: true };
}
