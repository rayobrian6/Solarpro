// lib/reconciliation/reconcile.ts
// W4 §7 — Equipment-identity reconciliation: the transactional operator action.
//
// Given an EXPLICIT operator selection + reason, this:
//   1. validates (reason required; chosen source must be one of the presented
//      sources; project id present),
//   2. preserves the PREVIOUS canonical value,
//   3. in ONE transaction: writes an immutable audit row, updates the canonical
//      reference (projects.selected_equipment), and records invalidation rows
//      (snapshot digest + engineering approval) so the closer can wire
//      digest-checks — old snapshots/approvals must be rebuilt/re-reviewed,
//   4. returns the audit id + invalidation records.
//
// No table or timestamp silently wins: a canonical value only changes because an
// operator chose it here, with a reason, on the record.
//
// This module is operator-initiated ONLY. It performs no automatic scan and
// never runs against a project unless the caller (the admin API) supplies one.

import { getDbReady } from '@/lib/db/core';
import { randomUUID } from 'node:crypto';
import { planInvalidationSupersession, type SupersessionPlan } from './invalidationLedger';
import {
  type ReconciliationRequest,
  type ReconciliationResult,
  type InvalidationRecord,
  type EquipmentSourceValue,
  EQUIPMENT_SOURCES,
} from './types';

/** conflictField → the projects.selected_equipment key it maps to. */
const CANONICAL_KEY_BY_FIELD: Record<string, string> = {
  module_model: 'panelId',
  inverter_model: 'inverterId',
  microinverter_model: 'inverterId',
  racking_assembly: 'mountingId',
  battery_model: 'batteryId',
};

export interface ReconcileValidation { ok: boolean; error?: string; }

/**
 * AAC-7 §1(a) — THE MIRROR STORES A RECONCILIATION MUST ALSO RE-ALIGN.
 *
 * Before this, `reconcileEquipmentIdentity` rewrote ONLY the top-level
 * `projects.selected_equipment` key. The superseded record on the live Braidon
 * project lives in `engineering_config.subSystems.roof.panelId` (the doctrine
 * owner of the per-subsystem map, lib/db/projects.ts:763-770) and in the
 * `selected_equipment.subSystems` mirror of it, so EVERY generation re-detected
 * the identical divergence and appended another immutable audit row plus two
 * invalidation rows — a reconciliation that never reconciled.
 *
 * The repair is the one the DB layer already performs one level down (the P0-11
 * "recompute-if-contradicts" mirror repair, lib/db/projects.ts:565-613): a mirror
 * record that CONTRADICTS the authoritative id is re-aligned to it, in the same
 * transaction as the audit row.
 *
 * It is deliberately NOT a blanket re-alignment of every subsystem: per-subsystem
 * equipment is a first-class product feature (a hybrid may legitimately carry a
 * different module per subsystem), so the caller passes the EXACT records its
 * precedence verdict superseded, and nothing else is touched.
 */
export type MirrorStore = 'selected_equipment' | 'engineering_config';

export interface MirrorRealignment {
  store: MirrorStore;
  /** the subsystem key inside `subSystems` (roof | ground | fence | …). */
  subsystemKey: string;
  /** the field inside the subsystem entry (panelId | inverterId | …). */
  key: string;
  /** the value being replaced, for the audit record (never used as a predicate). */
  previousValue: string | null;
}

/** subSystems entry field for a conflictField — the per-sub mirror of
 *  CANONICAL_KEY_BY_FIELD. Same key names; kept separate so a future divergence
 *  between the two shapes is explicit rather than accidental. */
export const SUBSYSTEM_KEY_BY_FIELD: Record<string, string> = {
  module_model: 'panelId',
  inverter_model: 'inverterId',
  microinverter_model: 'inverterId',
  racking_assembly: 'mountingId',
  battery_model: 'batteryId',
};

