// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE PERMIT WAS THE PERMISSIVE ONE
//
// When a battery could not be resolved from the catalogue, `lib/computed-system.ts`
// did exactly one thing about it:
//
//     if (_batteryUnresolved) {
//       console.warn('[COMPUTED-SYSTEM] at least one battery could not be resolved;',
//         'its NEC 705.12(B) contribution is MISSING from the busbar total, which is',
//         'therefore incomplete — do not read interconnectionPass as a clearance.');
//     }
//
// — and then the very next lines computed that clearance and shipped it.
//
// It reaches the AHJ two ways:
//   · `lib/permit/snapshot/computeSystemProjection.ts`:68 projected
//     `cs.interconnectionPass` as the busbar `passes`, which becomes PV-4A's
//     printed 120 % verdict. A design that should be PENDING printed PASS.
//   · `backfeedBreakerAmps` is exposed as solar + battery COMBINED
//     (computed-system.ts:2948 `backfeedBreakerAmps: totalBackfeedA`), so with the
//     battery term absent the printed total is understated too.
//
// `lib/electrical-calc.ts`, running on the same design for the engineering page,
// refuses outright with E-BATTERY-BACKFEED-UNRESOLVED. So the two engines
// disagreed, and the one that goes to the plan reviewer was the permissive one.
//
// THE CONCLUSION IS 'UNRESOLVED', NOT 'FAIL'. The rule was never evaluated; it did
// not fail. So the fix routes into the snapshot's EXISTING tri-state
// `rulePasses: boolean | null`, which PV-4A already renders as PENDING, and adds a
// blocking release gate so a package cannot ship with a verdict nobody reached.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { computeSystem } from '@/lib/computed-system';
import { resolveBatteryBranch, BATTERIES } from '@/lib/equipment-db';
import { mapComputedSystemToCompliance } from '@/lib/permit/snapshot/computeSystemProjection';
import { csStringInput } from './goldens/wave0-fixtures';

/** A battery id that cannot resolve — deliberately not a catalogue entry. */
const GHOST = 'battery-that-is-not-in-the-catalogue';

function withBattery(batteryIds: string[], over: Record<string, unknown> = {}) {
  return computeSystem({
    ...csStringInput(),
    batteryIds,
    batteryCount: batteryIds.length,
    interconnectionMethod: 'LOAD_SIDE',
    panelBusRating: 200,
    mainPanelAmps: 100,
    ...over,
  } as never);
}

describe('🚨 an unresolved battery cannot clear NEC 705.12(B)', () => {
  it('PRECONDITION: the ghost id really does not resolve, and a real one does', () => {
    // If the ghost ever resolves, every case below is vacuous.
    expect(resolveBatteryBranch(GHOST, 1).resolved,
      'the ghost battery id resolved — this suite proves nothing').toBe(false);
    const real = BATTERIES.find(b => resolveBatteryBranch(b.id, 1).resolved);
    expect(real, 'no catalogue battery resolves — the control group is empty').toBeTruthy();
  });

  it('says so on the RESULT, not only in a console warning', () => {
    const cs = withBattery([GHOST]);
    expect(cs.interconnectionUnresolved,
      'the refusal is still invisible to every consumer').toBe(true);
    expect(cs.batteryRefusal, 'no reason was carried out').toBeTruthy();
    expect(cs.batteryRefusal!, 'the reason does not name the rule that was not evaluated')
      .toMatch(/705\.12\(B\)/);
    expect(cs.batteryRefusal!).toMatch(/NOT EVALUATED/i);
  });

  it('raises a blocking-severity issue a gate consumer can read', () => {
    const cs = withBattery([GHOST]);
    const issue = cs.issues.find(i => i.code === 'BATTERY_BACKFEED_UNRESOLVED');
    expect(issue, 'no issue was raised for the missing busbar term').toBeTruthy();
    expect(issue!.severity).toBe('error');
    expect(issue!.necReference).toBe('NEC 705.12(B)');
    // An unresolved value must be actionable, not just reported.
    expect(issue!.suggestion, 'the refusal tells the installer nothing to do').toBeTruthy();
  });

  it('🚨 the projected busbar verdict is null — PENDING, not PASS and not FAIL', () => {
    // This is the assertion that matters: null is what PV-4A already renders as
    // PENDING. Statically imported and named, so a rename breaks the build instead
    // of silently selecting some other exported function and passing vacuously.
    const cs = withBattery([GHOST]);
    const proj = mapComputedSystemToCompliance(cs as never, {
      busRatingA: 200, mainBreakerA: 100, interconnectionMethod: 'LOAD_SIDE',
    } as never);
    expect((proj.busbar as { passes?: unknown }).passes,
      'an unresolved 120% rule still projects a boolean verdict to PV-4A').toBeNull();
  });

  it('a supply-side tap is unaffected — NEC 705.11 has no busbar loading concern', () => {
    const cs = withBattery([GHOST], { interconnectionMethod: 'SUPPLY_SIDE_TAP' });
    const proj = mapComputedSystemToCompliance(cs as never, {
      busRatingA: 200, mainBreakerA: 100, interconnectionMethod: 'SUPPLY_SIDE_TAP',
    } as never);
    expect((proj.busbar as { passes?: unknown }).passes,
      'the refusal leaked onto a supply-side tap, where the 120% rule does not apply',
    ).toBe(true);
  });

  it('a RESOLVABLE battery is unaffected — the refusal is not a blanket refusal', () => {
    const real = BATTERIES.find(b => resolveBatteryBranch(b.id, 1).resolved)!;
    const cs = withBattery([real.id]);
    expect(cs.interconnectionUnresolved,
      'a perfectly resolvable battery was refused — the gate became a wall').toBe(false);
    expect(cs.batteryRefusal).toBeNull();
    expect(cs.issues.some(i => i.code === 'BATTERY_BACKFEED_UNRESOLVED')).toBe(false);
    expect(typeof cs.interconnectionPass).toBe('boolean');
  });

  it('a design with NO battery at all is unaffected', () => {
    const cs = withBattery([]);
    expect(cs.interconnectionUnresolved).toBe(false);
    expect(cs.batteryRefusal).toBeNull();
  });

  it('ONE unresolved battery among several poisons the total — a partial sum is not a sum', () => {
    const real = BATTERIES.find(b => resolveBatteryBranch(b.id, 1).resolved)!;
    const cs = withBattery([real.id, GHOST]);
    expect(cs.interconnectionUnresolved,
      'a fleet with one unknown unit was treated as fully resolved').toBe(true);
  });

  it('the understated backfeed total is the second consequence, and it is visible', () => {
    // backfeedBreakerAmps is exposed as solar+battery combined. With the battery
    // term missing it is solar-only — lower than the truth, in the permissive
    // direction, and it reaches poi.backfeedA on the snapshot.
    const real = BATTERIES.find(b => resolveBatteryBranch(b.id, 1).resolved)!;
    const resolved = withBattery([real.id]);
    const ghosted  = withBattery([GHOST]);
    expect(ghosted.backfeedBreakerAmps,
      'the unresolved design reports the same backfeed as the resolved one — '
      + 'then the battery contributes nothing either way and this case is blind',
    ).toBeLessThan(resolved.backfeedBreakerAmps);
    // And because it is understated, the flag is the only thing standing between
    // that number and a reader who trusts it.
    expect(ghosted.interconnectionUnresolved).toBe(true);
  });
});
