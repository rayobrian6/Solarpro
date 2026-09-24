// ═══════════════════════════════════════════════════════════════════════════
// DELETION IS A DECISION, AND IT NEEDS AN AUTHORITY
//
// WHAT WAS WRONG
// --------------
// There was no canonical answer to "does this object still belong to the
// active design?". Every subsystem answered it from whatever it happened to
// hold:
//
//   • the renderer answered from `plane3DEntityMap` — so a removed face stayed
//     drawn, and a face that had never been drawn was treated as absent. The
//     reconcile-deletions block that used to run off that map DESTROYED a
//     hand-traced garage (SolarEngine3D.tsx, the v66 comment), because it read
//     "not in this prop right now" as "deleted".
//   • Lane A answered from `existingPlaneCount` — so emptying the roof, which
//     is HOW a person says no to a bad Google model, re-satisfied the gate and
//     re-injected exactly what had been removed.
//   • the save guard answered from `panels.length` — so an intentional wipe and
//     the July reload data-loss bug were the same byte pattern, and it had to
//     refuse both.
//
// 🚨 ABSENCE IS NOT INTENT, AND INTENT WAS UNWRITABLE. Nothing in the data
// model could say "a person looked at this and removed it on purpose", so every
// consumer had to guess, and the guesses disagreed. Restoring a project could
// resurrect a deleted face from the archive; a provider retry could resurrect a
// whole rejected roof; and a user who genuinely wanted an empty roof could not
// save one.
//
// THE MODEL
// ---------
// Two facts, both persisted, both property-scoped exactly as ownership is:
//
//   1. A LEDGER of tombstones — the ids a person deliberately removed at a
//      property. This is the one canonical answer. Every path that can
//      reconstruct geometry (stored row, archive, provider, legacy migration)
//      filters through `admitPlanes` before the geometry reaches state.
//
//   2. A one-shot AUTHORIZATION minted by the destructive operation itself and
//      carried on the save that follows it. This is what lets the server tell
//      "the user chose Clear Custom Building and confirmed" from "sixty-seven
//      faces just became zero for no stated reason". A payload containing zero
//      faces is NOT authorization; the authorization is.
//
// 🚨 NEITHER IS A RENDERER FLAG. Both are design state, they persist with the
// design, and they are read by the gate, the restore paths, the archive merge
// and the server guard — not by the view.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * What a destructive operation removed. The scope is what the user chose, in
 * their words, not what the implementation happened to splice.
 */
export type DeletionScope =
  /** one roof face / traced polygon */
  | 'face'
  /** a building section and every face, wall and panel it owns */
  | 'section'
  /** one obstruction and its keep-out */
  | 'obstruction'
  /** every marked obstruction at this property, and their keep-outs */
  | 'obstructions'
  /** the panel layout only — geometry untouched */
  | 'panels'
  /** every hand-built roof face and section at this property */
  | 'customBuilding'
  /** everything at this property: geometry, obstructions, measurements, panels */
  | 'design';

export const DELETION_SCOPES: readonly DeletionScope[] = [
  'face', 'section', 'obstruction', 'obstructions', 'panels', 'customBuilding', 'design',
] as const;

export function isDeletionScope(v: unknown): v is DeletionScope {
  return typeof v === 'string' && (DELETION_SCOPES as readonly string[]).includes(v);
}

/**
 * How much ceremony a scope deserves.
 *
 * 🚨 ONE FACE MUST NOT COST WHAT THE WHOLE PROJECT COSTS. A modelling tool is
 * used by trying things; if every removal demands a modal, people stop trying
 * things, and the product becomes the thing they are afraid of. Undo is the
 * safety net for the small ones. The two that cannot be a slip — clearing the
 * building, starting over — are the two that ask.
 */
export type DeletionCeremony = 'undoable' | 'confirm';

export function ceremonyFor(scope: DeletionScope): DeletionCeremony {
  return scope === 'customBuilding' || scope === 'design' || scope === 'panels'
      || scope === 'obstructions'
    ? 'confirm'
    : 'undoable';
}

// ───────────────────────────────────────────────────────────────────────────
// THE LEDGER
// ───────────────────────────────────────────────────────────────────────────

/** What a person deliberately removed at ONE property. */
export interface DeletionLedgerSite {
  /** RoofPlane ids. A tombstoned id may never re-enter the active design. */
  faceIds: string[];
  /** BuildingSection ids. Kept separately so a rebuilt section is also refused. */
  sectionIds: string[];
  /** PlacedObstruction ids. */
  obstructionIds: string[];
  /**
   * When the property's geometry was deliberately emptied, ms epoch; 0 = never.
   *
   * 🚨 THIS IS WHAT `existingPlaneCount` COULD NOT SAY. A count of zero is the
   * same integer whether nobody has modelled the house yet or somebody modelled
   * it and threw it away, and those two facts must produce opposite answers
   * from the acquisition gate. See `lifecycleFor`.
   */
  clearedAt: number;
}

