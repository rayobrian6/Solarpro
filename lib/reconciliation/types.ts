// lib/reconciliation/types.ts
// W4 §7 — Equipment-identity reconciliation TYPES (pure).

/** The five authority sources a project's equipment identity can come from. */
export const EQUIPMENT_SOURCES = [
  'subsystem_panel_id',  // project.subSystems[k].panelId (the §1.1 stored map)
  'fleet',               // the fleet's own resolved equipment
  'design',              // Design Studio DesignElectrical
  'stored_permit',       // the stored permit snapshot equipment
  'rendered',            // what a rendered sheet shows
] as const;
export type EquipmentSource = (typeof EQUIPMENT_SOURCES)[number];

/** One equipment value from one source, with its provenance. */
export interface EquipmentSourceValue {
  source: EquipmentSource;
  /** normalized identity value (e.g. catalog id) used for conflict comparison */
  value: string | null;
  /** human label (e.g. "REC Alpha Pure 405W") */
  label?: string | null;
  provenance: string;
}

/** A detected conflict for one field on one (optional) subsystem. */
export interface EquipmentConflict {
  conflictField: string;             // e.g. 'module_model'
  subsystemKey: string | null;       // roof | ground | fence | null
  sources: EquipmentSourceValue[];   // every conflicting source (>= 2 distinct values)
  /** distinct non-null values in play */
  distinctValues: string[];
}

/** Operator's reconciliation decision (API input). */
export interface ReconciliationRequest {
  projectId: string;
  conflictField: string;
  subsystemKey?: string | null;
  /** every conflicting source at decision time (echoed into the audit record) */
  sources: EquipmentSourceValue[];
  chosenSource: EquipmentSource | string;
  reason: string;
  operatorId: string;
  operatorName?: string | null;
}

/** Result of a completed reconciliation. */
export interface ReconciliationResult {
  auditId: string;
  projectId: string;
  conflictField: string;
  subsystemKey: string | null;
  chosenSource: string;
  chosenValue: string | null;
  previousValues: EquipmentSourceValue[];
  reason: string;
  operatorId: string;
  reconciledAt: string;
  invalidations: InvalidationRecord[];
  status: 'applied' | 'failed';
}

/** One invalidation the reconciliation produced. The closer wires digest-checks
 *  against snapshot_digest_invalidations rows shaped like this. */
export interface InvalidationRecord {
  id: string;
  projectId: string;
  digest: string | null;
  snapshotId: string | null;
  scope: 'snapshot' | 'calculation' | 'engineering_approval';
  engineeringApprovalRef: string | null;
  reason: string;
  invalidatedBy: string;   // the reconciliation audit id
  invalidatedAt: string;
}
