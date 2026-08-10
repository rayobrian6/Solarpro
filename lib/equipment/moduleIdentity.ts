// ═══════════════════════════════════════════════════════════════════════════
// CMEI §0 — CANONICAL MODULE EQUIPMENT IDENTITY.
//
// THE ONE ANSWER to "which solar module is selected?". CAD, computed-system,
// computed-multi-system, drafting, the BOM engines, permit generation, the
// module-document authority (CMDA) and every renderer read THIS. Nothing else
// may decide it.
//
// ─── THE RULE ──────────────────────────────────────────────────────────────
//   `panelId` — the stable catalogue id — IS the identity.
//   manufacturer / model / watts are ATTRIBUTES of that identity. They are
//   projections, never independent identity authorities.
//
// ─── WHAT WAS WRONG ────────────────────────────────────────────────────────
// `applyCanonicalEquipmentToInput` already re-pins the canonical selection onto
// every string (panelId, panelModel, panelManufacturer, panelWatts), so a single
// source of truth existed and was materialised. But the id was undeclared on the
// type until now, so ~26 consumers identified the module by its MODEL STRING and
// re-derived the catalogue row with two-way substring matching. FOUR independent
// copies of the same matcher existed:
//
//   equipmentSelection.PRODUCTION_EQUIPMENT_CATALOG.byModel   ← inside the
//                                                               canonical picker
//   snapshot/build.ts                    `fuzz`
//   snapshot/equipmentProjection.ts      `fuzzPanel` / `fuzzMicro`
//   sections/datasheetAppendix.ts        `fuzz`
//
// each doing:
//     list.find(e => e.model.includes(m) || m.includes(e.model))
//
// That is not identity resolution. "REC 400" matches "REC 400AA Pure-R" and
// "REC 4000"; a model string that merely CONTAINS a catalogue model silently
// became that product — in the BOM that is ordered hardware, and in CAD it is
// geometry.
//
// ─── THE THREE STATES ──────────────────────────────────────────────────────
//   CANONICAL        a stable panelId is present and resolves. Authoritative.
//   LEGACY_DERIVED   no panelId, but the persisted attributes produce exactly
//                    ONE deterministic EXACT catalogue match. Authoritative, and
//                    eligible for the existing reconciliation / self-heal re-pin.
//   NOT_ESTABLISHED  ambiguous, partial, substring or fuzzy. FAIL CLOSED.
//
// There is no fourth state and no "best guess". A caller that needs a panel and
// receives NOT_ESTABLISHED must surface that, not substitute something.
//
// ─── WHERE FUZZY MATCHING MAY STILL LIVE ───────────────────────────────────
// Only in non-authoritative display/search assistance whose result cannot reach
// design, CAD, BOM, procurement, permit readiness, the digest, document
// applicability or release. `searchModulesForDisplay` below is that surface, and
// it is named so a reviewer can see at the call site which one is being used.
// ═══════════════════════════════════════════════════════════════════════════

import { SOLAR_PANELS, getPanelById, type SolarPanel } from '@/lib/equipment-db';

// ═══════════════════════════════════════════════════════════════════════════
// §1 — THE RESULT
// ═══════════════════════════════════════════════════════════════════════════

export type ModuleIdentityState = 'CANONICAL' | 'LEGACY_DERIVED' | 'NOT_ESTABLISHED';

/** THE canonical module identity. One per distinct selected module. */
export interface CanonicalModuleIdentity {
  state: ModuleIdentityState;
  /** true ⇔ the identity is established (CANONICAL or LEGACY_DERIVED). */
  established: boolean;
  /** THE identity — the stable catalogue id. Null ⇔ NOT_ESTABLISHED. */
  panelId: string | null;
  /** attributes, PROJECTED from the catalogue row — never inputs to identity. */
  manufacturer: string | null;
  model: string | null;
  watts: number | null;
  /** the catalogue row itself, for callers that need full specs. */
  spec: SolarPanel | null;
  /** true ⇔ LEGACY_DERIVED: the caller may offer this to the existing
   *  reconciliation / self-heal persistence so the id gets pinned. This module
   *  never writes anything itself. */
  repinnable: boolean;
  /** how the identity was established, or why it was not. Auditable. */
  basis: string;
  /** every reason the identity could not be established. Empty ⇔ established. */
  refusals: string[];
}