/** siteKey → what was removed there. An absent key means nothing was. */
export interface DeletionLedger {
  sites: Record<string, DeletionLedgerSite>;
}

export function emptyLedger(): DeletionLedger {
  return { sites: {} };
}

export function emptyLedgerSite(): DeletionLedgerSite {
  return { faceIds: [], sectionIds: [], obstructionIds: [], clearedAt: 0 };
}

/**
 * WHICH KEY DOES THIS PROPERTY'S LEDGER LIVE UNDER?
 *
 * 🚨 AN EXACT STRING LOOKUP IS NOT A PROPERTY MATCH, and everything else that
 * answers "which house is this" in this codebase knows it. `siteKeyFromCoords`
 * rounds to about 1.1 m, so ONE house routinely mints two or three keys metres
 * apart — the live trace in lib/design/siteDesignModel.ts records 2.8 m, 17 m
 * and 19 m for a single address inside 43 seconds. The DISPOSITION map hit
 * exactly this and was given `dispositionForProperty`; the ledger was written
 * without the same wrapper, so a tombstone filed under KA was invisible under
 * KA' — `lifecycleFor` read `untouched`, the acquisition gate said yes, and
 * `switchSite` handed the deleted face and its panel straight back. That is the
 * A -> B -> A failure this whole model exists to close, reintroduced one level
 * down.
 *
 * The matcher is injected so this module stays dependency-free and testable;
 * the callers pass `sitesAreSameProperty`.
 */
export function resolveLedgerKey(
  ledger: DeletionLedger | null | undefined,
  siteKey: string | null | undefined,
  sameProperty?: (a: string, b: string) => boolean,
): string {
  if (!siteKey) return '';
  const sites = ledger?.sites ?? {};
  if (sites[siteKey]) return siteKey;
  if (!sameProperty) return siteKey;
  for (const k of Object.keys(sites)) {
    if (k && k !== siteKey && sameProperty(k, siteKey)) return k;
  }
  return siteKey;
}

/** The tombstones at one property. Always an object, never null. */
export function ledgerSite(
  ledger: DeletionLedger | null | undefined,
  siteKey: string | null | undefined,
): DeletionLedgerSite {
  const s = siteKey ? ledger?.sites?.[siteKey] : null;
  if (!s) return emptyLedgerSite();
  return {
    faceIds: Array.isArray(s.faceIds) ? s.faceIds.filter(isId) : [],
    sectionIds: Array.isArray(s.sectionIds) ? s.sectionIds.filter(isId) : [],
    obstructionIds: Array.isArray(s.obstructionIds) ? s.obstructionIds.filter(isId) : [],
    clearedAt: Number.isFinite(s.clearedAt) && s.clearedAt > 0 ? s.clearedAt : 0,
  };
}

function isId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function uniq(a: string[]): string[] {
  const out: string[] = [];
  const seen: Record<string, boolean> = {};
  for (const v of a) {
    if (!isId(v) || seen[v]) continue;
    seen[v] = true;
    out.push(v);
  }
  return out.sort();
}

/**
 * Record tombstones, returning a NEW ledger.
 *
 * 🚨 A SITE WITH NOTHING RECORDED IS DELETED FROM THE MAP, not stored as an
 * empty object — absence and "nothing was removed here" must be one state, or
 * two readers spell one fact two ways and the day they disagree is a silent
 * wrong answer. Same rule as `withDisposition`.
 */
export function withTombstones(
  ledger: DeletionLedger | null | undefined,
  siteKey: string | null | undefined,
  add: Partial<DeletionLedgerSite>,
): DeletionLedger {
  const out: DeletionLedger = { sites: { ...(ledger?.sites ?? {}) } };
  if (!siteKey) return out;                 // an unresolved site owns no decision
  const cur = ledgerSite(ledger, siteKey);
  const next: DeletionLedgerSite = {
    faceIds: uniq([...cur.faceIds, ...(add.faceIds ?? [])]),
    sectionIds: uniq([...cur.sectionIds, ...(add.sectionIds ?? [])]),
    obstructionIds: uniq([...cur.obstructionIds, ...(add.obstructionIds ?? [])]),
    clearedAt: Math.max(cur.clearedAt, Number.isFinite(add.clearedAt) ? add.clearedAt : 0),
  };
  if (!next.faceIds.length && !next.sectionIds.length && !next.obstructionIds.length && !next.clearedAt) {
    delete out.sites[siteKey];
  } else {
    out.sites[siteKey] = next;
  }
  return out;
}

