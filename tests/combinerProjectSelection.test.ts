/**
 * tests/combinerProjectSelection.test.ts
 *
 * COMPATIBILITY VALIDATES. THE INSTALLER SELECTS. DOWNSTREAM CONSUMES.
 *
 * "The SLD is currently showing an IQ Combiner 6C. I am still installing IQ
 * Combiner 5C." Nobody chose the 6C: an inverter lookup missed, the pairing came
 * back undefined, and `?? getBosDevice('enphase-iq-combiner-6c')` named a
 * product. This file pins the authority that replaces that.
 *
 * The rule the tests below encode, in the order it matters:
 *   project selection  >  session override  >  declared compatibility  >  nothing
 * and "nothing" must be VISIBLE rather than resolved into the newest product.
 */

import { describe, it, expect } from 'vitest';
import {
  COMBINER_SELECTION_KEY,
  combinerBasisFor,
  combinerBasisIsDecided,
  combinerSelectionPatch,
  judgeCombinerCompatibility,
  planCombinerClear,
  planCombinerSelection,
  readCombinerSelection,
  selectedCombinerDeviceId,
  type CombinerDeviceFacts,
  type CombinerSelectionStore,
} from '@/lib/combinerSelection/service';

const FIVE_C = 'enphase-iq-combiner-5c';
const SIX_C = 'enphase-iq-combiner-6c';

const CATALOGUE: Record<string, CombinerDeviceFacts> = {
  [FIVE_C]: { id: FIVE_C, manufacturer: 'Enphase', model: 'IQ Combiner 5C' },
  [SIX_C]: { id: SIX_C, manufacturer: 'Enphase', model: 'IQ Combiner 6C', modelNumber: 'X-IQ-AM1-240-6C' },
};
const lookupDevice = (id: string) => CATALOGUE[id] ?? null;

const ACTOR = { id: 'ray@example.com', kind: 'user' as const };
const AT = '2026-09-21T12:00:00.000Z';

function select(over: Partial<Parameters<typeof planCombinerSelection>[0]> = {}) {
  return planCombinerSelection({
    deviceId: FIVE_C,
    lookupDevice,
    inverterId: 'enphase-iq8m',
    declaredCompatibleIds: null,
    actor: ACTOR,
    atIso: AT,
    basis: 'This is what we stock and fit.',
    current: null,
    ...over,
  });
}

describe('an absent pairing is NOT incompatibility', () => {
  it('🚨 a device the catalogue never named is still selectable', () => {
    // The catalogue declares `compatibleWith: ['enphase-iq-combiner-5']` on the
    // IQ8 rows, and Enphase documents IDENTICAL IQ6/IQ7/IQ8 support on BOTH
    // combiners — so that list is incomplete, not authoritative. Refusing a 6C
    // because the catalogue is missing data would be the software deciding.
    const r = select({ deviceId: SIX_C, declaredCompatibleIds: null });
    expect(r.ok).toBe(true);
    expect(r.next!.active!.combinerDeviceId).toBe(SIX_C);
    expect(r.next!.active!.compatibility.declaredCompatible).toBe(false);
    expect(r.next!.active!.compatibility.source).toMatch(/not stated.*not "not compatible"|incomplete/i);
  });

  it('an EMPTY declared list is treated as "not stated", not as "nothing works"', () => {
    const j = judgeCombinerCompatibility({ deviceId: SIX_C, inverterId: 'x', declaredCompatibleIds: [] });
    expect(j.declaredCompatibleIds).toBeNull();
    const r = select({ deviceId: SIX_C, declaredCompatibleIds: [] });
    expect(r.ok).toBe(true);
  });
});

