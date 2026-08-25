// lib/personnel/store.ts
// AAC WS-6 — the personnel-roles store (migration 115).
//
// Mirrors lib/documents/registry.ts exactly: raw async DB functions that THROW
// the Postgres error (so the admin API can be fail-loud via handleRouteDbError),
// with every permit-path read wrapped by the resolver's shared `safeDbRead`
// guard. Migration 115 is written but NOT RUN, so on production today every read
// here raises 42P01 and the resolver reports that precisely and retryably —
// nothing is swallowed, and nothing is defaulted.
//
// THE RESOLUTION ORDER (WS-6): an authorized per-project assignment SUPERSEDES
// the configured default; otherwise the org default, otherwise the owning user's
// default. A role with no configured record resolves to ABSENT — never to a
// vendor name, never to "SolarPro Engineering" (a default the W4 campaign
// deliberately removed, and route.ts:1181-1198 deliberately leaves blank).

import { getDbReady } from '@/lib/db/core';
import { randomUUID } from 'node:crypto';
import {
  PERSONNEL_ROLES, isPersonnelRole, isAutoPopulatable, validatePersonnelInput,
  type PersonnelRecord, type PersonnelRole, type ProjectPersonnelAssignment,
  type ProjectPersonnelAuthority, type ResolvedPersonnelRole,
} from './types';

// ── row ⇄ record ─────────────────────────────────────────────────────────────

