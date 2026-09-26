/**
 * tests/combinerIdentity.test.ts
 *
 * ONE IDENTITY FOR ONE PRODUCT — and the refusal it was causing.
 *
 * 🚨 THE DEFECT, IN THE INSTALLER'S WORDS: pick the IQ Combiner 5C you are
 * actually fitting on an Enphase IQ8 job, type your reason, save — and the
 * system answers "the selected inverter declares [enphase-iq-combiner-5] and
 * does not name enphase-iq-combiner-5c". Those are the same box. Two catalogues
 * spell it differently:
 *
 *   BOS catalogue (lib/equipment/integratedBos.ts)  'enphase-iq-combiner-5c'
 *       — what the picker offers and what a selection is RECORDED under
 *   equipment-db (lib/equipment-db.ts)              'enphase-iq-combiner-5'
 *       — what every Enphase IQ8 row DECLARES in `compatibleWith`
 *
 * `judgeCombinerCompatibility` compared those raw strings with `includes()`, so
 * `declaredCompatible` was false for every candidate the picker can send and the
 * planner raised NOT_A_CANDIDATE. Selecting a combiner was refused on EVERY
 * Enphase project; the only way through was the engineering-authority override,
 * i.e. citing a datasheet to admit a pairing the manufacturer already declares.
 *
 * The repair is an AUTHORITY, not a matcher: one declared table
 * (lib/equipment/combinerIdentity.ts) naming which catalogue each spelling comes
 * from. This file pins both halves — that the real catalogue pairing is now
 * honoured, and that nothing was loosened into a character rule. The previous
 * bridge (`resolveCompatibleCombiner` trying `${id}c`) is exactly the
 * substring/suffix equipment matching that has bitten this repo before, and the
 * "NEVER A CHARACTER RULE" block below is what stops it coming back.
 */

import { describe, it, expect } from 'vitest';
import {
  COMBINER_PRODUCT_IDENTITIES,
  canonicalCombinerId,
  combinerIdentityFor,
  sameCombinerProduct,
} from '@/lib/equipment/combinerIdentity';
import {
  judgeCombinerCompatibility,
  planCombinerSelection,
  type CombinerDeviceFacts,
} from '@/lib/combinerSelection/service';
import { BOS_DEVICES, getBosDevice, resolveCompatibleCombiner } from '@/lib/equipment/integratedBos';
import { combinerCompatibilityFor } from '@/lib/equipment/combinerCompatibility';
import { MICROINVERTERS } from '@/lib/equipment-db';

const FIVE_C = 'enphase-iq-combiner-5c';   // BOS spelling — what a selection stores
const FIVE   = 'enphase-iq-combiner-5';    // equipment-db spelling — what IQ8 declares
const SIX_C  = 'enphase-iq-combiner-6c';

/** A real IQ8 row, so the declaration under test is the production one. */
const IQ8 = MICROINVERTERS.find(m => /enphase/i.test(m.manufacturer) && /IQ8/i.test(m.model))! as
  { id: string; manufacturer: string; model: string; compatibleWith?: string[] };

/** The route's own catalogue reader (app/api/projects/[id]/combiner-selection). */
const lookupDevice = (id: string): CombinerDeviceFacts | null => {
  const d = getBosDevice(id);
  return d ? { id: d.id, manufacturer: d.brand, model: d.model, modelNumber: null } : null;
};

describe('the control — the two catalogues really do disagree', () => {
  it('🚨 the IQ8 declaration and the selectable id are DIFFERENT STRINGS for one box', () => {
    // If this ever stops being true the defect below is gone and this file is
    // testing a hazard that no longer exists — it should fail here saying so.
    expect(IQ8, 'no Enphase IQ8 microinverter in the catalogue').toBeTruthy();
    expect(IQ8.compatibleWith).toContain(FIVE);
    expect(IQ8.compatibleWith).not.toContain(FIVE_C);
    expect(getBosDevice(FIVE_C)?.model).toBe('IQ Combiner 5C');
    expect(getBosDevice(FIVE), 'the BOS catalogue has no row under the equipment-db spelling')
      .toBeUndefined();
  });
});