/**
 * Forget every deletion at a property.
 *
 * 🚨 ONLY AN EXPLICIT USER COMMAND MAY CALL THIS. Undo calls it — undoing a
 * deletion is a person saying they did not mean it, and a tombstone that
 * outlived its undo would make the returned object vanish again on the next
 * reload. "Return to Google 3D" calls it — that is the explicit re-acquisition
 * the deletion model exists to make deliberate. Nothing else does: a ledger
 * that quietly forgets is the resurrection bug wearing a different hat.
 */
export function withoutTombstones(
  ledger: DeletionLedger | null | undefined,
  siteKey: string | null | undefined,
): DeletionLedger {
  const out: DeletionLedger = { sites: { ...(ledger?.sites ?? {}) } };
  if (siteKey) delete out.sites[siteKey];
  return out;
}

/** Remove specific tombstones — what an undo of one deletion does. */
export function withTombstonesRemoved(
  ledger: DeletionLedger | null | undefined,
  siteKey: string | null | undefined,
  drop: Partial<DeletionLedgerSite>,
): DeletionLedger {
  const out: DeletionLedger = { sites: { ...(ledger?.sites ?? {}) } };
  if (!siteKey) return out;
  const cur = ledgerSite(ledger, siteKey);
  const gone = (keep: string[], remove: string[] | undefined) =>
    keep.filter(id => !(remove ?? []).includes(id));
  const next: DeletionLedgerSite = {
    faceIds: gone(cur.faceIds, drop.faceIds),
    sectionIds: gone(cur.sectionIds, drop.sectionIds),
    obstructionIds: gone(cur.obstructionIds, drop.obstructionIds),
    clearedAt: drop.clearedAt ? 0 : cur.clearedAt,
  };
  if (!next.faceIds.length && !next.sectionIds.length && !next.obstructionIds.length && !next.clearedAt) {
    delete out.sites[siteKey];
  } else {
    out.sites[siteKey] = next;
  }
  return out;
}

/** Tolerant parse of a stored ledger. Unknown shapes degrade to "nothing was
 *  deleted", never to "everything was" — the safe direction is keeping work. */
