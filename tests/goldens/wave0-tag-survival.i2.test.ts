// ============================================================================
// Wave 0 regression bar — see docs/ARCHITECTURE-per-subsystem-equipment.md
// (Invariant I-2: tag round-trip survival; §1.3 non-negotiable tag-survival
// rule — subSystemKey must land in BOTH normalizer whitelists in the same
// commit as the tag).
//
// GREEN since Wave 1: both normalizer whitelists carry subSystemKey
// (lib/system/buildInverterConfig.ts normalizeRawInverter and
// lib/system/designToEngineering.ts normalizeToPermitInverters), so the
// original `it.fails` pins were flipped to `it` in the same commit as the
// whitelist entries — the mechanical guard the contract requires (a rebase
// dropping one whitelist edit fails CI, not prod). These tests must stay
// green forever; a red here means a normalizer is silently stripping tags
// (the old-client hybrid-collapse hole, contract §4 risk #1).
// ============================================================================

import { describe, it, expect } from 'vitest';
import { normalizeRawInverter } from '../../lib/system/buildInverterConfig';
import { normalizeToPermitInverters } from '../../lib/system/designToEngineering';

// A fence-tagged inverter as Wave 1's hydration path will produce it: a plain
// legacy inverter record + the derived subSystemKey cache tag (§1.1 authority
// hierarchy — tags re-stamped from panel stamps at every hydration).
const fenceInverter = () => ({
  id: 'inv-fence-1',
  inverterId: 'fronius-primo-8.2',
  type: 'string' as const,
  subSystemKey: 'fence' as const,
  strings: [{
    id: 's1', label: 'String 1', panelCount: 8, panelId: 'tesla-tsp-420',
    tilt: 90, azimuth: 180, roofType: 'shingle', mountingSystem: 'solfence',
    wireGauge: '#10 AWG', wireLength: 50,
  }],
});

describe('I-2 tag round-trip survival (GREEN since Wave 1 — see header comment)', () => {
  it('normalizeRawInverter preserves subSystemKey through the whitelist (buildInverterConfig.ts:335)', () => {
    const out = normalizeRawInverter(fenceInverter() as unknown as Record<string, unknown>);
    expect((out as unknown as { subSystemKey?: string }).subSystemKey).toBe('fence');
  });

  it('normalizeToPermitInverters preserves subSystemKey through the whitelist (designToEngineering.ts:129)', () => {
    const out = normalizeToPermitInverters([fenceInverter()]);
    expect(out).not.toBeNull();
    expect((out![0] as unknown as { subSystemKey?: string }).subSystemKey).toBe('fence');
  });

  it('full round trip: raw → normalizeRawInverter → normalizeToPermitInverters keeps the tag', () => {
    const hydrated = normalizeRawInverter(fenceInverter() as unknown as Record<string, unknown>);
    const permit = normalizeToPermitInverters([hydrated]);
    expect(permit).not.toBeNull();
    expect((permit![0] as unknown as { subSystemKey?: string }).subSystemKey).toBe('fence');
  });

  // GREEN today and must STAY green: the normalizers still produce a valid
  // legacy shape when fed a tagged object (tags never break legacy consumers).
  it('a tagged inverter still normalizes to a valid legacy shape (no throw, strings intact)', () => {
    const out = normalizeRawInverter(fenceInverter() as unknown as Record<string, unknown>);
    expect(out.inverterId).toBe('fronius-primo-8.2');
    expect(out.strings).toHaveLength(1);
    expect(out.strings[0].panelCount).toBe(8);

    const permit = normalizeToPermitInverters([fenceInverter()]);
    expect(permit).not.toBeNull();
    expect(permit![0].type).toBe('string');
    expect(permit![0].strings[0].panelCount).toBe(8);
  });
});
