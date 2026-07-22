import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the DB layer BEFORE importing the modules under test.
const mockState: { sql: any } = { sql: null };
vi.mock('@/lib/db/core', () => ({ getDbReady: async () => mockState.sql }));

import {
  validateReconciliationRequest,
  previousValuesOf,
  reconcileEquipmentIdentity,
} from '@/lib/reconciliation/reconcile';
import { detectConflictFromSources, collectModuleConflicts } from '@/lib/reconciliation/conflicts';
import type { ReconciliationRequest } from '@/lib/reconciliation/types';

const baseReq: ReconciliationRequest = {
  projectId: 'proj-1',
  conflictField: 'module_model',
  subsystemKey: 'roof',
  sources: [
    { source: 'subsystem_panel_id', value: 'rec-alpha-pure-405', label: 'REC Alpha 405', provenance: 'subSystems.roof.panelId' },
    { source: 'fleet', value: 'qcell-qpeak-400', label: 'Q.PEAK 400', provenance: 'fleet' },
  ],
  chosenSource: 'fleet',
  reason: 'fleet strings are the as-built modules; subsystem map is stale',
  operatorId: 'op-1',
  operatorName: 'Operator One',
};

describe('W4 §7 — reconciliation request validation (selection + reason REQUIRED)', () => {
  it('accepts a well-formed request', () => expect(validateReconciliationRequest(baseReq).ok).toBe(true));
  it('rejects a missing reason', () => expect(validateReconciliationRequest({ ...baseReq, reason: '' }).ok).toBe(false));
  it('rejects a too-short reason', () => expect(validateReconciliationRequest({ ...baseReq, reason: 'x' }).ok).toBe(false));
  it('rejects a missing chosenSource', () => expect(validateReconciliationRequest({ ...baseReq, chosenSource: '' as any }).ok).toBe(false));
  it('rejects a chosenSource not among the presented sources', () =>
    expect(validateReconciliationRequest({ ...baseReq, chosenSource: 'rendered' }).ok).toBe(false));
  it('rejects fewer than two sources', () =>
    expect(validateReconciliationRequest({ ...baseReq, sources: [baseReq.sources[0]] }).ok).toBe(false));
  it('rejects choosing a null-valued source', () =>
    expect(validateReconciliationRequest({
      ...baseReq, chosenSource: 'design',
      sources: [...baseReq.sources, { source: 'design', value: null, provenance: 'd' }],
    }).ok).toBe(false));

  it('previousValuesOf preserves every non-winning source', () => {
    const prev = previousValuesOf(baseReq);
    expect(prev.map(p => p.source)).toEqual(['subsystem_panel_id']);
  });
});

describe('W4 §7 — conflict detection surface', () => {
  it('flags a conflict only when >= 2 distinct non-null values', () => {
    expect(detectConflictFromSources('module_model', 'roof', baseReq.sources)).not.toBeNull();
    const agree = [
      { source: 'fleet' as const, value: 'x', provenance: 'a' },
      { source: 'design' as const, value: 'x', provenance: 'b' },
    ];
    expect(detectConflictFromSources('module_model', 'roof', agree)).toBeNull();
  });

  it('collectModuleConflicts surfaces a subsystem panelId vs fleet divergence', () => {
    const conflicts = collectModuleConflicts({
      subSystems: { roof: { panelId: 'some-unknown-panel-id' } },
      fleetModuleCatalogId: 'qcell-qpeak-400', fleetModuleLabel: 'Q.PEAK 400',
    });
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].distinctValues.length).toBeGreaterThanOrEqual(2);
  });

  it('no conflict when there is no subsystem panelId', () => {
    expect(collectModuleConflicts({ subSystems: { roof: {} }, fleetModuleCatalogId: 'x' })).toHaveLength(0);
  });
});

// ── Transactional reconcile with a mocked neon sql ──
function makeFakeSql(projectRow: any | null) {
  const captured: { text: string; values: any[] }[] = [];
  const tag = (record: typeof captured) =>
    (strings: TemplateStringsArray, ...values: any[]) => {
      const text = strings.join(' ? ');
      record.push({ text, values });
      // The SELECT selected_equipment returns the project row.
      if (/SELECT\s+selected_equipment/i.test(text)) return Promise.resolve(projectRow ? [projectRow] : []);
      return Promise.resolve([]);
    };
  const sql: any = tag(captured);
  sql.transaction = (cb: (txn: any) => any[]) => {
    const txnCaptured = captured; // record txn queries into the same array
    const txn = tag(txnCaptured);
    const qs = cb(txn);
    return Promise.all(qs);
  };
  sql.__captured = captured;
  return sql;
}

describe('W4 §7 — reconcileEquipmentIdentity (audit + canonical update + invalidation)', () => {
  beforeEach(() => { mockState.sql = makeFakeSql({ selected_equipment: { panelId: 'rec-alpha-pure-405' } }); });

  it('writes an audit row, updates canonical selected_equipment, records 2 invalidations', async () => {
    const result = await reconcileEquipmentIdentity(baseReq, { digest: 'digest-abc', snapshotId: 'PDS-1' });
    expect(result.status).toBe('applied');
    expect(result.chosenValue).toBe('qcell-qpeak-400');
    expect(result.previousValues.map(p => p.source)).toEqual(['subsystem_panel_id']);
    expect(result.invalidations).toHaveLength(2);

    const cap: { text: string; values: any[] }[] = mockState.sql.__captured;
    const texts = cap.map(c => c.text).join('\n');
    expect(texts).toMatch(/INSERT INTO equipment_reconciliation_audit/i);
    expect(texts).toMatch(/UPDATE projects/i);
    expect((texts.match(/INSERT INTO snapshot_digest_invalidations/gi) || []).length).toBe(2);

    // the winning value is merged into the canonical selected_equipment update
    const upd = cap.find(c => /UPDATE projects/i.test(c.text))!;
    expect(JSON.stringify(upd.values)).toContain('qcell-qpeak-400');
    // invalidations carry the supplied digest + scopes
    const invRows = cap.filter(c => /snapshot_digest_invalidations/i.test(c.text));
    expect(JSON.stringify(invRows.map(r => r.values))).toContain('digest-abc');
    expect(JSON.stringify(invRows.map(r => r.values))).toContain('engineering_approval');
  });

  it('refuses (throws) without a reason — no rows written', async () => {
    await expect(reconcileEquipmentIdentity({ ...baseReq, reason: '' })).rejects.toThrow(/reason/i);
  });

  it('throws when the project does not exist', async () => {
    mockState.sql = makeFakeSql(null);
    await expect(reconcileEquipmentIdentity(baseReq)).rejects.toThrow(/not found/i);
  });
});