/** The persisted fields an identity may be resolved from. Deliberately the
 *  fields that already exist — no new identity scheme is invented. */
export interface ModuleIdentitySource {
  /** the stable catalogue id. THE identity when present. */
  panelId?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  watts?: number | null;
}

/** DI seam so tests need no catalogue and so every consumer provably shares one. */
export interface ModuleCatalog {
  byId(id: string): SolarPanel | null;
  all(): readonly SolarPanel[];
}

export const PRODUCTION_MODULE_CATALOG: ModuleCatalog = {
  byId: (id: string) => getPanelById(id) ?? null,
  all: () => SOLAR_PANELS as readonly SolarPanel[],
};

// ═══════════════════════════════════════════════════════════════════════════
// §2 — NORMALISATION (comparison only — never a match relaxation)
// ═══════════════════════════════════════════════════════════════════════════

/** Case, surrounding space and internal run-length. NOTHING else: no token
 *  dropping, no punctuation stripping, no prefix logic. Two strings that differ
 *  by anything a human would call "a different model" still differ here. */
const norm = (s: string | null | undefined): string =>
  (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** The codebase's BLANK MARKERS. `ResolvedEquipment` prints '—' wherever a value
 *  is absent (helpers.ts), and those records are handed straight to this
 *  accessor. Treating '—' as a real manufacturer eliminated every candidate and
 *  turned "no manufacturer recorded" into "identity not established" — a
 *  refusal caused by a placeholder glyph rather than by ambiguity. An absent
 *  attribute must simply not narrow, exactly as `undefined` does. */
const BLANK_MARKERS = new Set(['', '—', '-', '–', 'n/a', 'na', 'none', 'tbd', 'unknown', '?']);
const attr = (s: string | null | undefined): string => {
  const n = norm(s);
  return BLANK_MARKERS.has(n) ? '' : n;
};

const num = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isFinite(v)) ? v : null;

// ═══════════════════════════════════════════════════════════════════════════
// §3 — THE RESOLVER
// ═══════════════════════════════════════════════════════════════════════════

function notEstablished(src: ModuleIdentitySource, refusals: string[], basis: string): CanonicalModuleIdentity {
  return {
    state: 'NOT_ESTABLISHED', established: false,
    panelId: null,
    // The RAW strings are echoed so a caller can name what it could not resolve.
    // They are NOT identity, and `spec` stays null so nothing can be read off
    // a product that was never identified.
    manufacturer: src.manufacturer ?? null, model: src.model ?? null, watts: num(src.watts),
    spec: null, repinnable: false, basis, refusals,
  };
}

function established(
  state: 'CANONICAL' | 'LEGACY_DERIVED', spec: SolarPanel, basis: string,
): CanonicalModuleIdentity {
  return {
    state, established: true,
    panelId: spec.id,
    // Attributes are read OFF THE CATALOGUE ROW, not off the posted body — that
    // is what makes them projections of the identity rather than rivals to it.
    manufacturer: spec.manufacturer ?? null,
    model: spec.model ?? null,
    watts: num(spec.watts),
    spec,
    repinnable: state === 'LEGACY_DERIVED',
    basis, refusals: [],
  };
}

/**
 * THE canonical accessor. Pure and total.
 *
 * Every subsystem that needs to know which module is selected calls this — or a
 * wrapper over it in §4 — and nothing else.
 */