export function parseDeletionLedger(raw: unknown): DeletionLedger {
  const out = emptyLedger();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const sites = (raw as { sites?: unknown }).sites;
  if (!sites || typeof sites !== 'object' || Array.isArray(sites)) return out;
  for (const [k, v] of Object.entries(sites as Record<string, unknown>)) {
    if (!k || !v || typeof v !== 'object') continue;
    const s = ledgerSite({ sites: { [k]: v as DeletionLedgerSite } }, k);
    if (s.faceIds.length || s.sectionIds.length || s.obstructionIds.length || s.clearedAt) {
      out.sites[k] = s;
    }
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// THE ONE CANONICAL QUESTION
// ───────────────────────────────────────────────────────────────────────────

/** Minimal shape of anything that can be tombstoned. Deliberately structural so
 *  this module needs no import from `types/index.ts` and stays usable on the
 *  server, where the studio's types do not belong. */
export interface AdmittableFace {
  id?: string;
  sectionId?: string;
  section?: { id?: string };
}

/**
 * DOES THIS OBJECT STILL BELONG TO THE ACTIVE DESIGN?
 *
 * The single answer, asked by every path that can put geometry into state.
 * Render presence is not this answer, `roofPlanes.length` is not this answer,
 * and "the provider offered it again" is not this answer.
 */
export function faceIsDeleted(
  ledger: DeletionLedger | null | undefined,
  siteKey: string | null | undefined,
  face: AdmittableFace | null | undefined,
): boolean {
  if (!face) return false;
  const s = ledgerSite(ledger, siteKey);
  if (isId(face.id) && s.faceIds.includes(face.id)) return true;
  // A section's tombstone covers every face it owns, including a face rebuilt
  // from the section's parameters after the delete — the face id is derived
  // from the section id, so the section is the durable half of the identity.
  const sid = isId(face.sectionId) ? face.sectionId : face.section?.id;
  if (isId(sid) && s.sectionIds.includes(sid)) return true;
  return false;
}

export function obstructionIsDeleted(
  ledger: DeletionLedger | null | undefined,
  siteKey: string | null | undefined,
  id: string | null | undefined,
): boolean {
  return isId(id) && ledgerSite(ledger, siteKey).obstructionIds.includes(id);
}

/**
 * THE FILTER EVERY RECONSTRUCTION PATH RUNS THROUGH.
 *
 * Stored row, archived bundle, provider acquisition, legacy migration, version
 * restore — each of them can hand the studio a face a person already removed.
 * They all call this. Returns the admitted faces and, separately, what was
 * refused, so the caller can log it: a silent filter is how you end up unable
 * to explain where a face went.
 */
export function admitFaces<T extends AdmittableFace>(
  ledger: DeletionLedger | null | undefined,
  siteKey: string | null | undefined,
  faces: T[] | null | undefined,
): { admitted: T[]; refused: T[] } {
  const all = Array.isArray(faces) ? faces : [];
  const admitted: T[] = [];
  const refused: T[] = [];
  for (const f of all) {
    if (faceIsDeleted(ledger, siteKey, f)) refused.push(f);
    else admitted.push(f);
  }
  return { admitted, refused };
}

export function admitObstructions<T extends { id?: string }>(
  ledger: DeletionLedger | null | undefined,
  siteKey: string | null | undefined,
  obstructions: T[] | null | undefined,
): { admitted: T[]; refused: T[] } {
  const all = Array.isArray(obstructions) ? obstructions : [];
  const admitted: T[] = [];
  const refused: T[] = [];
  for (const o of all) {
    if (obstructionIsDeleted(ledger, siteKey, o?.id)) refused.push(o);
    else admitted.push(o);
  }
  return { admitted, refused };
}

// ───────────────────────────────────────────────────────────────────────────
// LIFECYCLE — what `existingPlaneCount` was being asked and could not answer
// ───────────────────────────────────────────────────────────────────────────

/**
 * The state of a property's geometry, as a fact rather than as an inference
 * from a count.
 *
 *   untouched — no geometry, and nobody has removed any. A first visit.
 *   populated — geometry exists.
 *   cleared   — no geometry, BECAUSE a person removed it. Automatic
 *               acquisition must not run here; only an explicit
 *               "use Google 3D geometry" may.
 */
export type DesignGeometryLifecycle = 'untouched' | 'populated' | 'cleared';

export function lifecycleFor(
  ledger: DeletionLedger | null | undefined,
  siteKey: string | null | undefined,
  planeCount: number,
): DesignGeometryLifecycle {
  if (Number.isFinite(planeCount) && planeCount > 0) return 'populated';
  const s = ledgerSite(ledger, siteKey);
  const deliberate = s.clearedAt > 0 || s.faceIds.length > 0 || s.sectionIds.length > 0;
  return deliberate ? 'cleared' : 'untouched';
}

/**
 * May automatic native acquisition run at a property in this lifecycle state?
 *
 * 🚨 ONLY `untouched`. `populated` refuses because a machine's guess must not
 * appear beside a person's traced roof and be autosaved — that was the original
 * meaning of `existingPlaneCount !== 0`, and it is kept. `cleared` refuses
 * because emptying the roof is HOW a person says the native model is not good
 * enough, and re-acquiring is precisely what they just undid.
 */
export function acquisitionPermittedByLifecycle(l: DesignGeometryLifecycle): boolean {
  return l === 'untouched';
}

// ───────────────────────────────────────────────────────────────────────────
// THE ONE-SHOT AUTHORIZATION
// ───────────────────────────────────────────────────────────────────────────

/**
 * Minted by a destructive operation, carried on the next save, consumed once.
 *
 * 🚨 IT NAMES WHAT IT REMOVED. The server does not take "destructive: true" for
 * an answer, because a boolean can be set by any path that happens to be
 * running when the real bug fires. It authorises the removal of exactly the
 * panel sub-systems it lists, at exactly the property it names. Anything else
 * the save happens to empty is still refused, which is what keeps the July
 * reload wipe protected while a deliberate clear goes through.
 */
export interface DestructiveAuthorization {
  op: DeletionScope;
  /** The property the operation was performed at. An authorization does not
   *  travel to another house. */
  siteKey: string;
  faceIds: string[];
  sectionIds: string[];
  obstructionIds: string[];
  panelIds: string[];
  /** The `systemType` of every panel the operation removed. THIS is what the
   *  save guard checks against; ids are recorded for the audit trail. */
  panelSystemTypes: string[];
  /** ms epoch, for the log. Not a validity condition — see the note below. */
  at: number;
}

/**
 * 🚨 THERE IS DELIBERATELY NO EXPIRY. The obvious extra safety — refuse an
 * authorization older than N minutes — buys nothing and costs a real journey:
 * a person clears the building, the save fails because they are on a phone in a
 * basement, and the retry twenty minutes later is refused with a data-loss
 * error about a wipe they explicitly asked for. The authorization is made
 * single-use at the point it is consumed instead, which is the property that
 * actually matters.
 */
export function makeAuthorization(
  op: DeletionScope,
  siteKey: string,
  removed: {
    faceIds?: string[];
    sectionIds?: string[];
    obstructionIds?: string[];
    panelIds?: string[];
    panelSystemTypes?: string[];
  },
  at: number,
): DestructiveAuthorization {
  return {
    op,
    siteKey: siteKey || '',
    faceIds: uniq(removed.faceIds ?? []),
    sectionIds: uniq(removed.sectionIds ?? []),
    obstructionIds: uniq(removed.obstructionIds ?? []),
    panelIds: uniq(removed.panelIds ?? []),
    panelSystemTypes: uniq(removed.panelSystemTypes ?? []),
    at: Number.isFinite(at) ? at : 0,
  };
}

/**
 * 🚨 AN UNDO/REDO STEP IS A DESTRUCTIVE OPERATION TOO, AND IT WAS THE ONLY ONE
 * THAT NEVER SAID SO.
 *
 * Every other path that removes geometry mints an authorization, because the
 * save guard refuses a payload that has lost faces it cannot account for. Redo
 * did not. So:
 *
 *     delete a roof face -> undo -> redo
 *
 * re-applied the tombstone, the next payload legitimately carried fewer faces,
 * nothing explained why, and the server refused it with a data-loss error. Not
 * once -- FOR EVER, because the ledger keeps the tombstone and every subsequent
 * autosave carries the same unexplained shortfall. The design could not be saved
 * again, and on reload the face came back.
 *
 * This computes what a step actually removed: everything tombstoned in `next`
 * that was not tombstoned in `prev`, at one property.
 *
 * Returns null when the step removed nothing, so an ordinary undo mints nothing.
 */
export function authorizationForLedgerDelta(
  prev: DeletionLedger | null | undefined,
  next: DeletionLedger | null | undefined,
  siteKey: string,
  panels: ReadonlyArray<{ id?: string; systemType?: string; planeId?: string }>,
  at: number,
  /**
   * 🚨 THE PANELS THE STEP LEFT BEHIND. Without it a redo of Clear Panels
   * authorises NOTHING.
   *
   * A panel is not tombstoned -- only faces, sections and obstructions are --
   * so `Clear Panels` produces an EMPTY ledger delta and the whole function
   * returned null. Delete 12 modules, undo, redo: the ledger says nothing
   * changed, no authorization is minted, and the save guard sees 12 modules
   * vanish with nothing to explain them. The permanent 409 deadlock this
   * function exists to close, still open on the commonest destructive action
   * in the product.
   *
   * When given, panels present in `panels` and absent here were removed by the
   * step and are authorised on that basis alone.
   */
  panelsAfter?: ReadonlyArray<{ id?: string }> | null,
): DestructiveAuthorization | null {
  const before = ledgerSite(prev, siteKey);
  const after = ledgerSite(next, siteKey);

  const added = (b: string[], a: string[]) => {
    const had = new Set(b);
    return a.filter(id => id && !had.has(id));
  };
  const faceIds = added(before.faceIds, after.faceIds);
  const sectionIds = added(before.sectionIds, after.sectionIds);
  const obstructionIds = added(before.obstructionIds, after.obstructionIds);
  const newlyCleared = !before.clearedAt && !!after.clearedAt;

  // Panels removed by the step, independent of any tombstone.
  const live = Array.isArray(panels) ? panels : [];
  let lostPanels: Array<{ id?: string; systemType?: string }> = [];
  if (panelsAfter) {
    const kept = new Set((panelsAfter ?? []).map(pp => pp?.id).filter(Boolean) as string[]);
    lostPanels = live.filter(pp => pp && pp.id && !kept.has(pp.id));
  }

  if (!faceIds.length && !sectionIds.length && !obstructionIds.length
      && !newlyCleared && !lostPanels.length) {
    return null;
  }

  // 🚨 THE PANELS THAT STOOD ON THOSE FACES GO WITH THEM. The save guard
  // checks `panelSystemTypes`, not face ids, so an authorization that named the
  // faces but not the panels would still read as an unexplained loss of every
  // module on them.
  const gone = new Set(faceIds);
  const byFace = newlyCleared
    ? live.filter(Boolean)
    : live.filter(pp => pp && pp.planeId && gone.has(pp.planeId));
  // Union: modules that went with a deleted face, plus modules the step removed
  // on their own. A panels-only clear reaches this through the second list.
  const seen = new Set<string>();
  const doomed = [...byFace, ...lostPanels].filter(pp => {
    const id = pp?.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const op: DeletionScope = newlyCleared
    ? 'design'
    : (faceIds.length || sectionIds.length ? 'face' : 'panels');
  return makeAuthorization(
    op,
    siteKey,
    {
      faceIds,
      sectionIds,
      obstructionIds,
      panelIds: doomed.map(pp => pp.id).filter(Boolean) as string[],
      panelSystemTypes: doomed.map(pp => pp.systemType ?? 'roof'),
    },
    at,
  );
}

/**
 * 🚨 AN UNDO MUST TAKE ITS PERMISSION BACK.
 *
 * An authorization is permission to lose something. After an undo the thing is
 * no longer lost, so the permission is a claim about a removal that did not
 * happen -- and it would let a genuine bug wipe exactly those ids without the
 * guard objecting. The owner's rule is that the guard must still distinguish
 * unexplained loss from explicit deletion; a stale authorization erodes exactly
 * that distinction.
 *
 * Only ids the ledger no longer tombstones are dropped. Panel-scope
 * authorizations carry no ledger representation and are left alone, and an
 * authorization emptied of every id is discarded.
 */
export function narrowAuthorizationToLedger(
  auth: DestructiveAuthorization | null | undefined,
  ledger: DeletionLedger | null | undefined,
  siteKey: string,
): DestructiveAuthorization | null {
  if (!auth) return null;
  if (auth.op === 'panels') return auth;

  const site = ledgerSite(ledger, siteKey);
  const stillFace = new Set(site.faceIds);
  const stillSection = new Set(site.sectionIds);
  const stillObstruction = new Set(site.obstructionIds);

  const faceIds = auth.faceIds.filter(id => stillFace.has(id));
  const sectionIds = auth.sectionIds.filter(id => stillSection.has(id));
  const obstructionIds = auth.obstructionIds.filter(id => stillObstruction.has(id));

  // A whole-design clear that is still recorded keeps its authorization intact:
  // it names no ids because it removed everything.
  if (site.clearedAt && auth.op === 'design') return auth;

  if (!faceIds.length && !sectionIds.length && !obstructionIds.length) return null;

  return {
    ...auth,
    faceIds,
    sectionIds,
    obstructionIds,
  };
}

export function parseAuthorization(raw: unknown): DestructiveAuthorization | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!isDeletionScope(o.op)) return null;
  if (typeof o.siteKey !== 'string') return null;
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isId) : []);
  return {
    op: o.op,
    siteKey: o.siteKey,
    faceIds: arr(o.faceIds),
    sectionIds: arr(o.sectionIds),
    obstructionIds: arr(o.obstructionIds),
    panelIds: arr(o.panelIds),
    panelSystemTypes: arr(o.panelSystemTypes),
    at: typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : 0,
  };
}

