// ============================================================================
// Wave 1 — Contract & tag survival (docs/ARCHITECTURE-per-subsystem-equipment.md)
//
// Pins the §1.2 SubSystemEquipment shape, the §1.5 legacy-collapse rule
// (ensureSubSystemShape — the ONE idempotent helper for every hydration
// boundary), and §1.1 tag inheritance (untagged strings inherit the parent
// inverter's key). Storage-layer behavior (schemaVersion 2, deep-merge
// upsert, mirror derivation — Wave 1b) is NOT covered here.
//
// Determinism rule: injectable clock (opts.now) — no live Date.now assertions.
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  ensureSubSystemShape,
  synthesizeFromLegacyScalars,
  toSubSystemKey,
  isSubSystemKey,
  SUB_SYSTEM_KEYS,
  type SubSystemEquipment,
  type LegacyScalarConfig,
} from '../../lib/system/subSystemEquipment';
// Contract §1.1: subSystems.ts is the permit-side import path — the re-export
// must expose the same runtime helpers + types.
import {
  ensureSubSystemShape as ensureViaPermitPath,
  isSubSystemKey as isKeyViaPermitPath,
  type SubSystemKey,
} from '../../lib/permit/utils/subSystems';
import { normalizeRawInverter } from '../../lib/system/buildInverterConfig';

const NOW = () => '2026-07-11T00:00:00.000Z';

/** A legacy ROOF config as saved pre-contract: flat scalars, no map, no tags. */
function legacyRoofConfig() {
  return {
    systemType: 'roof',
    inverters: [{
      id: 'inv-1', inverterId: 'fronius-primo-8.2', type: 'string',
      strings: [
        { id: 's1', label: 'String 1', panelCount: 10, panelId: 'tesla-tsp-420' },
        { id: 's2', label: 'String 2', panelCount: 10, panelId: 'tesla-tsp-420' },
      ],
    }],
    mountingId: 'ironridge-xr100',
    batteryId: 'tesla-powerwall-3',
    batteryCount: 2,
    batteryKwh: 13.5,            // legacy PER-UNIT kWh
    roofType: 'shingle',
    conduitType: 'EMT',
    wireLength: 60,
    selectedBrand: 'enphase',
    mainPanelAmps: 200,          // untouched legacy passenger field
  };
}

/** A saved FENCE-ONLY config (SolFence optimizer) — must NEVER collapse to roof. */
function legacyFenceConfig() {
  return {
    systemType: 'fence',
    inverters: [{
      id: 'inv-f1', inverterId: 'solaredge-se7600h', type: 'optimizer',
      optimizerPeripheralId: 'se-p505',
      strings: [{ id: 's1', label: 'String 1', panelCount: 12, panelId: 'nexus-ps-mnb108-440w' }],
    }],
    mountingId: 'solfence-8ft',
    trenchRunLengthFt: 85,
    roofType: 'shingle',         // stale legacy scalar — must NOT leak into a fence entry
    conduitType: 'PVC Sch 40',
    wireLength: 120,
  } as LegacyScalarConfig;
}

// ─── §1.5 legacy collapse ────────────────────────────────────────────────────