/** PURE validation of a reconciliation request. */
export function validateReconciliationRequest(req: ReconciliationRequest): ReconcileValidation {
  if (!req.projectId || !req.projectId.trim()) return { ok: false, error: 'projectId is required' };
  if (!req.conflictField || !req.conflictField.trim()) return { ok: false, error: 'conflictField is required' };
  if (!req.reason || req.reason.trim().length < 3) {
    return { ok: false, error: 'a reason (>= 3 chars) is REQUIRED — no silent reconciliation' };
  }
  if (!req.operatorId || !req.operatorId.trim()) return { ok: false, error: 'operatorId is required' };
  if (!Array.isArray(req.sources) || req.sources.length < 2) {
    return { ok: false, error: 'at least two conflicting sources must be presented' };
  }
  if (!req.chosenSource) return { ok: false, error: 'chosenSource is required — the operator must select a winner' };
  const chosen = req.sources.find(s => s.source === req.chosenSource);
  if (!chosen) return { ok: false, error: `chosenSource '${req.chosenSource}' is not among the presented sources` };
  if (chosen.value == null || chosen.value === '') {
    return { ok: false, error: 'the chosen source has no value — cannot make a null value canonical' };
  }
  if (!(EQUIPMENT_SOURCES as readonly string[]).includes(req.chosenSource)) {
    // allow forward-compat sources but keep the winner explicit and named
    // (still recorded; just flagged as non-standard).
  }
  return { ok: true };
}

/** The previous canonical values = every presented source EXCEPT the winner. */
export function previousValuesOf(req: ReconciliationRequest): EquipmentSourceValue[] {
  return req.sources.filter(s => s.source !== req.chosenSource);
}

/**
 * Execute the reconciliation transactionally. On success returns the audit id
 * and the invalidation records written. `knownSnapshot` lets the caller invalidate
 * a specific digest/snapshot; when omitted a digest-null "all current snapshots
 * for this project" invalidation is written (the closer's digest-check treats a
 * null digest as "every current digest is stale until rebuild").
 */
