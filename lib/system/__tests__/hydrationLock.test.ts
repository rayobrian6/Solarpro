// ============================================================
// Tests — v61.4 Hydration Lock
// ============================================================
// Run with: npx jest lib/system/__tests__/hydrationLock.test.ts

import {
  buildStringConfig,
  buildInverterConfig,
  normalizeRawInverter,
  normalizeInverterConfig,
  assertValidInverter,
  validateInverterMetadata,
} from '../buildInverterConfig';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a healthy InverterConfig with N strings of M panels each. */
function makeHealthy(stringCount: number, panelCount: number) {
  const strings = Array.from({ length: stringCount }, (_, i) =>
    buildStringConfig({ index: i, panelCount }),
  );
  return buildInverterConfig({ inverterId: 'inv-test', type: 'string', strings });
}

/** Build a raw legacy object that bypasses the builder. */
function makeLegacyRaw(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-legacy-0',
    inverterId: 'solaredge-se7600h',
    type: 'string',
    strings: [
      { id: 'str-0', panelCount: 11 },
      { id: 'str-1', panelCount: 11 },
    ],
    // Intentionally stale/missing metadata to simulate pre-builder configs
    ...overrides,
  };
}

// ── normalizeRawInverter ──────────────────────────────────────────────────────

describe('normalizeRawInverter', () => {
  it('repairs a legacy object with no metadata', () => {
    const raw = makeLegacyRaw();
    const inv = normalizeRawInverter(raw);

    expect(inv.stringsPerInverter).toBe(2);
    expect(inv.modulesPerString).toBe(11);
    expect(inv.strings).toHaveLength(2);
    expect(inv.strings[0].panelCount).toBe(11);
    expect(inv.strings[1].panelCount).toBe(11);
  });

  it('repairs metadata when stringsPerInverter is stale (Nx1 bug)', () => {
    // N strings with 1 panel each — metadata still says stringsPerInverter=1
    const raw = makeLegacyRaw({
      strings: Array.from({ length: 8 }, (_, i) => ({ id: `str-${i}`, panelCount: 1 })),
      stringsPerInverter: 1,  // stale
      modulesPerString: 1,
    });
    const inv = normalizeRawInverter(raw);

    // After normalization: 8 strings, each with panelCount=1; metadata must reflect reality
    expect(inv.stringsPerInverter).toBe(8);
    expect(inv.strings).toHaveLength(8);
    expect(inv.modulesPerString).toBe(1);
  });

  it('repairs metadata for 1xN bug (single over-sized string)', () => {
    // 1 string with panelCount=44 — modulesPerString should be 44
    const raw = makeLegacyRaw({
      strings: [{ id: 'str-0', panelCount: 44 }],
      stringsPerInverter: 1,
      modulesPerString: 10,  // stale
    });
    const inv = normalizeRawInverter(raw);

    expect(inv.stringsPerInverter).toBe(1);
    expect(inv.modulesPerString).toBe(44);
    expect(inv.strings[0].panelCount).toBe(44);
  });

  it('synthesizes a minimal string when strings array is empty', () => {
    const raw: Record<string, unknown> = {
      id: 'inv-no-strings',
      inverterId: 'inv-x',
      type: 'string',
      strings: [],
      modulesPerString: 12,
    };
    const inv = normalizeRawInverter(raw);

    expect(inv.strings).toHaveLength(1);
    expect(inv.strings[0].panelCount).toBe(12);
    expect(inv.stringsPerInverter).toBe(1);
    expect(inv.modulesPerString).toBe(12);
  });

  it('synthesizes a minimal string using panelCount fallback when modulesPerString is absent', () => {
    const raw: Record<string, unknown> = {
      id: 'inv-bare',
      inverterId: 'inv-y',
      type: 'string',
      strings: [],
      panelCount: 10,
    };
    const inv = normalizeRawInverter(raw);

    expect(inv.strings).toHaveLength(1);
    expect(inv.strings[0].panelCount).toBe(10);
  });

  it('does not synthesize a single-string with panelCount=1 unless that is the actual data', () => {
    // If raw has valid strings already, don't collapse them to a single string
    const raw = makeLegacyRaw({
      strings: [
        { id: 'str-0', panelCount: 11 },
        { id: 'str-1', panelCount: 11 },
        { id: 'str-2', panelCount: 11 },
      ],
    });
    const inv = normalizeRawInverter(raw);

    // Must keep all 3 strings — never collapse to single string
    expect(inv.strings).toHaveLength(3);
    expect(inv.stringsPerInverter).toBe(3);
  });

  it('is idempotent — normalizing twice produces same result', () => {
    const raw = makeLegacyRaw();
    const once = normalizeRawInverter(raw);
    // normalizeRawInverter takes Record<string,unknown>; cast the result back
    const twice = normalizeRawInverter(once as unknown as Record<string, unknown>);

    expect(twice.stringsPerInverter).toBe(once.stringsPerInverter);
    expect(twice.modulesPerString).toBe(once.modulesPerString);
    expect(twice.strings).toHaveLength(once.strings.length);
    twice.strings.forEach((s, i) => {
      expect(s.panelCount).toBe(once.strings[i].panelCount);
    });
  });

  it('preserves existing inverterId and id when present', () => {
    const raw = makeLegacyRaw({ id: 'inv-keep-me', inverterId: 'se7600h' });
    const inv = normalizeRawInverter(raw);
    expect(inv.id).toBe('inv-keep-me');
    expect(inv.inverterId).toBe('se7600h');
  });
});

