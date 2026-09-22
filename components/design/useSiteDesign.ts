/**
 * components/design/useSiteDesign.ts
 *
 * THE OWNER OF EVERY SITE-BOUND DESIGN ENTITY.
 *
 * Design Studio used to declare `panels`, `roofPlanes`, `placedObstructions`
 * and `measurements` as four independent `useState`s with four independent
 * mirror refs, and then hand-cleared some of them (`setPanels([])`) whenever the
 * address changed. Nothing tied them together, so "change property" meant
 * "archive the roof, delete everything else" — the Melvin defect.
 *
 * This hook owns all four. The setters keep their exact names and signatures,
 * so every existing call site in DesignStudio is unchanged; what changes is
 * that a write can now only ever reach the ACTIVE site's bundle, and switching
 * property is a single operation that moves whole bundles
 * (lib/design/siteDesignModel.ts).
 *
 * 🚨 THE MIRROR REFS ARE WRITTEN SYNCHRONOUSLY, inside the setter.
 * They used to be maintained by `useEffect(() => { ref.current = state }, [state])`,
 * which means the ref lags the state until React flushes effects. The autosave,
 * the beforeunload beacon and the save-button path all read those refs. A save
 * firing in that window persists the PREVIOUS value — and during a site switch
 * the previous value belongs to the previous property. A ref that exists to be
 * read by a save path must never lag the state it mirrors.
 *
 * 🚨 STALE ASYNC RESPONSES. Roof detection, Lane A and the Solar API all resolve
 * long after they were asked. `scope()` hands out a token naming the site and
 * the switch epoch at request time; `isCurrent(token)` tells the caller whether
 * the answer still belongs to the site on screen. A late answer for the
 * previous property must be dropped, never applied — applying it is how one
 * house's roof ends up drawn on another's.
 */

'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  isNativeGeometryDisposition,
  type NativeGeometryDisposition,
} from '@/lib/design/nativeGeometryDisposition';
import {
  emptyHistory, pushSnapshot, undo, redo, canUndo, canRedo, undoLabel, redoLabel,
  type GeometryHistory,
} from '@/lib/3d/geometryHistory';
import { repositionPanelsForPlanes } from '@/lib/3d/sectionEditing';
import {
  type DeletionLedger,
  type DeletionPlan,
  type DeletionScope,
  type DestructiveAuthorization,
  type DesignGeometryLifecycle,
  emptyLedger,
  planDeletion,
  tombstonesFor,
  authorizationFor,
  makeAuthorization,
  withTombstones,
  withoutTombstones,
  lifecycleFor,
  admitFaces,
  admitObstructions,
  resolveLedgerKey,
} from '@/lib/design/deletionAuthority';
import type { PlacedPanel, RoofPlane, PlacedObstruction, LayoutMeasurement, DesignElectrical } from '@/types';
import {
  type SiteDesignBundle,
  type SiteDesignState,
  type StoredLayoutForHydration,
  type StoredSiteArchives,
  type SiteDesignScalars,
  emptyBundle,
  emptyState,
  hydrate,
  switchSite,
  bundleEntityCount,
  toPersistencePayload,
  resolveSiteKey,
  dispositionForProperty,
  withDispositionForProperty,
  sitesAreSameProperty,
  UNRESOLVED_SITE_KEY,
} from '@/lib/design/siteDesignModel';

type Updater<T> = T | ((prev: T) => T);

/** A token naming the site that was active when an async request was issued. */
export interface SiteScope {
  siteKey: string;
  epoch: number;
}

export interface UseSiteDesign {
  // ── The four site-bound entity arrays, with their original names ──────────
  panels: PlacedPanel[];
  setPanels: (u: Updater<PlacedPanel[]>) => void;
  roofPlanes: RoofPlane[];
  setRoofPlanes: (u: Updater<RoofPlane[]>) => void;
  placedObstructions: PlacedObstruction[];
  setPlacedObstructions: (u: Updater<PlacedObstruction[]>) => void;
  measurements: LayoutMeasurement[];
  setMeasurements: (u: Updater<LayoutMeasurement[]>) => void;

  // ── Mirror refs, synchronous with the state above ─────────────────────────
  panelsRef: React.MutableRefObject<PlacedPanel[]>;
  roofPlanesRef: React.MutableRefObject<RoofPlane[]>;
  placedObstructionsRef: React.MutableRefObject<PlacedObstruction[]>;
  measurementsRef: React.MutableRefObject<LayoutMeasurement[]>;

  // ── Ownership ─────────────────────────────────────────────────────────────
  /** The site the visible design belongs to. '' until hydration decides. */
  activeSiteKey: string;
  activeSiteKeyRef: React.MutableRefObject<string>;
  /** How many OTHER properties this project is holding a design for, and how
   *  many entities in total — what the UI tells the user is kept, not lost. */
  archivedSiteCount: number;
  archivedEntityCount: number;

  /** Move to another property. Returns whether anything changed. */
  switchToSite: (
    toKey: string,
    opts?: {
      address?: string | null;
      mapCenter?: { lat: number; lng: number } | null;
      /** The site-bound scalars as they stand RIGHT NOW. Passed in rather than
       *  owned here because they live in DesignStudio's own state; the hook
       *  archives and returns them so the caller can apply the arriving set. */
      scalars?: SiteDesignScalars;
    },
  ) => {
    changed: boolean;
    arriving: SiteDesignBundle;
    archivedCount: number;
    reason: string;
  };

  /** Rebuild from a stored layout row. Returns the disposition so the caller
   *  can log it and know whether one adoption save is expected. */
  hydrateFromStored: (stored: StoredLayoutForHydration | null, siteKeyNow: string) => ReturnType<typeof hydrate>;

