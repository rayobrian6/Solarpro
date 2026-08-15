// ═══════════════════════════════════════════════════════════════════════════
// D14 — A FIELD NAMED `…Iso` MUST HOLD AN ISO VALUE.
//
// THE DEFECT, AS IT STANDS ON THE LIVE BRAIDON SNAPSHOT:
//
//   meta.generatedAtIso                 "7/30/2026"
//   permitReadiness.registry[].createdAtIso  "7/30/2026"
//
// A US-localised `M/D/YYYY` date in two fields the schema declares as ISO. Both
// are DIGESTED, and build.ts records the reason it was left alone: substituting
// the true sub-second UTC instant made every unfrozen render produce a new
// snapshot id, so the defect was written down rather than papered over.
//
// The written-down reasoning contains a false dichotomy. The choice was never
// "localised date OR sub-second instant" — `2026-07-30` is ISO 8601, has no time
// component, and is a pure REFORMAT of the same calendar date. It moves no
// design fact and introduces no clock.
//
// WHY THE SUB-SECOND INSTANT IS STILL FORBIDDEN. `payloadGeneric` (D9) excludes
// any payload string matching /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/ from the
// artifact, so introducing a time component here would either be silently
// dropped from the render or reinstate the moving-artifact defect D9 closed.
// A date-only ISO value is clear of that guard by construction.
//
// AND ONE FORMAT, NOT TWO. `meta.generatedAtIso` and every registry row's
// `createdAtIso` were computed from the same expression written out twice. They
// now come from one resolved stamp, which also carries the PRECISION — because
// "ISO" alone does not tell a consumer whether there is a time component, and at
// least one consumer (D9's guard) depends on exactly that.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { resolveGenerationStamp } from '@/lib/permit/snapshot/generationStamp';
import { isRunInstantPayloadEntry } from '@/lib/permit/sections/reviewStatus';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_ANY = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}|$)/;