describe('a declared list that EXCLUDES the device is a real conflict', () => {
  it('🚨 it is REFUSED — and never silently substituted', () => {
    const r = select({ deviceId: SIX_C, declaredCompatibleIds: [FIVE_C] });
    expect(r.ok).toBe(false);
    expect(r.next, 'nothing may be written on a refusal').toBeNull();
    expect(r.refusals.map(x => x.code)).toContain('NOT_A_CANDIDATE');
    // The message must offer the override, not offer a different product.
    expect(r.refusals[0].message).toMatch(/will not be substituted/i);
  });

  it('stated engineering authority admits it, and is recorded', () => {
    const r = select({
      deviceId: SIX_C,
      declaredCompatibleIds: [FIVE_C],
      compatibilityOverride: { reason: 'Battery job — 10C requires the 6C.', authority: 'Enphase TEB-00282' },
    });
    expect(r.ok).toBe(true);
    expect(r.next!.active!.compatibilityOverride!.authority).toBe('Enphase TEB-00282');
    // …and the conflict is still on the record, not erased by the override.
    expect(r.next!.active!.compatibility.declaredCompatible).toBe(false);
  });

  it('an override without an authority is refused — there is no boolean force', () => {
    const r = select({
      deviceId: SIX_C,
      declaredCompatibleIds: [FIVE_C],
      compatibilityOverride: { reason: 'because', authority: '  ' },
    });
    expect(r.ok).toBe(false);
    expect(r.refusals.map(x => x.code)).toContain('OVERRIDE_INCOMPLETE');
  });
});

describe('a selection must be owned and justified', () => {
  it('refuses with no actor', () => {
    expect(select({ actor: null }).refusals.map(x => x.code)).toContain('ACTOR_REQUIRED');
  });
  it('refuses with no basis — this device is named on a permit', () => {
    expect(select({ basis: '   ' }).refusals.map(x => x.code)).toContain('BASIS_REQUIRED');
  });
  it('refuses a device the catalogue has never heard of', () => {
    const r = select({ deviceId: 'acme-combiner-9000' });
    expect(r.ok).toBe(false);
    expect(r.refusals.map(x => x.code)).toContain('UNKNOWN_DEVICE');
  });
  it('reports EVERY reason at once, not just the first', () => {
    // An operator who fixes one field and is refused again for another has been
    // told half the truth twice.
    const r = planCombinerSelection({
      deviceId: '', lookupDevice, inverterId: null, declaredCompatibleIds: null,
      actor: null, atIso: AT, basis: '', current: null,
    });
    const codes = r.refusals.map(x => x.code);
    expect(codes).toContain('DEVICE_REQUIRED');
    expect(codes).toContain('ACTOR_REQUIRED');
    expect(codes).toContain('BASIS_REQUIRED');
  });
});

describe('history is superseded, never overwritten', () => {
  it('re-selecting retires the previous record with who and why', () => {
    const first = select({ deviceId: FIVE_C });
    const second = planCombinerSelection({
      deviceId: SIX_C, lookupDevice, inverterId: 'enphase-iq8m', declaredCompatibleIds: null,
      actor: ACTOR, atIso: '2026-09-22T09:00:00.000Z', basis: 'Adding a 10C battery.',
      current: first.next,
    });
    expect(second.ok).toBe(true);
    expect(second.next!.active!.combinerDeviceId).toBe(SIX_C);
    expect(second.next!.superseded).toHaveLength(1);
    expect(second.next!.superseded[0].combinerDeviceId).toBe(FIVE_C);
    expect(second.next!.superseded[0].supersededBy).toBe(ACTOR.id);
    expect(second.next!.superseded[0].supersededReason).toMatch(/6c/i);
  });

  it('clearing leaves NOTHING selected — it does not revert to a recommendation', () => {
    const first = select();
    const cleared = planCombinerClear({
      actor: ACTOR, atIso: AT, reason: 'Equipment decision reopened.', current: first.next,
    });
    expect(cleared.ok).toBe(true);
    expect(selectedCombinerDeviceId(cleared.next)).toBeNull();
    expect(cleared.next!.superseded).toHaveLength(1);
  });

  it('clearing nothing is refused rather than silently succeeding', () => {
    const r = planCombinerClear({ actor: ACTOR, atIso: AT, reason: 'x', current: null });
    expect(r.ok).toBe(false);
    expect(r.refusals.map(x => x.code)).toContain('NO_ACTIVE_SELECTION');
  });
});