/**
 * MAY this save remove every panel of `systemType` at this property?
 *
 * The one question the server's wipe guard asks before it refuses. Everything
 * about it is deliberate:
 *
 *   • the authorization must exist — a payload of `panels: []` on its own is
 *     the signature of the bug, not of a decision;
 *   • it must name THIS property — `siteKey` binds it, so an authorization
 *     minted while clearing the garage at 3 Melvin does not license emptying
 *     the array at 5 Melvin two clicks later;
 *   • it must name THIS sub-system — clearing the roof array does not authorise
 *     losing the ground mount that was never mentioned.
 */
export function authorizesSubsystemRemoval(
  auth: DestructiveAuthorization | null | undefined,
  siteKey: string | null | undefined,
  systemType: string | null | undefined,
): boolean {
  if (!auth) return false;
  // An unresolved site key on either side cannot be matched; refusing is the
  // safe direction, and the studio always knows the key by the time a person
  // can click a delete control.
  if (!auth.siteKey || !siteKey) return false;
  if (auth.siteKey !== siteKey) return false;
  return auth.panelSystemTypes.includes(systemType || 'roof');
}

// ───────────────────────────────────────────────────────────────────────────
// PLANNING A DELETION — what will be removed, said before it happens
// ───────────────────────────────────────────────────────────────────────────

