// ═══════════════════════════════════════════════════════════════════════════
// TWO FACTS THAT DISAGREED WITH THEMSELVES ON THE SAME PACKAGE
//
// ── THE FUSE CLASS ────────────────────────────────────────────────────────
// E-1 printed  "60A FUSIBLE DISCONNECT — 60A RK5 FUSES · Eaton DPF222RP ·
// 2× Littelfuse LLNRK60SP"  and the equipment schedule printed  "60A 250V
// Class RK1 time-delay fuse"  — for the same two fuses in the same switch.
//
// LLNRK is Littelfuse's POWR-PRO 250 V time-delay line and is Class **RK1**.
// The drawing label had "RK5" typed into its template while the resolver right
// beside it selected the part. RK1 and RK5 differ in interrupting and
// let-through characteristics; RK1 is the current-limiting class, and an RK5
// called out where an RK1 is required is a coordination error a plan reviewer
// is entitled to fail. The class is a property OF the selected fuse and is now
// returned with the part number that carries it.
//
// While proving that: lib/electrical/acDisconnect.ts was written because
// bom-engine-v4 held duplicate frame/fuse/part rules. Two copies were retired
// then; TWO MORE were still there, re-deriving the frame ladder, the Eaton part
// map, the make and the fuse independently.
//
// ── THE CONDUIT FILL ──────────────────────────────────────────────────────
// PV-4A's "Conduit Fill Analysis — NEC Chapter 9" read 32.0%. Every physical
// raceway on the package read 26.2% / 32.5% / 32.5%. 32.0% described no conduit
// in the design: `projectCanonicalFeeder` preferred `feeder.conduit.fillPct`,
// computed by electrical-calc.ts's own parallel Chapter 9 tables from a nominal
// conductor count, over `segment.fillPct`, read off the PHYSICAL RACEWAY OBJECT
// that E-1's schedule prints and the ampacity derations are taken against.
//
// A raceway's fill is a property of that raceway.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';
import { resolveAcDisconnect } from '@/lib/electrical/acDisconnect';
import { projectCanonicalFeeder } from '@/lib/permit/snapshot/electricalProjection';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const input: any = clone(braidonOriginalAuditFixture);
input.plansetProfile = 'design-review';
const html = generatePermitHTML(input) as unknown as string;
const snap = input._snapshot as PermitDesignSnapshot;
const text = html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

describe('the fuse class travels with the fuse', () => {
  const spec = resolveAcDisconnect({ requiredAmps: 45, targetAmps: 60, fused: true });

  it('an LLNRK part is Class RK1, and the resolver says so', () => {
    expect(spec.fusePartNumber).toBe('LLNRK60SP');
    expect(spec.fuseClass).toBe('RK1');
    expect(spec.fuseDescription).toBe('60A 250V Class RK1 time-delay fuse');
  });

  it('the drawing label reads the class rather than carrying its own', () => {
    expect(spec.drawingLabel).toBe('60A FUSIBLE DISCONNECT — 60A RK1 FUSES');
    expect(spec.drawingLabel).not.toMatch(/RK5/);
  });

  it('a non-fused switch has no class to state', () => {
    const nf = resolveAcDisconnect({ requiredAmps: 45, targetAmps: null, fused: false });
    expect(nf.fuseClass).toBeNull();
    expect(nf.fuseDescription).toBeNull();
    expect(nf.fusePartNumber).toBeNull();
  });

  it('and RK5 appears nowhere in the package', () => {
    expect(text).not.toMatch(/\bRK5\b/);
    expect(text).toMatch(/\bRK1\b/);
  });

  it('the drawing and the schedule name the SAME class for the same part', () => {
    // The live defect was these two disagreeing. Both must now derive it.
    const classes = new Set(text.match(/Class RK\d|RK\d FUSES/g) ?? []);
    expect([...classes].every(c => /RK1/.test(c)), [...classes].join(' / ')).toBe(true);
  });
});

describe('a raceway fill belongs to that raceway', () => {
  it('the feeder projection reports the PHYSICAL raceway fill', () => {
    const feed = projectCanonicalFeeder(snap);
    // The projection resolves WHICH segment is the feeder; the assertion is that
    // its fill is that segment's own, not a separately computed figure.
    expect(feed.segment, 'the design must carry a feeder segment').toBeTruthy();
    const seg = feed.segment as unknown as {
      segmentId: string; fillPct: number | null; raceway: string | null; tradeSizeIn: string | null;
    };
    expect(feed.fillPct).toBe(seg.fillPct);
    expect(feed.raceway).toBe(seg.raceway);
    expect(feed.tradeSizeIn).toBe(seg.tradeSizeIn);
    // and that segment is one of the design's real raceways
    const real = (snap.electrical?.physicalRaceways ?? [])
      .map(r => r.fillPct).filter((v): v is number => v != null);
    expect(real).toContain(feed.fillPct);
  });

  it('every fill printed in the package is a real raceway value', () => {
    const printed = new Set((text.match(/[Ff]ill(?:\s*Percentage)?[^%\d]{0,12}([\d.]+)\s*%/g) ?? [])
      .map(s => (s.match(/([\d.]+)\s*%/) ?? [])[1]));
    const real = new Set((snap.electrical?.physicalRaceways ?? [])
      .map(r => r.fillPct).filter((v): v is number => v != null).map(v => v.toFixed(1)));
    expect(real.size).toBeGreaterThan(0);
    for (const p of printed) {
      expect(real.has(p!), `${p}% is printed but no raceway has it (real: ${[...real].join(', ')})`).toBe(true);
    }
  });

  it('and 32.0% — the parallel engine\'s answer — is gone', () => {
    // The number that described no conduit in the design.
    expect(text).not.toMatch(/Fill Percentage[^%]{0,12}32\.0%/);
  });
});
