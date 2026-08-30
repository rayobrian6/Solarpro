// ═══════════════════════════════════════════════════════════════════════════
// THE NUMBERS WERE RIGHT AND THE WORDS DESCRIBED DIFFERENT HARDWARE
//
// The selected fastener is a Roof Tech SS304 5.0 mm × 90 mm WOOD SCREW and the
// framing is a PRE-ENGINEERED TRUSS. The structural prose said:
//
//   "…0.6D + 0.6W (net uplift) for LAG BOLT withdrawal capacity"
//   "All LAG BOLT attachments shall develop the required withdrawal capacity"
//   "LAG BOLT attachment safety factor of 1.55 meets…"
//   "…array and LAG BOLT attachment system have been analyzed for wind uplift,
//    snow, dead load, RAFTER CAPACITY, and attachment withdrawal"
//
// and the BOM printed the internal category key `lag_bolt` as the CATEGORY label
// of a row whose own description reads "SS304 5.0 mm x 90 mm wood screw".
//
// A lag bolt and a wood screw have different withdrawal bases (NDS 12.2 lag
// screws vs 12.3 wood screws), and cutting a truss chord voids its engineering
// where notching a rafter does not. On a structural sheet these are not wording
// preferences.
//
// ── AND A SECTION THAT NO LONGER EXISTS ───────────────────────────────────
// PV-4A printed "NEC 690.41, 690.5" under a NEC 2020 title block. 690.5
// (Ground-Fault Protection) was DELETED in the 2017 reorganisation of Article
// 690 Part III and its requirement folded into 690.41(B) — so the sheet cited a
// retired section beside the one that replaced it. A plan reviewer who opens
// 690.5 in a 2020 code book finds nothing.
//
// MUTATION: select a true lag-bolt system and the prose must say LAG BOLT again.
// The noun is projected, not substituted.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { necSection, necRequires, RETIRED_SECTIONS } from '@/lib/nec/citations';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function build(mutate?: (i: any) => void) {
  const input: any = clone(braidonOriginalAuditFixture);
  input.plansetProfile = 'design-review';
  mutate?.(input);
  const html = generatePermitHTML(input) as unknown as string;
  const text = html.replace(/<[^>]+>/g, ' ')
    .replace(/&mdash;/g, '—').replace(/&sect;/g, '§').replace(/\s+/g, ' ');
  return { input, text };
}

describe('the prose names the SELECTED hardware', () => {
  const { text } = build();

  it('a wood-screw design never says lag bolt', () => {
    expect(text).not.toMatch(/[Ll]ag [Bb]olt/);
    expect(text).not.toMatch(/LAG BOLT/);
  });

  it('a truss design never says rafter capacity', () => {
    expect(text).not.toMatch(/rafter capacity/i);
    expect(text).toMatch(/truss capacity/i);
  });

  it('the page conclusion names both correctly', () => {
    expect(text).toMatch(/wood screw attachment system have been analyzed/);
    expect(text).toMatch(/dead load, truss capacity, and attachment withdrawal/);
  });

  it('the BOM category cannot contradict its own description', () => {
    // the internal key `lag_bolt` was printed as the visible category
    expect(text).toMatch(/attachment fastener/);
    const i = text.indexOf('SS304 5.0 mm x 90 mm wood screw');
    expect(i).toBeGreaterThan(-1);
    expect(text.slice(Math.max(0, i - 200), i)).not.toMatch(/lag bolt/i);
  });

  it('MUTATION — a true lag-bolt system says LAG BOLT again', () => {
    // The noun is PROJECTED from the selected fastener, not globally replaced.
    const { text: t2 } = build(i => {
      i.project.mountingSystemId = 'ironridge-xr100';   // 5/16" lag to rafter
    });
    expect(t2).toMatch(/lag bolt/i);
  });
});

describe('a retired NEC section cannot be cited', () => {
  it('690.5 is recorded as retired in every adoptable edition', () => {
    for (const ed of ['2017', '2020', '2023'] as const) {
      expect(RETIRED_SECTIONS[ed]).toContain('690.5');
    }
  });

  it('the ground-fault requirement resolves to the section that replaced it', () => {
    for (const ed of ['2017', '2020', '2023'] as const) {
      expect(necSection('pv-ground-fault-protection', ed)).toBe('690.41(B)');
    }
    expect(necRequires('pv-ground-fault-protection')).toMatch(/ground-fault protection/i);
  });

  it('and no retired section appears in the rendered package', () => {
    const { text } = build();
    for (const ed of ['2020'] as const) {
      for (const retired of RETIRED_SECTIONS[ed] ?? []) {
        // word-boundary: 690.5 must not match 690.54 / 690.56
        const re = new RegExp(retired.replace('.', '\\.') + '(?![0-9])');
        expect(text, `retired ${retired} is cited`).not.toMatch(re);
      }
    }
  });

  it('PV-4A cites 690.41(B) and states what it requires', () => {
    const { text } = build();
    expect(text).toMatch(/Ground-Fault Protection/);
    expect(text).toMatch(/NEC 690\.41\(B\)/);
    expect(text).toMatch(/dc ground-fault protection for a PV system/);
  });
});
