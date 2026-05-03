// ============================================================
// Tests — buildInverterConfig invariants
// ============================================================
// Run with: npx jest lib/system/__tests__/buildInverterConfig.test.ts

import {
  buildStringConfig,
  buildInverterConfig,
  newInverterConfig,
  rebuildInverterStrings,
  validateInverterMetadata,
  assertInverterMetadata,
} from '../buildInverterConfig';

// ── buildStringConfig ────────────────────────────────────────

describe('buildStringConfig', () => {
  it('fills all required fields with defaults', () => {
    const s = buildStringConfig({ index: 0 });
    expect(s.id).toMatch(/^str-/);
    expect(s.label).toBe('String 1');
    expect(s.panelCount).toBe(10);
    expect(s.panelId).toBeTruthy();
    expect(s.tilt).toBe(20);
    expect(s.azimuth).toBe(180);
    expect(s.roofType).toBe('shingle');
    expect(s.mountingSystem).toBeTruthy();
    expect(s.wireGauge).toBeTruthy();
    expect(s.wireLength).toBeGreaterThan(0);
  });

  it('uses caller-supplied values over defaults', () => {
    const s = buildStringConfig({
      index: 2,
      panelCount: 14,
      panelId: 'custom-panel-id',
      label: 'Ground A',
      tilt: 30,
      azimuth: 195,
      roofType: 'metal',
    });
    expect(s.panelCount).toBe(14);
    expect(s.panelId).toBe('custom-panel-id');
    expect(s.label).toBe('Ground A');
    expect(s.tilt).toBe(30);
    expect(s.azimuth).toBe(195);
    expect(s.roofType).toBe('metal');
  });

  it('preserves existingId', () => {
    const s = buildStringConfig({ index: 0, existingId: 'str-preserved-123' });
    expect(s.id).toBe('str-preserved-123');
  });

  it('uses fence panel default for fence system type', () => {
    const s = buildStringConfig({ index: 0, systemType: 'fence' });
    expect(s.panelId).toMatch(/nexus|fence/i);
  });
});

// ── buildInverterConfig ──────────────────────────────────────

describe('buildInverterConfig', () => {
  const makeString = (panelCount: number, idx = 0) =>
    buildStringConfig({ index: idx, panelCount });

  it('INVARIANT: stringsPerInverter === strings.length (1 string)', () => {
    const inv = buildInverterConfig({
      inverterId: 'se-7600h',
      type: 'string',
      strings: [makeString(10)],
    });
    expect(inv.stringsPerInverter).toBe(inv.strings.length);
    expect(inv.stringsPerInverter).toBe(1);
  });

  it('INVARIANT: stringsPerInverter === strings.length (7 strings)', () => {
    const strings = Array.from({ length: 7 }, (_, i) => makeString(6, i));
    const inv = buildInverterConfig({
      inverterId: 'fronius-symo-8',
      type: 'string',
      strings,
    });
    expect(inv.stringsPerInverter).toBe(7);
    expect(inv.stringsPerInverter).toBe(inv.strings.length);
  });

  it('INVARIANT: modulesPerString === strings[0].panelCount', () => {
    const inv = buildInverterConfig({
      inverterId: 'enphase-iq8plus',
      type: 'micro',
      strings: [makeString(44)],
    });
    expect(inv.modulesPerString).toBe(44);
    expect(inv.modulesPerString).toBe(inv.strings[0].panelCount);
  });

  it('INVARIANT: modulesPerString reflects first string panelCount', () => {
    const strings = [makeString(8, 0), makeString(8, 1), makeString(8, 2)];
    const inv = buildInverterConfig({
      inverterId: 'fronius-primo-8',
      type: 'string',
      strings,
    });
    expect(inv.modulesPerString).toBe(8);
    expect(inv.stringsPerInverter).toBe(3);
  });

  it('throws when strings array is empty', () => {
    expect(() =>
      buildInverterConfig({ inverterId: 'x', type: 'string', strings: [] })
    ).toThrow(/strings array must not be empty/);
  });

  it('preserves existingId', () => {
    const inv = buildInverterConfig({
      inverterId: 'se-7600h',
      type: 'string',
      strings: [makeString(10)],
      existingId: 'inv-preserved-abc',
    });
    expect(inv.id).toBe('inv-preserved-abc');
  });

  it('carries optimizerPeripheralId when provided', () => {
    const inv = buildInverterConfig({
      inverterId: 'se-11400h',
      type: 'optimizer',
      strings: [makeString(10)],
      optimizerPeripheralId: 'se-p505',
    });
    expect(inv.optimizerPeripheralId).toBe('se-p505');
  });

  it('does not set optimizerPeripheralId when not provided', () => {
    const inv = buildInverterConfig({
      inverterId: 'se-7600h',
      type: 'string',
      strings: [makeString(10)],
    });
    expect(inv.optimizerPeripheralId).toBeUndefined();
  });
});

// ── newInverterConfig ────────────────────────────────────────

describe('newInverterConfig', () => {
  it('creates N strings all with same panelCount', () => {
    const inv = newInverterConfig({
      inverterId: 'fronius-symo-8',
      type: 'string',
      panelCount: 12,
      stringsCount: 4,
    });
    expect(inv.strings).toHaveLength(4);
    inv.strings.forEach(s => expect(s.panelCount).toBe(12));
    expect(inv.stringsPerInverter).toBe(4);
    expect(inv.modulesPerString).toBe(12);
  });

  it('defaults to 1 string when stringsCount not provided', () => {
    const inv = newInverterConfig({
      inverterId: 'enphase-iq8plus',
      type: 'micro',
      panelCount: 36,
    });
    expect(inv.strings).toHaveLength(1);
    expect(inv.stringsPerInverter).toBe(1);
    expect(inv.modulesPerString).toBe(36);
  });

  it('enforces minimum 1 string even if stringsCount=0', () => {
    const inv = newInverterConfig({
      inverterId: 'se-7600h',
      type: 'string',
      stringsCount: 0,
    });
    expect(inv.strings.length).toBeGreaterThanOrEqual(1);
    expect(inv.stringsPerInverter).toBeGreaterThanOrEqual(1);
  });
});

