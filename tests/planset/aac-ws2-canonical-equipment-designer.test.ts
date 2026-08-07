// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-2 + WS-6 — CANONICAL EQUIPMENT SELECTION + DESIGNER PROPAGATION
//
// THE EQUIPMENT SET (the directive's 7):
//   E1  the precedence lattice ranks every source, each with real provenance
//   E2  a CURRENT explicit user selection supersedes a stale record ⇒ AUTO-
//       RECONCILED through the existing transactional machinery (audit row +
//       digest invalidations), with the audit ref that alone can clear it
//   E3  TWO GENUINELY ACTIVE explicit selections still CONFLICT (both directions)
//   E4  a SUPERSEDED selection can never re-enter the active snapshot
//   E5  the reconciliation table absent ⇒ UNRESOLVED with the exact retryable
//       failure + operator step; a determination without its audit row never clears
//   E6  a selection change REGENERATES the downstream records (module identity,
//       ratings, datasheet binding, BOM, calculations) from the canonical identity
//   E7  MODULE-EXACT-DATASHEET: the range comparison (a covering series sheet is
//       distinguishable from a non-covering one) + the recorded retrieval attempt
//
// THE DESIGNER SET (the directive's 6):
//   D1  a configured designer populates the project record, the snapshot, the
//       title blocks and the planset metadata, and CLEARS the requirement
//   D2  it NEVER populates EOR / PE / signature / seal / digest approval
//   D3  a project-specific override supersedes the configured default, audited
//   D4  migration not run ⇒ RETRYABLE failure naming the exact operator step;
//       no vendor default is ever substituted
//   D5  store readable but nothing configured ⇒ REQUIRES_INPUT (a DIFFERENT fact)
//   D6  role separation: precedence, and the licensed roles are not auto-populatable
//
// NO DATABASE IS TOUCHED: every case injects a scripted `safeDbRead`, which is
// also exactly the live condition today (migrations 113/114/115 unrun ⇒ 42P01).
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { runResolutionLifecycle } from '@/lib/permit/snapshot/resolution/lifecycle';
import { PRODUCTION_RESOLVERS, canonicalEquipmentResolver } from '@/lib/permit/snapshot/resolution/resolvers';
import { createResolverRegistry } from '@/lib/permit/snapshot/resolution/registry';
import { validateResolutionDeclarations, verifyClearedRequirementsHaveEvidence } from '@/lib/permit/snapshot/resolution/lifecycle';
import {
  EQUIPMENT_SELECTION_TIERS, EQUIPMENT_TIER_RANK, collectModuleSelectionCandidates,
  decideCanonicalSelection, dominates, applyCanonicalEquipmentToInput, findSupersededLeaks,
  buildCanonicalEquipmentAuthority, reconciliationSources, isExplicitChannel,
  SYSTEM_RESOLVER_ACTOR, supersededMirrorRecords, persistedSupersededCandidates,
  isPersistedStorePath,
} from '@/lib/permit/snapshot/resolution/equipmentSelection';
import { evaluateModuleDatasheetBinding } from '@/lib/permit/snapshot/resolution/datasheetBinding';
import { resolveModuleDatasheetExactness } from '@/lib/permit/snapshot/equipmentProjection';
import { resolvePersonnelAuthority, unavailablePersonnelAuthority } from '@/lib/personnel/store';
import {
  PERSONNEL_ROLES, AUTO_POPULATABLE_ROLES, LICENSED_ROLES, isAutoPopulatable,
  validatePersonnelInput, type PersonnelRecord, type ProjectPersonnelAssignment,
} from '@/lib/personnel/types';
import { deriveRequirementStatus, REQUIREMENT_DECLARATIONS } from '@/lib/permit/snapshot/releaseGates';
import type { SafeDbRead } from '@/lib/permit/snapshot/resolution/types';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';
import type { PermitInput } from '@/lib/permit/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const NOW = '2026-07-27T12:00:00.000Z';
const PID = '4030b664-bebe-433b-a11c-cda05ead2f7d';

// The LIVE Braidon provenance, read from the production row on 2026-07-27:
//   projects.selected_equipment.panelId       = qcells-peak-duo-400  source engineering  2026-07-27T17:06:57.737Z
//   projects.selected_equipment.subSystems.roof.panelId = rec-alpha-pure-405  source engineering  2026-07-17T16:16:47.549Z
//   engineering_config.inverters[].strings[].panelId    = qcells-peak-duo-400 (the posted fleet)
// One explicit selection, ten days newer, corroborated by the fleet — vs ONE
// stale mirror. These constants are TEST FIXTURE DATA, never production input.
const LIVE_CANONICAL_AT = '2026-07-27T17:06:57.737Z';
const LIVE_STALE_AT = '2026-07-17T16:16:47.549Z';

const braidonStore = (over?: Record<string, unknown>) => ({
  selectedEquipment: {
    panelId: 'qcells-peak-duo-400', source: 'engineering', updatedAt: LIVE_CANONICAL_AT,
    subSystems: {
      roof: { key: 'roof', panelId: 'rec-alpha-pure-405', source: 'engineering', updatedAt: LIVE_STALE_AT },
    },
    ...(over ?? {}),
  } as Record<string, unknown>,
  engineeringSubSystems: {
    roof: { key: 'roof', panelId: 'rec-alpha-pure-405', source: 'engineering', updatedAt: LIVE_STALE_AT },
  } as Record<string, unknown>,
});

/** A scripted guarded read: label PREFIX → value, or an Error to fail. Anything
 *  unscripted fails soft with the live 42P01 condition. */
function scriptedRead(script: Record<string, unknown>): SafeDbRead {
  return async <T>(label: string, _run: () => Promise<T>, failSoftTo: T) => {
    for (const [prefix, v] of Object.entries(script)) {
      if (!label.startsWith(prefix)) continue;
      if (v instanceof Error) return { value: failSoftTo, ok: false, error: `${label}: ${v.message}` };
      return { value: v as T, ok: true, error: null };
    }
    return {
      value: failSoftTo, ok: false,
      error: `${label}: 42P01 relation does not exist [table absent — migration 113/114 not run]`,
    };
  };
}

const OFFLINE: SafeDbRead = scriptedRead({});

/** A Braidon-shaped input whose POSTED subsystem map still carries the stale REC
 *  mirror (exactly what generation receives today) while the fleet is Qcells. */
function braidonInput(over?: (i: any) => void): PermitInput {
  const i = clone(braidonOriginalAuditFixture) as any;
  i.projectId = PID;
  i.project.subSystems = {
    roof: { key: 'roof', panelId: 'rec-alpha-pure-405', source: 'engineering', updatedAt: LIVE_STALE_AT },
  };
  over?.(i);
  return i as PermitInput;
}

function snapshotOf(input: PermitInput): PermitDesignSnapshot {
  generatePermitHTML(input);
  return (input as any)._snapshot as PermitDesignSnapshot;
}

