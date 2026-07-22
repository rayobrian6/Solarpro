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
  knownSnapshot?: { digest?: string | null; snapshotId?: string | null; engineeringApprovalRef?: string | null },
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
          ${JSON.stringify({ presented: previous, priorCanonical: { key: canonicalKey, value: priorCanonicalValue } })},
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