// ── normalizeInverterConfig ───────────────────────────────────────────────────

describe('normalizeInverterConfig', () => {
  it('normalizes all inverters in config.inverters', () => {
    const config = {
      selectedBrand: 'solaredge',
      inverters: [
        makeLegacyRaw({ strings: [{ id: 'a', panelCount: 10 }, { id: 'b', panelCount: 10 }] }),
        makeLegacyRaw({ strings: [{ id: 'c', panelCount: 12 }], stringsPerInverter: 99 }),
      ],
    };

    const result = normalizeInverterConfig(config);

    expect(result.inverters[0].stringsPerInverter).toBe(2);
    expect(result.inverters[1].stringsPerInverter).toBe(1);
    expect(result.inverters[1].modulesPerString).toBe(12);
    // Other config fields preserved
    expect(result.selectedBrand).toBe('solaredge');
  });

  it('is a no-op when inverters is empty', () => {
    const config = { inverters: [], selectedBrand: 'sunpower' };
    const result = normalizeInverterConfig(config);
    expect(result).toBe(config); // same reference — no allocation
  });

  it('is a no-op when inverters is absent', () => {
    const config = { selectedBrand: 'sunpower' };
    const result = normalizeInverterConfig(config as any);
    expect(result).toBe(config);
  });

  it('is idempotent — normalizing a healthy config returns equivalent data', () => {
    const healthy = makeHealthy(3, 11);
    const config = { inverters: [healthy] };

    const once = normalizeInverterConfig(config);
    const twice = normalizeInverterConfig(once);

    expect(twice.inverters[0].stringsPerInverter).toBe(3);
    expect(twice.inverters[0].modulesPerString).toBe(11);
    expect(twice.inverters[0].strings).toHaveLength(3);
  });

  it('auto-heals a config with stale stringsPerInverter metadata', () => {
    // Simulate a DB record where stringsPerInverter was never saved correctly
    const stale = {
      id: 'inv-stale',
      inverterId: 'fronius-primo',
      type: 'string' as const,
      strings: [
        buildStringConfig({ index: 0, panelCount: 13 }),
        buildStringConfig({ index: 1, panelCount: 13 }),
        buildStringConfig({ index: 2, panelCount: 13 }),
      ],
      stringsPerInverter: 1,   // stale — was never updated
      modulesPerString: 13,
    };
    const config = { inverters: [stale] };
    const result = normalizeInverterConfig(config);

    expect(result.inverters[0].stringsPerInverter).toBe(3);
    expect(result.inverters[0].strings).toHaveLength(3);
  });

  it('auto-heals a config with missing modulesPerString', () => {
    const inv = {
      id: 'inv-no-mps',
      inverterId: 'enphase-iq8',
      type: 'micro' as const,
      strings: [buildStringConfig({ index: 0, panelCount: 24 })],
      stringsPerInverter: 1,
      // modulesPerString intentionally absent
    };
    const config = { inverters: [inv] };
    const result = normalizeInverterConfig(config);

    expect(result.inverters[0].modulesPerString).toBe(24);
    expect(result.inverters[0].stringsPerInverter).toBe(1);
  });
});

