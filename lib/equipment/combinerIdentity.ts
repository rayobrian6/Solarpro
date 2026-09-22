// ═══════════════════════════════════════════════════════════════════════════
// ONE IDENTITY FOR ONE PRODUCT — the combiner id vocabularies, reconciled.
//
// 🚨 WHAT THIS REPAIRS: SELECTING A COMBINER WAS REFUSED ON EVERY ENPHASE JOB.
//
// Two catalogues name the same box, and they spell it differently:
//
//   lib/equipment/integratedBos.ts  (the BOS catalogue) — the id a SELECTION is
//       recorded under, because it is what `listCombiners()` offers the picker
//       and what `getBosDevice()` resolves:   'enphase-iq-combiner-5c'
//   lib/equipment-db.ts             (the equipment database) — the id the
//       microinverter rows DECLARE they pair with, in `compatibleWith`:
//                                             'enphase-iq-combiner-5'
//
// `judgeCombinerCompatibility` compared those two strings with `includes()`.
// Every Enphase IQ8 row declares `['enphase-iq-combiner-5', …]` and every id the
// picker can send ends in 'c', so the declaration NEVER named the chosen device,
// `declaredCompatible` was always false, and the planner raised NOT_A_CANDIDATE.
// What the installer saw: pick the IQ Combiner 5C you are actually fitting on an
// IQ8 job, state your reason, press save — "the selected inverter declares
// [enphase-iq-combiner-5] and does not name enphase-iq-combiner-5c". The only
// way through was the engineering-authority override, i.e. citing a datasheet to
// admit a pairing the manufacturer already declares. The 6C was refused too, so
// no combiner could be recorded at all.
//
// 🚨 WHY A TABLE AND NOT A SUFFIX RULE. `resolveCompatibleCombiner` used to
// bridge the gap by trying the id, then `${id}c`, then `id` with a trailing 'c'
// stripped. That is string surgery standing in for identity, and it is the same
// defect class as the substring equipment matching this codebase has been bitten
// by repeatedly (see the canonical-module memos: a model FAMILY once satisfied a
// document requirement it had not earned because a substring matched). A rule
// that mutates characters will happily equate two genuinely different products
// the day one is named with a trailing letter — and it answers "probably" where
// a permit needs "yes" or "no". So the mapping is DECLARED, one row per real
// product, every spelling written out, with the catalogue each one comes from
// named beside it.
//
// 🚨 AN ID THIS TABLE DOES NOT KNOW IS A REFUSAL, NEVER A PASS. `canonicalCombinerId`
// returns null, callers must treat null as "cannot be judged", and nothing is
// inferred from how the characters look. Absence of an answer stays absent.
//
// THIS MODULE IMPORTS NOTHING, DELIBERATELY. integratedBos.ts keeps the BOS
// catalogue dependency-free and cycle-free and says so in its own header, and
// combinerSelection/service.ts is pure. Both consume this table, so it may not
// drag either catalogue in behind it. The consequence is that the table is
// DATA ABOUT the catalogues rather than derived from them, which is why
// tests/combinerIdentity.test.ts checks it against the real BOS catalogue: a
// combiner added to integratedBos.ts and not to this table must fail loudly
// rather than quietly stop being selectable.
// ═══════════════════════════════════════════════════════════════════════════

export interface CombinerProductIdentity {
  /**
   * The one id this product is known by inside SolarPro.
   *
   * It is the BOS-catalogue spelling on purpose: that is what a picker sends,
   * what `getBosDevice` resolves, and what a recorded selection stores in
   * `projects.selected_equipment.combinerSelection.combinerDeviceId`. Choosing
   * the equipment-db spelling instead would have re-pointed every stored record.
   */
  canonical: string;
  /** The product as a human reads it on a sheet — for messages, never matching. */
  product: string;
  /** Spellings used in lib/equipment/integratedBos.ts (BOS_DEVICES[].id). */
  bosCatalogueIds: string[];
  /**
   * Spellings used in lib/equipment-db.ts — either a row id or a string that
   * appears inside another row's `compatibleWith` declaration. Each is annotated
   * below with where it actually occurs, because an entry nobody writes is a
   * fabrication and this table is consulted when a permit is at stake.
   */
  equipmentDbIds: string[];
}

/**
 * The declared table. One row per PRODUCT.
 *
 * 🚨 ADDING A ROW IS AN EQUIPMENT-DATA DECISION, NOT A CONVENIENCE. Two ids
 * belong on one row only when they name the same physical box. Enphase's own
 * data sheet covers the IQ Combiner 5 and 5C as one document
 * (IQC-5-5C-DSH-00007-1.0) and integratedBos.ts already carries that reading in
 * `resolveCompatibleCombiner`'s comment; that is the basis for the 5/5C row and
 * nothing here is inferred from the ids themselves.
 */
