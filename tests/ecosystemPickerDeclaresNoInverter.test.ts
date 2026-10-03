// ═══════════════════════════════════════════════════════════════════════════
// 🚨 "INVERTER: — NONE —" IS A DECLARATION, AND THE PICKER COULD NOT MAKE IT
//
// Ray, 2026-10-02, with the screen in front of him — Tesla selected, Powerwall 3 selected,
// Inverter: — None —, and two `Tesla Solar Inverter 5.7kW` still in Inverters & Strings:
//
//   "Still not fucking fixed. This entire fucking problem can be wired into the ecosystem picker.
//    I literally pick equipment. I could select the right equipment. Thats why I said the topology
//    could be converted to the sys config page."
//
// He is right, and the reason it did nothing is three lines of plumbing:
//
//   · `EcosystemApplyPayload.selections.inverterId` is OPTIONAL;
//   · the "— None —" option has `value=""`, so `selectedInverter || undefined` sends NOTHING;
//   · the host acts only `if (payload.selections.inverterId)`, and the documented behaviour of the
//     absent case is to PRESERVE the existing fleet ("The user's existing solar inverter choice is
//     preserved (parent handler only touches inverterId if present)", EcosystemPicker.tsx:633).
//
// So an explicit NONE was byte-identical to "did not choose", and the auto-picked phantom survived
// the one act in the product that was supposed to declare the system. Same disease as the rest of
// this gauntlet: ABSENCE READ AS NO-OPINION, where the user meant a decision.
//
// These are source assertions on LIVE lines (the component needs jsdom + RTL, which this suite does
// not set up) — but they assert the three specific links in the chain, and each was mutation-checked
// by restoring the original bytes.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const src = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
/** Lines that actually run — a guard that matches its own explanatory comment proves nothing. */
const live = (...p: string[]) => src(...p)
  .split('\n')
  .filter(l => {
    const t = l.trim();
    return t.length > 0 && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
  });

describe('🚨 THE PICKER CAN DECLARE "NO SEPARATE PV INVERTER"', () => {
  it('🚨 the payload carries the declaration as its own field', () => {
    const l = live('components', 'engineering', 'EcosystemPicker.tsx');
    expect(l.some(x => x.includes('inverterExplicitlyNone?: boolean')),
      'the apply payload still cannot distinguish "chose none" from "did not choose", so an '
      + 'explicit NONE reaches the host as an absent key').toBe(true);
  });

  it('🚨 handleApply sets it from an explicit empty selection', () => {
    const l = live('components', 'engineering', 'EcosystemPicker.tsx');
    const i = l.findIndex(x => x.includes('inverterExplicitlyNone:'));
    expect(i, 'handleApply never sets the declaration').toBeGreaterThan(-1);
    const expr = l.slice(i, i + 3).join(' ');

    expect(expr, 'the declaration does not require an empty inverter selection')
      .toContain('!selectedInverter');
    // 🚨 A battery-only kit has no inverter to decline, so an empty dropdown there is absence.
    expect(expr, 'the declaration fires on an ecosystem that offers no inverter at all, where '
      + 'an empty dropdown means nothing').toContain('offersInverter');
  });

  it('🚨 and ONLY where "none" has one meaning — the storage takes the PV on DC', () => {
    const l = live('components', 'engineering', 'EcosystemPicker.tsx');
    const i = l.findIndex(x => x.includes('inverterExplicitlyNone:'));
    const expr = l.slice(i, i + 3).join(' ');

    // 🚨 THE BLAST RADIUS. Ray: "every auto pick selection works for installs that do not have
    // batteries. Do not fuck my entire website up because we are getting 1 real world scenario to
    // work." On a SolarEdge or Enphase kit with no DC-PV-capable battery, an empty dropdown keeps
    // meaning "leave it alone" exactly as it did before.
    expect(
      expr.includes('pvCoupledToStorage') || expr.includes('pickedBatteryTakesPvOnDc'),
      'the declaration is no longer scoped to a DC-PV-capable design, so leaving the inverter '
      + 'dropdown empty on ANY brand would now wipe the fleet',
    ).toBe(true);
  });

  it('🚨 the capability is read off the battery the installer actually picked', () => {
    const l = live('components', 'engineering', 'EcosystemPicker.tsx');
    const i = l.findIndex(x => x.includes('const pickedBatteryTakesPvOnDc'));
    expect(i, 'the declaration depends only on the service graph being loaded and hydrated — a '
      + 'different store than the one the installer is looking at').toBeGreaterThan(-1);
    const expr = l.slice(i, i + 2).join(' ');
    expect(expr).toContain('selectedBattery');
    expect(expr, 'the check does not read the published PV input').toContain('pvInput');
  });
});

describe('🚨 AND THE HOST ACTS ON IT', () => {
  it('🚨 an explicit NONE empties the fleet', () => {
    const l = live('app', 'engineering', 'page.tsx');
    const i = l.findIndex(x => x.includes('} else if (payload.selections.inverterExplicitlyNone)'));
    expect(i, 'the host still only acts when an inverter IS picked, so an explicit NONE preserves '
      + 'the phantom fleet').toBeGreaterThan(-1);

    const body = l.slice(i, i + 4).join(' ');
    expect(body, 'the branch does not clear the inverters').toContain('updates.inverters = []');
  });

  it('🚨 the decision is RECORDED on the project, not only in React state', () => {
    const l = live('app', 'engineering', 'page.tsx');
    const i = l.findIndex(x => x.includes('payload.selections.inverterExplicitlyNone && currentProjectId'));
    expect(i, 'clearing the fleet is never persisted as an architecture, so the server model still '
      + 'reads selected_equipment and the next writer re-seeds').toBeGreaterThan(-1);

    const body = l.slice(i, i + 3).join(' ');
    expect(body, 'the architecture is not recorded through the resolution route')
      .toContain("resolveElectricalArchitecture('dc-coupled-storage')");
  });

  it('🚨 CONTROL — the auto-apply rebuild cannot undo the declaration 150ms later', () => {
    const l = live('app', 'engineering', 'page.tsx');
    const i = l.findIndex(x => x.includes("if (controlMode === 'auto' && sizingAutoApply"));
    expect(i, 'the post-apply rebuild is gone').toBeGreaterThan(-1);

    // That block clears `userHasEditedInverters` and re-applies the whole-project recommendation.
    // Without this exclusion it would overwrite the empty fleet moments after it was honoured.
    const guard = l.slice(i, i + 3).join(' ');
    expect(guard, 'the auto-apply rebuild still runs after an explicit NONE, so the declaration is '
      + 'overwritten by the recommendation it was supposed to refuse')
      .toContain('!payload.selections.inverterExplicitlyNone');
  });

  it('🚨 CONTROL — picking an inverter still applies it, unchanged', () => {
    const l = live('app', 'engineering', 'page.tsx');
    const i = l.findIndex(x => x.includes('if (payload.selections.inverterId) {'));
    expect(i, 'the normal ecosystem apply path is gone — every brand that picks an inverter is '
      + 'broken').toBeGreaterThan(-1);
  });
});