// ── assertValidInverter ───────────────────────────────────────────────────────
// Note: assertValidInverter throws in NODE_ENV=development, logs in test/prod.
// In Jest (NODE_ENV=test) we verify it calls console.error on violation.

describe('assertValidInverter', () => {
  it('does not throw and does not log for a healthy InverterConfig', () => {
    const inv = makeHealthy(2, 12);
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => assertValidInverter(inv)).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('calls console.error when stringsPerInverter disagrees with strings.length', () => {
    const inv = {
      ...makeHealthy(2, 12),
      stringsPerInverter: 5, // wrong
    };
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    // In test env: logs, does not throw
    expect(() => assertValidInverter(inv, 'test context')).not.toThrow();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('stringsPerInverter'));
    spy.mockRestore();
  });

  it('calls console.error when modulesPerString is zero', () => {
    const inv = {
      ...makeHealthy(2, 12),
      modulesPerString: 0, // wrong
    };
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => assertValidInverter(inv, 'test context')).not.toThrow();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('modulesPerString'));
    spy.mockRestore();
  });
});

// ── Builder invariants preserved after hydration ──────────────────────────────

describe('builder invariants after hydration', () => {
  it('validateInverterMetadata passes on normalized output', () => {
    const raw = makeLegacyRaw({
      strings: [{ id: 'a', panelCount: 11 }, { id: 'b', panelCount: 11 }],
      stringsPerInverter: 99,  // stale
      modulesPerString: 5,     // stale
    });
    const inv = normalizeRawInverter(raw);
    const violations = validateInverterMetadata(inv);

    expect(violations).toHaveLength(0);
  });

  it('validateInverterMetadata passes on all inverters after normalizeInverterConfig', () => {
    const config = {
      inverters: [
        makeLegacyRaw({ strings: [{ panelCount: 10 }, { panelCount: 10 }], stringsPerInverter: 1 }),
        makeLegacyRaw({ strings: [{ panelCount: 12 }], modulesPerString: 99 }),
      ],
    };
    const result = normalizeInverterConfig(config);

    result.inverters.forEach((inv, i) => {
      const violations = validateInverterMetadata(inv);
      expect(violations).toHaveLength(0);
    });
  });

  it('healthy config passes assertion after double normalize', () => {
    const config = { inverters: [makeHealthy(4, 10)] };
    const normalized = normalizeInverterConfig(normalizeInverterConfig(config));
    expect(() => assertValidInverter(normalized.inverters[0])).not.toThrow();
  });

  it('no single-string fallback used when multi-string data exists', () => {
    // Ensure normalizeRawInverter never collapses multi-string data to 1 string
    const multiStringRaw = makeLegacyRaw({
      strings: [
        { id: 's0', panelCount: 11 },
        { id: 's1', panelCount: 11 },
        { id: 's2', panelCount: 11 },
        { id: 's3', panelCount: 11 },
      ],
      stringsPerInverter: 1, // stale
    });
    const inv = normalizeRawInverter(multiStringRaw);

    expect(inv.strings.length).toBe(4);
    expect(inv.stringsPerInverter).toBe(4);
  });
});

// ── Mutation path invariants (v61.5) ─────────────────────────────────────────
// These tests verify the builder-at-exit-point pattern used in
// updateInverter / addString / removeString / updateString.