export async function reconcileEquipmentIdentity(
  req: ReconciliationRequest,
  knownSnapshot?: {
    digest?: string | null;
    snapshotId?: string | null;
    engineeringApprovalRef?: string | null;
    /** AAC-7 §1(a) — the superseded MIRROR records to re-align in this same
     *  transaction (see MirrorRealignment). Omitted ⇒ prior behaviour exactly. */
    realign?: MirrorRealignment[];
  },
): Promise<ReconciliationResult> {
  const v = validateReconciliationRequest(req);
  if (!v.ok) throw new Error(v.error);

  const sql = await getDbReady();
  const chosen = req.sources.find(s => s.source === req.chosenSource)!;
  const previous = previousValuesOf(req);
  const auditId = randomUUID();
  const reconciledAt = new Date().toISOString();

  // Read the current canonical equipment (for preservation + merge).
  const [projRow] = await sql`SELECT selected_equipment FROM projects WHERE id = ${req.projectId} LIMIT 1`;
  if (!projRow) throw new Error(`project '${req.projectId}' not found`);
  const currentSelected: Record<string, unknown> =
    (projRow.selected_equipment && typeof projRow.selected_equipment === 'object')
      ? { ...(projRow.selected_equipment as Record<string, unknown>) }
      : {};

  const canonicalKey = CANONICAL_KEY_BY_FIELD[req.conflictField] ?? null;
  const priorCanonicalValue = canonicalKey ? (currentSelected[canonicalKey] ?? null) : null;

  // Build the next selected_equipment (merge the winning value on the mapped key).
  const nextSelected: Record<string, unknown> = { ...currentSelected };
  if (canonicalKey) {
    nextSelected[canonicalKey] = chosen.value;
    nextSelected['source'] = 'reconciliation';
    nextSelected['updatedAt'] = reconciledAt;
  }

  // ── AAC-7 §1(a): re-align the superseded MIRROR records ────────────────────
  // `selected_equipment.subSystems.<k>.<field>` folds into the object we are
  // already writing (one UPDATE, still atomic); `engineering_config.subSystems`
  // gets its own guarded jsonb_set in the same transaction.
  const realign = (knownSnapshot?.realign ?? []).filter(r => r.subsystemKey && r.key);
  const subField = SUBSYSTEM_KEY_BY_FIELD[req.conflictField] ?? null;
  const realigned: Array<MirrorRealignment & { newValue: string }> = [];
  for (const r of realign) {
    if (subField && r.key !== subField) continue;   // never touch another identity field
    realigned.push({ ...r, newValue: String(chosen.value) });
  }
  for (const r of realigned.filter(x => x.store === 'selected_equipment')) {
    const subs = (nextSelected.subSystems && typeof nextSelected.subSystems === 'object')
      ? { ...(nextSelected.subSystems as Record<string, unknown>) } : null;
    if (!subs) continue;
    const entry = subs[r.subsystemKey];
    if (!entry || typeof entry !== 'object') continue;   // never CREATE a record
    const next = { ...(entry as Record<string, unknown>) };
    if (next[r.key] === chosen.value) continue;
    next[r.key] = chosen.value;
    next['updatedAt'] = reconciledAt;
    subs[r.subsystemKey] = next;
    nextSelected.subSystems = subs;
  }

  // Invalidation records: the old snapshot digest + engineering approval are stale.
  const invalidations: InvalidationRecord[] = [];
  const mkInval = (
    scope: InvalidationRecord['scope'],
    digest: string | null,
    snapshotId: string | null,
    approvalRef: string | null,
    reason: string,
  ): InvalidationRecord => ({
    id: randomUUID(),
    projectId: req.projectId,
    digest,
    snapshotId,
    scope,
    engineeringApprovalRef: approvalRef,
    reason,
    invalidatedBy: auditId,
    invalidatedAt: reconciledAt,
  });
  invalidations.push(mkInval(
    'snapshot',
    knownSnapshot?.digest ?? null,
    knownSnapshot?.snapshotId ?? null,
    null,
    `equipment '${req.conflictField}' reconciled to ${chosen.value} — prior snapshot digest is stale and must be rebuilt/re-validated`,
  ));
  invalidations.push(mkInval(
    'engineering_approval',
    knownSnapshot?.digest ?? null,
    knownSnapshot?.snapshotId ?? null,
    knownSnapshot?.engineeringApprovalRef ?? null,
    'engineer review tied to the old snapshot digest is invalidated until a new review explicitly covers the rebuilt digest',
  ));

  const invalidationRecordJson = JSON.stringify(invalidations);

  // ── Single transaction: audit row + canonical update + invalidation ledger ──
  // neon sql.transaction: synchronous callback returning an array of queries.
  await sql.transaction((txn) => {
    const queries = [
      txn`
        INSERT INTO equipment_reconciliation_audit (
          id, project_id, conflict_field, subsystem_key, conflict_sources,
          chosen_source, chosen_value, previous_values, reason,
          operator_id, operator_name, reconciled_at, status, invalidation_record
        ) VALUES (
          ${auditId}, ${req.projectId}, ${req.conflictField}, ${req.subsystemKey ?? null},
          ${JSON.stringify(req.sources)}, ${req.chosenSource}, ${JSON.stringify({ value: chosen.value, label: chosen.label ?? null })},
          ${JSON.stringify({
            presented: previous,
            priorCanonical: { key: canonicalKey, value: priorCanonicalValue },
            realignedMirrors: realigned.map(r => ({
              store: r.store, path: r.store === 'engineering_config'
                ? `engineering_config.subSystems.${r.subsystemKey}.${r.key}`
                : `projects.selected_equipment.subSystems.${r.subsystemKey}.${r.key}`,
              previousValue: r.previousValue, newValue: r.newValue,
            })),
          })},
          ${req.reason}, ${req.operatorId}, ${req.operatorName ?? null}, ${reconciledAt}, 'applied',
          ${invalidationRecordJson}
        )
      `,
    ];
    // Update the canonical reference only when the field maps to a known key.
    if (canonicalKey) {
      queries.push(txn`
        UPDATE projects
        SET selected_equipment = ${JSON.stringify(nextSelected)}::jsonb
        WHERE id = ${req.projectId}
      `);
    }
    // AAC-7 §1(a) — the engineering_config half of the mirror re-alignment.
    // `create_missing = false` and the IS DISTINCT FROM guard together mean this
    // can only ever CORRECT an existing contradicting record: it never creates a
    // subsystem entry, never invents a field, and is a no-op once aligned (which
    // is what makes repeat generation idempotent).
    for (const r of realigned.filter(x => x.store === 'engineering_config')) {
      queries.push(txn`
        UPDATE projects
        SET engineering_config = jsonb_set(
              engineering_config,
              ARRAY['subSystems', ${r.subsystemKey}, ${r.key}]::text[],
              to_jsonb(${r.newValue}::text),
              false)
        WHERE id = ${req.projectId}
          AND engineering_config IS NOT NULL
          AND engineering_config -> 'subSystems' -> ${r.subsystemKey} ->> ${r.key}
              IS DISTINCT FROM ${r.newValue}
      `);
      queries.push(txn`
        UPDATE projects
        SET engineering_config = jsonb_set(
              engineering_config,
              ARRAY['subSystems', ${r.subsystemKey}, 'updatedAt']::text[],
              to_jsonb(${reconciledAt}::text),
              false)
        WHERE id = ${req.projectId}
          AND engineering_config -> 'subSystems' -> ${r.subsystemKey} IS NOT NULL
      `);
    }
    for (const inv of invalidations) {
      queries.push(txn`
        INSERT INTO snapshot_digest_invalidations (
          id, project_id, digest, snapshot_id, scope, engineering_approval_ref,
          reason, invalidated_by, invalidated_at
        ) VALUES (
          ${inv.id}, ${inv.projectId}, ${inv.digest}, ${inv.snapshotId}, ${inv.scope},
          ${inv.engineeringApprovalRef}, ${inv.reason}, ${inv.invalidatedBy}, ${inv.invalidatedAt}
        )
      `);
    }
    return queries;
  });

  return {
    auditId,
    projectId: req.projectId,
    conflictField: req.conflictField,
    subsystemKey: req.subsystemKey ?? null,
    chosenSource: req.chosenSource,
    chosenValue: chosen.value,
    previousValues: previous,
    reason: req.reason,
    operatorId: req.operatorId,
    reconciledAt,
    invalidations,
    status: 'applied',
    realignedMirrors: realigned.map(r => ({
      store: r.store,
      path: r.store === 'engineering_config'
        ? `engineering_config.subSystems.${r.subsystemKey}.${r.key}`
        : `projects.selected_equipment.subSystems.${r.subsystemKey}.${r.key}`,
      previousValue: r.previousValue,
      newValue: r.newValue,
    })),
  };
}

