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
  dispositionFor,
  withDisposition,
  type NativeGeometryDisposition,
} from '@/lib/design/nativeGeometryDisposition';
import {
  emptyHistory, pushSnapshot, undo, redo, canUndo, canRedo, undoLabel, redoLabel,
  type GeometryHistory,
} from '@/lib/3d/geometryHistory';
import { repositionPanelsForPlanes } from '@/lib/3d/sectionEditing';
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
    writeHistory(pushSnapshot(geometryHistoryRef.current, label, roofPlanesRef.current, coalesceKey));
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
  const applyRestoredGeometry = useCallback((restored: RoofPlane[]) => {
    const held = panelsRef.current ?? [];
    const from = roofPlanesRef.current ?? [];
    setRoofPlanes(restored);
    if (held.length === 0) return;
    const moved = repositionPanelsForPlanes(held, from, restored);
    if (moved.moved > 0) setPanels(moved.panels);
    // An orphan here means the undone edit had changed the roof KIND. The
    // panels are left exactly as they are rather than guessed onto a
    // neighbouring face; the caller surfaces it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const undoGeometry = useCallback((): string | null => {
    const step = undo(geometryHistoryRef.current, roofPlanesRef.current);
    if (!step.ok) return null;
    writeHistory(step.history);
    // Adopt the canonical array; every derived thing rebuilds from it.
    applyRestoredGeometry(step.planes);
    return step.label;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const redoGeometry = useCallback((): string | null => {
    const step = redo(geometryHistoryRef.current, roofPlanesRef.current);
    if (!step.ok) return null;
    writeHistory(step.history);
    applyRestoredGeometry(step.planes);
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
  const nativeDisposition = useMemo(() => {
    void archiveTick;
    const d = dispositionFor(stateRef.current.nativeGeometry, activeSiteKey);
    nativeDispositionRef.current = d;
    return d;
  }, [archiveTick, activeSiteKey]);

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
    const key = siteKey || activeSiteKeyRef.current || stateRef.current.activeSiteKey;
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
      nativeGeometry: withDisposition(stateRef.current.nativeGeometry, key, d),
    };
    nativeDispositionRef.current = d;
    // Moves `archivesSignature`, so the autosave actually writes it. Without
    // the tick the decision would live in a ref nothing re-reads.
    setArchiveTick(t => t + 1);
  }, []);

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
    stateRef,
  };
}

export { emptyBundle };