export function resolveModuleIdentity(
  src: ModuleIdentitySource,
  opts?: { catalog?: ModuleCatalog },
): CanonicalModuleIdentity {
  const catalog = opts?.catalog ?? PRODUCTION_MODULE_CATALOG;
  const id = (src.panelId ?? '').trim();

  // ── 1 · THE STABLE ID IS THE IDENTITY ───────────────────────────────────
  if (id) {
    const spec = catalog.byId(id);
    if (spec) {
      return established('CANONICAL', spec,
        `stable catalogue id '${spec.id}' (${spec.manufacturer} ${spec.model}${spec.watts != null ? `, ${spec.watts} W` : ''})`);
    }
    // An id that names nothing is a HARD failure, never a reason to fall back to
    // the model text: a dangling id means the catalogue and the record disagree,
    // and guessing past that is how the wrong product gets ordered.
    return notEstablished(src,
      [`panelId '${id}' does not resolve to any catalogue module`],
      `the record names catalogue id '${id}', which is not in the module catalogue — identity is NOT established, `
      + 'and the model text is deliberately not consulted as a substitute');
  }

  // ── 2 · THE LEGACY COMPATIBILITY BRIDGE ─────────────────────────────────
  // No stable id. Exactly one path is allowed: a UNIQUE, DETERMINISTIC, EXACT
  // match on the strongest persisted attributes. This is the ONLY place in the
  // codebase that may derive an identity from attributes, and it fails closed.
  // Blank markers are treated as ABSENT, not as values to match on.
  const model = attr(src.model);
  const manufacturer = attr(src.manufacturer);
  const watts = num(src.watts);

  // A MODEL is mandatory for the bridge. Without it, `manufacturer` (optionally
  // plus a wattage) could land on exactly one catalogue row and establish an
  // identity nobody recorded — "Q CELLS, 400 W" is not a product selection, and
  // a catalogue that happens to carry one such row today would start silently
  // resolving it. Manufacturer and wattage are DISCRIMINATORS here, never the
  // basis of a match.
  if (!model) {
    return notEstablished(src,
      [manufacturer || watts != null
        ? 'the record carries no panelId and no model — manufacturer/wattage alone cannot identify a product'
        : 'the record carries no panelId, model or manufacturer'],
      'no module identity is recorded: a model is required before the legacy bridge may match');
  }

  const all = catalog.all();

  // 2a · A STABLE CATALOGUE CLUE hiding in the model field. Several older bodies
  //      persist the catalogue ID in `panelModel` (generatePermit has long called
  //      `getPanelById(str.panelModel)`). An EXACT id hit is a stable clue, not a
  //      guess, so it is admitted — and it is the only non-attribute clue used.
  if (model) {
    const byIdClue = catalog.byId(src.model!.trim());
    if (byIdClue) {
      // The clue is admitted only if the OTHER recorded attributes agree with
      // the row it names. Accepting it unconditionally would have made this the
      // one place a contradiction is ignored — exactly the "optional if
      // inconvenient" behaviour 2b below refuses — so a record naming
      // 'rec-400aa-pure-r' while also recording Q CELLS / 999 W would have
      // resolved to the REC panel and silently discarded the disagreement.
      const disagree: string[] = [];
      if (manufacturer && norm(byIdClue.manufacturer) !== manufacturer) {
        disagree.push(`manufacturer '${src.manufacturer}' ≠ '${byIdClue.manufacturer}'`);
      }
      if (watts != null && num(byIdClue.watts) !== watts) {
        disagree.push(`${watts} W ≠ ${byIdClue.watts ?? 'unstated'} W`);
      }
      if (disagree.length) {
        return notEstablished(src,
          [`the model field holds catalogue id '${byIdClue.id}', but the record contradicts it: ${disagree.join('; ')}`],
          `the model field names catalogue id '${byIdClue.id}' while the record's other attributes disagree with that `
          + `row (${disagree.join('; ')}) — identity is NOT established, and neither side is preferred`);
      }
      return established('LEGACY_DERIVED', byIdClue,
        `no panelId on the record; the model field holds the exact catalogue id '${byIdClue.id}'`
        + `${manufacturer || watts != null ? ', and the recorded attributes agree with it' : ''}`);
    }
  }

  // 2b · EXACT attribute match. Every supplied attribute must match exactly.
  //      Nothing is optional-if-inconvenient: a supplied manufacturer or wattage
  //      that disagrees eliminates the candidate rather than being ignored.
  let candidates = all.filter(p => (model ? norm(p.model) === model : true));
  if (manufacturer) candidates = candidates.filter(p => norm(p.manufacturer) === manufacturer);
  if (watts != null) candidates = candidates.filter(p => num(p.watts) === watts);

  if (candidates.length === 1) {
    const spec = candidates[0];
    const on = [
      model ? `model '${src.model}'` : null,
      manufacturer ? `manufacturer '${src.manufacturer}'` : null,
      watts != null ? `${watts} W` : null,
    ].filter(Boolean).join(' + ');
    return established('LEGACY_DERIVED', spec,
      `no panelId on the record; exactly one catalogue module matches ${on} EXACTLY — '${spec.id}'`);
  }

  if (candidates.length > 1) {
    return notEstablished(src,
      [`${candidates.length} catalogue modules match the recorded attributes exactly (${candidates.map(c => c.id).join(', ')})`],
      `the recorded attributes are AMBIGUOUS — ${candidates.length} catalogue modules match them equally, so no single `
      + 'module is identified. Pin a panelId to resolve it.');
  }

  // 0 candidates. Say precisely why, and never widen the match to find one.
  const exactModelHits = model ? all.filter(p => norm(p.model) === model).length : 0;
  const refusal = exactModelHits > 0
    ? `model '${src.model}' matches ${exactModelHits} catalogue module(s), but none of them also match the recorded `
      + `${manufacturer ? 'manufacturer' : ''}${manufacturer && watts != null ? ' and ' : ''}${watts != null ? 'wattage' : ''}`
    : `no catalogue module has the exact model '${src.model ?? ''}'`;
  return notEstablished(src, [refusal],
    `${refusal} — identity is NOT established. Substring and approximate matching are deliberately not attempted.`);
}