  /** Name the property at these coordinates, reusing a property this project
   *  already knows about when the point is within SITE_MATCH_RADIUS_M of it.
   *  This is what makes "pick my house again" return the design left there
   *  rather than an empty roof beside it. */
  resolveKeyFor: (lat: number, lng: number, projectId?: string | null) => ReturnType<typeof resolveSiteKey>;

  /** Everything the save paths need: the ACTIVE entities for their own columns
   *  plus the archives for `layouts.site_archives`. */
  persistencePayload: (extras?: { designElectrical?: DesignElectrical | null; scalars?: SiteDesignScalars }) => ReturnType<typeof toPersistencePayload>;
  /** The archives exactly as they will be stored — for the dedup signature. */
  storedArchives: (extras?: { designElectrical?: DesignElectrical | null; scalars?: SiteDesignScalars }) => StoredSiteArchives;

  // ── Stale-response protection ─────────────────────────────────────────────
  scope: () => SiteScope;
  isCurrent: (s: SiteScope | null | undefined) => boolean;

  /** What the installer has decided about THIS property's native (Google)
   *  geometry. See lib/design/nativeGeometryDisposition.ts. Read as a ref so
   *  the Lane A gate, which fires from inside a resolved promise, sees the
   *  decision that exists NOW rather than the one captured when it was
   *  scheduled. */
  nativeDisposition: NativeGeometryDisposition;
  nativeDispositionRef: React.MutableRefObject<NativeGeometryDisposition>;
  /** Record a decision about a property.
   *
   *  🚨 PASS THE SITE KEY. `activeSiteKey` is the empty string until hydration
   *  resolves ownership, and a decision filed against an empty key is dropped
   *  by `withDisposition`. The caller knows which house is on screen —
   *  DesignStudio computes `siteKeyFromCoords(mapCenter)` to stamp the plane
   *  and passes the same key here. Omitting it falls back to the active site
   *  and REFUSES OUT LOUD when there is none. */
  setNativeDisposition: (d: NativeGeometryDisposition, siteKey?: string) => void;

  // ── Canonical geometry undo ───────────────────────────────────────────────
  /** Record the roof as it stands BEFORE a mutation. Call, then mutate.
   *  Consecutive calls sharing a `coalesceKey` collapse to one undo step, so a
   *  run of stepper presses returns the user to where the run began. */
  recordGeometry: (label: string, coalesceKey?: string) => void;
  /** Step back / forward one geometry edit. Returns the edit's label, or null
   *  when there was nothing to do. Restores CANONICAL planes; the renderer
   *  rebuilds from them. */
  undoGeometry: () => string | null;
  redoGeometry: () => string | null;
  canUndoGeometry: boolean;
  canRedoGeometry: boolean;
  undoGeometryLabel: string | null;
  redoGeometryLabel: string | null;

  // ── Deletion ──────────────────────────────────────────────────────────────
  /**
   * WHAT A PERSON DELIBERATELY REMOVED AT EACH PROPERTY, and the one canonical
   * answer to "does this object still belong to the active design?".
   * See lib/design/deletionAuthority.ts.
   */
  deletionLedger: DeletionLedger;
  deletionLedgerRef: React.MutableRefObject<DeletionLedger>;

  /** What would this deletion remove? Pure — shows the user before it happens,
   *  and refuses with a sentence when the deletion is not expressible. */
  planDelete: (scope: DeletionScope, targetId?: string) => DeletionPlan;

  /**
   * Perform a planned deletion.
   *
   * 🚨 THIS IS THE ONLY WAY GEOMETRY LEAVES THE ACTIVE DESIGN. It is what
   * writes the tombstones, what mints the save authorization, and what records
   * the undo step — so a caller that splices `roofPlanes` itself gets none of
   * the three, and the object comes back on the next reload.
   */
  applyDelete: (plan: DeletionPlan) => { ok: boolean; removed: number; message: string };

  /**
   * A DELIBERATE PANEL REMOVAL THAT DID NOT COME THROUGH `planDelete`.
   *
   * 🚨 "DELETE SELECTED" IS A DELETION TOO. Box-selecting forty modules and
   * pressing Delete is as deliberate as any control in the studio, and it
   * minted no authorization — so the save that followed was met with
   * LAYOUT_SUBSYSTEM_WIPE and a permanent "Save refused" badge telling the user
   * to use a delete control they had just used. The removal never persisted.
   *
   * MERGED, NEVER OVERWRITTEN. Two deletions inside one three-second autosave
   * window used to leave only the second authorization on the payload, and the
   * server refuses when ANY wiped sub-system is unauthorised — so the save
   * deadlocked and BOTH deletions were lost on reload.
   */
  notePanelRemoval: (removed: Array<{ id?: string; systemType?: string }>) => void;
  /** The authorization for the NEXT save, or null. Read by the save paths. */
  pendingDestructive: () => DestructiveAuthorization | null;
  /** Consume it — called once the save that carried it has SUCCEEDED. A failed
   *  save must keep it, or the retry is refused for the deletion the user
   *  already confirmed. */
  clearPendingDestructive: () => void;

  /**
   * Forget every deletion at a property. The explicit "use Google 3D geometry
   * here after all" command, and nothing else — a ledger that quietly forgets
   * is the resurrection bug wearing a different hat.
   */
  forgetDeletions: (siteKey?: string) => void;

  /** `untouched` | `populated` | `cleared` — what `existingPlaneCount` was
   *  being asked and could not answer. Read by the acquisition gate. */
  geometryLifecycle: DesignGeometryLifecycle;
  geometryLifecycleRef: React.MutableRefObject<DesignGeometryLifecycle>;