/**
 * AAC-7 §1(a) — the newest APPLIED reconciliation for (project, field, value).
 *
 * The idempotence half: once the mirrors are re-aligned a later generation finds
 * no persisted divergence and must NOT write a second audit row. It still needs
 * an audit REFERENCE to clear the requirement (releaseGates.deriveRequirementStatus:
 * `resolved` without `resolutionAuditRef` stays OPEN), so it cites the row the
 * original reconciliation already wrote.
 */
export async function findAppliedReconciliation(
  projectId: string,
  conflictField: string,
  chosenValue: string,
): Promise<{ id: string; reconciledAt: string; operatorId: string } | null> {
  const sql = await getDbReady();
  const rows = await sql`
    SELECT id, reconciled_at, operator_id
    FROM equipment_reconciliation_audit
    WHERE project_id = ${projectId}
      AND conflict_field = ${conflictField}
      AND status = 'applied'
      AND chosen_value ->> 'value' = ${chosenValue}
    ORDER BY reconciled_at DESC
    LIMIT 1
  `;
  const r = (rows as any[])[0];
  return r ? { id: String(r.id), reconciledAt: String(r.reconciled_at), operatorId: String(r.operator_id) } : null;
}

/**
 * AAC WS-2 — read the TWO equipment stores a canonical-selection decision needs,
 * in ONE query: the canonical `projects.selected_equipment` record (migration
 * 101, which the permit POST never read — audit Path 1 "Critical") and
 * `engineering_config.subSystems`, the doctrine owner of the per-subsystem
 * equipment map (lib/db/projects.ts:763-770).
 *
 * READ-ONLY. Throws the raw Postgres error like every other function here; the
 * permit path reads it through the resolver's shared `safeDbRead` guard.
 */