describe('🚨 selecting a combiner on an Enphase project — the refusal, gone', () => {
  it('the declared pairing NAMES the device the picker offers', () => {
    // THE ASSERTION THAT FAILS ON THE OLD CODE. `declared.includes(deviceId)`
    // compared 'enphase-iq-combiner-5' against 'enphase-iq-combiner-5c' and
    // answered false; both now resolve to one product identity first.
    const j = judgeCombinerCompatibility({
      deviceId: FIVE_C,
      inverterId: IQ8.id,
      declaredCompatibleIds: IQ8.compatibleWith,
    });
    expect(j.declaredCompatible).toBe(true);
    // The declaration is recorded VERBATIM — reconciling for comparison must not
    // rewrite what the catalogue actually said onto the permit record.
    expect(j.declaredCompatibleIds).toEqual(IQ8.compatibleWith);
    // …and the source line shows both spellings, because the failure was
    // unreadable while it printed only one of them.
    expect(j.source).toContain(FIVE);
    expect(j.source).toContain(FIVE_C);
  });

  it('so the whole selection is ACCEPTED, with no engineering override', () => {
    // The route's exact shape: BOS id in, equipment-db declaration alongside.
    const outcome = planCombinerSelection({
      deviceId: FIVE_C,
      lookupDevice,
      inverterId: IQ8.id,
      declaredCompatibleIds: combinerCompatibilityFor(undefined, undefined, IQ8.id),
      actor: { id: 'ray@example.com', kind: 'user' },
      atIso: '2026-09-22T12:00:00.000Z',
      basis: 'This is what we stock and fit.',
      current: null,
    });
    expect(outcome.refusals, 'an installer fitting the declared device was refused').toEqual([]);
    expect(outcome.ok).toBe(true);
    expect(outcome.next!.active!.combinerDeviceId).toBe(FIVE_C);
    expect(outcome.next!.active!.compatibility.declaredCompatible).toBe(true);
  });

  it('and a device the declaration does NOT name is RECORDED as not declared — and still accepted', () => {
    // The identity repair still decides `declaredCompatible` (the IQ8 rows do
    // not declare the 6C, so it reads false). Since Ray's 2026-09-25 ruling
    // that is information on the record, never a refusal of the pick.
    const r = planCombinerSelection({
      deviceId: SIX_C,
      lookupDevice,
      inverterId: IQ8.id,
      declaredCompatibleIds: combinerCompatibilityFor(undefined, undefined, IQ8.id),
      actor: { id: 'ray@example.com', kind: 'user' },
      atIso: '2026-09-22T12:00:00.000Z',
      basis: null,
      current: null,
    });
    expect(r.ok).toBe(true);
    expect(r.next!.active!.combinerDeviceId).toBe(SIX_C);
    expect(r.next!.active!.compatibility.declaredCompatible).toBe(false);
  });
});

describe('🚨 an unknown id is a REFUSAL, never a pass', () => {
  it('a spelling the table does not know cannot be judged compatible', () => {
    const j = judgeCombinerCompatibility({
      deviceId: 'acme-combiner-9000',
      inverterId: IQ8.id,
      declaredCompatibleIds: IQ8.compatibleWith,
    });
    expect(j.declaredCompatible).toBe(false);
    expect(j.source).toMatch(/matches no combiner product identity/i);
  });

  it('sameCombinerProduct is false when EITHER side is unknown', () => {
    expect(sameCombinerProduct(FIVE, FIVE_C)).toBe(true);
    expect(sameCombinerProduct(FIVE_C, FIVE)).toBe(true);          // symmetric
    expect(sameCombinerProduct(FIVE_C, SIX_C)).toBe(false);
    expect(sameCombinerProduct('nope', 'nope')).toBe(false);        // not even to itself
    expect(sameCombinerProduct(null, FIVE_C)).toBe(false);
    expect(sameCombinerProduct(undefined, undefined)).toBe(false);
  });

  it('non-combiner entries riding in the same declaration resolve to nothing', () => {
    // `compatibleWith` on an IQ8 row also lists the gateway and a battery. They
    // are real ids; they are not this device, and they must not become it.
    expect(canonicalCombinerId('enphase-iq-gateway')).toBeNull();
    expect(canonicalCombinerId('enphase-iq-battery-5p')).toBeNull();
  });
});