describe('Wave 1 — ensureSubSystemShape (§1.5 legacy collapse)', () => {
  it('legacy roof config → single roof entry synthesized from flat scalars', () => {
    const out = ensureSubSystemShape(legacyRoofConfig(), { now: NOW });
    expect(Object.keys(out.subSystems)).toEqual(['roof']);
    const roof = out.subSystems.roof!;
    expect(roof).toEqual({
      key: 'roof',
      panelId: 'tesla-tsp-420',
      inverterId: 'fronius-primo-8.2',
      topology: 'string',
      ecosystemBrand: 'enphase',
      mountingId: 'ironridge-xr100',
      batteryId: 'tesla-powerwall-3',
      batteryCount: 2,
      batteryKwhPerUnit: 13.5,   // legacy batteryKwh is per-unit — carried 1:1
      roofType: 'shingle',
      env: { rooftopTempAdderC: 30, conduitType: 'EMT', wireLengthFt: 60 },
      source: 'migration',
      updatedAt: NOW(),
    });
  });

  it('fence-typed config → fence entry, NOT roof (I-8: no silent collapse)', () => {
    const out = ensureSubSystemShape(legacyFenceConfig(), { now: NOW });
    expect(Object.keys(out.subSystems)).toEqual(['fence']);
    expect(out.subSystems.roof).toBeUndefined();
    const fence = out.subSystems.fence!;
    expect(fence.key).toBe('fence');
    expect(fence.topology).toBe('optimizer');          // from ITS OWN inverter (I-3)
    expect(fence.optimizerId).toBe('se-p505');
    expect(fence.mountingId).toBe('solfence-8ft');
    expect(fence.trenchRunLengthFt).toBe(85);
    expect(fence.roofType).toBeUndefined();            // roof-only field never leaks
    expect(fence.env?.rooftopTempAdderC).toBe(0);      // 30 roof / 0 ground+fence (I-7)
    // Inverter + string tags inherit config.systemType — never bare 'roof'.
    expect(out.inverters![0].subSystemKey).toBe('fence');
    expect(out.inverters![0].strings![0].subSystemKey).toBe('fence');
  });

  it('canonical spellings normalize: solar_fence → fence, ground_mount → ground', () => {
    expect(toSubSystemKey('solar_fence')).toBe('fence');
    expect(toSubSystemKey('ground_mount')).toBe('ground');
    const out = ensureSubSystemShape({ ...legacyFenceConfig(), systemType: 'solar_fence' }, { now: NOW });
    expect(Object.keys(out.subSystems)).toEqual(['fence']);
  });

  it('no config.systemType → cad.systemType fallback wins; bare roof only as last resort', () => {
    const cfg = { ...legacyRoofConfig(), systemType: undefined as string | undefined };
    const viaCad = ensureSubSystemShape(cfg, { cadSystemType: 'ground_mount', now: NOW });
    expect(Object.keys(viaCad.subSystems)).toEqual(['ground']);
    expect(viaCad.subSystems.ground!.trenchRunLengthFt).toBeUndefined();
    expect(viaCad.subSystems.ground!.env?.rooftopTempAdderC).toBe(0);
    const lastResort = ensureSubSystemShape(cfg, { now: NOW });
    expect(Object.keys(lastResort.subSystems)).toEqual(['roof']);
  });

  it('existing map passes through untouched (equipment authority survives)', () => {
    const storedMap = {
      fence: {
        key: 'fence' as const, panelId: 'nexus-ps-mnb108-440w',
        inverterId: 'solaredge-se7600h', topology: 'optimizer' as const,
        source: 'engineering' as const, updatedAt: '2026-07-01T00:00:00.000Z',
      },
    };
    // Contradictory legacy scalars must NOT overwrite the stored map (§1.1:
    // the map is the equipment authority).
    const cfg = { ...legacyRoofConfig(), systemType: 'fence', subSystems: storedMap };
    const out = ensureSubSystemShape(cfg, { now: NOW });
    expect(out.subSystems).toEqual(storedMap);
  });

  it('an EMPTY subSystems map is treated as absent (degenerate write cannot erase the project)', () => {
    const out = ensureSubSystemShape({ ...legacyFenceConfig(), subSystems: {} }, { now: NOW });
    expect(Object.keys(out.subSystems)).toEqual(['fence']);
  });

  it('is idempotent: f(f(x)) deep-equals f(x)', () => {
    for (const cfg of [legacyRoofConfig(), legacyFenceConfig()]) {
      const once = ensureSubSystemShape(cfg, { now: NOW });
      const twice = ensureSubSystemShape(once, { now: () => '2099-01-01T00:00:00.000Z' });
      // Second pass takes the map-passthrough branch — no re-synthesis, no
      // new timestamp, no tag churn.
      expect(twice).toEqual(once);
    }
  });

  it('is pure: the input object is never mutated', () => {
    const cfg = legacyFenceConfig();
    const snapshot = JSON.parse(JSON.stringify(cfg));
    ensureSubSystemShape(cfg, { now: NOW });
    expect(cfg).toEqual(snapshot);
  });

  it('serialization is a SUPERSET of the legacy shape (every legacy reader sees identical values)', () => {
    const cfg = legacyRoofConfig();
    const out = JSON.parse(JSON.stringify(ensureSubSystemShape(cfg, { now: NOW })));
    // Every input key/value survives verbatim (toMatchObject = recursive
    // subset check, including per-inverter/per-string legacy fields).
    expect(out).toMatchObject(JSON.parse(JSON.stringify(cfg)));
    // Only additive fields appear at the top level.
    const added = Object.keys(out).filter(k => !(k in cfg));
    expect(added).toEqual(['subSystems']);
  });

  it('is exported via the permit-side path (lib/permit/utils/subSystems re-export)', () => {
    expect(ensureViaPermitPath).toBe(ensureSubSystemShape);
    expect(isKeyViaPermitPath).toBe(isSubSystemKey);
    const k: SubSystemKey = 'ground'; // type re-export compiles
    expect(SUB_SYSTEM_KEYS).toContain(k);
  });
});