describe('mutation path invariants (v61.5)', () => {
  /**
   * Simulates the updateInverter exit point:
   *   _buildInvCfg({ existingId, inverterId, type, strings, ... })
   * When a patch changes inverterId (ecosystem apply), metadata must reflect
   * the new state, not the stale pre-patch metadata.
   */
  it('inverterId change preserves strings and recomputes metadata', () => {
    const original = makeHealthy(3, 11); // 3 strings × 11 panels
    // Simulate patch: change inverterId only (ecosystem apply)
    const patched = buildInverterConfig({
      existingId: original.id,
      inverterId: 'new-inverter-id',
      type:       original.type,
      strings:    original.strings,
    });

    expect(patched.inverterId).toBe('new-inverter-id');
    expect(patched.stringsPerInverter).toBe(3);    // metadata recomputed
    expect(patched.modulesPerString).toBe(11);      // metadata recomputed
    expect(patched.strings).toHaveLength(3);        // strings preserved
  });

  it('adding a string recomputes stringsPerInverter', () => {
    const original = makeHealthy(2, 12); // 2 strings × 12 panels
    const newStr = buildStringConfig({ index: 2, panelCount: 12 });
    const updated = buildInverterConfig({
      existingId: original.id,
      inverterId: original.inverterId,
      type:       original.type,
      strings:    [...original.strings, newStr],
    });

    expect(updated.stringsPerInverter).toBe(3);
    expect(updated.strings).toHaveLength(3);
    const violations = validateInverterMetadata(updated);
    expect(violations).toHaveLength(0);
  });

  it('removing a string recomputes stringsPerInverter', () => {
    const original = makeHealthy(3, 10); // 3 strings × 10 panels
    const kept = original.strings.slice(0, 2);
    const updated = buildInverterConfig({
      existingId: original.id,
      inverterId: original.inverterId,
      type:       original.type,
      strings:    kept,
    });

    expect(updated.stringsPerInverter).toBe(2);
    expect(updated.strings).toHaveLength(2);
    const violations = validateInverterMetadata(updated);
    expect(violations).toHaveLength(0);
  });

  it('changing panelCount on one string updates modulesPerString to match first string', () => {
    const original = makeHealthy(2, 10); // 2 strings × 10 panels
    // Update first string to 14 panels
    const updatedFirstStr = buildStringConfig({
      index:      0,
      existingId: original.strings[0].id,
      panelCount: 14,
    });
    const newStrings = [updatedFirstStr, original.strings[1]];
    const updated = buildInverterConfig({
      existingId: original.id,
      inverterId: original.inverterId,
      type:       original.type,
      strings:    newStrings,
    });

    // modulesPerString derives from first string
    expect(updated.modulesPerString).toBe(14);
    expect(updated.stringsPerInverter).toBe(2);
    const violations = validateInverterMetadata(updated);
    expect(violations).toHaveLength(0);
  });

  it('ecosystem apply: changing type + inverterId preserves strings and fixes metadata', () => {
    // Simulate the ecosystem apply path: inverterId + type change, strings stale
    const original = makeHealthy(4, 11);
    // After ecosystem apply: inverterId changes from 'inv-test' to a micro inverter
    const afterApply = buildInverterConfig({
      existingId: original.id,
      inverterId: 'enphase-iq8plus',
      type:       'micro',
      strings:    original.strings,
    });

    expect(afterApply.inverterId).toBe('enphase-iq8plus');
    expect(afterApply.type).toBe('micro');
    expect(afterApply.stringsPerInverter).toBe(4);    // 4 strings preserved
    expect(afterApply.modulesPerString).toBe(11);
    const violations = validateInverterMetadata(afterApply);
    expect(violations).toHaveLength(0);
  });

  it('removing a string never trims to zero', () => {
    const original = makeHealthy(1, 10); // already 1 string
    const kept: typeof original.strings = []; // empty — remove would kill all strings
    // Guard: if kept is empty, keep original strings (as implemented in removeString)
    const safeStrings = kept.length > 0 ? kept : original.strings;
    const updated = buildInverterConfig({
      existingId: original.id,
      inverterId: original.inverterId,
      type:       original.type,
      strings:    safeStrings,
    });

    expect(updated.strings).toHaveLength(1);
    expect(updated.stringsPerInverter).toBe(1);
  });
});