export const COMBINER_PRODUCT_IDENTITIES: CombinerProductIdentity[] = [
  {
    canonical: 'enphase-iq-combiner-6c',
    product: 'Enphase IQ Combiner 6C',
    bosCatalogueIds: ['enphase-iq-combiner-6c'],
    // equipment-db has no 6C ROW, but `enphase-iq-battery-10c.compatibleWith`
    // names this exact string (its datasheet Compatibility row cites the 6C), so
    // the spelling really does arrive from that catalogue and must map.
    equipmentDbIds: ['enphase-iq-combiner-6c'],
  },
  {
    canonical: 'enphase-iq-combiner-5c',
    product: 'Enphase IQ Combiner 5C',
    bosCatalogueIds: ['enphase-iq-combiner-5c'],
    // The equipment-db ROW id (`BATTERIES` → backup_interface, 'IQ Combiner 5'),
    // and the string every Enphase IQ8 microinverter row declares in
    // `compatibleWith`. This single character is the whole defect.
    equipmentDbIds: ['enphase-iq-combiner-5'],
  },
  {
    canonical: 'enphase-iq-combiner-4c',
    product: 'Enphase IQ Combiner 4C',
    bosCatalogueIds: ['enphase-iq-combiner-4c'],
    // No equipment-db row or declaration names the 4/4C today. The list stays
    // EMPTY rather than guessing 'enphase-iq-combiner-4': a spelling no
    // catalogue writes is one nobody can send, and inventing it here would be
    // this table making up equipment data.
    equipmentDbIds: [],
  },
];

/** Trim + lowercase. That is the ENTIRE normalisation — no suffix rules, no
 *  substring, no punctuation stripping. Two ids match or they do not. */
const norm = (id: unknown): string => String(id ?? '').trim().toLowerCase();

/**
 * spelling → canonical id, built once.
 *
 * The duplicate check is not defensive decoration: a table that maps one
 * spelling to two products would silently make some comparison answer "yes" for
 * the wrong box, and this table's whole job is to be the place that cannot
 * happen. A contradictory edit fails at import, in every test and every build,
 * rather than on a permit.
 */
const BY_SPELLING: Map<string, CombinerProductIdentity> = (() => {
  const m = new Map<string, CombinerProductIdentity>();
  for (const row of COMBINER_PRODUCT_IDENTITIES) {
    const spellings = [row.canonical, ...row.bosCatalogueIds, ...row.equipmentDbIds];
    for (const s of spellings) {
      const key = norm(s);
      if (!key) continue;
      const prev = m.get(key);
      if (prev && prev.canonical !== row.canonical) {
        throw new Error(
          `[combinerIdentity] '${key}' is claimed by both ${prev.canonical} and ${row.canonical}. `
          + 'One spelling names one product; fix the table rather than the caller.',
        );
      }
      m.set(key, row);
    }
  }
  return m;
})();

/**
 * The product identity behind an id from EITHER catalogue.
 *
 * `null` means this table has never heard of the spelling. That is an answer —
 * "cannot be judged" — and callers must not convert it into a match.
 */
export function combinerIdentityFor(id: string | null | undefined): CombinerProductIdentity | null {
  return BY_SPELLING.get(norm(id)) ?? null;
}

/**
 * The one id this product is known by, whichever catalogue spelled it.
 *
 * Feed it an equipment-db `compatibleWith` entry or a BOS catalogue id; get back
 * the BOS-catalogue spelling, or `null` when the id names no combiner this table
 * knows (including ids that are not combiners at all — 'enphase-iq-gateway' and
 * 'enphase-iq-battery-5p' ride in the same `compatibleWith` arrays).
 */
export function canonicalCombinerId(id: string | null | undefined): string | null {
  return combinerIdentityFor(id)?.canonical ?? null;
}

/**
 * Do these two ids name the SAME physical combiner?
 *
 * 🚨 FALSE WHEN EITHER IS UNKNOWN. Not "assume yes", not "compare the raw
 * strings as a fallback" — an unknown id cannot be shown to be the same product,
 * so it is not treated as one. This is the function that decides whether a
 * declaration names the device the installer chose, and on this path a wrong
 * "yes" reaches an interconnection application.
 */
export function sameCombinerProduct(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = canonicalCombinerId(a);
  return ca != null && ca === canonicalCombinerId(b);
}