describe('🚨 NEVER A CHARACTER RULE — the suffix bridge must not come back', () => {
  it('identity is table lookup only: trim and case, nothing else', () => {
    expect(canonicalCombinerId(`  ${FIVE.toUpperCase()} `)).toBe(FIVE_C);
    // A spelling no catalogue writes stays unknown. The old bridge answered
    // these by appending or stripping a 'c', which is a guess dressed as a fact.
    expect(canonicalCombinerId('enphase-iq-combiner-6')).toBeNull();
    expect(canonicalCombinerId('enphase-iq-combiner-5cc')).toBeNull();
    expect(canonicalCombinerId('enphase-iq-combiner')).toBeNull();
    // …and no substring of a real id matches it, the defect class this repo
    // has been bitten by on modules, documents and now combiners.
    expect(canonicalCombinerId(FIVE_C.slice(0, -1) + 'x')).toBeNull();
  });

  it('resolveCompatibleCombiner goes through the table, not through `${id}c`', () => {
    // The production path: an equipment-db declaration resolving to a real BOS
    // device. This worked before via the suffix hack and must keep working.
    expect(resolveCompatibleCombiner([FIVE])?.id).toBe(FIVE_C);
    expect(resolveCompatibleCombiner(IQ8.compatibleWith)?.kind).toBe('integrated_combiner');
    // 🚨 THE ASSERTION THAT FAILS ON THE OLD CODE: 'enphase-iq-combiner-6' is a
    // string no catalogue writes, and the suffix rule turned it into the 6C.
    // Unknown must stay unknown so `combinerBasis: 'unresolved-default'` can say
    // so on the sheet.
    expect(resolveCompatibleCombiner(['enphase-iq-combiner-6'])).toBeUndefined();
    expect(resolveCompatibleCombiner(['enphase-iq-gateway'])).toBeUndefined();
    expect(resolveCompatibleCombiner([])).toBeUndefined();
    expect(resolveCompatibleCombiner(undefined)).toBeUndefined();
  });
});

describe('the table cannot fall behind the catalogues', () => {
  it('every selectable BOS combiner has a product identity', () => {
    // A combiner added to integratedBos.ts and not to the table would silently
    // stop being judgeable — every selection of it refused, exactly the failure
    // this work fixed. Fail here instead.
    const missing = BOS_DEVICES
      .filter(d => d.kind === 'integrated_combiner' && d.active !== false)
      .filter(d => canonicalCombinerId(d.id) !== d.id)
      .map(d => d.id);
    expect(missing, `these BOS combiners have no row in combinerIdentity.ts: ${missing.join(', ')}`)
      .toEqual([]);
  });

  it('every declared BOS spelling resolves back to a real catalogue device', () => {
    // The other direction: a table row naming a device the catalogue dropped.
    for (const row of COMBINER_PRODUCT_IDENTITIES) {
      expect(getBosDevice(row.canonical)?.kind,
        `${row.canonical} (${row.product}) is in the identity table but not in BOS_DEVICES`)
        .toBe('integrated_combiner');
    }
  });

  it('one spelling never names two products', () => {
    const seen = new Map<string, string>();
    for (const row of COMBINER_PRODUCT_IDENTITIES) {
      for (const s of [row.canonical, ...row.bosCatalogueIds, ...row.equipmentDbIds]) {
        const key = s.trim().toLowerCase();
        const prev = seen.get(key);
        expect(prev === undefined || prev === row.canonical,
          `'${key}' is claimed by both ${prev} and ${row.canonical}`).toBe(true);
        seen.set(key, row.canonical);
      }
    }
  });

  it('every Enphase micro that declares a combiner can actually have one resolved', () => {
    // The production requirement, asserted against the real catalogue rather
    // than a fixture: an inverter whose declaration names a combiner product
    // must resolve to a BOS device, or its jobs fall back to a device nobody
    // chose. Rows that declare no combiner at all are not a defect and are
    // skipped — that state is reported as `unresolved-default`, by design.
    const enphaseMicros = MICROINVERTERS.filter(m => /enphase/i.test(String(m.manufacturer)));
    expect(enphaseMicros.length, 'no Enphase micros in the catalogue').toBeGreaterThan(0);
    const broken: string[] = [];
    for (const m of enphaseMicros as Array<{ id: string; compatibleWith?: string[] }>) {
      const declared = m.compatibleWith ?? [];
      const namesACombiner = declared.some(id => combinerIdentityFor(id) !== null);
      if (namesACombiner && !resolveCompatibleCombiner(declared)) broken.push(m.id);
    }
    expect(broken, `these declare a combiner that does not resolve: ${broken.join(', ')}`).toEqual([]);
  });
});
