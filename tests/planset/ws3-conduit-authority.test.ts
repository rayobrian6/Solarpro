// ═══════════════════════════════════════════════════════════════════════════
// WS-3 — CONDUIT AUTHORITY RECONCILIATION.
//
// A route segment publishes its raceway as STRUCTURED FACTS (`raceway`,
// `tradeSizeIn`, `fillPct`, `racewayNecArticle`, `physicalRacewayId`). It also
// publishes a human-readable `conductorCallout`. Those are two statements about
// ONE raceway, and the snapshot is the digest-bound archive of record — so they
// must agree.
//
// They did not. Every in-conduit run arrived from the engine reading
//
//     "2×#6 THWN-2\n1×#10 GRN EGC\nIN 1-1/4\" 3/4\" EMT"
//
// against a record whose own fields said `raceway: 'PVC Sch 80'`,
// `tradeSizeIn: '1-1/4"'`. Two trade sizes in one callout, and a raceway TYPE
// (EMT) contradicting the record it sits on. `projectCanonicalFeeder` already
// refused that string and rebuilt the sheets' callout from canonical parts, so
// nothing corrupt ever PRINTED — which is precisely why it survived: the
// workaround downstream hid a defect in the authority itself.
//
// These tests pin the invariant at the source: a segment's callout may only
// name that segment's own raceway, and a contradicting callout is never stored.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

function build(): PermitDesignSnapshot {
  const input: any = JSON.parse(JSON.stringify(braidonOriginalAuditFixture));
  input.generatedAtIso = '2026-07-22T12:00:00Z';
  generatePermitHTML(input);
  return input._snapshot as PermitDesignSnapshot;
}

const snap = build();
const segments = snap.electrical.routeSegments ?? [];
const inConduit = segments.filter(s => s.raceway && s.raceway !== 'FREE_AIR');

