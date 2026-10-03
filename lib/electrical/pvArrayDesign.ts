// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE PHYSICAL PV ARRAY, AS DESIGN PLACED IT — NOT AS AN INVERTER FLEET DESCRIBES IT.
//
// Ray, 2026-10-03, with the live sheet in front of him after "Inverter: None" was finally
// honoured:
//
//   PV INVERTER = NONE · PV DC COUPLED TO POWERWALL 3        ← correct, keep it
//   20 × 400 W · 8.00 kW DC · 2 × 10 strings                 ← his design is 37 × 440 W, 16.28 kW
//
// The architecture repair emptied `config.inverters[]`, and the array went with it, because the
// engineering page had only ever described the array AS a property of the inverter fleet:
//
//   page.tsx   totalPanels = Σ config.inverters[].strings[].panelCount        → 0
//              panelData   = getPanelById(config.inverters[0].strings[0].panelId) → null
//   sld route  totalModules = Number(body.totalModules) || 20                 → 20
//              panelWatts   = Number(body.panelWatts)   || 400                → 400
//
// Two stores already held the truth and neither was asked: the Design layout (`layouts.panels`,
// `layouts.total_panels`) says HOW MANY modules are placed, and `projects.selected_equipment.panelId`
// says WHICH module. Removing an inverter cannot remove a module. Changing the coupling cannot change
// the module count. A string assignment cannot invent modules.
//
//   PHYSICAL PV DESIGN ≠ INVERTER FLEET
//
// This module is the one answer to "what array did Design place?", shared by the browser (System
// Config, the summary cards, every request the page builds) and the server (the canonical SLD
// projection), so the two cannot disagree about it. It is pure and isomorphic: no database, no React.
//
// What it is NOT: string design. Which modules land on which input is engineering's job
// (`generateStringConfig` against the receiving device's published window). This reports the array
// those engines must cover, and it reports the active assignment only to say whether that assignment
// still represents the design.
// ═══════════════════════════════════════════════════════════════════════════

import { resolveModuleIdentity } from '@/lib/equipment/moduleIdentity';

/** Where the module COUNT came from. Ordered by authority. */
export type PvModuleCountSource =
  /** `layouts.panels.length` — modules actually placed in Design. */
  | 'design-placed-modules'
  /** `layouts.total_panels` — Design's own precomputed total. */
  | 'design-layout-total'
  /** A saved SystemDefinition's layout total (older Design hand-off shape). */
  | 'system-definition'
  /**
   * The string assignment typed into Inverters & Strings, used ONLY when the project has no Design
   * layout at all — a manual engineering entry. Never used to override or fill in for Design.
   */
  | 'engineering-entry'
  | 'not-established';

/** Where the module IDENTITY came from. */
export type PvModuleIdentitySource =
  /** `projects.selected_equipment.panelId` — the canonical "which panel" (CMEI). */
  | 'selected-equipment'
  /** `layouts.design_electrical.panelId` — the module Design Studio recorded with its strings. */
  | 'design-electrical'
  /** The panel on the string assignment, used only when neither store above names one. */
  | 'engineering-entry'
  | 'not-established';

/** How the DC size was obtained. */
export type PvDcSizeSource =
  /** Σ per-string modules × that string's module watts — exact for a multi-module design. */
  | 'string-assignment'
  /** module count × the identified module's catalogue watts. */
  | 'module-identity'
  /** module count × the wattage Design recorded on the placed modules (identity not established). */
  | 'design-placed-wattage'
  | 'not-established';

/** Does the active string assignment still represent the array Design placed? */
export type PvAssignmentState =
  /** It covers exactly the design's module count. */
  | 'MATCHES_DESIGN'
  /** There is no assignment (e.g. a DC-coupled job whose standalone inverter fleet was retired). */
  | 'NO_ASSIGNMENT'
  /** It covers a different number of modules than Design placed — it must be re-derived, never trusted. */
  | 'DIFFERS_FROM_DESIGN'
  /** There is no Design count to compare it with. */
  | 'NO_DESIGN';

/** The module's electrical facts, projected from its catalogue row — never inputs to identity. */
export interface PvArrayModuleSpec {
  panelId: string;
  manufacturer: string;
  model: string;
  watts: number;
  voc: number;
  vmp: number;
  isc: number;
  imp: number;
  tempCoeffVoc: number;
  tempCoeffIsc: number;
  maxSeriesFuseRating: number;
}

/** A fact the array needs and does not have — what, why, whose, and what it blocks. */
export interface PvArrayMissingFact {
  fact: string;
  why: string;
  owner: string;
  blocks: string[];
}

