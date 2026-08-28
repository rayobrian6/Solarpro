// ═══════════════════════════════════════════════════════════════════════════
// A GROUND SNOW LOAD NOBODY ESTABLISHED IS NOT A CODE MINIMUM (2026-08-28)
//
// The Braidon package carried `groundSnowLoadPsf: 0` with
// `snowLoadBasis: 'code-minimum-default'` — on a roof in Granite City, ILLINOIS.
//
// Both halves were wrong. The 0 came from a trailing `|| 0` in the canonical
// site builder, so an ABSENT value arrived downstream wearing a number's
// clothes; and ASCE 7 prescribes no code-minimum ground snow load anywhere
// (Fig. 7.2-1 is a map, not a floor), so calling it one asserts an authority
// that does not exist. A reviewer reading "0 psf, code-minimum default" reads a
// decided value, and zero snow is not the conservative direction.
//
// The fix is honesty, not invention: SolarPro does not ship a nationwide
// ground-snow dataset and must not fabricate one. An unestablished value is
// reported as NOT ESTABLISHED and named in the requirement.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';
import { buildEnvironmentalLoadAuthority } from '@/lib/permit/snapshot/environmentalAuthority';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

const base = {
  windSpeedMph: 115,
  exposureCategory: 'C',
  riskCategory: null,
  groundSnowPsf: null as number | null,
  windOperatorEntered: false,
  snowOperatorEntered: false,
  coordinates: { lat: 38.7, lng: -90.0 },
  addressUsed: '3 MELVIN DR, GRANITE CITY, IL',
  projectOrAhj: 'City of Granite City',
  sourceEvidence: null,
  capturedAtIso: null,
  retrievalRecord: null,
};

describe('environmental load authority — snow', () => {
  it('an unsourced snow value is NOT-ESTABLISHED, never a code minimum', () => {
    const a = buildEnvironmentalLoadAuthority({ ...base, groundSnowPsf: 0 });
    expect(a.snowLoadBasis).toBe('not-established');
    expect(a.snowLoadBasis).not.toBe('code-minimum-default');
    expect(a.provenance.note).toMatch(/GROUND SNOW LOAD IS NOT ESTABLISHED/);
    expect(a.provenance.note).toMatch(/no code-minimum ground snow load/i);
  });

  it('an absent snow value is UNAVAILABLE and is still not a code minimum', () => {
    const a = buildEnvironmentalLoadAuthority({ ...base, groundSnowPsf: null });
    expect(a.snowLoadBasis).toBe('unavailable');
  });

  it('WIND keeps its code-minimum basis — ASCE 7 §26.5 really does give a floor', () => {
    const a = buildEnvironmentalLoadAuthority({ ...base });
    expect(a.windSpeedBasis).toBe('code-minimum-default');
  });

  it('an OPERATOR-entered snow load is an override, not "not established"', () => {
    const a = buildEnvironmentalLoadAuthority({
      ...base, groundSnowPsf: 20, snowOperatorEntered: true,
    });
    expect(a.snowLoadBasis).toBe('operator-entered');
    expect(a.operatorOverrides).toContain('groundSnowLoadPsf');
    // an override is still not verification
    expect(a.verificationStatus).toBe('unverified');
  });

  it('the live Braidon package reports it, and the requirement still blocks', () => {
    const input = clone(braidonOriginalAuditFixture) as unknown as Record<string, unknown>;
    input.generatedAtIso = '2026-08-28T12:00:00Z';
    generatePermitHTML(input as never);
    const snap = (input as { _snapshot?: PermitDesignSnapshot })._snapshot!;
    const env = (snap.structural as unknown as {
      env: { environmentalLoadAuthority: { snowLoadBasis: string; verificationStatus: string } };
    }).env.environmentalLoadAuthority;

    expect(env.snowLoadBasis).toBe('not-established');
    expect(env.verificationStatus).toBe('unverified');
    // it is a real, remaining external gap — SolarPro must not close it by
    // inventing a number, and the requirement stays up
    expect(snap.permitReadiness.registry.map(r => r.code))
      .toContain('ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED');
  });

  it('a project that DOES post a snow load is untouched — this is an absence fix', () => {
    const a = buildEnvironmentalLoadAuthority({
      ...base, groundSnowPsf: 25, snowOperatorEntered: true,
    });
    expect(a.groundSnowLoadPsf).toBe(25);
    expect(a.snowLoadBasis).toBe('operator-entered');
  });
});