/** Every trade size mentioned in a callout, e.g. 1-1/4" / 3/4" / 2-1/2". */
const sizesIn = (s: string): string[] => s.match(/\d+(?:-\d+\/\d+|\/\d+)?"/g) ?? [];

describe('WS-3 — the fixture exercises real raceways', () => {
  it('has in-conduit route segments to check', () => {
    expect(segments.length).toBeGreaterThan(0);
    expect(inConduit.length).toBeGreaterThan(0);
  });
});

describe('WS-3 — a segment callout names ONLY that segment’s own raceway', () => {
  for (const seg of inConduit) {
    it(`${seg.segmentId} callout agrees with raceway=${seg.raceway} size=${seg.tradeSizeIn}`, () => {
      const callout = seg.conductorCallout;
      if (!callout) return;               // a missing statement is honest
      if (!callout.includes('IN ')) return; // no raceway clause to check

      const clause = callout.slice(callout.indexOf('IN '));

      // exactly ONE trade size — the legacy string carried two ('1-1/4" 3/4"')
      const sizes = sizesIn(clause);
      expect(sizes.length,
        `${seg.segmentId}: callout names ${sizes.length} trade sizes ${JSON.stringify(sizes)} — a raceway has exactly one. Callout: ${JSON.stringify(callout)}`,
      ).toBe(1);

      // and it is THIS segment's size
      if (seg.tradeSizeIn) {
        expect(sizes[0],
          `${seg.segmentId}: callout size ${sizes[0]} != record tradeSizeIn ${seg.tradeSizeIn}. Callout: ${JSON.stringify(callout)}`,
        ).toBe(seg.tradeSizeIn);
      }

      // and THIS segment's raceway type
      if (seg.raceway) {
        expect(clause,
          `${seg.segmentId}: callout does not name its own raceway ${seg.raceway}. Callout: ${JSON.stringify(callout)}`,
        ).toContain(seg.raceway);
      }
    });
  }
});

describe('WS-3 — the legacy hard-coded raceway is gone from the archive', () => {
  it('no segment callout contains the malformed "<size> 3/4\\" EMT" concatenation', () => {
    const bad = segments
      .filter(s => s.conductorCallout && /"\s*3\/4"/.test(s.conductorCallout))
      .map(s => `${s.segmentId}: ${JSON.stringify(s.conductorCallout)}`);
    expect(bad, `segments still carrying the legacy double-raceway callout:\n${bad.join('\n')}`).toEqual([]);
  });

  it('no PVC segment is described as EMT (raceway TYPE contradiction)', () => {
    const bad = segments
      .filter(s => s.raceway && /PVC/i.test(s.raceway) && s.conductorCallout && /\bEMT\b/.test(s.conductorCallout))
      .map(s => `${s.segmentId}: raceway=${s.raceway} callout=${JSON.stringify(s.conductorCallout)}`);
    expect(bad, `PVC raceways described as EMT:\n${bad.join('\n')}`).toEqual([]);
  });

  it('open-air segments never claim a raceway', () => {
    const bad = (segments.filter(s => s.raceway === 'FREE_AIR'))
      .filter(s => s.conductorCallout && /\bIN\s+\d/.test(s.conductorCallout))
      .map(s => `${s.segmentId}: ${JSON.stringify(s.conductorCallout)}`);
    expect(bad, `open-air segments claiming a conduit:\n${bad.join('\n')}`).toEqual([]);
  });
});

describe('WS-3 — the raceway set is complete and correctly scoped', () => {
  const raceways = snap.electrical.physicalRaceways ?? [];

  // ── D1 (Planset 17) — REWRITTEN. ────────────────────────────────────────
  // The previous version of these two tests keyed the exclusion on a
  // `/MSP_TO_UTILITY/` NAME REGEX — the exact product-name topology inference
  // the standing rules prohibit — and the second carried `if (!utility) return;`,
  // a silent early return that made the whole assertion evaporate if the id ever
  // changed while still reporting green. They now resolve the segment by its
  // explicit canonical OWNERSHIP field and fail when it is absent.
  it('every in-conduit segment REQUIRING project route authority resolves to a physical raceway', () => {
    const orphans = inConduit
      .filter(s => (s.routeAuthorityApplicability ?? 'REQUIRED') === 'REQUIRED')
      .filter(s => !s.physicalRacewayId)
      .map(s => s.segmentId);
    expect(orphans, `project-owned in-conduit segments with no physicalRacewayId: ${orphans.join(', ')}`).toEqual([]);
  });

  it('every segment carries an explicit ownership and applicability decision', () => {
    const undecided = segments
      .filter(s => !s.routeOwnership || !s.routeAuthorityApplicability)
      .map(s => s.segmentId);
    expect(undecided, `segments with no explicit ownership/applicability: ${undecided.join(', ')}`).toEqual([]);
  });

  it('the utility-owned service run is excluded from the PV raceway set — by its OWN field, not its name', () => {
    const utility = segments.filter(s => s.routeOwnership === 'UTILITY_OWNED');
    // no silent early return: this design HAS a utility service connection, and
    // if it ever stops having one that is a topology change worth failing on.
    expect(utility.length, 'no UTILITY_OWNED segment found — the service connection vanished from topology').toBeGreaterThan(0);
    for (const u of utility) {
      expect(u.routeAuthorityApplicability, `${u.segmentId} is utility-owned but not EXCLUDED`).toBe('EXCLUDED');
      expect(u.routeApplicabilityReason, `${u.segmentId} excluded with no stated reason`).toBeTruthy();
      expect(u.physicalRacewayId, `${u.segmentId} must own no project raceway`).toBeNull();
      // it stays in topology, with its endpoints intact
      expect(u.from, `${u.segmentId} lost its source equipment`).toBeTruthy();
      expect(u.to, `${u.segmentId} lost its destination equipment`).toBeTruthy();
      expect(raceways.some(r => r.physicalRacewayId.includes(u.segmentId))).toBe(false);
    }
  });

  it('each physical raceway carries a fill at or under the NEC Ch.9 T1 limit', () => {
    for (const rw of raceways) {
      if (rw.fillPct == null) continue;
      expect(rw.fillPct, `${rw.physicalRacewayId} fill ${rw.fillPct}% exceeds the 40% limit`).toBeLessThanOrEqual(40);
    }
  });

  // The callout describes WHAT IS IN THE RACEWAY. `routeSegment.conductorCount`
  // is PER CIRCUIT — the shared branch home-run reports 2 while three branch
  // circuits share that raceway (6 current-carrying + 1 EGC = 7). Deriving the
  // callout from the segment count alone trades a wrong RACEWAY for a wrong
  // CONDUCTOR COUNT, so the total the callout names must equal the raceway's.
  it('the conductor count a callout names equals its raceway’s total', () => {
    for (const seg of inConduit) {
      const rw = raceways.find(r => r.physicalRacewayId === seg.physicalRacewayId);
      if (!rw || !seg.conductorCallout || rw.conductorCount == null) continue;
      const counts = [...seg.conductorCallout.matchAll(/(\d+)×/g)].map(m => Number(m[1]));
      if (!counts.length) continue;
      const total = counts.reduce((a, b) => a + b, 0);
      expect(total,
        `${seg.segmentId}: callout names ${total} conductors but raceway ${rw.physicalRacewayId} carries ${rw.conductorCount}. ` +
        `Callout: ${JSON.stringify(seg.conductorCallout)}`,
      ).toBe(rw.conductorCount);
    }
  });

  it('a segment fill agrees with its own physical raceway fill', () => {
    for (const seg of inConduit) {
      if (!seg.physicalRacewayId || seg.fillPct == null) continue;
      const rw = raceways.find(r => r.physicalRacewayId === seg.physicalRacewayId);
      if (!rw || rw.fillPct == null) continue;
      expect(Math.abs(rw.fillPct - seg.fillPct),
        `${seg.segmentId}: segment fill ${seg.fillPct}% vs raceway ${rw.physicalRacewayId} fill ${rw.fillPct}%`,
      ).toBeLessThanOrEqual(0.1);
    }
  });
});