export async function readProjectEquipmentStores(projectId: string): Promise<{
  selectedEquipment: Record<string, unknown> | null;
  engineeringSubSystems: Record<string, unknown> | null;
} | null> {
  const sql = await getDbReady();
  const rows = await sql`
    SELECT selected_equipment,
           engineering_config -> 'subSystems' AS engineering_sub_systems
    FROM projects WHERE id = ${projectId} LIMIT 1
  `;
  const r = (rows as any[])[0];
  if (!r) return null;
  const obj = (v: unknown): Record<string, unknown> | null =>
    (v && typeof v === 'object' && !Array.isArray(v)) ? (v as Record<string, unknown>) : null;
  return {
    selectedEquipment: obj(r.selected_equipment),
    engineeringSubSystems: obj(r.engineering_sub_systems),
  };
}

/** Read the reconciliation history for a project (newest first). */
export async function listReconciliationAudit(projectId: string): Promise<any[]> {
  const sql = await getDbReady();
  const rows = await sql`
    SELECT * FROM equipment_reconciliation_audit
    WHERE project_id = ${projectId}
    ORDER BY reconciled_at DESC
  `;
  return rows as any[];
}

/** Read active (not-yet-superseded) invalidations for a project — the closer's
 *  digest-check consumes this to reject stale snapshots/approvals. */
export async function listActiveInvalidations(projectId: string): Promise<any[]> {
  const sql = await getDbReady();
  const rows = await sql`
    SELECT * FROM snapshot_digest_invalidations
    WHERE project_id = ${projectId} AND superseded_at IS NULL
    ORDER BY invalidated_at DESC
  `;
  return rows as any[];
}

/**
 * D11 — LIFT the invalidations a rebuilt, re-reviewed design has answered.
 *
 * `superseded_at` / `superseded_by` have existed since migration 114 created the
 * table, and `listActiveInvalidations` has always filtered on them — but NOTHING
 * in the codebase ever wrote them. An invalidation, once recorded, was permanent:
 * there was no path by which rebuilding and re-reviewing a design could clear the
 * objection raised against its predecessor. This is that path, and it is the only
 * one.
 *
 * NO MIGRATION IS NEEDED. The columns and the `(project_id, superseded_at)` index
 * are already in 114; what was missing was a writer, not a schema.
 *
 * The decision is NOT made here — `planInvalidationSupersession` makes it, purely
 * and testably, and this function executes exactly what the plan says. Rows the
 * plan retains are left untouched, including every NULL-digest legacy watermark:
 * those never recorded the digest they were protecting, so no rebuild can prove
 * them answered, and reconstructing one would be fabricated authority. The plan
 * is returned so the caller can report what was lifted AND what was not.
 */
export async function supersedeInvalidationsForRebuild(args: {
  projectId: string;
  /** the digest of the rebuilt design the new approval covers. */
  rebuiltDigest: string;
  /** the approval clearing them — recorded in `superseded_by`. */
  approvalRef: string;
  /** when the approval was made. */
  atIso: string;
}): Promise<SupersessionPlan> {
  const active = await listActiveInvalidations(args.projectId);
  const plan = planInvalidationSupersession({
    rows: active.map(r => ({
      id: String(r.id),
      digest: (r.digest as string | null) ?? null,
      invalidatedAtIso: r.invalidated_at == null
        ? null
        : (r.invalidated_at instanceof Date ? r.invalidated_at.toISOString() : String(r.invalidated_at)),
    })),
    rebuiltDigest: args.rebuiltDigest,
    approvalRef: args.approvalRef,
    atIso: args.atIso,
  });
  if (!plan.supersede.length) return plan;

  const sql = await getDbReady();
  for (const s of plan.supersede) {
    // Guarded by `superseded_at IS NULL` so a concurrent lift cannot be
    // overwritten and re-attributed to a later approval.
    await sql`
      UPDATE snapshot_digest_invalidations
      SET superseded_at = ${s.supersededAtIso}::timestamptz, superseded_by = ${s.supersededBy}
      WHERE id = ${s.id} AND superseded_at IS NULL
    `;
  }
  return plan;
}