describe('the store round-trips through selected_equipment', () => {
  it('reads back what the patch wrote', () => {
    const store = select().next!;
    const patch = combinerSelectionPatch(store);
    expect(Object.keys(patch)).toEqual([COMBINER_SELECTION_KEY]);
    const back = readCombinerSelection(patch as Record<string, unknown>);
    expect(back!.active!.combinerDeviceId).toBe(FIVE_C);
    expect(selectedCombinerDeviceId(back)).toBe(FIVE_C);
  });

  it('🚨 an ABSENT key reads as null, not as an empty store', () => {
    // "no selection has ever been made" must stay distinguishable from "one was
    // made and then cleared" — they mean different things to a permit reader.
    expect(readCombinerSelection({})).toBeNull();
    expect(readCombinerSelection(null)).toBeNull();
    expect(readCombinerSelection(undefined)).toBeNull();
    const cleared: CombinerSelectionStore = { active: null, superseded: [] };
    expect(readCombinerSelection({ [COMBINER_SELECTION_KEY]: cleared })).not.toBeNull();
  });

  it('a bare id elsewhere in the record is NOT a selection', () => {
    // `engineering_config.combinerId` is the engineering page's private
    // workspace. A selection without an actor and a basis is not one this
    // module will vouch for.
    expect(readCombinerSelection({ combinerId: FIVE_C } as any)).toBeNull();
  });
});

describe('basis — how a consumer came to name this device', () => {
  it('project selection outranks everything', () => {
    expect(combinerBasisFor({
      projectSelectedId: FIVE_C, sessionOverrideId: SIX_C, declaredCompatibleIds: [SIX_C],
    })).toBe('project-selected');
  });
  it('a session override outranks a catalogue recommendation', () => {
    expect(combinerBasisFor({
      projectSelectedId: null, sessionOverrideId: SIX_C, declaredCompatibleIds: [FIVE_C],
    })).toBe('session-override');
  });
  it('a declared pairing is a RECOMMENDATION, not a decision', () => {
    const b = combinerBasisFor({ projectSelectedId: null, sessionOverrideId: null, declaredCompatibleIds: [FIVE_C] });
    expect(b).toBe('declared-compatibility');
    expect(combinerBasisIsDecided(b), 'a recommendation must not read as decided').toBe(false);
  });
  it('🚨 nothing at all is `unresolved-default` and is NOT decided', () => {
    // This is the state that used to print "IQ Combiner 6C" with no
    // qualification. It must now be reportable as undecided.
    const b = combinerBasisFor({ projectSelectedId: null, sessionOverrideId: null, declaredCompatibleIds: null });
    expect(b).toBe('unresolved-default');
    expect(combinerBasisIsDecided(b)).toBe(false);
  });
  it('only an installer decision counts as decided', () => {
    expect(combinerBasisIsDecided('project-selected')).toBe(true);
    expect(combinerBasisIsDecided('session-override')).toBe(true);
  });
});

// ── The consumption side: does the resolver actually obey the selection? ──────
import { resolveIntegratedEquipment, type SystemBosContext } from '@/lib/equipment/integratedBos';
import { MICROINVERTERS } from '@/lib/equipment-db';

const IQ8 = MICROINVERTERS.find(m => /enphase/i.test(m.manufacturer) && /IQ8/i.test(m.model))!;
const ctx = (over: Partial<SystemBosContext> = {}): SystemBosContext => ({
  inverterManufacturer: IQ8.manufacturer,
  inverterModel: IQ8.model,
  isMicro: true,
  totalDevices: 24,
  branchCount: 3,
  hasBattery: false,
  ...over,
});