describe('D14 · the generation stamp is ISO, or it says it is not', () => {
  it('1 — the live localised date is REFORMATTED, not reinterpreted', () => {
    const s = resolveGenerationStamp({ injectedIso: null, projectDate: '7/30/2026' });
    expect(s.value).toBe('2026-07-30');
    expect(s.precision).toBe('date');
    expect(s.value).toMatch(ISO_DATE);
  });

  it('2 — single-digit month and day are zero-padded', () => {
    expect(resolveGenerationStamp({ injectedIso: null, projectDate: '1/5/2026' }).value).toBe('2026-01-05');
    expect(resolveGenerationStamp({ injectedIso: null, projectDate: '12/31/2026' }).value).toBe('2026-12-31');
  });

  it('3 — an injected ISO instant is passed through VERBATIM', () => {
    // Every frozen-clock test in the suite injects one of these; truncating it
    // would move their digests for no design reason.
    const s = resolveGenerationStamp({ injectedIso: '2026-07-22T12:00:00Z', projectDate: '7/30/2026' });
    expect(s.value).toBe('2026-07-22T12:00:00Z');
    expect(s.precision).toBe('instant');
  });

  it('4 — an already-ISO date is left alone', () => {
    const s = resolveGenerationStamp({ injectedIso: null, projectDate: '2026-07-30' });
    expect(s.value).toBe('2026-07-30');
    expect(s.precision).toBe('date');
  });

  it('5 — nothing at all is ABSENT, and stays empty (nothing is invented)', () => {
    const s = resolveGenerationStamp({ injectedIso: null, projectDate: null });
    expect(s.value).toBe('');
    expect(s.precision).toBe('absent');
  });

  it('6 — an unrecognized format is preserved VERBATIM and labelled unrecognized', () => {
    // The failure this prevents: a future format silently inheriting the "ISO"
    // claim, which is the whole defect.
    const s = resolveGenerationStamp({ injectedIso: null, projectDate: 'Thursday, July 30' });
    expect(s.value).toBe('Thursday, July 30');
    expect(s.precision).toBe('unrecognized');
    expect(s.basis).toMatch(/not.*recognized|unrecognized/i);
  });

  it('7 — an impossible date is not silently coerced', () => {
    const s = resolveGenerationStamp({ injectedIso: null, projectDate: '13/45/2026' });
    expect(s.precision).toBe('unrecognized');
    expect(s.value).toBe('13/45/2026');
  });

  it('8 — no reformatted value ever carries a time component (the D9 guard)', () => {
    for (const raw of ['7/30/2026', '1/5/2026', '2026-07-30']) {
      const s = resolveGenerationStamp({ injectedIso: null, projectDate: raw });
      expect(isRunInstantPayloadEntry('createdAtIso', s.value)).toBe(false);
      expect(s.value).toMatch(ISO_ANY);
    }
  });

  it('9 — the reformat preserves the calendar date exactly', () => {
    for (const [raw, iso] of [['7/30/2026', '2026-07-30'], ['8/5/2026', '2026-08-05'], ['2/29/2024', '2024-02-29']] as const) {
      expect(resolveGenerationStamp({ injectedIso: null, projectDate: raw }).value).toBe(iso);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE SNAPSHOT PROJECTS ONE STAMP
// ═══════════════════════════════════════════════════════════════════════════

describe('D14 · meta and the registry carry the SAME stamp', () => {
  type Snap = {
    meta: { generatedAtIso: string; generatedAtPrecision: string; generatedAtBasis: string };
    permitReadiness: { registry: Array<{ createdAtIso: string }> };
  };
  async function build(mutate: (input: Record<string, unknown>) => void): Promise<{ snap: Snap; input: Record<string, unknown> }> {
    const { generatePermitHTML } = await import('@/lib/permit');
    const { braidonOriginalAuditFixture } = await import('../fixtures/braidon-original-audit-fixture');
    const input = JSON.parse(JSON.stringify(braidonOriginalAuditFixture)) as Record<string, unknown>;
    mutate(input);
    generatePermitHTML(input as never);
    return { snap: (input as unknown as { _snapshot: Snap })._snapshot, input };
  }

  it('10 — with no injected instant the stamp is an ISO CALENDAR DATE, not M/D/YYYY', async () => {
    // NOTE: `project.date` is overwritten by the ONE document-issue context
    // (generatePermit.ts) before the snapshot is built, so the stamp tracks the
    // resolved jurisdiction-zone issue date rather than the posted label. What
    // D14 fixes is its FORMAT: that resolved date is 'M/D/YYYY' and used to land
    // verbatim in a field the schema calls ISO.
    const { snap, input } = await build(i => {
      delete (i as { generatedAtIso?: unknown }).generatedAtIso;
      (i.project as Record<string, unknown>).date = '7/30/2026';
    });
    expect(snap.meta.generatedAtIso).toMatch(ISO_DATE);
    expect(snap.meta.generatedAtPrecision).toBe('date');
    // it IS the resolved issue date, reformatted — not some other clock
    const resolved = String((input.project as Record<string, unknown>).date);
    const [m, d, y] = resolved.split('/');
    expect(snap.meta.generatedAtIso).toBe(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
  });

  it('11 — meta and EVERY registry row carry the identical stamp', async () => {
    const { snap } = await build(i => { delete (i as { generatedAtIso?: unknown }).generatedAtIso; });
    expect(snap.permitReadiness.registry.length).toBeGreaterThan(0);
    for (const r of snap.permitReadiness.registry) expect(r.createdAtIso).toBe(snap.meta.generatedAtIso);
  });

  it('12 — an injected instant reaches meta VERBATIM, and the registry agrees', async () => {
    const { snap } = await build(i => { (i as Record<string, unknown>).generatedAtIso = '2026-07-22T12:00:00Z'; });
    expect(snap.meta.generatedAtIso).toBe('2026-07-22T12:00:00Z');
    expect(snap.meta.generatedAtPrecision).toBe('instant');
    for (const r of snap.permitReadiness.registry) expect(r.createdAtIso).toBe('2026-07-22T12:00:00Z');
  });

  it('13 — the live stamp never carries a localised M/D/YYYY value again', async () => {
    const { snap } = await build(i => { delete (i as { generatedAtIso?: unknown }).generatedAtIso; });
    expect(snap.meta.generatedAtIso).not.toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}$/);
    for (const r of snap.permitReadiness.registry) {
      expect(r.createdAtIso).not.toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}$/);
    }
  });
});
