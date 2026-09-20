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
  switchToSite: (toKey: string, opts?: { address?: string | null; mapCenter?: { lat: number; lng: number } | null }) => {
    changed: boolean;
    arriving: SiteDesignBundle;
    archivedCount: number;
    reason: string;
  };

  /** Rebuild from a stored layout row. Returns the disposition so the caller
   *  can log it and know whether one adoption save is expected. */
  hydrateFromStored: (stored: StoredLayoutForHydration | null, siteKeyNow: string) => ReturnType<typeof hydrate>;

  /** Everything the save paths need: the ACTIVE entities for their own columns
   *  plus the archives for `layouts.site_archives`. */
  persistencePayload: (extras?: { designElectrical?: DesignElectrical | null; scalars?: SiteDesignScalars }) => ReturnType<typeof toPersistencePayload>;
  /** The archives exactly as they will be stored — for the dedup signature. */
  storedArchives: (extras?: { designElectrical?: DesignElectrical | null; scalars?: SiteDesignScalars }) => StoredSiteArchives;

  // ── Stale-response protection ─────────────────────────────────────────────
  scope: () => SiteScope;
  isCurrent: (s: SiteScope | null | undefined) => boolean;

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

  /** Push a bundle into component state and the mirror refs, in one step. */
  const applyBundle = useCallback((b: SiteDesignBundle) => {
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

  return {
    panels, setPanels,
    roofPlanes, setRoofPlanes,
    placedObstructions, setPlacedObstructions,
    measurements, setMeasurements,
    panelsRef, roofPlanesRef, placedObstructionsRef, measurementsRef,
    activeSiteKey, activeSiteKeyRef,
    archivedSiteCount, archivedEntityCount,
    switchToSite, hydrateFromStored,
    persistencePayload, storedArchives,
    scope, isCurrent,
    stateRef,
  };
}

export { emptyBundle };