/** The face shape `planDeletion` needs. Structural, for the same reason as
 *  `AdmittableFace`. */
export interface PlannableFace {
  id: string;
  sectionId?: string;
  section?: { id?: string; kind?: string; label?: string };
  source?: string;
  siteKey?: string;
}

export interface PlannablePanel {
  id: string;
  planeId?: string;
  systemType?: string;
}

export interface PlannableObstruction {
  id: string;
  label?: string;
  type?: string;
}

export interface DeletionPlanInput {
  scope: DeletionScope;
  siteKey: string;
  /** For 'face' / 'section' / 'obstruction': what the user selected. */
  targetId: string;
  faces: PlannableFace[];
  panels: PlannablePanel[];
  obstructions: PlannableObstruction[];
  measurementCount: number;
  /** ms epoch, supplied by the caller so this module stays pure. */
  now: number;
}

/**
 * 🚨 UNIFORM SHAPE, EVERY FIELD ALWAYS PRESENT. `strictNullChecks` is off in
 * this repo, so a discriminated union on `ok` does not narrow at runtime and a
 * caller that reads `plan.faceIds` on a refusal would get `undefined.length`.
 * Refusals therefore carry empty arrays, not absent ones.
 */
export interface DeletionPlan {
  ok: boolean;
  /** Empty when ok. A sentence a person can act on, never a code. */
  refusal: string;
  /** What to offer instead when this deletion is refused. */
  refusalRemedy: string;
  scope: DeletionScope;
  ceremony: DeletionCeremony;
  /** 'Delete roof face' — the control's own words. */
  title: string;
  /** One line per class of thing removed: '1 roof face', '12 panels'. */
  lines: string[];
  faceIds: string[];
  sectionIds: string[];
  obstructionIds: string[];
  panelIds: string[];
  panelSystemTypes: string[];
  /** True when the whole property's geometry goes, which is what sets
   *  `clearedAt` and therefore what stops automatic re-acquisition. */
  clearsProperty: boolean;
  /** True when measurements go too. */
  clearsMeasurements: boolean;
}

