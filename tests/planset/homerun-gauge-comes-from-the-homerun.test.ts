// ═══════════════════════════════════════════════════════════════════════════
// PV-4B's HOME-RUN ROW PRINTED THE OPEN-AIR BRANCH'S CONDUCTOR GAUGE
//
// The Branch Home-Run row on the conductor schedule is built entirely from
// `projectSharedBranchRaceway(_snap)` — the circuit count, the current-carrying count,
// the voltage drop, the conduit label, the fill, the length. Every cell but ONE:
//
//     <td>${_hr.currentCarryingCount ?? '—'}×${_branch.gauge ?? '#10 AWG'} …
//
// `_branch` is `projectCanonicalBranch` — the OPEN-AIR Q-Cable trunk (BRANCH_RUN).
// `_hr` is the shared jbox→combiner conduit (BRANCH_HOMERUN_RUN). computed-system keeps
// them deliberately distinct: "BRANCH_RUN is the OPEN-AIR Q-Cable trunk … the shared
// conduit home-run is a SEPARATE segment", and this very row's comment says "Never one
// merged whole-branch string spanning two wiring methods".
//
// 🚨 THE FIELD IT SHOULD HAVE READ DOCUMENTS THE MISTAKE BY NAME.
// `SharedBranchRaceway.conductorGauge` is commented "§1 — the home-run PHASE conductor
// gauge (from BRANCH_HOMERUN_RUN — the #10 the SVG/E-1 must print, NEVER the legacy
// #12-from-OCPD branch gauge)". E-1's physical schedule reads it, with it in
// `requiredValues` so E-1 pends honestly when it is absent; the SLD's SEGMENT_2A reads
// it. PV-4B was the one consumer that did not.
//
// The two are sized INDEPENDENTLY. Back-population sets each run's gauge from its own
// segment-schedule row, and only the home-run carries the NEC 310.15(C)(1) count
// adjustment for its bundle — so a fully loaded design sizes the home-run UP while this
// cell went on printing the open-air size, and nothing reconciled the two.
//
// The `?? '#10 AWG'` fallback went with it. It was the exact literal the comment twenty
// lines above condemns the old code for hardcoding, and an absent gauge must PEND like
// every other unestablished value on this sheet rather than name a conductor.
//
// 🚨 WHAT THIS FILE PROVES, HONESTLY. On the Braidon fixture the two segments resolve
// to the SAME gauge, so a rendered-output comparison alone cannot tell the two sources
// apart — that is precisely why the defect survived. The divergence cannot be injected
// from a fixture either: both gauges are computed during generation from the design,
// not read from the input. So there are two guards here, and each is labelled with
// what it can and cannot see.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { projectSharedBranchRaceway } from '@/lib/permit/snapshot/electricalProjection';
import { stripComments } from '../support/stripSource';

const ROOT = join(__dirname, '..', '..');

describe('the printed home-run gauge agrees with the home-run authority', () => {
  it('PV-4B prints exactly what projectSharedBranchRaceway reports', () => {
    // A CONSISTENCY guard. It cannot distinguish the two sources while they agree,
    // which they do here — see the header. It does catch the cell being re-pointed at
    // anything that disagrees with the authority, which is the failure mode.
    const input: any = JSON.parse(JSON.stringify(braidonOriginalAuditFixture));
    input.plansetProfile = 'design-review';
    const html = generatePermitHTML(input) as unknown as string;
    const snap = (input as any)._snapshot;
    expect(snap, 'no snapshot was attached — this guard is blind').toBeTruthy();

    const hr = projectSharedBranchRaceway(snap);
    if (!hr.present) return;   // no shared home-run on this design; nothing to compare

    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const m = text.match(/Branch Home-Run.*?(\d+)×(#[\w\/]+ AWG|PENDING)\s+THWN-2\s+\(shared\)/);
    expect(m, 'the Branch Home-Run row did not render a conductor cell').toBeTruthy();

    const printed = m![2];
    const expected = hr.conductorGauge ?? 'PENDING';
    expect(printed,
      `PV-4B prints ${printed} for the shared home-run while the home-run authority says ${expected}`)
      .toBe(expected);
  });

  it('and the current-carrying count in the same cell is the home-run\'s', () => {
    // The two halves of one cell must come from one place. They already did — this
    // notices if the repair is ever undone by re-pointing the gauge alone again.
    const input: any = JSON.parse(JSON.stringify(braidonOriginalAuditFixture));
    input.plansetProfile = 'design-review';
    const html = generatePermitHTML(input) as unknown as string;
    const hr = projectSharedBranchRaceway((input as any)._snapshot);
    if (!hr.present || hr.currentCarryingCount == null) return;
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const m = text.match(/Branch Home-Run.*?(\d+)×/);
    expect(m).toBeTruthy();
    expect(Number(m![1])).toBe(hr.currentCarryingCount);
  });
});

describe('the source of that one cell', () => {
  // A SOURCE guard, because the behavioural one above is blind while the two segments
  // agree. It is anchored on the row's own delimiters rather than on a line number or
  // a neighbouring identifier — anchors of that kind have died of correct changes in
  // this repo repeatedly.
  const SRC = stripComments(
    readFileSync(join(ROOT, 'lib', 'permit', 'sections', 'electricalPages.ts'), 'utf8'),
  );

  const cell = (() => {
    const at = SRC.indexOf('THWN-2 (shared)');
    expect(at, 'the shared home-run conductor cell is gone — this guard is blind')
      .toBeGreaterThan(-1);
    const from = SRC.lastIndexOf('<td>', at);
    return SRC.slice(from, at);
  })();

  it('🚨 reads the HOME-RUN projection, not the open-air branch', () => {
    expect(cell, 'the shared home-run cell is reading the open-air branch gauge again')
      .toMatch(/_hr\.conductorGauge/);
    expect(cell, '`_branch` is the OPEN-AIR Q-Cable trunk — a different physical run')
      .not.toMatch(/_branch\.gauge/);
  });

  it('🚨 names no conductor when the authority has none', () => {
    // The old fallback invented `#10 AWG` — the literal this file's neighbouring
    // comment condemns the previous code for hardcoding — and printed it beside a REAL
    // current-carrying count and a REAL fill, so it read as computed.
    expect(cell, 'an absent home-run gauge must PEND, never name a conductor')
      .not.toMatch(/#\d+(\/\d+)? AWG/);
  });
});