function rowToPersonnel(r: any): PersonnelRecord {
  return {
    id: r.id,
    orgId: r.org_id ?? null,
    userId: r.user_id ?? null,
    role: r.role,
    personName: r.person_name,
    personTitle: r.person_title ?? null,
    email: r.email ?? null,
    phone: r.phone ?? null,
    licenseNumber: r.license_number ?? null,
    licenseState: r.license_state ?? null,
    licenseExpiresOn: r.license_expires_on ? String(r.license_expires_on) : null,
    isDefault: !!r.is_default,
    active: r.active !== false,
    notes: r.notes ?? null,
    createdBy: r.created_by ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function rowToAssignment(r: any): ProjectPersonnelAssignment {
  return {
    id: r.id,
    projectId: r.project_id,
    role: r.role,
    personnelId: r.personnel_id ?? null,
    personName: r.person_name,
    personTitle: r.person_title ?? null,
    licenseNumber: r.license_number ?? null,
    licenseState: r.license_state ?? null,
    assignedBy: r.assigned_by,
    reason: r.reason ?? null,
    assignedAt: String(r.assigned_at),
    supersededAt: r.superseded_at ? String(r.superseded_at) : null,
    supersededBy: r.superseded_by ?? null,
  };
}

// ── scope ────────────────────────────────────────────────────────────────────

export interface PersonnelScope { orgId: string | null; userId: string | null }

/** Resolve a project's personnel SCOPE (owning user + their organisation).
 *  Reads only existing columns (projects.user_id, users.org_id — migration 016). */
export async function resolveProjectScope(projectId: string): Promise<PersonnelScope | null> {
  const sql = await getDbReady();
  const rows = await sql`
    SELECT p.user_id AS user_id, u.org_id AS org_id
    FROM projects p LEFT JOIN users u ON u.id = p.user_id
    WHERE p.id = ${projectId} LIMIT 1
  `;
  const r = (rows as any[])[0];
  if (!r) return null;
  return { orgId: r.org_id ? String(r.org_id) : null, userId: r.user_id ? String(r.user_id) : null };
}

// ── reads ────────────────────────────────────────────────────────────────────

/** Resolve a USER's own personnel scope (their organisation, when they have one).
 *  Used by the System Config surface, where the caller is the authenticated admin
 *  rather than a project. */
export async function resolveUserScope(userId: string): Promise<PersonnelScope> {
  const sql = await getDbReady();
  const rows = await sql`SELECT org_id FROM users WHERE id = ${userId} LIMIT 1`;
  const r = (rows as any[])[0];
  const orgId = r?.org_id ? String(r.org_id) : null;
  return { orgId, userId };
}

/** The active roster for a scope (org rows first, then the user's own). */
export async function listPersonnel(scope: PersonnelScope): Promise<PersonnelRecord[]> {
  const sql = await getDbReady();
  const rows = await sql`
    SELECT * FROM personnel_roles
    WHERE active = true
      AND ((${scope.orgId}::text IS NOT NULL AND org_id = ${scope.orgId})
        OR (${scope.userId}::text IS NOT NULL AND user_id = ${scope.userId}))
    ORDER BY (org_id IS NOT NULL) DESC, is_default DESC, person_name ASC
  `;
  return (rows as any[]).map(rowToPersonnel);
}

/** The ACTIVE (not-superseded) per-project assignments, newest first. */
/**
 * A.1.1 §1 — THE GOVERNED LICENSED IDENTITY FOR AN AUTHENTICATED ACTOR.
 *
 * The engineering-review API used to server-stamp only `reviewerUserId` and take
 * `reviewerName`, `reviewerLicense` and `reviewerLicenseState` straight off the
 * request body — under a comment claiming the identity was server-stamped. Any
 * admin could therefore record an approval in another professional's name and
 * licence number, which defeats the attestation the record exists to carry.
 *
 * This is the only sanctioned source of a reviewer's professional identity: an
 * ACTIVE personnel row in a LICENSED role, tied to the authenticated user id.
 * Returns null when no such row exists — and null must be refused by the caller,
 * never back-filled from the request.
 */
export async function resolveLicensedProfessionalForUser(
  userId: string,
  role: PersonnelRole,
): Promise<PersonnelRecord | null> {
  if (!userId?.trim()) return null;
  const sql = await getDbReady();
  const rows = await sql`
    SELECT * FROM personnel_roles
    WHERE active = true
      AND user_id = ${userId}
      AND role = ${role}
      AND license_number IS NOT NULL
      AND btrim(license_number) <> ''
      AND license_state IS NOT NULL
      AND btrim(license_state) <> ''
    ORDER BY is_default DESC, updated_at DESC
    LIMIT 1
  `;
  const r = (rows as unknown[])[0];
  return r ? rowToPersonnel(r as Record<string, unknown>) : null;
}

export async function listProjectAssignments(projectId: string): Promise<ProjectPersonnelAssignment[]> {
  const sql = await getDbReady();
  const rows = await sql`
    SELECT * FROM project_personnel_assignments
    WHERE project_id = ${projectId} AND superseded_at IS NULL
    ORDER BY assigned_at DESC
  `;
  return (rows as any[]).map(rowToAssignment);
}

// ── the resolution (pure, given the two lists) ───────────────────────────────

/**
 * PURE resolution of the personnel authority from a roster + assignments. Split
 * out so tests can prove the precedence and the hard boundary with synthetic
 * stores and no database at all.
 */
export function resolvePersonnelAuthority(args: {
  projectId: string | null;
  scope: PersonnelScope;
  roster: readonly PersonnelRecord[];
  assignments: readonly ProjectPersonnelAssignment[];
  /** a designer already present on the posted project record (operator-typed). */
  projectRecordDesigner?: string | null;
}): ProjectPersonnelAuthority {
  const roles: Partial<Record<PersonnelRole, ResolvedPersonnelRole>> = {};
  const notes: string[] = [];

  for (const role of PERSONNEL_ROLES) {
    // 1. an authorized per-project override wins.
    const assignment = args.assignments.find(a => a.role === role && !a.supersededAt);
    // 2. otherwise the configured default: org scope first, then user scope.
    const orgDefault = args.roster.find(p => p.role === role && p.isDefault && p.active && p.orgId && p.orgId === args.scope.orgId);
    const userDefault = args.roster.find(p => p.role === role && p.isDefault && p.active && !p.orgId && p.userId && p.userId === args.scope.userId);
    const fallbackDefault = orgDefault ?? userDefault ?? null;

    if (assignment) {
      roles[role] = {
        role,
        personName: assignment.personName,
        personTitle: assignment.personTitle,
        licenseNumber: assignment.licenseNumber,
        licenseState: assignment.licenseState,
        source: 'project-assignment',
        recordId: assignment.id,
        path: `project_personnel_assignments(project_id=${assignment.projectId}, role=${role})`,
        atIso: assignment.assignedAt,
        overridesDefault: !!fallbackDefault,
        supersededDefault: fallbackDefault
          ? { recordId: fallbackDefault.id, personName: fallbackDefault.personName }
          : null,
      };
      if (fallbackDefault) {
        notes.push(`${role}: project override '${assignment.personName}' supersedes the configured default '${fallbackDefault.personName}' `
          + `(assigned by ${assignment.assignedBy}${assignment.reason ? `: ${assignment.reason}` : ''})`);
      }
      continue;
    }
    if (fallbackDefault) {
      roles[role] = {
        role,
        personName: fallbackDefault.personName,
        personTitle: fallbackDefault.personTitle,
        licenseNumber: fallbackDefault.licenseNumber,
        licenseState: fallbackDefault.licenseState,
        source: orgDefault ? 'org-default' : 'user-default',
        recordId: fallbackDefault.id,
        path: `personnel_roles(${orgDefault ? `org_id=${fallbackDefault.orgId}` : `user_id=${fallbackDefault.userId}`}, role=${role}, is_default)`,
        atIso: fallbackDefault.updatedAt,
        overridesDefault: false,
        supersededDefault: null,
      };
    }
  }

  // A designer ALREADY typed onto the project record is authority in its own
  // right (an operator-supplied value is never overwritten by configuration).
  const typed = (args.projectRecordDesigner ?? '').trim();
  if (typed && !roles.designer) {
    roles.designer = {
      role: 'designer', personName: typed, personTitle: null,
      licenseNumber: null, licenseState: null,
      source: 'project-record', recordId: null, path: 'permit-input#project.designer',
      atIso: null, overridesDefault: false, supersededDefault: null,
    };
  }

  const unconfigured = PERSONNEL_ROLES.filter(r => !roles[r]);
  // THE HARD BOUNDARY: only non-licensed roles may be auto-populated onto the
  // project record by configuration. A configured engineer_of_record row may be
  // DISPLAYED in system config, but this resolution never writes it onto a
  // project, never onto a title block, and never onto a certification record.
  const populated = PERSONNEL_ROLES.filter(r => !!roles[r] && isAutoPopulatable(r));

  return {
    projectId: args.projectId,
    scope: args.scope,
    roles, unconfiguredRoles: unconfigured,
    storeUnavailable: false, storeError: null,
    populatedRoles: populated,
    basis: [
      `roster ${args.roster.length} row(s), ${args.assignments.length} active project assignment(s)`,
      ...notes,
    ].join(' · '),
  };
}

/** The DB-backed resolution. THROWS when the store is unavailable — the caller
 *  (the resolver) wraps it in `safeDbRead` and reports the failure precisely. */
export async function resolveProjectPersonnel(
  projectId: string,
  projectRecordDesigner?: string | null,
): Promise<ProjectPersonnelAuthority> {
  const scope = (await resolveProjectScope(projectId)) ?? { orgId: null, userId: null };
  const [roster, assignments] = await Promise.all([
    listPersonnel(scope),
    listProjectAssignments(projectId),
  ]);
  return resolvePersonnelAuthority({ projectId, scope, roster, assignments, projectRecordDesigner });
}

/** The authority record for an UNAVAILABLE store — the honest fail-soft value.
 *  Every role is unconfigured, nothing is populated, and the exact error rides
 *  with it. Never a name, never a default. */
export function unavailablePersonnelAuthority(
  projectId: string | null,
  error: string,
): ProjectPersonnelAuthority {
  return {
    projectId, scope: { orgId: null, userId: null },
    roles: {}, unconfiguredRoles: [...PERSONNEL_ROLES],
    storeUnavailable: true, storeError: error,
    populatedRoles: [],
    basis: 'the personnel-roles store could not be read — no role is established',
  };
}

// ── writes (admin surface) ───────────────────────────────────────────────────

export interface UpsertPersonnelInput {
  id?: string;
  orgId?: string | null;
  userId?: string | null;
  role: string;
  personName: string;
  personTitle?: string | null;
  email?: string | null;
  phone?: string | null;
  licenseNumber?: string | null;
  licenseState?: string | null;
  licenseExpiresOn?: string | null;
  isDefault?: boolean;
  notes?: string | null;
  createdBy?: string | null;
}

/**
 * Insert a roster row. At most one default per (scope, role) is enforced by the
 * migration's partial unique indexes; when `isDefault` is requested the existing
 * default for that scope+role is DEACTIVATED first, in one transaction, so the
 * change is atomic and the prior row survives as history (active = false).
 */
export async function upsertPersonnel(input: UpsertPersonnelInput): Promise<PersonnelRecord> {
  const v = validatePersonnelInput(input);
  if (!v.ok) throw new Error(v.error);
  const sql = await getDbReady();
  const id = input.id ?? randomUUID();
  const role = input.role as PersonnelRole;
  const orgId = input.orgId ?? null;
  const userId = input.userId ?? null;
  const wantsDefault = input.isDefault !== false;   // a first row for a role is the default

  await sql.transaction((txn) => {
    // Retire the current default for this exact scope+role (history preserved:
    // the prior row stays, deactivated — it is never deleted).
    const retire = txn`
      UPDATE personnel_roles SET active = false, updated_at = now()
      WHERE role = ${role} AND is_default = true AND active = true
        AND ((${orgId}::text IS NOT NULL AND org_id = ${orgId})
          OR (${orgId}::text IS NULL AND ${userId}::text IS NOT NULL AND org_id IS NULL AND user_id = ${userId}))
    `;
    const insert = txn`
      INSERT INTO personnel_roles (
        id, org_id, user_id, role, person_name, person_title, email, phone,
        license_number, license_state, license_expires_on, is_default, active, notes, created_by
      ) VALUES (
        ${id}, ${orgId}, ${userId}, ${role}, ${input.personName.trim()}, ${input.personTitle ?? null},
        ${input.email ?? null}, ${input.phone ?? null}, ${input.licenseNumber ?? null},
        ${input.licenseState ?? null}, ${input.licenseExpiresOn ?? null}, ${wantsDefault}, true,
        ${input.notes ?? null}, ${input.createdBy ?? null}
      )
    `;
    return wantsDefault ? [retire, insert] : [insert];
  });

  const rows = await sql`SELECT * FROM personnel_roles WHERE id = ${id} LIMIT 1`;
  const r = (rows as any[])[0];
  if (!r) throw new Error(`personnel row '${id}' was not written`);
  return rowToPersonnel(r);
}

export interface AssignProjectPersonnelInput {
  projectId: string;
  role: string;
  personnelId?: string | null;
  personName: string;
  personTitle?: string | null;
  licenseNumber?: string | null;
  licenseState?: string | null;
  assignedBy: string;
  reason?: string | null;
}

/**
 * Assign (or re-assign) a role on ONE project. Append-only: the prior active
 * assignment for that role is marked superseded by the new row's id — the same
 * supersession shape the invalidation ledger uses. Nothing is deleted.
 */
export async function assignProjectPersonnel(
  input: AssignProjectPersonnelInput,
): Promise<ProjectPersonnelAssignment> {
  if (!input.projectId?.trim()) throw new Error('projectId is required');
  if (!isPersonnelRole(input.role)) {
    throw new Error(`role must be one of ${PERSONNEL_ROLES.join(' | ')}; got '${String(input.role)}'`);
  }
  if (!input.personName?.trim()) throw new Error('personName is required');
  if (!input.assignedBy?.trim()) throw new Error('assignedBy is required — no anonymous assignment');
  const sql = await getDbReady();
  const id = randomUUID();
  const role = input.role as PersonnelRole;

  await sql.transaction((txn) => [
    txn`
      UPDATE project_personnel_assignments
      SET superseded_at = now(), superseded_by = ${id}
      WHERE project_id = ${input.projectId} AND role = ${role} AND superseded_at IS NULL
    `,
    txn`
      INSERT INTO project_personnel_assignments (
        id, project_id, role, personnel_id, person_name, person_title,
        license_number, license_state, assigned_by, reason
      ) VALUES (
        ${id}, ${input.projectId}, ${role}, ${input.personnelId ?? null}, ${input.personName.trim()},
        ${input.personTitle ?? null}, ${input.licenseNumber ?? null}, ${input.licenseState ?? null},
        ${input.assignedBy}, ${input.reason ?? null}
      )
    `,
  ]);

  const rows = await sql`SELECT * FROM project_personnel_assignments WHERE id = ${id} LIMIT 1`;
  const r = (rows as any[])[0];
  if (!r) throw new Error(`project personnel assignment '${id}' was not written`);
  return rowToAssignment(r);
}