function refuse(scope: DeletionScope, why: string, remedy: string): DeletionPlan {
  return {
    ok: false, refusal: why, refusalRemedy: remedy, scope,
    ceremony: ceremonyFor(scope), title: titleFor(scope), lines: [],
    faceIds: [], sectionIds: [], obstructionIds: [], panelIds: [],
    panelSystemTypes: [], clearsProperty: false, clearsMeasurements: false,
  };
}

export function titleFor(scope: DeletionScope): string {
  switch (scope) {
    case 'face':           return 'Delete roof face';
    case 'section':        return 'Delete building section';
    case 'obstruction':    return 'Delete obstruction';
    case 'obstructions':   return 'Clear all obstructions';
    case 'panels':         return 'Clear panels';
    case 'customBuilding': return 'Clear custom building';
    default:               return 'Start over';
  }
}

function plural(n: number, one: string, many?: string): string {
  return `${n} ${n === 1 ? one : (many ?? one + 's')}`;
}

/**
 * What would this deletion remove?
 *
 * 🚨 IT WALKS THE OWNERSHIP GRAPH, it does not splice an array. A section owns
 * its faces; a face carries the panels standing on it; both carry the walls the
 * renderer generates from them. Removing the face and leaving the panels is how
 * you get a panel floating where a roof used to be, and the layout engine has
 * no way to notice.
 */