// ═══════════════════════════════════════════════════════════════════════════
// §4 — THE SHAPES THE CODEBASE ACTUALLY HOLDS
// ═══════════════════════════════════════════════════════════════════════════

/** A posted fleet string, structurally (no import of the permit types, so CAD /
 *  BOM / computed-system can use this without depending on the permit layer). */
export interface ModuleBearingString {
  panelId?: string | null;
  panelManufacturer?: string | null;
  panelModel?: string | null;
  panelWatts?: number | null;
}

/** Identity for one fleet string. */
export function resolveStringModuleIdentity(
  s: ModuleBearingString | null | undefined,
  opts?: { catalog?: ModuleCatalog },
): CanonicalModuleIdentity {
  return resolveModuleIdentity({
    panelId: s?.panelId ?? null,
    manufacturer: s?.panelManufacturer ?? null,
    model: s?.panelModel ?? null,
    watts: num(s?.panelWatts),
  }, opts);
}

/** A per-subsystem equipment map entry (`{ panelId }`), structurally. */
export function resolveSubsystemModuleIdentity(
  entry: { panelId?: string | null } | null | undefined,
  opts?: { catalog?: ModuleCatalog },
): CanonicalModuleIdentity {
  return resolveModuleIdentity({ panelId: entry?.panelId ?? null }, opts);
}

/** Every DISTINCT module identity in a fleet, keyed by the resolved panelId —
 *  or, where identity is not established, by the raw model text so the caller can
 *  still report the gap. Deterministic key order.
 *
 *  Keying by panelId is what makes proof 7 hold: change the canonical id and
 *  every subsystem sees the new key without rematching anything. */
