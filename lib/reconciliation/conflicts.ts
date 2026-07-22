// lib/reconciliation/conflicts.ts
// W4 §7 — Equipment-identity conflict DETECTION surface (pure, read-only).
//
// This reuses the SAME classification the snapshot build applies (build.ts,
// "equipmentIdentityConflicts"): a project's stored subSystems[k].panelId is
// cross-checked against the fleet's own resolved module identity, and any
// divergence is SURFACED (never silently picked). Here that classification is
// exposed as an operator-facing detection surface so a human can reconcile it.
//
// Pure: no DB, no mutation. Callers pass the project record (or an assembled set
// of source values); this module only decides what is in conflict.

import { getPanelById } from '@/lib/equipment-db';
import {
  type EquipmentConflict,
  type EquipmentSourceValue,
} from './types';

/** Distinct non-null normalized values among a set of sources. */
export function distinctOf(sources: EquipmentSourceValue[]): string[] {
  const seen = new Set<string>();
  for (const s of sources) {
    if (s.value != null && s.value !== '') seen.add(s.value);
  }
  return [...seen];
}

/**
 * PURE generic detector: given the assembled source values for ONE field on ONE
 * (optional) subsystem, return a conflict when >= 2 DISTINCT non-null values are
 * present. A single agreed value (or all-null) is NOT a conflict.
 */
export function detectConflictFromSources(
  conflictField: string,
  subsystemKey: string | null,
  sources: EquipmentSourceValue[],
): EquipmentConflict | null {
  const distinct = distinctOf(sources);
  if (distinct.length < 2) return null;
  return { conflictField, subsystemKey, sources, distinctValues: distinct };
}

/**
 * Collect module-identity source values from a project the SAME way build.ts
 * does: fleet identity vs each subSystems[k].panelId (resolved through the
 * catalog). Design/stored/rendered values are included when present on the
 * project so the operator sees every source. Returns one entry per subsystem
 * that carries a panelId.
 */
export function collectModuleConflicts(project: {
  subSystems?: Record<string, any> | null;
  /** the fleet's resolved module catalog id + label (from the snapshot/engine) */
  fleetModuleCatalogId?: string | null;
  fleetModuleLabel?: string | null;
  /** optional design/stored/rendered identities, when the caller has them */
  designModuleCatalogId?: string | null;
  storedPermitModuleCatalogId?: string | null;
  renderedModuleCatalogId?: string | null;
}): EquipmentConflict[] {
  const conflicts: EquipmentConflict[] = [];
  const subs = (project.subSystems ?? {}) as Record<string, any>;
  const fleetId = project.fleetModuleCatalogId ?? null;
  const fleetLabel = project.fleetModuleLabel ?? null;

  for (const [k, sub] of Object.entries(subs)) {
    const panelId: string | null = sub?.panelId ?? null;
    if (!panelId) continue;
    const mapped: any = getPanelById(panelId);
    const mappedId = mapped?.id ?? panelId;
    const mappedLabel = mapped ? `${mapped.manufacturer} ${mapped.model}` : panelId;

    const sources: EquipmentSourceValue[] = [
      { source: 'subsystem_panel_id', value: mappedId, label: mappedLabel, provenance: `project.subSystems.${k}.panelId='${panelId}'` },
    ];
    if (fleetId) sources.push({ source: 'fleet', value: fleetId, label: fleetLabel, provenance: 'fleet resolved module identity' });
    if (project.designModuleCatalogId) sources.push({ source: 'design', value: project.designModuleCatalogId, provenance: 'DesignElectrical.panelId' });
    if (project.storedPermitModuleCatalogId) sources.push({ source: 'stored_permit', value: project.storedPermitModuleCatalogId, provenance: 'stored permit snapshot equipment' });
    if (project.renderedModuleCatalogId) sources.push({ source: 'rendered', value: project.renderedModuleCatalogId, provenance: 'rendered sheet equipment' });

    const c = detectConflictFromSources('module_model', k, sources);
    if (c) conflicts.push(c);
  }
  return conflicts;
}