export function planDeletion(i: DeletionPlanInput): DeletionPlan {
  const faces = Array.isArray(i.faces) ? i.faces : [];
  const panels = Array.isArray(i.panels) ? i.panels : [];
  const obstructions = Array.isArray(i.obstructions) ? i.obstructions : [];
  const sectionOf = (f: PlannableFace) => f?.sectionId || f?.section?.id || '';

  let faceIds: string[] = [];
  let sectionIds: string[] = [];
  let obstructionIds: string[] = [];
  let clearsProperty = false;
  let clearsMeasurements = false;
  let panelsOnly = false;

  if (i.scope === 'face') {
    const face = faces.find(f => f && f.id === i.targetId);
    if (!face) {
      return refuse('face', 'That roof face is no longer part of the design.',
        'Select a face on the model and try again.');
    }
    const sid = sectionOf(face);
    if (sid) {
      const siblings = faces.filter(f => sectionOf(f) === sid);
      if (siblings.length > 1) {
        // 🚨 REFUSE, AND SAY WHY — this is one of the four options the owner
        // named, and it is the honest one here. A gable's two slopes are
        // DERIVED from one footprint and one ridge; there is no such object as
        // half a gable, so "delete one face" cannot be expressed as a smaller
        // section. Rebuilding into a shed would silently change the house.
        return refuse('face',
          `This face is one of ${siblings.length} on a ${face.section?.kind || 'building'} section, `
          + `and the section's faces are built together from one footprint — `
          + `there is no shape left if one of them goes.`,
          'Delete the whole section instead, or change its type in the inspector.');
      }
      // A one-face section (flat pad, shed deck) IS its face. Removing the face
      // removes the section, and saying otherwise would leave an empty section
      // that still claims a footprint.
      sectionIds = [sid];
    }
    faceIds = [face.id];
  } else if (i.scope === 'section') {
    const owned = faces.filter(f => sectionOf(f) === i.targetId);
    if (!owned.length) {
      return refuse('section', 'That building section is no longer part of the design.',
        'Select a section on the model and try again.');
    }
    sectionIds = [i.targetId];
    faceIds = owned.map(f => f.id);
  } else if (i.scope === 'obstruction') {
    const o = obstructions.find(x => x && x.id === i.targetId);
    if (!o) {
      return refuse('obstruction', 'That obstruction is no longer part of the design.',
        'Select an obstruction on the model and try again.');
    }
    obstructionIds = [o.id];
  } else if (i.scope === 'obstructions') {
    // 🚨 "CLEAR" IN THE OBSTRUCTION PANEL USED TO BE A RAW SETTER. No plan, no
    // object list, no undo step, no tombstone, no save authorization, no toast —
    // and it sat next to "Reset to 0.6x0.6x1.0m", so a person who opened the
    // panel to fix ONE vent was a mis-click from wiping every vent, stack,
    // skylight and chimney on the roof, with the autosave persisting the loss.
    if (!obstructions.length) {
      return refuse('obstructions', 'There are no obstructions to clear.',
        'Mark one with the Obstruction tool first.');
    }
    obstructionIds = obstructions.map(o => o.id).filter(isId);
  } else if (i.scope === 'panels') {
    if (!panels.length) {
      return refuse('panels', 'There are no panels to clear.',
        'Place panels with Auto Layout or Fill Roof first.');
    }
    panelsOnly = true;
  } else if (i.scope === 'customBuilding') {
    // Hand-built geometry only. A Google-derived face is not "the custom
    // building", and clearing it here would silently do what "Return to Google
    // 3D" and "reject Google 3D" exist to do explicitly.
    const custom = faces.filter(f => f && f.source !== 'solar_api');
    if (!custom.length) {
      return refuse('customBuilding', 'There is no hand-built geometry at this property.',
        'Use Start Over to clear everything, including geometry from Google 3D.');
    }
    faceIds = custom.map(f => f.id);
    sectionIds = uniq(custom.map(sectionOf).filter(isId));
    // Obstructions belong to the roof they were marked on. If every face goes,
    // so do they; otherwise they are left alone rather than guessed at.
    if (custom.length === faces.length) {
      obstructionIds = obstructions.map(o => o.id).filter(isId);
      clearsProperty = true;
    }
  } else {
    // 'design' — start over.
    if (!faces.length && !panels.length && !obstructions.length && !i.measurementCount) {
      return refuse('design', 'This property is already empty.',
        'Trace a roof with the 🏚 Building tools to begin.');
    }
    faceIds = faces.map(f => f.id).filter(isId);
    sectionIds = uniq(faces.map(sectionOf).filter(isId));
    obstructionIds = obstructions.map(o => o.id).filter(isId);
    clearsProperty = true;
    clearsMeasurements = i.measurementCount > 0;
  }

  const goneFace: Record<string, boolean> = {};
  for (const id of faceIds) goneFace[id] = true;
  const goneObstruction: Record<string, boolean> = {};
  for (const id of obstructionIds) goneObstruction[id] = true;

  // Panels: everything standing on a removed face, or everything when the scope
  // is the whole layout or the whole property.
  //
  // 🚨 A FENCE OR GROUND PANEL HAS NO `planeId` AT ALL. It stands on a fence
  // line or a rack in the yard, not on a roof face, so "panels whose face was
  // removed" reaches none of them — and Start Over, which means every last
  // thing at this property, would have left the SolFence standing over an empty
  // lot and then been refused by the save guard for a sub-system it had not
  // authorised. Scope decides; `planeId` only narrows the partial scopes.
  const takesEveryPanel = panelsOnly || i.scope === 'design';
  const doomedPanels = takesEveryPanel
    ? panels
    : panels.filter(p => p && isId(p.planeId) && goneFace[p.planeId]);
  const panelIds = doomedPanels.map(p => p.id).filter(isId);
  const panelSystemTypes = uniq(doomedPanels.map(p => p?.systemType || 'roof'));

  const lines: string[] = [];
  if (faceIds.length) lines.push(plural(faceIds.length, 'roof face'));
  if (sectionIds.length) {
    lines.push(plural(sectionIds.length, 'building section')
      + ' — including its walls');
  }
  if (obstructionIds.length) lines.push(plural(obstructionIds.length, 'obstruction'));
  if (panelIds.length) {
    lines.push(plural(panelIds.length, 'panel')
      + (takesEveryPanel ? '' : ' standing on it'));
  }
  if (clearsMeasurements && i.measurementCount) {
    lines.push(plural(i.measurementCount, 'measurement'));
  }
  if (!lines.length) lines.push('nothing — this selection owns no geometry');

  return {
    ok: true, refusal: '', refusalRemedy: '',
    scope: i.scope,
    ceremony: ceremonyFor(i.scope),
    title: titleFor(i.scope),
    lines,
    faceIds, sectionIds, obstructionIds, panelIds, panelSystemTypes,
    clearsProperty, clearsMeasurements,
  };
}

/** The tombstones a plan produces. Split out so the caller can apply the same
 *  facts to state and to the ledger without re-deriving either. */
export function tombstonesFor(plan: DeletionPlan, now: number): Partial<DeletionLedgerSite> {
  return {
    faceIds: plan.faceIds,
    sectionIds: plan.sectionIds,
    obstructionIds: plan.obstructionIds,
    clearedAt: plan.clearsProperty ? (Number.isFinite(now) ? now : 0) : 0,
  };
}

/** The authorization a plan produces. */
export function authorizationFor(plan: DeletionPlan, siteKey: string, now: number): DestructiveAuthorization {
  return makeAuthorization(plan.scope, siteKey, {
    faceIds: plan.faceIds,
    sectionIds: plan.sectionIds,
    obstructionIds: plan.obstructionIds,
    panelIds: plan.panelIds,
    panelSystemTypes: plan.panelSystemTypes,
  }, now);
}