export function resolveFleetModuleIdentities(
  fleet: { inverters?: Array<{ strings?: ModuleBearingString[] } | null | undefined> | null } | null | undefined,
  opts?: { catalog?: ModuleCatalog },
): Map<string, CanonicalModuleIdentity> {
  const out = new Map<string, CanonicalModuleIdentity>();
  for (const inv of fleet?.inverters ?? []) {
    for (const s of inv?.strings ?? []) {
      const idn = resolveStringModuleIdentity(s, opts);
      const key = idn.panelId ?? `unresolved:${norm(s?.panelModel) || '(no model)'}`;
      if (!out.has(key)) out.set(key, idn);
    }
  }
  return new Map([...out.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

// ═══════════════════════════════════════════════════════════════════════════
// §5 — THE BOUNDARY: MATERIALISE THE IDENTITY ONCE
//
// WHY THIS EXISTS. `applyCanonicalEquipmentToInput` re-pins the canonical
// selection — but it is called from only TWO places, both inside DIVERGENT
// branches of `canonical-equipment-selection@v1` (resolvers.ts:582, :683). The
// NO-DIVERGENCE branch (resolvers.ts:520-534 — the ordinary single-selection
// case), the SKIPPED branch and the OPERATOR_CONFIRMATION branch all return
// without re-pinning anything. So on the normal path `panelId` is written only
// if the posted body already carried it, and a consumer that required the id
// would fail closed on most real projects.
//
// This is the ONE place that guarantees the invariant every consumer relies on:
//   after materialisation, a string either carries a resolved `panelId` and
//   attributes projected from that catalogue row, or its identity is honestly
//   not established.
//
// It is IDEMPOTENT and independent of divergence, so it is safe to call at more
// than one boundary. It writes only to the in-memory input; persistence remains
// the reconciliation / self-heal path's job, which is what `bridged` is for.
// ═══════════════════════════════════════════════════════════════════════════

export interface ModuleMaterialisationReport {
  /** record paths whose identity was written or corrected. */
  changed: string[];
  /** paths where a LEGACY_DERIVED identity supplied the id — eligible for the
   *  existing reconciliation / self-heal persistence. This module never writes
   *  to a database. */
  bridged: string[];
  /** paths where identity could not be established, with the exact reasons. */
  refused: Array<{ path: string; refusals: string[] }>;
}

interface MutableStringLike extends ModuleBearingString {
  panelVoc?: number | null;
  panelIsc?: number | null;
}

/**
 * Resolve and write the canonical module identity onto every fleet string.
 *
 * Attributes are written FROM THE CATALOGUE ROW, which is what makes them
 * projections of the identity rather than rivals to it. A string whose identity
 * cannot be established is left exactly as posted and reported in `refused` —
 * nothing is guessed, and nothing is blanked.
 */
export function materialiseModuleIdentity(
  input: { system?: { inverters?: Array<{ strings?: MutableStringLike[] } | null | undefined> | null } | null } | null | undefined,
  opts?: { catalog?: ModuleCatalog },
): ModuleMaterialisationReport {
  const report: ModuleMaterialisationReport = { changed: [], bridged: [], refused: [] };
  const invs = input?.system?.inverters ?? [];
  invs.forEach((inv, i) => {
    (inv?.strings ?? []).forEach((s, j) => {
      const path = `system.inverters[${i}].strings[${j}]`;
      const idn = resolveStringModuleIdentity(s, opts);
      if (!idn.established || !idn.spec) {
        report.refused.push({ path, refusals: idn.refusals });
        return;
      }
      const spec = idn.spec;
      if (s.panelId !== spec.id) { s.panelId = spec.id; report.changed.push(`${path}.panelId`); }
      if (s.panelModel !== spec.model) { s.panelModel = spec.model; report.changed.push(`${path}.panelModel`); }
      if (s.panelManufacturer !== spec.manufacturer) {
        s.panelManufacturer = spec.manufacturer; report.changed.push(`${path}.panelManufacturer`);
      }
      if (spec.watts != null && s.panelWatts !== spec.watts) {
        s.panelWatts = spec.watts; report.changed.push(`${path}.panelWatts`);
      }
      // Voc / Isc are electrical ATTRIBUTES of the identified module. They are
      // filled only where the body left them empty or zero — a posted
      // measurement is an observation and is never overwritten by a catalogue
      // nominal.
      if (spec.voc != null && !(typeof s.panelVoc === 'number' && s.panelVoc > 0)) s.panelVoc = spec.voc;
      if (spec.isc != null && !(typeof s.panelIsc === 'number' && s.panelIsc > 0)) s.panelIsc = spec.isc;
      if (idn.state === 'LEGACY_DERIVED') report.bridged.push(path);
    });
  });
  return report;
}

// ═══════════════════════════════════════════════════════════════════════════
// §6 — DISPLAY / SEARCH ONLY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Approximate module search for a HUMAN picking from a list.
 *
 * ⚠ ITS RESULT MAY NEVER ESTABLISH IDENTITY. It must not reach design, CAD,
 * BOM, procurement, permit readiness, the digest, document applicability or
 * release. It returns MANY candidates precisely so a caller cannot mistake it
 * for a resolution — there is no "the answer" to take.
 *
 * The architectural guard test asserts no authority path imports this.
 */
export function searchModulesForDisplay(
  query: string,
  opts?: { catalog?: ModuleCatalog; limit?: number },
): SolarPanel[] {
  const catalog = opts?.catalog ?? PRODUCTION_MODULE_CATALOG;
  const q = norm(query);
  if (!q) return [];
  const hits = catalog.all().filter(p =>
    norm(p.model).includes(q) || q.includes(norm(p.model)) || norm(p.manufacturer).includes(q));
  return hits.slice(0, opts?.limit ?? 25);
}