// ─── §1.1 tag inheritance through the normalizer whitelist ───────────────────

describe('Wave 1 — tag inheritance (untagged string under tagged inverter)', () => {
  it('normalizeRawInverter: untagged strings inherit the parent inverter key', () => {
    const out = normalizeRawInverter({
      id: 'inv-g1', inverterId: 'solis-s6', type: 'string', subSystemKey: 'ground',
      strings: [{ id: 's1', label: 'String 1', panelCount: 9, panelId: 'tesla-tsp-420' }],
    });
    expect(out.subSystemKey).toBe('ground');
    expect(out.strings[0].subSystemKey).toBe('ground');
  });

  it('normalizeRawInverter: a string\'s OWN tag wins over the parent tag', () => {
    const out = normalizeRawInverter({
      id: 'inv-1', inverterId: 'solis-s6', type: 'string', subSystemKey: 'ground',
      strings: [
        { id: 's1', panelCount: 9, subSystemKey: 'fence' },
        { id: 's2', panelCount: 9 },
      ],
    });
    expect(out.strings[0].subSystemKey).toBe('fence');
    expect(out.strings[1].subSystemKey).toBe('ground');
  });

  it('untagged inverters stay untagged through the normalizer (no invented roof default — I-8)', () => {
    const out = normalizeRawInverter({
      id: 'inv-1', inverterId: 'fronius-primo-8.2', type: 'string',
      strings: [{ id: 's1', panelCount: 10 }],
    });
    expect(out.subSystemKey).toBeUndefined();
    expect(out.strings[0].subSystemKey).toBeUndefined();
  });
});

// ─── §1.2 SubSystemEquipment shape lint ──────────────────────────────────────

describe('Wave 1 — SubSystemEquipment shape (§1.2)', () => {
  it('synthesized entries use batteryKwhPerUnit — batteryKwh must NOT exist on the record', () => {
    const entry = synthesizeFromLegacyScalars(legacyRoofConfig() as LegacyScalarConfig, 'roof', NOW());
    expect(entry.batteryKwhPerUnit).toBe(13.5);
    expect('batteryKwh' in entry).toBe(false);
    expect(Object.keys(entry)).not.toContain('batteryKwh');
  });

  it('compile-time lint: the type rejects a batteryKwh field', () => {
    const ok: SubSystemEquipment = {
      key: 'roof', batteryKwhPerUnit: 5, source: 'defaults', updatedAt: NOW(),
    };
    expect(ok.batteryKwhPerUnit).toBe(5);
    // If someone ever re-adds `batteryKwh` to SubSystemEquipment, this
    // directive becomes unused and `tsc --noEmit` fails the build.
    const bad: SubSystemEquipment = {
      key: 'roof',
      // @ts-expect-error — batteryKwh is structurally banned (§1.2 rename)
      batteryKwh: 5,
      source: 'defaults',
      updatedAt: NOW(),
    };
    expect(bad).toBeTruthy();
  });

  it('no-equipment subsystems are representable (a fence drawn before equipment is picked)', () => {
    const bare: SubSystemEquipment = { key: 'fence', source: 'design', updatedAt: NOW() };
    expect(bare.panelId).toBeUndefined();
    expect(bare.inverterId).toBeUndefined();
  });
});