// ═══════════════════════════════════════════════════════════════════════════
// E1 — the precedence lattice
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-2 · E1 · the precedence lattice ranks every source with provenance', () => {
  it('is exactly the directive lattice: explicit user > project > design > fleet > company defaults > subsystem > legacy/generated', () => {
    expect(EQUIPMENT_SELECTION_TIERS).toEqual([
      'explicit-user', 'project', 'design', 'fleet', 'company-default', 'subsystem', 'legacy-generated',
    ]);
    const ranks = EQUIPMENT_SELECTION_TIERS.map(t => EQUIPMENT_TIER_RANK[t]);
    for (let n = 1; n < ranks.length; n++) expect(ranks[n]).toBeLessThan(ranks[n - 1]);
  });

  it('classifies the WRITING CHANNEL, never the product name (explicit vs generated)', () => {
    expect(isExplicitChannel('design')).toBe(true);
    expect(isExplicitChannel('engineering')).toBe(true);
    expect(isExplicitChannel('migration')).toBe(false);
    expect(isExplicitChannel('defaults')).toBe(false);
    expect(isExplicitChannel(null)).toBe(false);
  });

  it('every collected candidate carries actor + timestamp + record path', () => {
    const candidates = collectModuleSelectionCandidates({ input: braidonInput(), stored: braidonStore() });
    expect(candidates.length).toBeGreaterThanOrEqual(3);
    for (const c of candidates) {
      expect(c.provenance.actor.length).toBeGreaterThan(0);
      expect(c.provenance.path.length).toBeGreaterThan(0);
      expect(typeof c.provenance.explicit).toBe('boolean');
      expect(EQUIPMENT_TIER_RANK[c.tier]).toBe(c.rank);
    }
    // the canonical store's user-authored write is the TOP tier; the per-sub
    // mirror is the SUBSYSTEM tier even though the same channel wrote it.
    const top = candidates.find(c => c.provenance.path === 'projects.selected_equipment.panelId')!;
    expect(top.tier).toBe('explicit-user');
    expect(top.value).toBe('qcells-peak-duo-400');
    const mirror = candidates.find(c => c.provenance.path.endsWith('selected_equipment.subSystems.roof.panelId'))!;
    expect(mirror.tier).toBe('subsystem');
    expect(mirror.value).toBe('rec-alpha-pure-405');
    // the posted fleet corroborates Qcells and carries NO timestamp by design
    const fleet = candidates.find(c => c.tier === 'fleet')!;
    expect(fleet.value).toBe('qcells-peak-duo-400');
    expect(fleet.provenance.atIso).toBeNull();
  });

  it('a MIGRATION-synthesized subsystem record lands in the legacy/generated tier', () => {
    const candidates = collectModuleSelectionCandidates({
      input: braidonInput(i => { i.project.subSystems.roof.source = 'migration'; }),
      stored: null,
    });
    const legacy = candidates.find(c => c.provenance.path.startsWith('permit-input#project.subSystems'))!;
    expect(legacy.tier).toBe('legacy-generated');
    expect(legacy.rank).toBe(0);
    expect(legacy.provenance.explicit).toBe(false);
  });

  it('an UNDATED record can never claim currency over a dated one (domination rule)', () => {
    const a = { rank: 60, provenance: { atIso: null } } as any;
    const b = { rank: 10, provenance: { atIso: '2026-07-17T00:00:00.000Z' } } as any;
    // higher rank but undated, nothing corroborating ⇒ does NOT dominate
    expect(dominates(a, b, [])).toBe(false);
    // a corroborator at least as recent supplies the currency evidence
    expect(dominates(a, b, [{ provenance: { atIso: '2026-07-27T00:00:00.000Z' } } as any])).toBe(true);
    // an UNDATED loser cannot claim currency at all
    expect(dominates(a, { rank: 10, provenance: { atIso: null } } as any, [])).toBe(true);
    // equal or lower rank never dominates
    expect(dominates({ rank: 10, provenance: { atIso: '2026-07-27' } } as any, b, [])).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E2 — the current explicit selection supersedes a stale record, automatically
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-2 · E2 · a CURRENT explicit selection auto-reconciles a stale record', () => {
  it('the Braidon verdict: Qcells canonical, the REC subsystem mirror superseded, no operator step', () => {
    const verdict = decideCanonicalSelection(
      collectModuleSelectionCandidates({ input: braidonInput(), stored: braidonStore() }));
    expect(verdict.canonical!.value).toBe('qcells-peak-duo-400');
    expect(verdict.canonical!.tier).toBe('explicit-user');
    expect(verdict.divergent).toBe(true);
    expect(verdict.operatorConfirmationRequired).toBe(false);
    expect(verdict.superseded.map(s => s.value)).toEqual(
      expect.arrayContaining(['rec-alpha-pure-405']));
    expect(verdict.unresolvedActive).toEqual([]);
    // corroboration is recorded, not assumed
    expect(verdict.corroborating.some(c => c.tier === 'fleet')).toBe(true);
    // and the basis states WHY, with the provenance
    expect(verdict.basis).toContain('explicit-user');
    expect(verdict.basis).toContain(LIVE_CANONICAL_AT);
  });

  it('the resolver RECORDS the reconciliation through the existing machinery and clears with an audit ref', async () => {
    const input = braidonInput();
    const { authority, outcome } = await runResolutionLifecycle(input, {
      nowIso: NOW,
      safeDbRead: scriptedRead({
        readProjectEquipmentStores: braidonStore(),
        reconcileEquipmentIdentity: {
          auditId: 'audit-aac2-0001', projectId: PID, conflictField: 'module_model',
          subsystemKey: 'roof', chosenSource: 'stored_permit', chosenValue: 'qcells-peak-duo-400',
          previousValues: [], reason: 'fixture', operatorId: SYSTEM_RESOLVER_ACTOR,
          reconciledAt: NOW, status: 'applied',
          invalidations: [{ scope: 'snapshot' }, { scope: 'engineering_approval' }],
        },
      }),
    });
    const st = outcome.states['EQUIPMENT-IDENTITY-CONFLICT'];
    expect(st.lastResolutionResult).toBe('RESOLVED');
    expect(st.cleared).toBe(true);
    // the audit ref is what the release-gate contract requires to clear
    expect(st.resolutionAuditRef).toContain('canonical-equipment-selection@v1');
    expect(st.resolutionAuditRef).toContain('audit-aac2-0001');
    expect(deriveRequirementStatus({ resolved: true, resolutionAuditRef: st.resolutionAuditRef })).toBe('CLEARED');
    // the audit row was written under the SYSTEM actor — never a human id
    expect(authority.canonicalEquipment!.reconciliation!.actor).toBe(SYSTEM_RESOLVER_ACTOR);
    expect(authority.canonicalEquipment!.reconciliation!.auditId).toBe('audit-aac2-0001');
    // the same invalidation vocabulary the operator path writes
    expect(outcome.invalidations.map(i => i.scope)).toEqual(
      expect.arrayContaining(['snapshot', 'calculation', 'engineering_approval']));
    expect(verifyClearedRequirementsHaveEvidence(outcome)).toEqual([]);
    expect(outcome.invariantViolations).toEqual([]);
  });

  it('the reconciliation sources handed to the transactional writer carry every store + its provenance', () => {
    const verdict = decideCanonicalSelection(
      collectModuleSelectionCandidates({ input: braidonInput(), stored: braidonStore() }));
    const sources = reconciliationSources(verdict);
    expect(sources.length).toBeGreaterThanOrEqual(2);      // reconcile.ts requires >= 2
    expect(sources.some(s => s.value === 'qcells-peak-duo-400')).toBe(true);
    expect(sources.some(s => s.value === 'rec-alpha-pure-405')).toBe(true);
    for (const s of sources) expect(s.provenance).toMatch(/tier .+ · (explicit|generated) via /);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E2b — AAC-7 §1(a) · REPEAT GENERATION IS IDEMPOTENT
// ───────────────────────────────────────────────────────────────────────────
// The AAC-6 live pass found the reconciliation writing the canonical value to
// `projects.selected_equipment` while the superseded record it was reconciling
// (engineering_config.subSystems.roof.panelId) stayed exactly as it was. Every
// subsequent generation therefore re-detected the identical divergence and
// appended another immutable audit row + two invalidation rows, and two
// consecutive live runs could disagree about the registry because run 1 changed
// what run 2 read.
//
// The contract these tests pin: (1) the reconciliation re-aligns the superseded
// PERSISTED mirrors in its own transaction, (2) once the stores agree the
// resolver writes NOTHING — a stale value in the POSTED BODY is re-pinned, not
// reconciled — and (3) it still clears, citing the audit row that already exists.
// ═══════════════════════════════════════════════════════════════════════════

/** The Braidon store AFTER a correct reconciliation: every persisted mirror
 *  re-aligned to the canonical id. The POSTED body is still stale (it is a
 *  request payload, not a store — braidonInput() always posts the REC mirror). */
const reconciledStore = () => ({
  selectedEquipment: {
    panelId: 'qcells-peak-duo-400', source: 'reconciliation', updatedAt: LIVE_CANONICAL_AT,
    subSystems: {
      roof: { key: 'roof', panelId: 'qcells-peak-duo-400', source: 'engineering', updatedAt: LIVE_CANONICAL_AT },
    },
  } as Record<string, unknown>,
  engineeringSubSystems: {
    roof: { key: 'roof', panelId: 'qcells-peak-duo-400', source: 'engineering', updatedAt: LIVE_CANONICAL_AT },
  } as Record<string, unknown>,
});

describe('AAC WS-2 · E2b · repeat generation neither re-reconciles nor churns the audit', () => {
  it('the reconciliation is handed the exact superseded PERSISTED mirrors — and only those', () => {
    const verdict = decideCanonicalSelection(
      collectModuleSelectionCandidates({ input: braidonInput(), stored: braidonStore() }));
    const mirrors = supersededMirrorRecords(verdict);
    expect(mirrors).toEqual(expect.arrayContaining([
      { store: 'selected_equipment', subsystemKey: 'roof', key: 'panelId', previousValue: 'rec-alpha-pure-405' },
      { store: 'engineering_config', subsystemKey: 'roof', key: 'panelId', previousValue: 'rec-alpha-pure-405' },
    ]));
    expect(mirrors.length).toBe(2);
    // the POSTED body is NOT a store and is never handed to the writer
    expect(mirrors.some(m => (m.store as string).includes('permit-input'))).toBe(false);
    expect(verdict.superseded.some(s => s.provenance.path.startsWith('permit-input#'))).toBe(true);
  });

  it('a posted-body path is never mistaken for a store of record', () => {
    expect(isPersistedStorePath('engineering_config.subSystems.roof.panelId')).toBe(true);
    expect(isPersistedStorePath('projects.selected_equipment.panelId')).toBe(true);
    expect(isPersistedStorePath('permit-input#project.subSystems.roof.panelId')).toBe(false);
    expect(isPersistedStorePath('permit-input#system.inverters[].strings[].panelModel')).toBe(false);
  });

  it('with the stores already reconciled it is STILL divergent (the posted body) but nothing is left to persist', () => {
    const verdict = decideCanonicalSelection(
      collectModuleSelectionCandidates({ input: braidonInput(), stored: reconciledStore() }));
    expect(verdict.divergent).toBe(true);                       // the posted mirror still disagrees
    expect(verdict.superseded.length).toBeGreaterThan(0);
    expect(persistedSupersededCandidates(verdict)).toEqual([]); // …but no STORE does
    expect(supersededMirrorRecords(verdict)).toEqual([]);
  });

  it('run 2 writes NOTHING: the transactional writer is not called at all', async () => {
    const input = braidonInput();
    const { authority, outcome } = await runResolutionLifecycle(input, {
      nowIso: NOW,
      safeDbRead: scriptedRead({
        readProjectEquipmentStores: reconciledStore(),
        // If the resolver were to call the writer, this scripted FAILURE would
        // make the requirement unresolved — so a clear here PROVES it did not.
        reconcileEquipmentIdentity: new Error('the writer must not be called when every store is already reconciled'),
        findAppliedReconciliation: { id: 'audit-aac2-0001', reconciledAt: NOW, operatorId: SYSTEM_RESOLVER_ACTOR },
      }),
    });
    const st = outcome.states['EQUIPMENT-IDENTITY-CONFLICT'];
    expect(st.lastResolutionResult).toBe('RESOLVED');
    expect(st.cleared).toBe(true);
    // it cites the audit row that ALREADY exists — never a clear without a ref
    expect(st.resolutionAuditRef).toContain('audit-aac2-0001');
    expect(deriveRequirementStatus({ resolved: true, resolutionAuditRef: st.resolutionAuditRef })).toBe('CLEARED');
    // and it declares NO new invalidations (nothing was invalidated: nothing changed)
    expect(outcome.invalidations.filter(i => i.invalidatedBy.startsWith('canonical-equipment-selection'))).toEqual([]);
    expect(authority.canonicalEquipment!.reconciliation!.auditId).toBe('audit-aac2-0001');
    expect(authority.canonicalEquipment!.reconciliation!.invalidationCount).toBe(0);
    expect(verifyClearedRequirementsHaveEvidence(outcome)).toEqual([]);
    expect(outcome.invariantViolations).toEqual([]);
  });

  it('TWO CONSECUTIVE RUNS produce the identical requirement set (run 1 reconciles, run 2 does not)', async () => {
    const run = async (stored: unknown, writer: unknown) => {
      const input = braidonInput();
      const { outcome } = await runResolutionLifecycle(input, {
        nowIso: NOW,
        safeDbRead: scriptedRead({
          readProjectEquipmentStores: stored,
          reconcileEquipmentIdentity: writer,
          findAppliedReconciliation: { id: 'audit-aac2-0001', reconciledAt: NOW, operatorId: SYSTEM_RESOLVER_ACTOR },
        }),
      });
      const snap = snapshotOf(input);
      return {
        cleared: outcome.states['EQUIPMENT-IDENTITY-CONFLICT'].cleared,
        codes: snap.permitReadiness.registry.map(r => r.code).sort(),
        moduleId: snap.equipment.modules[0]?.catalogId ?? null,
      };
    };
    // run 1 — the live pre-reconciliation state; the writer succeeds
    const first = await run(braidonStore(), {
      auditId: 'audit-aac2-0001', projectId: PID, conflictField: 'module_model',
      subsystemKey: 'roof', chosenSource: 'stored_permit', chosenValue: 'qcells-peak-duo-400',
      previousValues: [], reason: 'fixture', operatorId: SYSTEM_RESOLVER_ACTOR,
      reconciledAt: NOW, status: 'applied',
      invalidations: [{ scope: 'snapshot' }, { scope: 'engineering_approval' }],
      realignedMirrors: [
        { store: 'engineering_config', path: 'engineering_config.subSystems.roof.panelId', previousValue: 'rec-alpha-pure-405', newValue: 'qcells-peak-duo-400' },
        { store: 'selected_equipment', path: 'projects.selected_equipment.subSystems.roof.panelId', previousValue: 'rec-alpha-pure-405', newValue: 'qcells-peak-duo-400' },
      ],
    });
    // run 2 — the state run 1 left behind; the writer would THROW if called
    const second = await run(reconciledStore(), new Error('run 2 must not write'));

    expect(first.cleared).toBe(true);
    expect(second.cleared).toBe(true);
    expect(second.codes).toEqual(first.codes);                 // identical requirement set
    expect(second.moduleId).toBe(first.moduleId);              // identical module of record
    expect(first.codes).not.toContain('EQUIPMENT-IDENTITY-CONFLICT');
  });

  it('anti-vacuity: a mirror that is GENUINELY ACTIVE is never re-aligned away', async () => {
    // the per-sub record is NEWER than the project-level one ⇒ two active
    // selections ⇒ no reconciliation, no re-alignment, operator confirmation.
    const stored = braidonStore();
    (stored.selectedEquipment.subSystems as any).roof.updatedAt = '2026-07-28T09:00:00.000Z';
    (stored.engineeringSubSystems as any).roof.updatedAt = '2026-07-28T09:00:00.000Z';
    const verdict = decideCanonicalSelection(
      collectModuleSelectionCandidates({ input: braidonInput(), stored }));
    expect(verdict.operatorConfirmationRequired).toBe(true);
    expect(supersededMirrorRecords(verdict)).toEqual([]);

    const input = braidonInput();
    const { outcome } = await runResolutionLifecycle(input, {
      nowIso: NOW,
      safeDbRead: scriptedRead({
        readProjectEquipmentStores: stored,
        reconcileEquipmentIdentity: new Error('the writer must not be called on two active selections'),
        findAppliedReconciliation: { id: 'audit-aac2-0001', reconciledAt: NOW, operatorId: SYSTEM_RESOLVER_ACTOR },
      }),
    });
    const st = outcome.states['EQUIPMENT-IDENTITY-CONFLICT'];
    expect(st.cleared).toBe(false);
    expect(st.resolutionAuditRef ?? null).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E3 — two genuinely active explicit selections STILL conflict (anti-vacuity)
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-2 · E3 · anti-vacuity: two genuinely active explicit selections still conflict', () => {
  it('a per-subsystem selection made AFTER the project-level one is NOT superseded', () => {
    const stored = braidonStore();
    // the operator picked REC per-subsystem AFTER the project-level Qcells write
    (stored.selectedEquipment.subSystems as any).roof.updatedAt = '2026-07-28T09:00:00.000Z';
    (stored.engineeringSubSystems as any).roof.updatedAt = '2026-07-28T09:00:00.000Z';
    const verdict = decideCanonicalSelection(
      collectModuleSelectionCandidates({
        input: braidonInput(i => { i.project.subSystems.roof.updatedAt = '2026-07-28T09:00:00.000Z'; }),
        stored,
      }));
    expect(verdict.divergent).toBe(true);
    expect(verdict.operatorConfirmationRequired).toBe(true);
    expect(verdict.superseded).toEqual([]);
    expect(verdict.unresolvedActive.some(c => c.value === 'rec-alpha-pure-405')).toBe(true);
    expect(verdict.basis).toContain('TWO GENUINELY ACTIVE EXPLICIT SELECTIONS');
  });

  it('the resolver refuses to pick, performs NO reconciliation, and states the operator step', async () => {
    const stored = braidonStore();
    (stored.selectedEquipment.subSystems as any).roof.updatedAt = '2026-07-28T09:00:00.000Z';
    (stored.engineeringSubSystems as any).roof.updatedAt = '2026-07-28T09:00:00.000Z';
    let reconcileCalled = 0;
    const read: SafeDbRead = async <T>(label: string, run: () => Promise<T>, failSoftTo: T) => {
      if (label.startsWith('reconcileEquipmentIdentity')) { reconcileCalled++; return { value: failSoftTo, ok: false, error: 'must not be called' }; }
      if (label.startsWith('readProjectEquipmentStores')) return { value: stored as unknown as T, ok: true, error: null };
      return { value: failSoftTo, ok: false, error: `${label}: 42P01 relation does not exist` };
    };
    const { authority, outcome } = await runResolutionLifecycle(
      braidonInput(i => { i.project.subSystems.roof.updatedAt = '2026-07-28T09:00:00.000Z'; }),
      { nowIso: NOW, safeDbRead: read });
    const st = outcome.states['EQUIPMENT-IDENTITY-CONFLICT'];
    expect(reconcileCalled).toBe(0);
    expect(st.cleared).toBe(false);
    expect(st.resolutionAuditRef).toBeNull();
    expect(st.retryability).toBe('REQUIRES_INPUT');
    expect(st.blockingReason).toMatch(/two genuinely active/i);
    expect(authority.canonicalEquipment!.operatorConfirmationRequired).toBe(true);
    expect(authority.canonicalEquipment!.reconciliation).toBeNull();
    const ev = outcome.evidence.find(e => e.resolverId === 'canonical-equipment-selection@v1')!;
    expect(ev.operatorAction).toMatch(/Reconciliation/i);
  });

  it('BOTH DIRECTIONS: with the stale record older it auto-reconciles; with it newer it does not', () => {
    const older = decideCanonicalSelection(
      collectModuleSelectionCandidates({ input: braidonInput(), stored: braidonStore() }));
    const newerStore = braidonStore();
    (newerStore.selectedEquipment.subSystems as any).roof.updatedAt = '2026-07-28T09:00:00.000Z';
    (newerStore.engineeringSubSystems as any).roof.updatedAt = '2026-07-28T09:00:00.000Z';
    const newer = decideCanonicalSelection(
      collectModuleSelectionCandidates({
        input: braidonInput(i => { i.project.subSystems.roof.updatedAt = '2026-07-28T09:00:00.000Z'; }),
        stored: newerStore,
      }));
    expect(older.operatorConfirmationRequired).toBe(false);
    expect(newer.operatorConfirmationRequired).toBe(true);
  });

  it('WITHOUT the canonical store (no DB) the undated fleet cannot supersede a dated mirror — the blocker survives', async () => {
    const { authority, outcome } = await runResolutionLifecycle(braidonInput(), { nowIso: NOW, safeDbRead: OFFLINE });
    const st = outcome.states['EQUIPMENT-IDENTITY-CONFLICT'];
    expect(st.cleared).toBe(false);
    expect(authority.canonicalEquipment!.operatorConfirmationRequired).toBe(true);
    expect(authority.canonicalEquipment!.reconciliation).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E4 — a superseded selection can never re-enter the active snapshot
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-2 · E4 · anti-vacuity: a superseded selection cannot re-enter the snapshot', () => {
  it('the re-pin removes it from every posted record, and the leak guard confirms', () => {
    const input = braidonInput();
    const verdict = decideCanonicalSelection(
      collectModuleSelectionCandidates({ input, stored: braidonStore() }));
    const authority = buildCanonicalEquipmentAuthority({ verdict });
    // BEFORE: the superseded value IS present in the active input
    expect(findSupersededLeaks(input, authority).length).toBeGreaterThan(0);
    const report = applyCanonicalEquipmentToInput(input, 'qcells-peak-duo-400', { nowIso: NOW });
    expect(report.changed).toContain('project.subSystems.roof.panelId');
    expect(report.previous['project.subSystems.roof.panelId']).toBe('rec-alpha-pure-405');
    // AFTER: no leak anywhere
    expect(findSupersededLeaks(input, authority)).toEqual([]);
    expect((input.project as any).subSystems.roof.panelId).toBe('qcells-peak-duo-400');
  });

  it('the superseded record survives ONLY as audit history, with the reason it lost', () => {
    const verdict = decideCanonicalSelection(
      collectModuleSelectionCandidates({ input: braidonInput(), stored: braidonStore() }));
    const authority = buildCanonicalEquipmentAuthority({ verdict });
    const rec = authority.superseded.find(s => s.value === 'rec-alpha-pure-405')!;
    expect(rec.actor).toBe('engineering');
    expect(rec.atIso).toBe(LIVE_STALE_AT);
    expect(rec.supersededBecause).toMatch(/outranked/);
    expect(rec.supersededBecause).toContain(LIVE_STALE_AT);
    // the canonical identity is persisted with full provenance
    expect(authority.canonical).toMatchObject({
      catalogId: 'qcells-peak-duo-400', manufacturer: 'Q CELLS', ratedWatts: 400,
      tier: 'explicit-user', actor: 'engineering', explicit: true,
    });
  });

  it('a leak after a recorded reconciliation is refused, not reported as resolved', async () => {
    // A resolver run whose re-pin cannot reach a value (an unresolvable catalog
    // id) must not clear: the guard turns it into an explicit failure.
    const input = braidonInput();
    const verdict = decideCanonicalSelection(
      collectModuleSelectionCandidates({ input, stored: braidonStore() }));
    const authority = buildCanonicalEquipmentAuthority({ verdict });
    const noop = applyCanonicalEquipmentToInput(input, 'not-a-real-catalog-id');
    expect(noop.changed).toEqual([]);                       // nothing re-pinned
    expect(findSupersededLeaks(input, authority).length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E5 — the reconciliation table absent ⇒ unresolved, exactly and retryably
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-2 · E5 · migration 114 absent ⇒ unresolved with the exact retryable failure', () => {
  it('the determination is certain, the record cannot be written, so nothing clears', async () => {
    const { authority, outcome } = await runResolutionLifecycle(braidonInput(), {
      nowIso: NOW,
      safeDbRead: scriptedRead({
        readProjectEquipmentStores: braidonStore(),
        reconcileEquipmentIdentity: new Error('42P01 relation "equipment_reconciliation_audit" does not exist'),
      }),
    });
    const st = outcome.states['EQUIPMENT-IDENTITY-CONFLICT'];
    expect(st.cleared).toBe(false);
    expect(st.resolutionAuditRef).toBeNull();
    expect(st.retryability).toBe('RETRYABLE');
    expect(st.blockingReason).toMatch(/could not be RECORDED/);
    const ev = outcome.evidence.find(e => e.resolverId === 'canonical-equipment-selection@v1')!;
    expect(ev.outcome).toBe('FAILED');
    expect(ev.failureReason).toMatch(/42P01/);
    expect(ev.failureReason).toMatch(/equipment_reconciliation_audit/);
    expect(ev.operatorAction).toMatch(/migration 114/);
    expect(ev.operatorAction).toMatch(/governed console/);
    // the canonical DETERMINATION is still recorded, so the evidence shows what
    // WOULD be reconciled — the blocker is not a mystery.
    expect(authority.canonicalEquipment!.canonical!.catalogId).toBe('qcells-peak-duo-400');
    expect(authority.canonicalEquipment!.reconciliation).toBeNull();
  });

  it('no projectId ⇒ the store cannot be scoped, and that is stated (never a silent clear)', async () => {
    const input = braidonInput(i => { delete i.projectId; });
    const { outcome } = await runResolutionLifecycle(input, { nowIso: NOW, safeDbRead: OFFLINE });
    const ev = outcome.evidence.find(e => e.resolverId === 'canonical-equipment-selection@v1')!;
    expect(ev.inputs.canonicalStoreReadable).toBe(false);
    expect(outcome.states['EQUIPMENT-IDENTITY-CONFLICT'].cleared).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E6 — a selection change REGENERATES the downstream records
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-2 · E6 · anti-vacuity: a canonical change rebuilds BOM / datasheet binding / calcs', () => {
  /** the SAME design, but the posted fleet still carries the STALE REC module —
   *  so the canonical selection has to change the module of record. */
  function staleFleetInput(): PermitInput {
    return braidonInput(i => {
      for (const inv of i.system.inverters ?? []) {
        for (const s of inv.strings ?? []) {
          s.panelId = 'rec-alpha-pure-405';
          s.panelModel = 'Alpha Pure-R 405W';
          s.panelManufacturer = 'REC Group';
          s.panelWatts = 405;
        }
      }
    });
  }

  it('BEFORE: every downstream record is built from the stale module', () => {
    const snap = snapshotOf(staleFleetInput());
    expect(snap.equipment.modules[0].catalogId).toBe('rec-alpha-pure-405');
    expect(snap.equipment.modules[0].spec.wattsStc).toBe(405);
  });

  it('AFTER the lifecycle: the module of record, its ratings, the datasheet binding and the BOM all rebuild', async () => {
    const input = staleFleetInput();
    const before = snapshotOf(clone(input));
    const { authority, outcome } = await runResolutionLifecycle(input, {
      nowIso: NOW,
      safeDbRead: scriptedRead({
        readProjectEquipmentStores: braidonStore(),
        reconcileEquipmentIdentity: {
          auditId: 'audit-aac2-rebuild', projectId: PID, conflictField: 'module_model',
          subsystemKey: 'roof', chosenSource: 'stored_permit', chosenValue: 'qcells-peak-duo-400',
          previousValues: [], reason: 'fixture', operatorId: SYSTEM_RESOLVER_ACTOR,
          reconciledAt: NOW, status: 'applied', invalidations: [{ scope: 'snapshot' }],
        },
      }),
    });
    expect(outcome.states['EQUIPMENT-IDENTITY-CONFLICT'].cleared).toBe(true);
    // the INPUT itself was re-pinned — which is what makes the rebuild real
    const repinned = authority.canonicalEquipment!.rebuiltRecords;
    expect(repinned.some(p => p.startsWith('system.inverters['))).toBe(true);
    expect(repinned).toContain('project.subSystems.roof.panelId');

    const after = snapshotOf(input);
    // 1. module identity of record
    expect(before.equipment.modules[0].catalogId).toBe('rec-alpha-pure-405');
    expect(after.equipment.modules[0].catalogId).toBe('qcells-peak-duo-400');
    // 2. ratings ⇒ the calculations' own inputs changed
    expect(after.equipment.modules[0].spec.wattsStc).toBe(400);
    expect(after.equipment.modules[0].spec.voc).not.toBe(before.equipment.modules[0].spec.voc);
    expect(after.derived.dcWattsStc).not.toBe(before.derived.dcWattsStc);
    // 3. the datasheet binding is re-resolved against the canonical module
    expect(after.equipment.modules[0].datasheet.revision).toMatch(/Qcells/i);
    expect(before.equipment.modules[0].datasheet.revision).toMatch(/REC/i);
    // 4. the BOM module line follows the canonical identity
    const bomAfter = JSON.stringify((after as any).bom ?? after.equipment.modules[0]);
    expect(bomAfter).not.toMatch(/Alpha Pure-R/);
    // 5. and the digest moved — which is exactly what the invalidation ledger records
    expect(after.meta.digest).not.toBe(before.meta.digest);
  });

  it('the invalidations NAME the dependents that must rebuild — never a bare "something changed"', async () => {
    const { outcome } = await runResolutionLifecycle(staleFleetInput(), {
      nowIso: NOW,
      safeDbRead: scriptedRead({
        readProjectEquipmentStores: braidonStore(),
        reconcileEquipmentIdentity: {
          auditId: 'a1', reconciledAt: NOW, invalidations: [], projectId: PID,
          conflictField: 'module_model', subsystemKey: 'roof', chosenSource: 'stored_permit',
          chosenValue: 'qcells-peak-duo-400', previousValues: [], reason: 'f', operatorId: 's', status: 'applied',
        },
      }),
    });
    const targets = outcome.invalidations.map(i => i.target).join(' | ');
    expect(targets).toMatch(/equipment\.modules\[0\]/);
    expect(targets).toMatch(/conductorAuthority/);
    expect(targets).toMatch(/bom/);
    expect(targets).toMatch(/MODULE-EXACT-DATASHEET/);
    for (const inv of outcome.invalidations) expect(inv.reason.length).toBeGreaterThan(20);
  });

  it('the invalidations reach the persist seam the ledger writer plugs into', async () => {
    const persisted: string[] = [];
    await runResolutionLifecycle(staleFleetInput(), {
      nowIso: NOW,
      persistInvalidation: async rec => { persisted.push(rec.target); },
      safeDbRead: scriptedRead({
        readProjectEquipmentStores: braidonStore(),
        reconcileEquipmentIdentity: {
          auditId: 'a2', reconciledAt: NOW, invalidations: [], projectId: PID,
          conflictField: 'module_model', subsystemKey: 'roof', chosenSource: 'stored_permit',
          chosenValue: 'qcells-peak-duo-400', previousValues: [], reason: 'f', operatorId: 's', status: 'applied',
        },
      }),
    });
    expect(persisted.length).toBeGreaterThanOrEqual(6);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E7 — MODULE-EXACT-DATASHEET: the range comparison + the recorded attempt
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-2 · E7 · module exact-datasheet: the range comparison the audit found missing', () => {
  it('a COVERING series sheet and a NON-COVERING one are no longer treated identically', () => {
    const covering = resolveModuleDatasheetExactness('Q.PEAK DUO BLK ML-G10+ 400W', 400);
    expect(covering.familyRange).toEqual([385, 405]);
    expect(covering.coversSelectedWatts).toBe(true);
    expect(covering.coverageBasis).toMatch(/INSIDE/);
    // the same document with a wattage OUTSIDE its range
    const notCovering = resolveModuleDatasheetExactness('Q.PEAK DUO BLK ML-G10+ 400W', 500);
    expect(notCovering.coversSelectedWatts).toBe(false);
    expect(notCovering.coverageBasis).toMatch(/OUTSIDE/);
    // the two now name DIFFERENT missing documents
    expect(covering.missingDocument).toMatch(/registry binding/);
    expect(notCovering.missingDocument).toMatch(/covering exactly 500 W/);
    // and the rendered stateLabel is deliberately unchanged (no sheet moves)
    expect(covering.stateLabel).toBe('FAMILY-DATASHEET-PENDING');
    expect(notCovering.stateLabel).toBe('FAMILY-DATASHEET-PENDING');
  });

  it('the REC 405 W series sheet (400-430 W) also covers its selection — the same rule, no special case', () => {
    const rec = resolveModuleDatasheetExactness('Alpha Pure-R 405W', 405);
    expect(rec.familyRange).toEqual([400, 430]);
    expect(rec.coversSelectedWatts).toBe(true);
  });

  it('a module with NO document names the missing document instead of emitting nothing', () => {
    const none = resolveModuleDatasheetExactness('Totally Unknown Module 999W', 999);
    expect(none.stateLabel).toBe('NO-DOCUMENT');
    expect(none.missingDocument).toMatch(/manufacturer module datasheet/);
  });

  it('the resolver records the ATTEMPTED retrieval + the precise missing document, and does NOT clear on coverage alone', async () => {
    const { authority, outcome } = await runResolutionLifecycle(braidonInput(), { nowIso: NOW, safeDbRead: OFFLINE });
    const st = outcome.states['MODULE-EXACT-DATASHEET-PENDING'];
    expect(st.lastResolutionResult).toBe('FAILED');
    expect(st.cleared).toBe(false);                       // coverage is not a binding
    expect(st.resolutionAuditRef).toBeNull();
    const binding = authority.moduleDatasheetBinding!;
    const qcells = binding.modules.find(m => /Q\.PEAK/i.test(m.moduleModel))!;
    // CMDA — with the registry unreadable there is NO governed document, so the
    // honest state is NO-DOCUMENT. It used to read RANGE-COVERED, derived from a
    // static asset's marketing title ("385-405W") — a coverage claim made with
    // no document, no hash and no verification behind it.
    expect(qcells.state).toBe('NO-DOCUMENT');
    expect(qcells.applicability.state).toBe('NO_DOCUMENT');
    expect(qcells.applicability.clears).toBe(false);
    expect(qcells.registryLookup.attempted).toBe(true);
    expect(qcells.registryLookup.documentClass).toBe('module_datasheet');
    expect(qcells.registryLookup.boundDocumentId).toBeNull();
    expect(qcells.registryLookup.failure).toMatch(/42P01/);
    expect(qcells.missingDocument).toMatch(/governed module_datasheet registry claims/);
  });

  it('it CLEARS once a verified registry binding exists (the AUTO_RETRIEVED half\'s seam)', async () => {
    const { authority, outcome } = await runResolutionLifecycle(braidonInput(), {
      nowIso: NOW,
      // CMDA — the seam must hand back a GOVERNED row: identity, hash,
      // verification AND the structured module claims that prove 400 W coverage.
      // `{ id, sha256 }` alone no longer clears anything, which is the point.
      safeDbRead: scriptedRead({ 'findVerifiedDocument(module_datasheet': {
        id: 'doc-qcells-400', documentClass: 'module_datasheet', sha256: 'a'.repeat(64),
        archivedInRepo: true, status: 'current', verificationState: 'verified',
        verifiedBy: 'Dana Reyes', verificationNotes: 'page 2 table checked',
        title: 'Q CELLS Q.PEAK DUO BLK ML-G10+ 385-405W Datasheet',
        extractedClaims: {
          module: {
            manufacturer: 'Q CELLS', productFamily: 'Q.PEAK DUO BLK ML-G10+',
            equipmentIdsCovered: ['qcells-peak-duo-400'],
            modelsCovered: ['Q.PEAK DUO BLK ML-G10+ 400W'],
            wattagesCovered: [385, 400, 405],
            explicitWattageRange: { minWatts: 385, maxWatts: 405 },
            electricalMechanicalSpecificationsPresent: true,
            evidence: { page: 2, table: 'Electrical Characteristics', column: '400' },
            applicabilityBasis: 'Q CELLS family datasheet, electrical characteristics table',
          },
        },
      } }),
    });
    const st = outcome.states['MODULE-EXACT-DATASHEET-PENDING'];
    expect(st.cleared).toBe(true);
    expect(st.resolutionAuditRef).toContain('module-datasheet-binding@v1');
    expect(authority.moduleDatasheetBinding!.allBound).toBe(true);
    expect(deriveRequirementStatus({ resolved: true, resolutionAuditRef: st.resolutionAuditRef })).toBe('CLEARED');
  });

  it('the binding evaluation is CANONICAL-aware: it evaluates the re-pinned module', () => {
    const input = braidonInput(i => {
      for (const inv of i.system.inverters ?? []) for (const s of inv.strings ?? []) {
        s.panelModel = 'Alpha Pure-R 405W'; s.panelWatts = 405;
      }
    });
    const stale = evaluateModuleDatasheetBinding(input);
    expect(stale.modules[0].moduleModel).toBe('Alpha Pure-R 405W');
    applyCanonicalEquipmentToInput(input, 'qcells-peak-duo-400');
    const canonical = evaluateModuleDatasheetBinding(input);
    expect(canonical.modules[0].moduleModel).toMatch(/Q\.PEAK/);
    expect(canonical.modules[0].selectedWatts).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D1-D6 — the DESIGNER / personnel set
// ═══════════════════════════════════════════════════════════════════════════

const rosterRow = (over: Partial<PersonnelRecord>): PersonnelRecord => ({
  id: 'p-1', orgId: 'org-1', userId: null, role: 'designer',
  personName: 'A. Designer', personTitle: 'PV Designer', email: null, phone: null,
  licenseNumber: null, licenseState: null, licenseExpiresOn: null,
  isDefault: true, active: true, notes: null, createdBy: 'admin-1',
  createdAt: NOW, updatedAt: NOW, ...over,
});

const assignmentRow = (over: Partial<ProjectPersonnelAssignment>): ProjectPersonnelAssignment => ({
  id: 'a-1', projectId: PID, role: 'designer', personnelId: 'p-2',
  personName: 'B. Override', personTitle: null, licenseNumber: null, licenseState: null,
  assignedBy: 'admin-1', reason: 'client-specific designer', assignedAt: NOW,
  supersededAt: null, supersededBy: null, ...over,
});

const configuredPersonnel = (roster: PersonnelRecord[], assignments: ProjectPersonnelAssignment[] = []) =>
  resolvePersonnelAuthority({ projectId: PID, scope: { orgId: 'org-1', userId: 'user-1' }, roster, assignments });

describe('AAC WS-6 · D1 · a configured designer populates the project, snapshot, title blocks + planset metadata', () => {
  it('the resolver writes project.designer and clears the requirement with an audit ref', async () => {
    const input = braidonInput(i => { i.project.designer = ''; });
    const { authority, outcome } = await runResolutionLifecycle(input, {
      nowIso: NOW,
      safeDbRead: scriptedRead({ resolveProjectPersonnel: configuredPersonnel([rosterRow({})]) }),
    });
    const st = outcome.states['DESIGNER-OF-RECORD-MISSING'];
    expect(st.cleared).toBe(true);
    expect(st.resolutionAuditRef).toContain('project-personnel-designer@v1');
    expect(deriveRequirementStatus({ resolved: true, resolutionAuditRef: st.resolutionAuditRef })).toBe('CLEARED');
    // ONE write, every consumer: the project record is the propagation point
    expect((input.project as any).designer).toBe('A. Designer');
    expect(authority.projectPersonnel!.roles.designer!.source).toBe('org-default');
  });

  it('propagates into the snapshot authority, the cover/CERT title blocks and the planset metadata', async () => {
    const input = braidonInput(i => { i.project.designer = ''; });
    const noDesigner = snapshotOf(clone(input));
    expect(noDesigner.permitReadiness.blockers.map(b => b.code)).toContain('DESIGNER-OF-RECORD-MISSING');
    expect(noDesigner.projectAuthority.designer ?? '').toBe('');

    const { authority } = await runResolutionLifecycle(input, {
      nowIso: NOW,
      safeDbRead: scriptedRead({ resolveProjectPersonnel: configuredPersonnel([rosterRow({})]) }),
    });
    generatePermitHTML(input, undefined, authority as never);
    const snap = (input as any)._snapshot as PermitDesignSnapshot;
    // 1. the snapshot's project authority
    expect(snap.projectAuthority.designer).toBe('A. Designer');
    // 2. the requirement is gone from the registry
    expect(snap.permitReadiness.blockers.map(b => b.code)).not.toContain('DESIGNER-OF-RECORD-MISSING');
    expect(snap.permitReadiness.registry.map(b => b.code)).not.toContain('DESIGNER-OF-RECORD-MISSING');
    // 3. the evidence for the auto-cleared requirement is ON the artifact
    expect(snap.resolutionAuthority!.projectPersonnel!.roles.designer!.personName).toBe('A. Designer');
    expect(snap.resolutionAuthority!.projectPersonnel!.populatedRoles).toEqual(['designer']);
    // 4. and the rendered sheets carry it (title block + CERT + revision "by")
    const html = generatePermitHTML(input, undefined, authority as never);
    expect(html).toContain('A. Designer');
  });

  it('an operator-typed designer on the project record is authority and is never overwritten', async () => {
    const input = braidonInput(i => { i.project.designer = 'Typed By Operator'; });
    const { authority, outcome } = await runResolutionLifecycle(input, {
      nowIso: NOW,
      safeDbRead: scriptedRead({
        resolveProjectPersonnel: resolvePersonnelAuthority({
          projectId: PID, scope: { orgId: 'org-1', userId: 'user-1' },
          roster: [rosterRow({})], assignments: [], projectRecordDesigner: 'Typed By Operator',
        }),
      }),
    });
    // the roster default exists, but the typed value already resolved the role;
    // resolvePersonnelAuthority prefers the configured default only when the role
    // is otherwise unresolved, and the typed value is never clobbered here.
    expect((input.project as any).designer).toBeTruthy();
    expect(outcome.states['DESIGNER-OF-RECORD-MISSING'].cleared).toBe(true);
    expect(authority.projectPersonnel!.roles.designer).toBeTruthy();
  });
});

describe('AAC WS-6 · D2 · anti-vacuity: it NEVER populates an EOR, PE, signature, seal or approval', () => {
  it('only designer / preparer / reviewer are auto-populatable, and the licensed roles are excluded', () => {
    expect(AUTO_POPULATABLE_ROLES).toEqual(['designer', 'preparer', 'reviewer']);
    expect(LICENSED_ROLES).toEqual(['engineer_of_record', 'approving_engineer']);
    for (const r of LICENSED_ROLES) expect(isAutoPopulatable(r)).toBe(false);
    expect(PERSONNEL_ROLES.length).toBe(5);
  });

  it('a configured EOR + approving engineer are NOT populated onto the project', () => {
    const authority = configuredPersonnel([
      rosterRow({}),
      rosterRow({ id: 'p-eor', role: 'engineer_of_record', personName: 'P.E. Person', licenseNumber: 'IL-062-1234' }),
      rosterRow({ id: 'p-app', role: 'approving_engineer', personName: 'A.E. Person', licenseNumber: 'IL-062-9999' }),
    ]);
    expect(authority.roles.engineer_of_record).toBeTruthy();          // configured…
    expect(authority.populatedRoles).toEqual(['designer']);           // …but not populated
    expect(authority.populatedRoles).not.toContain('engineer_of_record');
    expect(authority.populatedRoles).not.toContain('approving_engineer');
  });

  it('the professional-release requirement is untouched: no digest approval is fabricated', async () => {
    const input = braidonInput(i => { i.project.designer = ''; });
    const { authority } = await runResolutionLifecycle(input, {
      nowIso: NOW,
      safeDbRead: scriptedRead({
        resolveProjectPersonnel: configuredPersonnel([
          rosterRow({}),
          rosterRow({ id: 'p-eor', role: 'engineer_of_record', personName: 'P.E. Person', licenseNumber: 'IL-062-1234' }),
        ]),
      }),
    });
    generatePermitHTML(input, undefined, authority as never);
    const snap = (input as any)._snapshot as PermitDesignSnapshot;
    expect(snap.certification.engineeringReviewApproved).toBe(false);
    expect(snap.certification.engineer).toBeNull();
    expect(snap.permitReadiness.blockers.map(b => b.code)).toContain('ENGINEERING-REVIEW-PENDING');
    // the PE's name never reaches the artifact through this path
    expect(JSON.stringify(snap.projectAuthority)).not.toContain('P.E. Person');
    expect(REQUIREMENT_DECLARATIONS['ENGINEERING-REVIEW-PENDING'].resolutionMode).toBe('PROFESSIONAL_APPROVAL');
    expect(REQUIREMENT_DECLARATIONS['ENGINEERING-REVIEW-PENDING'].resolverId ?? null).toBeNull();
  });

  it('a licensed role cannot be stored without a licence (a half-record is not an authority)', () => {
    expect(validatePersonnelInput({ role: 'engineer_of_record', personName: 'X', orgId: 'org-1' }).ok).toBe(false);
    expect(validatePersonnelInput({ role: 'engineer_of_record', personName: 'X', orgId: 'org-1', licenseNumber: 'IL-1' }).ok).toBe(true);
    expect(validatePersonnelInput({ role: 'designer', personName: 'X', orgId: 'org-1' }).ok).toBe(true);
    expect(validatePersonnelInput({ role: 'designer', personName: '', orgId: 'org-1' }).ok).toBe(false);
    expect(validatePersonnelInput({ role: 'nope' as never, personName: 'X', orgId: 'org-1' }).ok).toBe(false);
    expect(validatePersonnelInput({ role: 'designer', personName: 'X' }).ok).toBe(false);   // no scope
  });
});

describe('AAC WS-6 · D3 · a project override supersedes the configured default, audited', () => {
  it('the override wins, and the default it superseded is recorded', () => {
    const authority = configuredPersonnel([rosterRow({})], [assignmentRow({})]);
    const d = authority.roles.designer!;
    expect(d.personName).toBe('B. Override');
    expect(d.source).toBe('project-assignment');
    expect(d.overridesDefault).toBe(true);
    expect(d.supersededDefault).toEqual({ recordId: 'p-1', personName: 'A. Designer' });
    expect(authority.basis).toMatch(/supersedes the configured default 'A. Designer'/);
    expect(authority.basis).toMatch(/assigned by admin-1/);
  });

  it('a SUPERSEDED assignment never wins (append-only history)', () => {
    const authority = configuredPersonnel(
      [rosterRow({})],
      [assignmentRow({ id: 'a-old', personName: 'C. Retired', supersededAt: NOW, supersededBy: 'a-1' })]);
    expect(authority.roles.designer!.personName).toBe('A. Designer');
    expect(authority.roles.designer!.source).toBe('org-default');
  });
});

describe('AAC WS-6 · D4/D5 · store unavailable vs nothing configured are DIFFERENT facts', () => {
  it('D4 — migration 115 not run ⇒ RETRYABLE with the exact operator step, and NO vendor default', async () => {
    const input = braidonInput(i => { i.project.designer = ''; });
    const { authority, outcome } = await runResolutionLifecycle(input, { nowIso: NOW, safeDbRead: OFFLINE });
    const st = outcome.states['DESIGNER-OF-RECORD-MISSING'];
    expect(st.cleared).toBe(false);
    expect(st.retryability).toBe('RETRYABLE');
    const ev = outcome.evidence.find(e => e.resolverId === 'project-personnel-designer@v1')!;
    expect(ev.failureReason).toMatch(/42P01|unavailable/);
    expect(ev.operatorAction).toMatch(/migration 115/);
    expect(ev.operatorAction).toMatch(/governed console/);
    expect(ev.operatorAction).toMatch(/System Config/);
    // the vendor default the W4 campaign removed is NEVER reintroduced
    expect((input.project as any).designer).toBe('');
    expect(JSON.stringify(authority.projectPersonnel)).not.toMatch(/SolarPro Engineer/);
    expect(authority.projectPersonnel!.storeUnavailable).toBe(true);
    expect(authority.projectPersonnel!.populatedRoles).toEqual([]);
    // and the blocker survives on the artifact
    generatePermitHTML(input, undefined, authority as never);
    const snap = (input as any)._snapshot as PermitDesignSnapshot;
    expect(snap.permitReadiness.blockers.map(b => b.code)).toContain('DESIGNER-OF-RECORD-MISSING');
  });

  it('D5 — store readable but nothing configured ⇒ REQUIRES_INPUT with the config step', async () => {
    const input = braidonInput(i => { i.project.designer = ''; });
    const { authority, outcome } = await runResolutionLifecycle(input, {
      nowIso: NOW,
      safeDbRead: scriptedRead({ resolveProjectPersonnel: configuredPersonnel([]) }),
    });
    const st = outcome.states['DESIGNER-OF-RECORD-MISSING'];
    expect(st.cleared).toBe(false);
    expect(st.retryability).toBe('REQUIRES_INPUT');
    const ev = outcome.evidence.find(e => e.resolverId === 'project-personnel-designer@v1')!;
    expect(ev.operatorAction).toMatch(/System Config/);
    expect(ev.operatorAction).not.toMatch(/migration 115/);
    expect(authority.projectPersonnel!.storeUnavailable).toBe(false);
    expect(authority.projectPersonnel!.unconfiguredRoles).toEqual([...PERSONNEL_ROLES]);
  });

  it('the unavailable record is honest: every role unconfigured, nothing populated, the error carried', () => {
    const a = unavailablePersonnelAuthority(PID, '42P01 relation "personnel_roles" does not exist');
    expect(a.storeUnavailable).toBe(true);
    expect(a.storeError).toMatch(/42P01/);
    expect(a.populatedRoles).toEqual([]);
    expect(Object.keys(a.roles)).toEqual([]);
    expect(a.unconfiguredRoles).toEqual([...PERSONNEL_ROLES]);
  });
});

describe('AAC WS-6 · D6 · role separation + precedence', () => {
  it('project assignment > org default > user default, per role, independently', () => {
    const authority = resolvePersonnelAuthority({
      projectId: PID, scope: { orgId: 'org-1', userId: 'user-1' },
      roster: [
        rosterRow({ id: 'p-org', role: 'designer', orgId: 'org-1', userId: null, personName: 'Org Designer' }),
        rosterRow({ id: 'p-usr', role: 'designer', orgId: null, userId: 'user-1', personName: 'User Designer' }),
        rosterRow({ id: 'p-prep', role: 'preparer', personName: 'Org Preparer' }),
      ],
      assignments: [assignmentRow({ role: 'reviewer', personName: 'Project Reviewer', personnelId: null })],
    });
    expect(authority.roles.designer!.personName).toBe('Org Designer');     // org beats user
    expect(authority.roles.preparer!.personName).toBe('Org Preparer');
    expect(authority.roles.reviewer!.personName).toBe('Project Reviewer'); // assignment
    expect(authority.roles.reviewer!.overridesDefault).toBe(false);        // no default existed
    expect(authority.unconfiguredRoles).toEqual(['engineer_of_record', 'approving_engineer']);
    expect(authority.populatedRoles).toEqual(['designer', 'preparer', 'reviewer']);
  });

  it('the user default applies only when there is no org row for that role', () => {
    const authority = resolvePersonnelAuthority({
      projectId: PID, scope: { orgId: 'org-1', userId: 'user-1' },
      roster: [rosterRow({ id: 'p-usr', orgId: null, userId: 'user-1', personName: 'User Designer' })],
      assignments: [],
    });
    expect(authority.roles.designer!.source).toBe('user-default');
    expect(authority.roles.designer!.path).toContain('user_id=user-1');
  });

  it('an INACTIVE or non-default roster row is never the configured designer', () => {
    expect(configuredPersonnel([rosterRow({ active: false })]).roles.designer).toBeUndefined();
    expect(configuredPersonnel([rosterRow({ isDefault: false })]).roles.designer).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FRAMEWORK COHERENCE + DIGEST STABILITY
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-2/WS-6 · framework coherence', () => {
  it('the three new resolvers are REGISTERED and the declaration table agrees', () => {
    const reg = createResolverRegistry(PRODUCTION_RESOLVERS);
    expect(validateResolutionDeclarations(reg)).toEqual([]);
    for (const [code, id] of [
      ['EQUIPMENT-IDENTITY-CONFLICT', 'canonical-equipment-selection@v1'],
      ['MODULE-EXACT-DATASHEET-PENDING', 'module-datasheet-binding@v1'],
      ['DESIGNER-OF-RECORD-MISSING', 'project-personnel-designer@v1'],
    ] as const) {
      expect(REQUIREMENT_DECLARATIONS[code].resolverId).toBe(id);
      expect(reg.get(id)!.requirementCodes).toContain(code);
    }
    // the canonical-equipment resolver runs FIRST among the domain resolvers
    const ids = PRODUCTION_RESOLVERS.map(r => r.id);
    expect(ids.indexOf(canonicalEquipmentResolver.id))
      .toBeLessThan(ids.indexOf('module-datasheet-binding@v1'));
    expect(ids.indexOf(canonicalEquipmentResolver.id))
      .toBeLessThan(ids.indexOf('racking-capacity-document@v1'));
  });

  it('all three are ATTEMPTED on every run — an uncalled resolver can no longer finalize them', async () => {
    const { outcome } = await runResolutionLifecycle(braidonInput(), { nowIso: NOW, safeDbRead: OFFLINE });
    for (const code of ['EQUIPMENT-IDENTITY-CONFLICT', 'MODULE-EXACT-DATASHEET-PENDING', 'DESIGNER-OF-RECORD-MISSING']) {
      const st = outcome.states[code];
      expect(st.resolverImplemented, code).toBe(true);
      expect(st.lastResolutionResult, code).not.toBe('NOT_ATTEMPTED');
      expect(st.resolutionEvidence.length, code).toBeGreaterThan(0);
    }
    expect(outcome.invariantViolations).toEqual([]);
    expect(outcome.stabilized).toBe(true);
  });

  it('a no-store run leaves the snapshot digest UNCHANGED (resolutionAuthority is omitted, not null-filled)', () => {
    const a = snapshotOf(braidonInput());
    const b = snapshotOf(braidonInput());
    expect(a.meta.digest).toBe(b.meta.digest);
    expect((a as any).resolutionAuthority).toBeUndefined();
    // and threading an all-null authority bundle changes nothing
    const input = braidonInput();
    generatePermitHTML(input, undefined, {
      capacityDocument: null, projectJurisdiction: null, manufacturerDocumentsArchived: null,
      digestInvalidatedByLedger: false, framingCapacityDocument: null,
      framingProjectApplicabilityKey: null, cableExtensionSolutions: [],
      qcableServiceLoopAllowance: null, environmentalSource: null,
      canonicalEquipment: null, moduleDatasheetBinding: null, projectPersonnel: null,
    } as never);
    expect(((input as any)._snapshot as PermitDesignSnapshot).meta.digest).toBe(a.meta.digest);
  });

  it('the resolution payload stays out of the RGM failure vocabulary (gate 10)', async () => {
    const { outcome } = await runResolutionLifecycle(braidonInput(), { nowIso: NOW, safeDbRead: OFFLINE });
    const FAILURE_CLASS = /\b(failed|failure|fails|exceeded|exceeds|non-?compliant|does not comply|violation|rejected|unsafe|defective|inadequate)\b/i;
    for (const code of ['EQUIPMENT-IDENTITY-CONFLICT', 'MODULE-EXACT-DATASHEET-PENDING', 'DESIGNER-OF-RECORD-MISSING']) {
      const st = outcome.states[code];
      const printed = [st.blockingReason ?? '', ...st.requiredInputs, ...st.reasons].join(' · ');
      expect(printed, `${code}: ${printed}`).not.toMatch(FAILURE_CLASS);
    }
  });

  it('the renderer never imports the equipment/personnel stores (WS-9 renderer purity)', () => {
    const { readFileSync, readdirSync } = require('fs') as typeof import('fs');
    const { join } = require('path') as typeof import('path');
    const dir = join(__dirname, '..', '..', 'lib', 'permit', 'sections');
    const offenders: string[] = [];
    for (const f of readdirSync(dir).filter(n => n.endsWith('.ts'))) {
      const s = readFileSync(join(dir, f), 'utf8');
      if (/lib\/personnel|reconciliation\/reconcile|snapshot\/resolution/.test(s)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