describe('🚨 downstream CONSUMES the selection — it does not choose', () => {
  it('a selected 5C wins over a declared pairing that says otherwise', () => {
    const plan = resolveIntegratedEquipment(ctx({
      selectedCombinerId: FIVE_C,
      compatibleCombinerIds: ['enphase-iq-combiner-6c'],   // the recommendation disagrees
    }));
    expect(plan.brains?.model).toBe('IQ Combiner 5C');
    expect(plan.combinerBasis).toBe('project-selected');
  });

  it('a selected 6C wins too — the rule is symmetric, not a preference for one product', () => {
    const plan = resolveIntegratedEquipment(ctx({
      selectedCombinerId: SIX_C,
      compatibleCombinerIds: ['enphase-iq-combiner-5'],
    }));
    expect(plan.brains?.model).toBe('IQ Combiner 6C');
    expect(plan.combinerBasis).toBe('project-selected');
  });

  it('the selection outranks a session override as well', () => {
    const plan = resolveIntegratedEquipment(ctx({
      selectedCombinerId: FIVE_C,
      overrideDeviceIds: [SIX_C],
    }));
    expect(plan.brains?.model).toBe('IQ Combiner 5C');
    expect(plan.combinerBasis).toBe('project-selected');
  });

  it('and it changes a CODE STATEMENT, not a label', () => {
    // providesAcDisconnect drives whether the package claims an integral AC
    // disconnecting means. The 6C has one; the 5C is main-lug only.
    const five = resolveIntegratedEquipment(ctx({ selectedCombinerId: FIVE_C }));
    const six  = resolveIntegratedEquipment(ctx({ selectedCombinerId: SIX_C }));
    expect(five.providesAcDisconnect).toBe(false);
    expect(six.providesAcDisconnect).toBe(true);
  });

  it('🚨 a BROKEN selection stays visible — it does not fall through to a guess', () => {
    // An id the BOS catalogue does not know must not quietly become the
    // recommendation. The project said something; we could not honour it; that
    // has to be reportable rather than papered over.
    const plan = resolveIntegratedEquipment(ctx({
      selectedCombinerId: 'acme-combiner-9000',
      compatibleCombinerIds: ['enphase-iq-combiner-5'],
    }));
    expect(plan.devices).toHaveLength(0);
    expect(plan.brains).toBeUndefined();
    expect(plan.combinerBasis).toBe('project-selected');
  });
});

describe('🚨 with NO selection, the fallback must confess', () => {
  it('a declared pairing reports as a recommendation', () => {
    const plan = resolveIntegratedEquipment(ctx({ compatibleCombinerIds: ['enphase-iq-combiner-5'] }));
    expect(plan.combinerBasis).toBe('declared-compatibility');
    expect(combinerBasisIsDecided(plan.combinerBasis!)).toBe(false);
  });

  it('nothing declared reports as UNRESOLVED, even though a device is still returned', () => {
    // This is the exact state that printed "IQ Combiner 6C" on a 5C job with no
    // qualification whatsoever. The device is still produced so the plan stays
    // buildable — what changed is that it can no longer pretend to be a decision.
    const plan = resolveIntegratedEquipment(ctx({ compatibleCombinerIds: undefined }));
    expect(plan.brains?.model).toBe('IQ Combiner 6C');
    expect(plan.combinerBasis).toBe('unresolved-default');
    expect(combinerBasisIsDecided(plan.combinerBasis!)).toBe(false);
  });

  it('a session override reports as one', () => {
    const plan = resolveIntegratedEquipment(ctx({ overrideDeviceIds: [FIVE_C] }));
    expect(plan.combinerBasis).toBe('session-override');
    expect(combinerBasisIsDecided(plan.combinerBasis!)).toBe(true);
  });
});

// ── Every consumer must CONSUME the selection, not re-derive a device ─────────
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments, stripCommentsAndStrings } from './support/stripSource';
import { sldCombinerFields } from '@/lib/equipment/sldCombinerFields';

