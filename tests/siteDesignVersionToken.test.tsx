/** @vitest-environment jsdom */
/**
 * tests/siteDesignVersionToken.test.tsx
 *
 * WHICH VERSION OF THE STORED DESIGN IS THIS TAB EDITING?
 *
 * The server half of the fix lives in `upsertLayout` and is proved against real
 * PostgreSQL in tests/layoutConcurrency.postgres.test.ts: send the version you
 * read as `expectedUpdatedAt` and a stale write is refused with
 * `LAYOUT_STALE_WRITE` instead of silently overwriting whoever saved while you
 * had the design open.
 *
 * This is the other half — the custody of that token in the client. It belongs
 * in `useSiteDesign` because that hook is what READS the row: `hydrateFromStored`
 * is handed the stored layout, so it is the one place that knows, without
 * guessing, which version the entities now on screen came from.
 *
 * 🚨 THE TOKEN LIVES IN A REF, AND THAT IS THE WHOLE POINT. Every save path in
 * DesignStudio — the autosave timer, the Save button, the beforeunload beacon —
 * reads what it sends out of refs, for the reason stated at the top of
 * useSiteDesign.ts: a mirror maintained by `useEffect` lags the state until
 * React flushes, and a save firing in that window sends the previous value. A
 * version token that lags is worse than no token: it names a version that is
 * not the one on screen, so it either refuses a save that should succeed or
 * waves through one that should not.
 *
 * Run with the real hook, real React state and real refs — the harness
 * tests/siteDesignIntegration.test.tsx already established for this hook.
 */

import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSiteDesign } from '@/components/design/useSiteDesign';
import { siteKeyFromCoords } from '@/lib/siteIdentity';
import type { PlacedPanel } from '@/types';

const PROJECT = '4030b664-bebe-433b-a11c-cda05ead2f7d';
const MELVIN = { lat: 38.70615257709013, lng: -90.04625419301613 };
const KEY_A = siteKeyFromCoords(MELVIN.lat, MELVIN.lng, PROJECT);

const panel = (id: string): PlacedPanel =>
  ({ id, lat: MELVIN.lat, lng: MELVIN.lng, wattage: 400 } as unknown as PlacedPanel);

/** What DesignStudio hands the hook after `GET /api/projects/[id]/layout`.
 *  The route returns the whole Layout row, so `updatedAt` is on it. */
const storedRow = (updatedAt: unknown) => ({
  panels: [panel('p1'), panel('p2')],
  roofPlanes: [],
  obstructions: [],
  measurements: [],
  designElectrical: null,
  siteArchives: undefined,
  updatedAt,
} as unknown as Parameters<ReturnType<typeof useSiteDesign>['hydrateFromStored']>[0]);

describe('the tab knows which version of the design it is editing', () => {
  it('has no version before it has read anything', () => {
    const { result } = renderHook(() => useSiteDesign());
    expect(result.current.storedVersion()).toBeNull();
  });

  it('takes the version from the row it hydrated from', () => {
    const { result } = renderHook(() => useSiteDesign());
    act(() => { result.current.hydrateFromStored(storedRow('2026-09-25T10:00:00.000Z'), KEY_A); });
    expect(result.current.storedVersion()).toBe('2026-09-25T10:00:00.000Z');
  });

  it('accepts what the database driver actually hands back — a Date, not a string', () => {
    // 🚨 `timestamptz` arrives as a JS Date through the Neon driver and as an
    // ISO string through JSON. Both must produce the SAME token, or the
    // precondition is a guard that can never match and every save is refused.
    const { result } = renderHook(() => useSiteDesign());
    act(() => { result.current.hydrateFromStored(storedRow(new Date('2026-09-25T10:00:00.000Z')), KEY_A); });
    expect(result.current.storedVersion()).toBe('2026-09-25T10:00:00.000Z');
  });

  it('🚨 is readable in the same tick it is set — a save firing now sends the right one', () => {
    // The lagging-mirror failure, asserted directly: read INSIDE the act(), with
    // no render between, exactly as an autosave timer or a beforeunload beacon
    // would read it.
    const { result } = renderHook(() => useSiteDesign());
    let seen: string | null = 'not-read';
    act(() => {
      result.current.hydrateFromStored(storedRow('2026-09-25T10:00:00.000Z'), KEY_A);
      seen = result.current.storedVersion();
    });
    expect(seen).toBe('2026-09-25T10:00:00.000Z');
  });

  it('moves forward when a save reports the version it wrote', () => {
    // 🚨 WITHOUT THIS THE STUDIO WEDGES ITSELF. The next autosave would send
    // the version from before the previous save and be refused as stale — by
    // this tab's own earlier write.
    const { result } = renderHook(() => useSiteDesign());
    act(() => { result.current.hydrateFromStored(storedRow('2026-09-25T10:00:00.000Z'), KEY_A); });
    act(() => { result.current.noteSavedVersion('2026-09-25T10:05:00.000Z'); });
    expect(result.current.storedVersion()).toBe('2026-09-25T10:05:00.000Z');
  });

  it('a project with no saved row carries no precondition', () => {
    // A brand-new project, and a Quick Design session whose id is not a UUID:
    // there is no stored version to conflict with, and inventing one would
    // refuse the first save a design ever makes.
    const { result } = renderHook(() => useSiteDesign());
    act(() => { result.current.hydrateFromStored(null, KEY_A); });
    expect(result.current.storedVersion()).toBeNull();
  });

  it('an unreadable value becomes NO token rather than a poisoned one', () => {
    // A token the server cannot parse is refused outright (by design — see
    // `requestedVersion` in lib/db/projects.ts), so sending rubbish would make
    // every save fail. Nothing sensible can be said about the version here, and
    // "no precondition" is the honest answer.
    const { result } = renderHook(() => useSiteDesign());
    act(() => { result.current.hydrateFromStored(storedRow('whenever'), KEY_A); });
    expect(result.current.storedVersion()).toBeNull();
    act(() => { result.current.noteSavedVersion(undefined); });
    expect(result.current.storedVersion()).toBeNull();
  });

  it('a row written before this existed simply has no version', () => {
    const { result } = renderHook(() => useSiteDesign());
    act(() => { result.current.hydrateFromStored(storedRow(undefined), KEY_A); });
    expect(result.current.storedVersion()).toBeNull();
  });

  it('re-hydrating replaces the version — a reload is a fresh read', () => {
    const { result } = renderHook(() => useSiteDesign());
    act(() => { result.current.hydrateFromStored(storedRow('2026-09-25T10:00:00.000Z'), KEY_A); });
    act(() => { result.current.hydrateFromStored(storedRow('2026-09-25T11:00:00.000Z'), KEY_A); });
    expect(result.current.storedVersion()).toBe('2026-09-25T11:00:00.000Z');
  });
});