  /**
   * Filter anything a reconstruction path is about to admit.
   *
   * Stored row, archived bundle, provider acquisition, aerial adoption, legacy
   * migration — every one of them can hand the studio a face a person already
   * removed. They all run through this.
   */
  admitGeometry: <T extends { id?: string; sectionId?: string }>(faces: T[]) => T[];
  admitPlacedObstructions: <T extends { id?: string }>(obstructions: T[]) => T[];

  /** Test/diagnostic view of the whole state. Not for production branching. */
  stateRef: React.MutableRefObject<SiteDesignState>;
}

export function useSiteDesign(): UseSiteDesign {
  const [panels, rawSetPanels] = useState<PlacedPanel[]>([]);
  const [roofPlanes, rawSetRoofPlanes] = useState<RoofPlane[]>([]);
  const [placedObstructions, rawSetObstructions] = useState<PlacedObstruction[]>([]);
  const [measurements, rawSetMeasurements] = useState<LayoutMeasurement[]>([]);
  const [activeSiteKey, setActiveSiteKeyState] = useState<string>(UNRESOLVED_SITE_KEY);
  const [archiveTick, setArchiveTick] = useState(0);

  const panelsRef = useRef<PlacedPanel[]>([]);
  const roofPlanesRef = useRef<RoofPlane[]>([]);
  const placedObstructionsRef = useRef<PlacedObstruction[]>([]);
  const measurementsRef = useRef<LayoutMeasurement[]>([]);
  const activeSiteKeyRef = useRef<string>(UNRESOLVED_SITE_KEY);
  const stateRef = useRef<SiteDesignState>(emptyState());
  const nativeDispositionRef = useRef<NativeGeometryDisposition>('undecided');
  // 🚨 DECLARED HERE, WITH THE OTHER OWNERSHIP REFS, because `undoGeometry`
  // below has to restore the ledger and is written before the deletion block.
  // A `const` referenced from a callback body is fine at call time; one
  // referenced from a `useCallback` DEPENDENCY ARRAY is evaluated during this
  // render and would hit the temporal dead zone.
  const deletionLedgerRef = useRef<DeletionLedger>(emptyLedger());
  const pendingDestructiveRef = useRef<DestructiveAuthorization | null>(null);
  const epochRef = useRef(0);

  /** One setter factory. The ref is written first and synchronously, so any
   *  save path that fires before React re-renders still reads the new value. */
  function makeSetter<T>(
    ref: React.MutableRefObject<T[]>,
    raw: React.Dispatch<React.SetStateAction<T[]>>,
    key: 'panels' | 'roofPlanes' | 'obstructions' | 'measurements',
  ) {
    return (u: Updater<T[]>) => {
      const next = typeof u === 'function' ? (u as (p: T[]) => T[])(ref.current) : u;
      ref.current = next;
      // The active bundle is the single source of truth for what is persisted.
      (stateRef.current.active[key] as unknown as T[]) = next;
      raw(next);
    };
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const setPanels = useCallback(makeSetter(panelsRef, rawSetPanels, 'panels'), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const setRoofPlanes = useCallback(makeSetter(roofPlanesRef, rawSetRoofPlanes, 'roofPlanes'), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const setPlacedObstructions = useCallback(makeSetter(placedObstructionsRef, rawSetObstructions, 'obstructions'), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const setMeasurements = useCallback(makeSetter(measurementsRef, rawSetMeasurements, 'measurements'), []);

  // ── CANONICAL GEOMETRY UNDO ────────────────────────────────────────────────
  //
  // 🚨 IT LIVES HERE BECAUSE THIS HOOK OWNS `roofPlanes`.
  //
  // There was already an undo in the app: `createHistoryStore` in
  // components/3d/SolarEngine3D.tsx, over a `SceneState` of primitives and
  // slider positions, wired to a Save/Undo/Redo chip. Nothing ever dispatched
  // to it — zero call sites — so the buttons were inert, and what it modelled
  // was render state, which is the one thing a geometry history must not
  // restore: putting the picture back while the canonical array keeps the
  // undone edit means the next autosave persists the design the user rejected.
  //
  // So the unit of history is the `RoofPlane[]` this hook holds, the same array
  // the autosave signs and the planset reads. `lib/3d/geometryHistory` keeps
  // the stack; this is only the binding.
  const [geometryHistory, setGeometryHistory] = useState<GeometryHistory>(() => emptyHistory());
  const geometryHistoryRef = useRef<GeometryHistory>(emptyHistory());
  const writeHistory = (h: GeometryHistory) => { geometryHistoryRef.current = h; setGeometryHistory(h); };

  /** Record the state BEFORE a mutation. Call, then mutate. */
  const recordGeometry = useCallback((label: string, coalesceKey?: string) => {
    // 🚨 THE PROVIDER DECISION IS PART OF THE SNAPSHOT.
    //
    // Every face the section tools emit carries `.section`, and DesignStudio
    // files `custom` for the property the instant one arrives. So drawing one
    // gable by mistake on an otherwise-Google property made it 'custom', and
    // Undo — which restored only `RoofPlane[]` — left it that way: the roof came
    // back empty and native acquisition stayed refused forever, through a door
    // nothing in the app could reopen. An undo that restores half the change is
    // the class of defect this history was written to remove, not an instance
    // of it.
    writeHistory(pushSnapshot(
      geometryHistoryRef.current, label, roofPlanesRef.current, coalesceKey,
      nativeDispositionRef.current,
      // 🚨 AND THE DELETION LEDGER, on EVERY step, not just on a delete.
      // Carrying it costs nothing when nothing was deleted, and it is the only
      // thing that makes "delete a face, make two more edits, undo three times"
      // end with the face actually back rather than back-until-reload.
      deletionLedgerRef.current,
      // Panels, obstructions and measurements are NOT carried here. Every edit
      // this function records MOVES a face: its panels are recomputed from
      // where the face went, and nothing else is touched. Only `applyDelete`
      // snapshots them, because only a delete destroys them.
      null, null, null,
    ));
  }, []);

  /**
   * Adopt a restored roof AND bring its panels back with it.
   *
   * 🚨 UNDO HAS THE SAME OBLIGATION AS THE EDIT. `editSection` repositions the
   * array when the roof moves, because `PlacedPanel.lat/lng/height` is absolute
   * while `planeId` says which face it belongs to. An undo that restored only
   * the roof would be that defect exactly, in reverse: the geometry returns to
   * where it was and the modules stay where the edit had put them — a foot
   * above the roof instead of a foot below it.
   *
   * The history unit stays `RoofPlane[]`. Panels are DERIVED from the roof they
   * stand on, so they are recomputed from it rather than snapshotted beside it;
   * storing both would create two records of one fact and a way for them to
   * disagree.
   */
  const applyRestoredGeometry = useCallback((restored: RoofPlane[], panelsAlreadyExact = false) => {
    const held = panelsRef.current ?? [];
    const from = roofPlanesRef.current ?? [];
    setRoofPlanes(restored);
    // 🚨 A DELETE STEP HAS ALREADY PUT THE EXACT PANELS BACK. Repositioning
    // them would move modules that were never moved: the face they stand on
    // did not change shape, it came back. There is nothing to compensate for,
    // and `repositionPanelsForPlanes` matching a restored face against a live
    // roof that no longer contains it would orphan the array.
    if (panelsAlreadyExact) return;
    if (held.length === 0) return;
    const moved = repositionPanelsForPlanes(held, from, restored);
    if (moved.moved > 0) setPanels(moved.panels);
    // An orphan here means the undone edit had changed the roof KIND. The
    // panels are left exactly as they are rather than guessed onto a
    // neighbouring face; the caller surfaces it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Put the provider decision back to what it was before the undone edit.
   *
   * 🚨 ONLY WHEN THE STEP CARRIED ONE, AND ONLY WHEN IT DIFFERS. A step
   * recorded before this field existed (or by a caller that passed none) has
   * `null`, and null is not a decision: coercing it to 'undecided' would let an
   * undo silently license re-acquisition over hand-built work, which is the
   * same shape as the `?? 0` that turns an unknown current into zero amps.
   */
  const restoreDisposition = useCallback((d: string | null) => {
    if (!d || d === nativeDispositionRef.current) return;
    if (!isNativeGeometryDisposition(d)) return;
    // Through the real setter, so the restored decision is filed against the
    // property and reaches the autosave — not left in a ref that the next
    // render recomputes away.
    setNativeDisposition(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Put the deletion ledger back to what it was before the undone step.
   *
   * 🚨 A TOMBSTONE MUST NOT OUTLIVE ITS UNDO. Without this, undoing a deletion
   * puts the face back on screen and in `roofPlanes` — and the tombstone is
   * still filed, so the very next hydration refuses it again. The face would
   * disappear on reload with nothing to explain it, which is strictly worse
   * than the delete not working at all, because it looks like it worked.
   *
   * `null` means the step carried none (recorded before this existed), and then
   * whatever is current is left alone — the same rule as the disposition.
   */
  const restoreLedger = useCallback((led: unknown) => {
    if (!led || typeof led !== 'object') return;
    stateRef.current = { ...stateRef.current, deletions: led as DeletionLedger };
    deletionLedgerRef.current = led as DeletionLedger;
    setArchiveTick(t => t + 1);
  }, []);

  /**
   * Put the panels back exactly, when the step carried them.
   *
   * Only a deletion does. Everything else keeps the existing rule — panels are
   * derived from the roof they stand on and are repositioned, never restored —
   * because two records of one fact is a way for them to disagree.
   */
  const restorePanelsVerbatim = useCallback((panelsBefore: unknown[] | null): boolean => {
    if (!panelsBefore || !Array.isArray(panelsBefore)) return false;
    setPanels(panelsBefore as PlacedPanel[]);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Put the site entities back exactly, when the step carried them. Only a
   *  deletion does; every other edit leaves them alone entirely. */
  const restoreSiteEntities = useCallback((obs: unknown[] | null, meas: unknown[] | null) => {
    if (Array.isArray(obs)) setPlacedObstructions(obs as PlacedObstruction[]);
    if (Array.isArray(meas)) setMeasurements(meas as LayoutMeasurement[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const undoGeometry = useCallback((): string | null => {
    const step = undo(
      geometryHistoryRef.current, roofPlanesRef.current, nativeDispositionRef.current,
      deletionLedgerRef.current, panelsRef.current,
      placedObstructionsRef.current, measurementsRef.current,
    );
    if (!step.ok) return null;
    writeHistory(step.history);
    // 🚨 PANELS FIRST WHEN THE STEP CARRIES THEM. `applyRestoredGeometry`
    // repositions whatever panels are live onto the restored roof; if the
    // deleted ones are not back yet it repositions the survivors and the
    // deleted array never returns.
    const verbatim = restorePanelsVerbatim(step.panels);
    // Adopt the canonical array; every derived thing rebuilds from it.
    applyRestoredGeometry(step.planes, verbatim);
    restoreSiteEntities(step.obstructions, step.measurements);
    restoreDisposition(step.disposition);
    restoreLedger(step.deletions);
    return step.label;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const redoGeometry = useCallback((): string | null => {
    const step = redo(
      geometryHistoryRef.current, roofPlanesRef.current, nativeDispositionRef.current,
      deletionLedgerRef.current, panelsRef.current,
      placedObstructionsRef.current, measurementsRef.current,
    );
    if (!step.ok) return null;
    writeHistory(step.history);
    const verbatim = restorePanelsVerbatim(step.panels);
    applyRestoredGeometry(step.planes, verbatim);
    restoreSiteEntities(step.obstructions, step.measurements);
    restoreDisposition(step.disposition);
    restoreLedger(step.deletions);
    return step.label;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Push a bundle into component state and the mirror refs, in one step. */
  const applyBundle = useCallback((b: SiteDesignBundle) => {
    // 🚨 HISTORY DOES NOT CROSS A SITE BOUNDARY. A bundle swap is a different
    // property (or a reload of this one); an undo entry from the previous
    // building would apply a roof from another address to this one.
    geometryHistoryRef.current = emptyHistory();
    setGeometryHistory(geometryHistoryRef.current);
    panelsRef.current = b.panels ?? [];
    roofPlanesRef.current = b.roofPlanes ?? [];
    placedObstructionsRef.current = b.obstructions ?? [];
    measurementsRef.current = b.measurements ?? [];
    rawSetPanels(panelsRef.current);
    rawSetRoofPlanes(roofPlanesRef.current);
    rawSetObstructions(placedObstructionsRef.current);
    rawSetMeasurements(measurementsRef.current);
  }, []);

  const setActiveKey = useCallback((k: string) => {
    activeSiteKeyRef.current = k;
    setActiveSiteKeyState(k);
    // 🚨 NO DECISION IS FLUSHED HERE, AND THAT IS DELIBERATE.
    //
    // A first version parked a disposition recorded before the property had a
    // name and filed it the moment `setActiveKey` ran. Two independent audits
    // measured it doing the wrong thing twice over: the parked value was
    // overwritten by the memo below on the very next tick (so it was inert),
    // and when it did flush it carried NO SITE IDENTITY — pressing "Draw
    // Manually Instead" at an unnamed property and then changing the address
    // filed 'rejected' against the NEIGHBOUR, permanently marking a house the
    // installer had never looked at.
    //
    // `switchToSite` and `hydrateFromStored` both bump the epoch and both call
    // this, so nothing here can tell "the site on screen finally resolved" from
    // "we moved to a different house". The caller can: it knows the
    // coordinates. `setNativeDisposition` now takes the site key the decision
    // is ABOUT, and DesignStudio passes the same key it stamps on the plane.
  }, []);

  const switchToSite = useCallback<UseSiteDesign['switchToSite']>((toKey, opts) => {
    // The active bundle is kept live by the setters, but re-seat it from the
    // refs before switching so a bundle can never be archived one render stale.
    stateRef.current = {
      ...stateRef.current,
      active: {
        ...stateRef.current.active,
        panels: panelsRef.current,
        roofPlanes: roofPlanesRef.current,
        obstructions: placedObstructionsRef.current,
        measurements: measurementsRef.current,
        // The fence line is lat/lng geometry, so it belongs to the property it
        // was drawn at. Re-seated here, from the caller, for the same reason
        // the entity arrays are: a bundle must never be archived one render
        // stale.
        scalars: opts?.scalars ?? stateRef.current.active.scalars,
      },
    };
    const res = switchSite(stateRef.current, toKey, opts);
    stateRef.current = res.state;
    // The ledger travels with the state. Re-seat the synchronous mirror here,
    // because the acquisition gate and the restore filters read the REF, and a
    // property change is exactly when they fire.
    deletionLedgerRef.current = res.state.deletions ?? emptyLedger();
    // 🚨 AND THE AUTHORIZATION DOES NOT TRAVEL. It names the property it was
    // minted at, so carrying it to the next house guarantees a refusal there —
    // the save 409s until the user happens to place a panel of the wiped
    // sub-system at a property they never deleted anything from.
    if (res.changed) pendingDestructiveRef.current = null;
    if (res.changed || res.reason === 'unresolved-source') {
      setActiveKey(res.state.activeSiteKey);
      epochRef.current += 1;
    }
    if (res.changed) {
      applyBundle(res.arriving);
      setArchiveTick(t => t + 1);
    }
    return {
      changed: res.changed,
      arriving: res.arriving,
      archivedCount: bundleEntityCount(res.archived),
      reason: res.reason,
    };
  }, [applyBundle, setActiveKey]);

  const hydrateFromStored = useCallback<UseSiteDesign['hydrateFromStored']>((stored, siteKeyNow) => {
    const res = hydrate(stored, siteKeyNow);
    stateRef.current = res.state;
    deletionLedgerRef.current = res.state.deletions ?? emptyLedger();
    pendingDestructiveRef.current = null;
    // 🚨 A RELOAD IS NOT A SAVE. Anything the previous session had authorised
    // was either persisted or refused; carrying it across a hydration would let
    // a stale authorization license a wipe nobody asked for in this one.
    pendingDestructiveRef.current = null;
    setActiveKey(res.state.activeSiteKey);
    epochRef.current += 1;
    applyBundle(res.state.active);
    setArchiveTick(t => t + 1);
    return res;
  }, [applyBundle, setActiveKey]);

  const storedArchives = useCallback<UseSiteDesign['storedArchives']>((extras) => {
    stateRef.current = {
      ...stateRef.current,
      active: {
        ...stateRef.current.active,
        panels: panelsRef.current,
        roofPlanes: roofPlanesRef.current,
        obstructions: placedObstructionsRef.current,
        measurements: measurementsRef.current,
        designElectrical: extras?.designElectrical ?? stateRef.current.active.designElectrical ?? null,
        scalars: extras?.scalars ?? stateRef.current.active.scalars,
      },
    };
    return toPersistencePayload(stateRef.current).siteArchives;
  }, []);

  const persistencePayload = useCallback<UseSiteDesign['persistencePayload']>((extras) => {
    storedArchives(extras);
    return toPersistencePayload(stateRef.current);
  }, [storedArchives]);

  const resolveKeyFor = useCallback<UseSiteDesign['resolveKeyFor']>(
    (lat, lng, projectId) => resolveSiteKey(stateRef.current, lat, lng, projectId),
    [],
  );

  const scope = useCallback<UseSiteDesign['scope']>(
    () => ({ siteKey: activeSiteKeyRef.current, epoch: epochRef.current }),
    [],
  );

  /** A response is current when neither the site NOR the switch epoch moved.
   *  The epoch matters on its own: A → B → A within one request's lifetime
   *  returns to the same key, but the design in between was replaced, so an
   *  answer computed against the first visit is no longer about what is on
   *  screen. Refusing it is the safe answer; the caller can re-ask. */
  const isCurrent = useCallback<UseSiteDesign['isCurrent']>(
    s => !!s && s.siteKey === activeSiteKeyRef.current && s.epoch === epochRef.current,
    [],
  );

  const { archivedSiteCount, archivedEntityCount } = useMemo(() => {
    void archiveTick; // recompute whenever the archive moves
    const sites = Object.values(stateRef.current.archives ?? {});
    return {
      archivedSiteCount: sites.length,
      archivedEntityCount: sites.reduce((n, b) => n + bundleEntityCount(b), 0),
    };
  }, [archiveTick]);

  // Derived from the state, per ACTIVE property. Recomputed when the archive
  // moves (which is when the active property changes) so switching house and
  // back shows that property's decision, not the other one's.
  /**
   * THE KEY THE DECISION IS FILED UNDER — one expression, used by the read and
   * by the write.
   *
   * 🚨 THEY USED DIFFERENT KEYS, AND THE READ WON.
   *
   * The write took `siteKey || activeSiteKeyRef.current || state.activeSiteKey`,
   * because the caller is the one that knows the property before hydration
   * resolves it. The memo below read `dispositionFor(map, activeSiteKey)` — the
   * React value alone — and then assigned the result to
   * `nativeDispositionRef.current`. So on a project whose stored coordinates are
   * absent or the placeholder pair, `activeSiteKey` is the EMPTY STRING and
   * nothing later resolves it: the installer pressed "Draw Manually Instead",
   * the write filed `rejected` under the camera's key and bumped `archiveTick`,
   * and the very next render recomputed `dispositionFor(map, '')` — which is
   * `undecided` by the module's first line — and overwrote the ref with it.
   *
   * The judgement was in the map, and the gate could not see it. Lane A then
   * re-injected the Google roof the installer had just rejected, which is the
   * exact defect the whole disposition module was written to close.
   */
  const dispositionKeyOf = useCallback((explicit?: string) =>
    explicit || activeSiteKeyRef.current || stateRef.current.activeSiteKey || '', []);

  const nativeDisposition = useMemo(() => {
    void archiveTick;
    void activeSiteKey;   // recompute on a property change, not just an archive move
    const key = dispositionKeyOf();
    // 🚨 AND IT MATCHES BY PROPERTY, NOT BY STRING. See
    // `dispositionForProperty`: a key that drifted a few metres must still find
    // the judgement, or an unreadable decision reads `undecided` — the state
    // that PERMITS re-acquisition.
    const d = dispositionForProperty(
      stateRef.current.nativeGeometry, key,
      [stateRef.current.activeSiteKey, ...Object.keys(stateRef.current.archives ?? {})],
    );
    // 🚨 AND IT NEVER CLOBBERS A KNOWN DECISION WITH "NOBODY LOOKED". While no
    // property is named there is nothing to read, and the ref holds whatever the
    // last explicit write put there — which is a real judgement about the house
    // on screen. Overwriting it with the default is how the rejection above was
    // lost between one render and the next.
    if (key || d !== 'undecided') nativeDispositionRef.current = d;
    return key ? d : nativeDispositionRef.current;
  }, [archiveTick, activeSiteKey, dispositionKeyOf]);

  const setNativeDisposition = useCallback((d: NativeGeometryDisposition, siteKey?: string) => {
    // 🚨 KEYED BY SITE, like ownership. A judgement is about a PROPERTY, so
    // going to the neighbour's house and back must not lose it — and must not
    // land on the neighbour.
    //
    // The caller may name the property explicitly. It is the one that knows:
    // DesignStudio computes `siteKeyFromCoords(mapCenter)` to stamp the plane
    // and passes the same key here, so the decision and the geometry it is
    // about are filed against one property even before `activeSiteKey` has
    // resolved.
    const key = dispositionKeyOf(siteKey);
    if (!key) {
      // 🚨 REFUSED OUT LOUD, NOT DROPPED IN SILENCE. `withDisposition` returns
      // the map unchanged for an empty key, so this used to vanish and the app
      // went on believing native acquisition was permitted for a house somebody
      // had just modelled by hand.
      console.warn('[useSiteDesign] native-geometry decision "' + d +
        '" could not be recorded: no property is named yet. The caller must pass a site key.');
      return;
    }
    stateRef.current = {
      ...stateRef.current,
      // 🚨 THE SAME FALLBACK THE PLANE STAMP USES. activeSiteKeyRef holds the
      // EMPTY STRING until hydration resolves ownership, and withDisposition
      // drops a write against an empty key — so a decision made in the first
      // moments of a session would vanish silently. Falls back to the site the
      // state believes is active, which is what every other ownership write
      // here does.
      // 🚨 FILED AGAINST THE PROPERTY, NOT AGAINST THIS SPELLING OF IT. If a
      // decision already exists under a key within the property radius, it is
      // REPLACED rather than joined by a second one — otherwise one house
      // accumulates `rejected` under one identity and `custom` under another,
      // and which the app reads depends on where the mouse last was.
      nativeGeometry: withDispositionForProperty(stateRef.current.nativeGeometry, key, d),
    };
    nativeDispositionRef.current = d;
    // Moves `archivesSignature`, so the autosave actually writes it. Without
    // the tick the decision would live in a ref nothing re-reads.
    setArchiveTick(t => t + 1);
  }, []);

  // ── DELETION ───────────────────────────────────────────────────────────────
  //
  // 🚨 THE LEDGER LIVES ON `stateRef.current.deletions`, beside the provider
  // judgement and for the same reason: it is a fact about a PROPERTY, not an
  // entity, so a bundle cannot carry it and archiving cannot protect it. The
  // ref below is a synchronous mirror, exactly like `nativeDispositionRef` —
  // the Lane A gate and the restore filters both fire from inside resolved
  // promises and must see the ledger that exists NOW, not the one captured when
  // they were scheduled.
  // `deletionLedgerRef` and `pendingDestructiveRef` are declared with the other
  // ownership refs at the top of this hook — see the note there.
  const geometryLifecycleRef = useRef<DesignGeometryLifecycle>('untouched');

  /**
   * THE KEY THE TOMBSTONES ARE FILED UNDER — one expression, used by every
   * read and every write, exactly as `dispositionKeyOf` is for the judgement.
   *
   * 🚨 IT MATCHES BY PROPERTY. `siteKeyFromCoords` rounds to about 1.1 m and a
   * single house routinely mints two or three keys metres apart, so an exact
   * lookup made a tombstone filed under one spelling invisible under another:
   * the lifecycle read `untouched`, the acquisition gate said yes, and the
   * archive handed the deleted face back. The disposition map had this defect
   * and was fixed with `dispositionForProperty`; this is the same fix for the
   * ledger, and it also means one house accumulates ONE entry rather than a
   * tombstone under each spelling of itself.
   */
  const ledgerKeyOf = useCallback((explicit?: string) =>
    resolveLedgerKey(deletionLedgerRef.current, dispositionKeyOf(explicit), sitesAreSameProperty),
  [dispositionKeyOf]);

  const deletionLedger = useMemo(() => {
    void archiveTick;
    void activeSiteKey;
    const led = stateRef.current.deletions ?? emptyLedger();
    deletionLedgerRef.current = led;
    return led;
  }, [archiveTick, activeSiteKey]);

  const geometryLifecycle = useMemo(() => {
    void archiveTick;
    const l = lifecycleFor(
      stateRef.current.deletions, ledgerKeyOf(), (roofPlanesRef.current ?? []).length,
    );
    geometryLifecycleRef.current = l;
    return l;
  }, [archiveTick, roofPlanes, ledgerKeyOf]);

  /** Write the ledger to state AND the mirror, and move the archive signature
   *  so the autosave actually persists it. A tombstone held only in memory is
   *  a face that returns on the next reload. */
  const writeLedger = useCallback((next: DeletionLedger) => {
    stateRef.current = { ...stateRef.current, deletions: next };
    deletionLedgerRef.current = next;
    setArchiveTick(t => t + 1);
  }, []);

  const planDelete = useCallback<UseSiteDesign['planDelete']>((scope, targetId) => planDeletion({
    scope,
    siteKey: ledgerKeyOf(),
    targetId: targetId ?? '',
    faces: (roofPlanesRef.current ?? []) as never,
    panels: (panelsRef.current ?? []) as never,
    obstructions: (placedObstructionsRef.current ?? []) as never,
    measurementCount: (measurementsRef.current ?? []).length,
    now: Date.now(),
  }), [ledgerKeyOf]);

  const applyDelete = useCallback<UseSiteDesign['applyDelete']>((plan) => {
    if (!plan || !plan.ok) {
      return { ok: false, removed: 0, message: plan?.refusal || 'Nothing to delete.' };
    }
    const key = ledgerKeyOf();
    if (!key) {
      // 🚨 REFUSED OUT LOUD, exactly as an unnamed-property disposition write
      // is. A tombstone filed against an empty key is dropped by
      // `withTombstones`, and the deletion would then work on screen and be
      // undone by the next hydration with nothing saying why.
      return {
        ok: false, removed: 0,
        message: 'This property is not identified yet, so a deletion cannot be recorded against it. '
          + 'Pick the house on the map first.',
      };
    }
    const now = Date.now();

    // 🚨 HISTORY FIRST, AND IT CARRIES THE PANELS. Every other edit moves a
    // face, so its panels are recomputed from where the face went. A delete
    // removes the face, and no arithmetic brings a panel back from a roof that
    // is not there — so this is the one step that snapshots them.
    writeHistory(pushSnapshot(
      geometryHistoryRef.current, plan.title, roofPlanesRef.current, null,
      nativeDispositionRef.current,
      deletionLedgerRef.current,
      panelsRef.current,
      // 🚨 AND THE OBSTRUCTIONS AND MEASUREMENTS, so "Undo restores it" is
      // TRUE. Deleting a vent used to say exactly that and leave it gone for
      // good — a false reassurance is the reason somebody stops looking for
      // what they lost.
      placedObstructionsRef.current,
      measurementsRef.current,
    ));

    const goneFace: Record<string, boolean> = {};
    for (const id of plan.faceIds) goneFace[id] = true;
    const gonePanel: Record<string, boolean> = {};
    for (const id of plan.panelIds) gonePanel[id] = true;
    const goneObs: Record<string, boolean> = {};
    for (const id of plan.obstructionIds) goneObs[id] = true;

    if (plan.faceIds.length) {
      setRoofPlanes((roofPlanesRef.current ?? []).filter(p => !goneFace[p?.id]));
    }
    if (plan.panelIds.length) {
      setPanels((panelsRef.current ?? []).filter(p => !gonePanel[p?.id]));
    }
    if (plan.obstructionIds.length) {
      setPlacedObstructions((placedObstructionsRef.current ?? []).filter(o => !goneObs[o?.id]));
    }
    if (plan.clearsMeasurements) setMeasurements([]);

    writeLedger(withTombstones(deletionLedgerRef.current, key, tombstonesFor(plan, now)));

    // 🚨 THE AUTHORIZATION IS MINTED HERE AND NOWHERE ELSE. This is the single
    // function that can say "a person chose this", so it is the single function
    // that may hand the server permission to accept an emptied sub-system.
    //
    // MERGED, NEVER OVERWRITTEN — see `mergeAuthorization`.
    pendingDestructiveRef.current = mergeAuthorization(
      pendingDestructiveRef.current, authorizationFor(plan, key, now),
    );

    const removed = plan.faceIds.length + plan.panelIds.length + plan.obstructionIds.length;
    return { ok: true, removed, message: `${plan.title}: ${plan.lines.join(', ')}.` };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerKeyOf, writeLedger]);

  /**
   * Fold a new authorization into whatever is already waiting for the next save.
   *
   * 🚨 PLAIN ASSIGNMENT WAS A DEADLOCK. The autosave is debounced three
   * seconds and its timer restarts on every state change, so two deletions
   * inside that window produced ONE save carrying only the SECOND
   * authorization. The server refuses when ANY wiped sub-system is
   * unauthorised, so the save 409-ed, nothing was written — tombstones
   * included — and the autosave retried for ever with the same insufficient
   * token. Both deletions came back on reload.
   *
   * Two authorizations at different properties do not merge; the newer one
   * wins, because the older one can no longer be satisfied by a save that
   * names the new property.
   */
  const mergeAuthorization = useCallback((
    prev: DestructiveAuthorization | null, next: DestructiveAuthorization,
  ): DestructiveAuthorization => {
    if (!prev || prev.siteKey !== next.siteKey) return next;
    const join = (a: string[], b: string[]) => Array.from(new Set([...(a ?? []), ...(b ?? [])])).sort();
    return {
      ...next,
      faceIds: join(prev.faceIds, next.faceIds),
      sectionIds: join(prev.sectionIds, next.sectionIds),
      obstructionIds: join(prev.obstructionIds, next.obstructionIds),
      panelIds: join(prev.panelIds, next.panelIds),
      panelSystemTypes: join(prev.panelSystemTypes, next.panelSystemTypes),
    };
  }, []);

  const notePanelRemoval = useCallback<UseSiteDesign['notePanelRemoval']>((removed) => {
    const list = (Array.isArray(removed) ? removed : []).filter(Boolean);
    if (list.length === 0) return;
    const key = ledgerKeyOf();
    if (!key) return;
    pendingDestructiveRef.current = mergeAuthorization(
      pendingDestructiveRef.current,
      makeAuthorization('panels', key, {
        panelIds: list.map(p => p?.id).filter(Boolean) as string[],
        panelSystemTypes: list.map(p => p?.systemType || 'roof'),
      }, Date.now()),
    );
  }, [ledgerKeyOf, mergeAuthorization]);

  const pendingDestructive = useCallback(() => pendingDestructiveRef.current, []);
  const clearPendingDestructive = useCallback(() => { pendingDestructiveRef.current = null; }, []);

  const forgetDeletions = useCallback<UseSiteDesign['forgetDeletions']>((siteKey) => {
    const key = ledgerKeyOf(siteKey);
    if (!key) return;
    writeLedger(withoutTombstones(deletionLedgerRef.current, key));
  }, [ledgerKeyOf, writeLedger]);

  const admitGeometry = useCallback(<T extends { id?: string; sectionId?: string }>(faces: T[]): T[] => {
    const res = admitFaces(deletionLedgerRef.current, ledgerKeyOf(), faces);
    if (res.refused.length) {
      // Never silent. A face that vanishes with no explanation is the failure
      // mode this whole model exists to replace.
      console.warn('[useSiteDesign] refused ' + res.refused.length
        + ' face(s) that were deliberately deleted at this property:',
        res.refused.map(f => f?.id));
    }
    return res.admitted;
  }, [ledgerKeyOf]);

  const admitPlacedObstructions = useCallback(<T extends { id?: string }>(obs: T[]): T[] => {
    const res = admitObstructions(deletionLedgerRef.current, ledgerKeyOf(), obs);
    if (res.refused.length) {
      console.warn('[useSiteDesign] refused ' + res.refused.length
        + ' obstruction(s) that were deliberately deleted at this property.');
    }
    return res.admitted;
  }, [ledgerKeyOf]);

  return {
    panels, setPanels,
    roofPlanes, setRoofPlanes,
    placedObstructions, setPlacedObstructions,
    measurements, setMeasurements,
    panelsRef, roofPlanesRef, placedObstructionsRef, measurementsRef,
    activeSiteKey, activeSiteKeyRef,
    archivedSiteCount, archivedEntityCount,
    switchToSite, hydrateFromStored, resolveKeyFor,
    persistencePayload, storedArchives,
    scope, isCurrent,
    nativeDisposition, nativeDispositionRef, setNativeDisposition,
    recordGeometry, undoGeometry, redoGeometry,
    canUndoGeometry: canUndo(geometryHistory),
    canRedoGeometry: canRedo(geometryHistory),
    undoGeometryLabel: undoLabel(geometryHistory),
    redoGeometryLabel: redoLabel(geometryHistory),
    deletionLedger, deletionLedgerRef,
    planDelete, applyDelete,
    notePanelRemoval, pendingDestructive, clearPendingDestructive,
    forgetDeletions,
    geometryLifecycle, geometryLifecycleRef,
    admitGeometry, admitPlacedObstructions,
    stateRef,
  };
}

export { emptyBundle };
