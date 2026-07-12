// ============================================================================
// Wave 0 regression bar — see docs/ARCHITECTURE-per-subsystem-equipment.md
// (Invariant I-2: tag round-trip survival; §1.3 non-negotiable tag-survival
// rule — subSystemKey must land in BOTH normalizer whitelists in the same
// commit as the tag).
//
// EXPECTED RED (as `it.fails`) until Wave 1: today both normalizers rebuild
// the object from an explicit field whitelist and DROP subSystemKey. Each
// test asserts the tag SURVIVES — which currently fails, so `it.fails` keeps
// the suite green while pinning the hole. When Wave 1 adds the whitelist
// entries (lib/system/buildInverterConfig.ts:335 normalizeRawInverter and
// lib/system/designToEngineering.ts:129 normalizeToPermitInverters), these
// inner assertions start PASSING, `it.fails` starts failing CI, and Wave 1
// MUST flip `it.fails` → `it` in the same commit — the mechanical guard the
// contract requires (a rebase dropping one whitelist edit fails CI, not prod).
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

describe('I-2 tag round-trip survival (RED until Wave 1 — see header comment)', () => {
  it.fails('normalizeRawInverter preserves subSystemKey through the whitelist (buildInverterConfig.ts:335)', () => {
    const out = normalizeRawInverter(fenceInverter() as unknown as Record<string, unknown>);
    expect((out as unknown as { subSystemKey?: string }).subSystemKey).toBe('fence');
  });

  it.fails('normalizeToPermitInverters preserves subSystemKey through the whitelist (designToEngineering.ts:129)', () => {
    const out = normalizeToPermitInverters([fenceInverter()]);
    expect(out).not.toBeNull();
    expect((out![0] as unknown as { subSystemKey?: string }).subSystemKey).toBe('fence');
  });

  it.fails('full round trip: raw → normalizeRawInverter → normalizeToPermitInverters keeps the tag', () => {
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