// ── rebuildInverterStrings ───────────────────────────────────

describe('rebuildInverterStrings', () => {
  const baseInv = newInverterConfig({
    inverterId: 'fronius-symo-8',
    type: 'string',
    panelCount: 10,
    stringsCount: 2,
  });

  it('expands string count and updates metadata', () => {
    const rebuilt = rebuildInverterStrings({
      existing: baseInv,
      targetStringCount: 7,
      panelCount: 6,
    });
    expect(rebuilt.strings).toHaveLength(7);
    expect(rebuilt.stringsPerInverter).toBe(7);
    expect(rebuilt.modulesPerString).toBe(6);
  });

  it('shrinks string count and updates metadata', () => {
    const rebuilt = rebuildInverterStrings({
      existing: baseInv,
      targetStringCount: 1,
      panelCount: 14,
    });
    expect(rebuilt.strings).toHaveLength(1);
    expect(rebuilt.stringsPerInverter).toBe(1);
    expect(rebuilt.modulesPerString).toBe(14);
  });

  it('never shrinks to 0 — enforces minimum 1', () => {
    const rebuilt = rebuildInverterStrings({
      existing: baseInv,
      targetStringCount: 0,
      panelCount: 10,
    });
    expect(rebuilt.strings.length).toBeGreaterThanOrEqual(1);
    expect(rebuilt.stringsPerInverter).toBeGreaterThanOrEqual(1);
  });

  it('preserves existing string IDs for in-place slots', () => {
    const rebuilt = rebuildInverterStrings({
      existing: baseInv,
      targetStringCount: 2,
      panelCount: 8,
    });
    // IDs of the original 2 strings should be reused
    expect(rebuilt.strings[0].id).toBe(baseInv.strings[0].id);
    expect(rebuilt.strings[1].id).toBe(baseInv.strings[1].id);
  });

  it('preserves inverterId + type from existing inverter', () => {
    const rebuilt = rebuildInverterStrings({
      existing: baseInv,
      targetStringCount: 3,
      panelCount: 9,
    });
    expect(rebuilt.inverterId).toBe(baseInv.inverterId);
    expect(rebuilt.type).toBe(baseInv.type);
    expect(rebuilt.id).toBe(baseInv.id);
  });
});

// ── validateInverterMetadata ─────────────────────────────────

describe('validateInverterMetadata', () => {
  it('returns empty array for valid metadata', () => {
    const inv = newInverterConfig({
      inverterId: 'se-7600h',
      type: 'string',
      panelCount: 10,
      stringsCount: 3,
    });
    expect(validateInverterMetadata(inv)).toHaveLength(0);
  });

  it('detects stringsPerInverter mismatch', () => {
    const inv = newInverterConfig({
      inverterId: 'se-7600h',
      type: 'string',
      panelCount: 10,
      stringsCount: 3,
    });
    // Manually corrupt
    (inv as any).stringsPerInverter = 1;
    const violations = validateInverterMetadata(inv);
    expect(violations).toHaveLength(1);
    expect(violations[0].field).toBe('stringsPerInverter');
    expect(violations[0].expected).toBe(3);
    expect(violations[0].actual).toBe(1);
  });

  it('detects modulesPerString mismatch', () => {
    const inv = newInverterConfig({
      inverterId: 'se-7600h',
      type: 'string',
      panelCount: 12,
      stringsCount: 2,
    });
    (inv as any).modulesPerString = 99;
    const violations = validateInverterMetadata(inv);
    expect(violations).toHaveLength(1);
    expect(violations[0].field).toBe('modulesPerString');
    expect(violations[0].expected).toBe(12);
    expect(violations[0].actual).toBe(99);
  });

  it('detects both violations simultaneously', () => {
    const inv = newInverterConfig({
      inverterId: 'enphase-iq8plus',
      type: 'micro',
      panelCount: 36,
      stringsCount: 1,
    });
    (inv as any).stringsPerInverter = 44;
    (inv as any).modulesPerString = 1;
    const violations = validateInverterMetadata(inv);
    expect(violations).toHaveLength(2);
  });
});

// ── assertInverterMetadata ───────────────────────────────────

describe('assertInverterMetadata (dev mode)', () => {
  const origEnv = process.env.NODE_ENV;

  beforeEach(() => {
    (process.env as any).NODE_ENV = 'development';
  });

  afterEach(() => {
    (process.env as any).NODE_ENV = origEnv;
  });

  it('does not throw for valid inverter', () => {
    const inv = newInverterConfig({
      inverterId: 'se-7600h',
      type: 'string',
      panelCount: 10,
      stringsCount: 2,
    });
    expect(() => assertInverterMetadata(inv)).not.toThrow();
  });

  it('throws in development for corrupt metadata', () => {
    const inv = newInverterConfig({
      inverterId: 'se-7600h',
      type: 'string',
      panelCount: 10,
      stringsCount: 5,
    });
    (inv as any).stringsPerInverter = 1;
    expect(() => assertInverterMetadata(inv, 'test context')).toThrow(
      /Metadata violation/
    );
  });
});