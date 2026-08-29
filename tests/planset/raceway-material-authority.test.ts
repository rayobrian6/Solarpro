// THE RACEWAY MATERIAL (2026-08-29)
//
// One malformed value, two silent fallbacks, opposite directions.
//
// `computedRuns` built the raceway-TYPE field by packing the trade size and the
// type into one display string - `3/4" EMT` - and handed it to a field whose
// contract is a canonical key ('EMT' | 'PVC Sch 40' | 'PVC Sch 80'). Downstream:
//
//   · segment-schedule's raceway ternary was
//     `t === 'EMT' ? 'EMT' : t === 'PVC Sch 40' ? ... : 'PVC_SCH80'`, so an
//     unrecognised string became PVC Sch 80 - and that is what PRINTED;
//   · the conduit-area lookup ended `TABLE[t] ?? TABLE['EMT']`, so the same
//     string was SIZED against steel.
//
// The audited package therefore stated "PVC Sch 80 3/4"" beside a 26.2% fill,
// and 26.2% is 0.1399 in² over 0.533 - the EMT interior. The project had
// selected EMT the whole time. A sheet stating one material while its number
// describes another is worse than either error alone.
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { readFileSync } from 'fs';
import { join } from 'path';
import { conduitTotalAreaIn2, normalizeConduitType } from '@/lib/nec/chapter9';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function build(conduitType: string) {
  const input: any = clone(braidonOriginalAuditFixture);
  input.plansetProfile = 'design-review';
  input.project.conduitType = conduitType;
  const html = generatePermitHTML(input) as unknown as string;
  return { html, snap: input._snapshot, text: html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ') };
}

describe('the material printed is the material selected', () => {
  it('an EMT project prints EMT, and no other raceway material', () => {
    const { text } = build('EMT');
    expect(text).toMatch(/\bEMT\b/);
    expect(text).not.toContain('PVC Sch 80');
    expect(text).not.toContain('PVC Sch 40');
  });

  it('a PVC Sch 80 project prints PVC Sch 80, and not EMT', () => {
    // The mirror case: before the repair EVERY project printed PVC Sch 80, so
    // this passing meant nothing. It means something now.
    const { text } = build('PVC Sch 80');
    expect(text).toContain('PVC Sch 80');
    expect(text).not.toMatch(/\bEMT\b/);
  });
});

describe('the fill is computed against the material that is printed', () => {
  const raceways = (snap: any) => (snap?.electrical?.physicalRaceways ?? []) as Array<{
    physicalRacewayId: string; racewayType: string; selectedRacewaySize: string;
    conductorAreaIn2: number | null; fillPct: number | null;
  }>;

  for (const type of ['EMT', 'PVC Sch 80']) {
    it(`${type}: every raceway's fill reproduces from ITS OWN Table 4 interior`, () => {
      const { snap } = build(type);
      const rws = raceways(snap).filter(r => r.conductorAreaIn2 != null && r.fillPct != null);
      expect(rws.length, 'the fixture builds raceways').toBeGreaterThan(0);
      for (const rw of rws) {
        expect(normalizeConduitType(rw.racewayType)).toBe(normalizeConduitType(type));
        const total = conduitTotalAreaIn2(rw.racewayType, rw.selectedRacewaySize);
        expect(total, `${rw.physicalRacewayId} ${rw.racewayType} ${rw.selectedRacewaySize}`).not.toBeNull();
        const expected = ((rw.conductorAreaIn2 as number) / (total as number)) * 100;
        expect(rw.fillPct as number,
          `${rw.physicalRacewayId}: ${rw.fillPct}% is not ${expected.toFixed(1)}% of the ${rw.racewayType} interior`,
        ).toBeCloseTo(expected, 0);
      }
    });
  }

  it('and the segment agrees with its own physical raceway', () => {
    const { snap } = build('EMT');
    const rws = raceways(snap);
    for (const seg of (snap?.electrical?.routeSegments ?? []) as Array<{
      segmentId: string; physicalRacewayId?: string | null; fillPct?: number | null; raceway?: string | null;
    }>) {
      if (!seg.physicalRacewayId || seg.fillPct == null) continue;
      const rw = rws.find(r => r.physicalRacewayId === seg.physicalRacewayId);
      if (!rw || rw.fillPct == null) continue;
      expect(seg.raceway, seg.segmentId).toBe(rw.racewayType);
      expect(Math.abs(rw.fillPct - seg.fillPct), `${seg.segmentId} vs ${rw.physicalRacewayId}`)
        .toBeLessThanOrEqual(0.1);
    }
  });
});

describe('a raceway material nobody can name is not PVC', () => {
  it('the display label that caused this now resolves to its real material', () => {
    // `3/4" EMT` is the exact string the permit path used to hand to a
    // canonical-key field. The silent `: 'PVC_SCH80'` tail turned it into a
    // material; it is now resolved at the boundary to the material it names.
    expect(normalizeConduitType('3/4" EMT')).toBe('EMT');
    const src = readFileSync(
      join(__dirname, '..', '..', 'lib', 'permit', 'utils', 'computedRuns.ts'), 'utf8');
    expect(src).toContain('necNormalizeConduitType(input.project.conduitType)');
    // and the trade size no longer travels inside the type
    expect(src).not.toContain('conduitType: `' + '${input.project.conduitSize');
  });

  it('a type nobody can resolve never becomes PVC by default', () => {
    // The boundary is tolerant (it accepts any label naming a real material);
    // the inner enum is strict. Neither silently substitutes a material.
    expect(normalizeConduitType('unobtainium')).toBeNull();
    expect(conduitTotalAreaIn2('unobtainium', '3/4"')).toBeNull();
  });

  it('...and the resolver accepts every label the UI offers', () => {
    expect(normalizeConduitType('PVC Schedule 80')).toBe('PVC Sch 80');
    expect(normalizeConduitType('Rigid Metal (RMC)')).toBe('RMC');
  });
});