export interface PvArrayDesign {
  /** Modules in the physical array. `null` ⇒ no source has established it. `0` ⇒ Design placed none. */
  moduleCount: number | null;
  moduleCountSource: PvModuleCountSource;
  /** The identified module, or null when no store names one that resolves. */
  module: PvArrayModuleSpec | null;
  moduleSource: PvModuleIdentitySource;
  /** Why the identity is what it is (or is not established). Auditable. */
  moduleBasis: string;
  /** DC nameplate at STC, in watts and kW. Null ⇒ not established — never a literal. */
  dcStcW: number | null;
  dcStcKw: number | null;
  dcSizeSource: PvDcSizeSource;
  /** Modules represented in the active string assignment (0 when there is none). */
  assignedModuleCount: number;
  assignmentState: PvAssignmentState;
  /** Every fact the array is missing. Empty ⇔ count, identity and DC size are all established. */
  missing: PvArrayMissingFact[];
}

export interface PvArrayDesignInput {
  /** `layouts.panels.length` — modules placed in Design. */
  placedModuleCount?: number | null;
  /** `layouts.total_panels`. */
  layoutTotalPanels?: number | null;
  /** `systemDefinition.layout.totalPanels` (older hand-off shape). */
  systemDefinitionTotal?: number | null;
  /** `projects.selected_equipment.panelId`. */
  selectedPanelId?: string | null;
  /** `layouts.design_electrical.panelId`. */
  designElectricalPanelId?: string | null;
  /**
   * The active string assignment (`engineering_config.inverters[].strings[]`). Consulted for the
   * count and identity ONLY when Design has neither; always consulted to report whether it still
   * represents the design.
   */
  engineeringStrings?: ReadonlyArray<{ panelId?: string | null; panelCount?: number | null }> | null;
  /** The wattage Design recorded on its placed modules — DC size fallback when identity is unknown. */
  placedModuleWatts?: number | null;
}

const posInt = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};
const nonNegInt = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};
const idOrNull = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

function specOf(panelId: string): { spec: PvArrayModuleSpec | null; basis: string } {
  const ident = resolveModuleIdentity({ panelId });
  const s = ident.spec;
  if (!ident.established || !s) return { spec: null, basis: ident.basis };
  return {
    spec: {
      panelId: s.id,
      manufacturer: s.manufacturer,
      model: s.model,
      watts: s.watts,
      voc: s.voc,
      vmp: s.vmp,
      isc: s.isc,
      imp: s.imp,
      tempCoeffVoc: s.tempCoeffVoc,
      tempCoeffIsc: s.tempCoeffIsc,
      maxSeriesFuseRating: s.maxSeriesFuseRating,
    },
    basis: ident.basis,
  };
}

/**
 * THE array Design placed. Pure and total.
 *
 * Count authority:    placed modules > layout total > SystemDefinition > (no Design at all) the
 *                     engineering entry. A positive Design count is never overridden by strings.
 * Identity authority: selected_equipment > Design Studio's recorded module > (neither) the string
 *                     assignment's module. A recorded id that does not resolve FAILS CLOSED — the
 *                     next store is not consulted as a substitute, because a dangling id means the
 *                     record and the catalogue disagree.
 */