describe('the shared SLD adapter — one answer for both drawings', () => {
  const base = {
    inverterManufacturer: IQ8.manufacturer,
    inverterModel: IQ8.model,
    isMicro: true,
    totalDevices: 24,
    branchCount: 3,
    hasBattery: false,
  };

  it('a selected device reaches the sheet, and reports as DECIDED', () => {
    const f = sldCombinerFields({ ...base, selectedCombinerId: SIX_C });
    expect(f.combinerModel).toBe('Enphase IQ Combiner 6C');
    expect(f.combinerProvidesAcDisconnect).toBe(true);
    expect(f.combinerSelectionIsDecided).toBe(true);
  });

  it('🚨 with nothing selected the sheet is told the device is NOT decided', () => {
    // `combinerProvidesAcDisconnect` drives the NEC integral-disconnect
    // statement. A derived device may still be drawn, but the sheet must be able
    // to say it was derived rather than chosen.
    const f = sldCombinerFields({ ...base, inverterId: (IQ8 as any).id });
    expect(f.combinerSelectionIsDecided).toBe(false);
    expect(f.combinerModel, 'a device is still produced so the sheet stays buildable').toBeTruthy();
  });

  it('the display-string miss no longer changes the answer when an id is given', () => {
    // The original defect: "Enphase IQ8M" missed the exact-match lookup and fell
    // into the 6C literal. With the id present the pairing resolves.
    const display = `${IQ8.manufacturer} ${IQ8.model}`;
    const withId = sldCombinerFields({ ...base, inverterModel: display, inverterId: (IQ8 as any).id });
    const withoutId = sldCombinerFields({ ...base, inverterModel: display });
    expect(withId.combinerModel).not.toBe(withoutId.combinerModel);
    expect(withoutId.combinerSelectionIsDecided).toBe(false);
  });

  it('a selection beats BOTH of those — the id path and the miss path alike', () => {
    const display = `${IQ8.manufacturer} ${IQ8.model}`;
    for (const inverterId of [(IQ8 as any).id, null]) {
      const f = sldCombinerFields({ ...base, inverterModel: display, inverterId, selectedCombinerId: FIVE_C });
      expect(f.combinerModel).toBe('Enphase IQ Combiner 5C');
      expect(f.combinerSelectionIsDecided).toBe(true);
    }
  });
});

describe('structural — no consumer builds a combiner context without the selection', () => {
  /**
   * 🚨 THE PREVIOUS VERSION OF THIS GUARD COULD NOT FAIL ON THE REAL DEFECT.
   * It asserted only that a micro context carries `compatibleCombinerIds` — the
   * COMPATIBILITY half — which both BOM call sites already did while still
   * shipping a device the installer had not chosen. A guard that checks the half
   * that was already fixed is decoration.
   */
  const FILES = [
    'lib/bom-engine-v4.ts',
    'app/api/engineering/sld/route.ts',
    'lib/equipment/sldCombinerFields.ts',
  ];

  it('every resolveIntegratedEquipment context passes selectedCombinerId', () => {
    const offenders: string[] = [];
    let examined = 0;
    for (const rel of FILES) {
      const src = stripCommentsAndStrings(readFileSync(join(__dirname, '..', rel), 'utf8'));
      for (const tail of src.split('resolveIntegratedEquipment({').slice(1)) {
        examined++;
        const body = tail.slice(0, tail.indexOf('});'));
        if (!/selectedCombinerId/.test(body)) offenders.push(`${rel} :: ${body.trim().slice(0, 80)}`);
      }
    }
    expect(examined, 'the scan found no call sites — the anchor has drifted').toBeGreaterThanOrEqual(3);
    expect(offenders, `these resolve a combiner without consulting the project selection:\n  ${offenders.join('\n  ')}`)
      .toEqual([]);
  });

  it('the SLD PDF export resolves a combiner at all', () => {
    // It previously accepted `combinerId` from the client and dropped it, so the
    // exported sheet — the one that reaches the permit package — named a generic
    // label and withheld the disconnect statement the diagram asserted.
    // 🚨 stripComments, NOT stripCommentsAndStrings. Measured on this exact
    // file: the identifier-stripper returns a body in which the real
    // `sldCombinerFields(` call is absent, so the guard failed against correct
    // code. Whatever construct upsets it earlier in the route, a guard that
    // cannot see the code it is guarding is worse than no guard — and comments
    // are the only thing that needed removing here, since both anchors are
    // identifiers rather than string literals.
    const src = stripComments(
      readFileSync(join(__dirname, '..', 'app', 'api', 'engineering', 'sld', 'pdf', 'route.ts'), 'utf8'),
    );
    expect(src).toMatch(/sldCombinerFields\(/);
    expect(src).toMatch(/combinerProvidesAcDisconnect:/);
  });

  it('both drawings go through the SAME adapter', () => {
    for (const rel of ['app/api/engineering/sld/route.ts', 'app/api/engineering/sld/pdf/route.ts']) {
      const src = readFileSync(join(__dirname, '..', rel), 'utf8');
      expect(src, `${rel} must map the disconnect fact`).toMatch(/combinerProvidesAcDisconnect/);
    }
  });
});
