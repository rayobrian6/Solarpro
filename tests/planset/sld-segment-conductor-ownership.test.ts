// ═══════════════════════════════════════════════════════════════════════════
// THE PV CONDUCTORS RAN THROUGH THE EXISTING SERVICE ON E-1
//
// The SLD drew the PV feeder package on the MSP bus-out → utility-meter span:
//
//     3#6 THWN-2 · 1×#10 AWG GRN EGC · IN 3/4" EMT
//
// That span is the building's EXISTING SERVICE ENTRANCE — conductors that were
// in the ground before this project and that nobody on this job installs. The
// renderer's fallback for it was literally the PV feeder's own conductor
// package, so whenever the canonical run carried no bundle the drawing showed
// the PV tap conductors continuing straight through the meter to the grid.
//
// A reviewer reads that as "the PV #6 THWN-2 IS the service entrance", which is
// wrong about what is installed, wrong about what is existing, and wrong about
// where this project's scope ends.
//
// A segment may not inherit the preceding segment's conductor inventory. When
// the existing service has not been surveyed the label says so — the same
// wording the SLD's other branch has always used for this span.
//
// MUTATION: change the PV tap conductor size and ONLY the PV segments move.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

/** The SLD's own text, in drawing order. */
function sldText(mutate?: (i: any) => void): string {
  const input: any = clone(braidonOriginalAuditFixture);
  input.plansetProfile = 'design-review';
  mutate?.(input);
  const html = generatePermitHTML(input) as unknown as string;
  const t = html.replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"').replace(/&mdash;/g, '—').replace(/&times;/g, '×')
    .replace(/\s+/g, ' ');
  const i = t.indexOf('SINGLE LINE DIAGRAM');
  expect(i, 'the package must contain a single-line diagram').toBeGreaterThan(-1);
  return t.slice(i, i + 2200);
}

describe('a segment carries its own conductors, and only its own', () => {
  const sld = sldText();

  it('the existing service entrance is labelled as existing', () => {
    expect(sld).toMatch(/EXISTING SERVICE CONDUCTORS/);
    expect(sld).toMatch(/200A SERVICE — FIELD VERIFY/);
  });

  it('the PV package appears on the PV segments and stops at the tap', () => {
    // combiner→disconnect and disconnect→tap both legitimately carry it…
    const pv = [...sld.matchAll(/3#6 THWN-2/g)];
    expect(pv.length, 'the two PV feeder/tap spans').toBe(2);
    // …and the LAST occurrence must precede the existing-service label, i.e. the
    // PV inventory does not continue past the tap point.
    const lastPv = sld.lastIndexOf('3#6 THWN-2');
    const existing = sld.indexOf('EXISTING SERVICE CONDUCTORS');
    expect(lastPv).toBeLessThan(existing);
  });

  it('the drawing order is PV → tap → existing service → meter → grid', () => {
    const order = ['AC DISCONNECT', 'SUPPLY SIDE TAP', 'EXISTING SERVICE CONDUCTORS',
      'UTILITY METER', 'UTILITY GRID'];
    let last = -1;
    for (const tok of order) {
      const i = sld.indexOf(tok);
      expect(i, `${tok} missing from the SLD`).toBeGreaterThan(-1);
      expect(i, `${tok} out of order`).toBeGreaterThan(last);
      last = i;
    }
  });
});

describe('MUTATION — resize the PV conductor and the service span does not follow', () => {
  it('a smaller array moves BOTH PV spans and leaves the service untouched', () => {
    const spans = (t: string): string[] => (t.match(/\d#\d+ THWN-2/g) ?? []) as string[];
    const before = sldText();
    // Shrink the design so the AC current — and therefore the feeder and tap
    // conductor size — genuinely changes at its own source.
    const after = sldText(i2 => {
      i2.project.panelPositions = (i2.project.panelPositions ?? []).slice(0, 11);
      if (i2.layout?.panels) i2.layout.panels = i2.layout.panels.slice(0, 11);
      i2.project.numberOfPanels = 11;
      if (i2.system) i2.system.totalPanels = 11;
    });

    // the mutation really moved the PV conductors (this test is not vacuous)…
    expect(spans(after)).not.toEqual(spans(before));
    expect(spans(before).some(x => x.includes('#6'))).toBe(true);
    expect(spans(after).some(x => x.includes('#6'))).toBe(false);

    // …and the existing service is byte-identical either way
    expect(after).toMatch(/EXISTING SERVICE CONDUCTORS/);
    expect(after).toMatch(/200A SERVICE — FIELD VERIFY/);
    const tail = after.slice(after.indexOf('EXISTING SERVICE CONDUCTORS'));
    expect(tail.slice(0, 120)).not.toMatch(/THWN-2/);
    expect(tail.slice(0, 120)).not.toMatch(/GRN EGC/);
  });

  it('the service-span fallback is the existing-service label, in the source', async () => {
    const src = await import('node:fs').then(fs =>
      fs.readFileSync('lib/sld-professional-renderer.ts', 'utf8'));
    // The block that draws MSP bus-out → utility meter must fall back to the
    // EXISTING-service wording, never to the AC feeder's conductor package.
    const m = src.match(/const run = mspUtilRun;[\s\S]{0,2000}?const \{lines, cnt\} = runLines/);
    expect(m, 'the MSP→meter block must exist').toBeTruthy();
    const block = m![0].replace(/\/\/.*/g, ' ');   // its comments explain the old bug
    expect(block).toContain('EXISTING SERVICE CONDUCTORS');
    expect(block).not.toMatch(/_acConductorCount/);
    expect(block).not.toMatch(/_acWireNum/);
  });
});