export function resolvePvArrayDesign(input: PvArrayDesignInput): PvArrayDesign {
  const strings = (input.engineeringStrings ?? []).filter(s => s && (posInt(s.panelCount) ?? 0) > 0);
  const assignedModuleCount = strings.reduce((n, s) => n + (posInt(s.panelCount) ?? 0), 0);

  // ── HOW MANY ──────────────────────────────────────────────────────────────
  let moduleCount: number | null = null;
  let moduleCountSource: PvModuleCountSource = 'not-established';
  const placed = posInt(input.placedModuleCount);
  const layoutTotal = posInt(input.layoutTotalPanels);
  const sdTotal = posInt(input.systemDefinitionTotal);
  if (placed !== null) { moduleCount = placed; moduleCountSource = 'design-placed-modules'; }
  else if (layoutTotal !== null) { moduleCount = layoutTotal; moduleCountSource = 'design-layout-total'; }
  else if (sdTotal !== null) { moduleCount = sdTotal; moduleCountSource = 'system-definition'; }
  else if (assignedModuleCount > 0) { moduleCount = assignedModuleCount; moduleCountSource = 'engineering-entry'; }
  else if (nonNegInt(input.layoutTotalPanels) === 0 || nonNegInt(input.placedModuleCount) === 0) {
    // A layout that exists and places nothing is an answer: no PV on this project.
    moduleCount = 0; moduleCountSource = 'design-layout-total';
  }

  const designOwnsCount = moduleCountSource !== 'engineering-entry' && moduleCountSource !== 'not-established';
  const assignmentState: PvAssignmentState = !designOwnsCount
    ? 'NO_DESIGN'
    : assignedModuleCount === 0
      ? 'NO_ASSIGNMENT'
      : assignedModuleCount === moduleCount ? 'MATCHES_DESIGN' : 'DIFFERS_FROM_DESIGN';

  // ── WHICH MODULE ──────────────────────────────────────────────────────────
  let mod: PvArrayModuleSpec | null = null;
  let moduleSource: PvModuleIdentitySource = 'not-established';
  let moduleBasis = 'no store names a module for this project';
  const selectedId = idOrNull(input.selectedPanelId);
  const designId = idOrNull(input.designElectricalPanelId);
  const stringIds = [...new Set(strings.map(s => idOrNull(s.panelId)).filter((x): x is string => !!x))];
  if (selectedId) {
    const r = specOf(selectedId);
    mod = r.spec; moduleBasis = r.basis;
    moduleSource = r.spec ? 'selected-equipment' : 'not-established';
  } else if (designId) {
    const r = specOf(designId);
    mod = r.spec; moduleBasis = r.basis;
    moduleSource = r.spec ? 'design-electrical' : 'not-established';
  } else if (stringIds.length === 1) {
    const r = specOf(stringIds[0]);
    mod = r.spec; moduleBasis = r.basis;
    moduleSource = r.spec ? 'engineering-entry' : 'not-established';
  } else if (stringIds.length > 1) {
    moduleBasis = `the string assignment names ${stringIds.length} different modules `
      + `(${stringIds.join(', ')}) and no project-level selection says which one the array is`;
  }

  // ── HOW BIG ───────────────────────────────────────────────────────────────
  let dcStcW: number | null = null;
  let dcSizeSource: PvDcSizeSource = 'not-established';
  const perStringWatts = strings.map(s => {
    const id = idOrNull(s.panelId);
    return id ? specOf(id).spec?.watts ?? null : null;
  });
  // The assignment is consulted for DC size only where it adds information the single module identity
  // cannot: a design that mixes module types (roof / ground / fence on different modules) AND whose
  // assignment still represents every module exactly once. A single-module design is count × the
  // identified module — a stale panel left on the strings must not resize the array.
  const canUseAssignment = (assignmentState === 'MATCHES_DESIGN' || assignmentState === 'NO_DESIGN')
    && strings.length > 0 && perStringWatts.every(w => w !== null)
    && (stringIds.length > 1 || !mod);
  if (moduleCount === 0) {
    dcStcW = 0; dcSizeSource = 'module-identity';
  } else if (canUseAssignment) {
    dcStcW = strings.reduce((w, s, i) => w + (posInt(s.panelCount) ?? 0) * (perStringWatts[i] as number), 0);
    dcSizeSource = 'string-assignment';
  } else if (moduleCount !== null && mod) {
    dcStcW = moduleCount * mod.watts;
    dcSizeSource = 'module-identity';
  } else if (moduleCount !== null && posInt(input.placedModuleWatts) !== null) {
    dcStcW = moduleCount * (posInt(input.placedModuleWatts) as number);
    dcSizeSource = 'design-placed-wattage';
  }

  // ── WHAT IS MISSING ───────────────────────────────────────────────────────
  const missing: PvArrayMissingFact[] = [];
  if (moduleCount === null) {
    missing.push({
      fact: 'PV module count',
      why: 'The strings, the DC size and the array drawn on the single-line diagram all follow from how '
        + 'many modules are installed.',
      owner: 'Design (place the modules)',
      blocks: ['string design', 'SLD', 'BOM', 'permit'],
    });
  }
  if ((moduleCount ?? 0) > 0 && !mod) {
    missing.push({
      fact: 'PV module model',
      why: 'Voc, Isc and the temperature coefficients that size every string are properties of the '
        + `module. ${moduleBasis}.`,
      owner: 'Design / equipment selection (choose the module)',
      blocks: ['string design', 'NEC 690.7 voltage check', 'SLD', 'BOM', 'permit'],
    });
  }

  return {
    moduleCount,
    moduleCountSource,
    module: mod,
    moduleSource,
    moduleBasis,
    dcStcW,
    dcStcKw: dcStcW === null ? null : Math.round(dcStcW) / 1000,
    dcSizeSource,
    assignedModuleCount,
    assignmentState,
    missing,
  };
}

/** The provenance hint an installer reads beside the number. No store names. */
export function pvModuleCountSourceLabel(s: PvModuleCountSource): string {
  switch (s) {
    case 'design-placed-modules':
    case 'design-layout-total':
    case 'system-definition':
      return 'From Design';
    case 'engineering-entry':
      return 'Entered in Inverters & Strings (no Design layout)';
    case 'not-established':
      return 'Not established — place modules in Design';
  }
}

export function pvModuleSourceLabel(s: PvModuleIdentitySource): string {
  switch (s) {
    case 'selected-equipment': return 'Selected module';
    case 'design-electrical': return 'From Design';
    case 'engineering-entry': return 'From Inverters & Strings';
    case 'not-established': return 'Not established — choose a module';
  }
}
