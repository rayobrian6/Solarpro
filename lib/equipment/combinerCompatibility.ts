/**
 * lib/equipment/combinerCompatibility.ts
 *
 * WHICH COMBINER DOES THIS INVERTER PAIR WITH? ONE ANSWER.
 *
 * `resolveIntegratedEquipment` picks the integrated combiner from
 * `ctx.compatibleCombinerIds` and falls back to the current-generation 6C when
 * that list is absent:
 *
 *     const combiner = resolveCompatibleCombiner(ctx.compatibleCombinerIds)
 *       ?? getBosDevice('enphase-iq-combiner-6c')!;
 *
 * Every Enphase IQ8 row in equipment-db declares
 * `compatibleWith: ['enphase-iq-combiner-5', …]`, so a caller that PASSES the
 * list gets the 5C and a caller that OMITS it gets the 6C. There were five call
 * sites. Two passed it. Three did not:
 *
 *     lib/permit/utils/integratedEquipment.ts   passed   ->  5C   planset sheets
 *     app/api/engineering/sld/route.ts          passed   ->  5C   the SLD
 *     lib/bom-engine-v4.ts  (two)               omitted  ->  6C   the BOM
 *     lib/equipment/integratedBos.ts (hybrid)   omitted  ->  6C
 *
 * 🚨 SO THE BOM SHIPPED THE 6C WHILE THE DRAWINGS PRINTED THE 5C. That is not a
 * labelling difference. The 6C declares `disconnect: true` and the 5C does not,
 * and `providesAcDisconnect` drives the NEC 690.13 "integral AC disconnecting
 * means" statement on the compliance and electrical pages — so one permit
 * package could contradict itself about whether a disconnect exists.
 *
 * WHY THE RULE LIVES HERE AND NOT IN integratedBos.ts
 *
 * That module deliberately does not import `equipment-db`, so the BOS catalogue
 * stays dependency-free and cycle-free, and its own comment says so. The fix is
 * therefore NOT to move the lookup inside it. It is to stop every caller
 * carrying its own copy: the rule had three inline implementations (the permit
 * wrapper, the SLD route, and a richer by-id variant) and three omissions, which
 * is four chances to drift and three places that already had.
 *
 * 🚨 EXACT MATCH, NEVER SUBSTRING. Substring matching on equipment models is a
 * known defect class in this codebase — it is how a model family once satisfied
 * a document requirement it had not earned. Manufacturer and model are compared
 * trimmed and case-insensitively and nothing else.
 *
 * An unknown inverter returns `undefined`, which is the honest answer and lets
 * the resolver apply its documented current-generation default. This module
 * never guesses a pairing.
 */

import { MICROINVERTERS, getMicroinverterById, getInverterById } from '@/lib/equipment-db';

const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase();

/**
 * The combiner ids the selected inverter declares in equipment-db.
 *
 * @param manufacturer  as the design records it
 * @param model         as the design records it
 * @param inverterId    preferred when the caller has one — an id is an identity,
 *                      a manufacturer+model pair is a description of one
 * @returns the declared `compatibleWith` list, or `undefined` when the inverter
 *          is not in the catalogue. Never a fabricated pairing.
 */
export function combinerCompatibilityFor(
  manufacturer: string | null | undefined,
  model: string | null | undefined,
  inverterId?: string | null,
): string[] | undefined {
  if (inverterId) {
    // 🚨 MICROINVERTERS FIRST, AND THAT IS A REPAIR, NOT A PREFERENCE.
    // The SLD route's own copy of this rule called `getInverterById`, which
    // searches STRING_INVERTERS only. Combiners pair with MICROinverters, so
    // for the ids this is actually asked about it always missed and fell
    // through to the name match — a silent near-miss that only worked because
    // the fallback happened to be right. Both catalogues are searched here.
    const id = String(inverterId);
    const byId = (getMicroinverterById(id) ?? getInverterById(id)) as
      { compatibleWith?: string[] } | undefined;
    if (Array.isArray(byId?.compatibleWith)) return byId!.compatibleWith;
  }

  const m = norm(manufacturer);
  const d = norm(model);
  if (!m || !d) return undefined;

  const rec = MICROINVERTERS.find(r => norm(r.manufacturer) === m && norm(r.model) === d) as
    { compatibleWith?: string[] } | undefined;
  return Array.isArray(rec?.compatibleWith) ? rec!.compatibleWith : undefined;
}
