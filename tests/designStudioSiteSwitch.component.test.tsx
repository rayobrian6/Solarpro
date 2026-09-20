/** @vitest-environment jsdom */
/**
 * tests/designStudioSiteSwitch.component.test.tsx
 *
 * THE MELVIN SEQUENCE, THROUGH THE REAL DesignStudio COMPONENT.
 *
 * WHAT THIS CLOSES THAT THE OTHER THREE DO NOT
 * --------------------------------------------
 *   tests/siteDesignModel.test.ts          the model
 *   tests/siteDesignIntegration.test.tsx   the hook, through React
 *   tests/siteDesignRoute.postgres.test.ts the route + real PostgreSQL
 *
 * Between the hook and the route sits the WIRING: is `changeSite` actually
 * called from `onLocationPick`? Does the hook actually drive the setters the
 * rest of the component reads? Does the save that follows a property change
 * actually carry the archive? Until now those were asserted by grepping the
 * source — which is exactly the kind of proof that was green while Ray's first
 * click failed.
 *
 * So this MOUNTS DesignStudio, drives `onLocationPick` the way SolarEngine3D
 * drives it when a user picks a house, and inspects the real HTTP payloads the
 * real autosave produces.
 *
 * SolarEngine3D is stubbed — it is Cesium, WebGL and ~13k lines, and it is not
 * what is under test; the stub captures the props so the test can invoke the
 * same callbacks the engine invokes. Everything inside DesignStudio is real.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, cleanup } from '@testing-library/react';
import type { Project } from '@/types';

// ── The 3D engine: a prop-capturing stub ────────────────────────────────────
type EngineProps = {
  onLocationPick?: (lat: number, lng: number, address: string) => void;
  onObstructionsChange?: (o: unknown[]) => void;
  onMeasurementsChange?: (m: unknown[]) => void;
  onRoofPlaneCreated?: (p: unknown) => void;
};
const engine: { props: EngineProps } = { props: {} };
vi.mock('../components/3d/SolarEngine3D', () => ({
  __esModule: true,
  default: (props: EngineProps) => { engine.props = props; return null; },
}));
vi.mock('@/components/3d/SolarEngine3D', () => ({
  __esModule: true,
  default: (props: EngineProps) => { engine.props = props; return null; },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/design',
}));

const toastApi = {
  success: () => {}, error: () => {}, info: () => {}, warning: () => {},
  loading: () => 'id', update: () => {}, dismiss: () => {},
};
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => toastApi,
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const DesignStudio = (await import('@/components/design/DesignStudio')).default;
const { siteKeyFromCoords } = await import('@/lib/siteIdentity');

// ── Melvin and the house next door ──────────────────────────────────────────
const PROJECT_ID = '4030b664-bebe-433b-a11c-cda05ead2f7d';
const MELVIN = { lat: 38.70615257709013, lng: -90.04625419301613 };
const NEIGHBOUR = { lat: 38.70629, lng: -90.04620 };
const KEY_A = siteKeyFromCoords(MELVIN.lat, MELVIN.lng, PROJECT_ID);
const KEY_B = siteKeyFromCoords(NEIGHBOUR.lat, NEIGHBOUR.lng, PROJECT_ID);

const panel = (id: string) => ({
  id, lat: MELVIN.lat, lng: MELVIN.lng, wattage: 400, systemType: 'roof',
  tilt: 20, azimuth: 180, widthFeet: 3.3, heightFeet: 5.5,
});
const plane = (id: string) => ({
  id, siteKey: KEY_A, pitch: 20, azimuth: 180, area: 40, usableArea: 34,
  vertices: [
    { lat: MELVIN.lat, lng: MELVIN.lng },
    { lat: MELVIN.lat + 0.0001, lng: MELVIN.lng },
    { lat: MELVIN.lat + 0.0001, lng: MELVIN.lng + 0.0001 },
  ],
});

const MELVIN_PANELS = Array.from({ length: 52 }, (_, i) => panel(`melvin-p${i}`));
const MELVIN_PLANES = Array.from({ length: 6 }, (_, i) => plane(`melvin-r${i}`));
const MELVIN_OBS = [{ id: 'melvin-o0', lat: MELVIN.lat, lng: MELVIN.lng, height: 3, radiusM: 1, type: 'vent' }];
const MELVIN_MEAS = [{ id: 'melvin-m0', a: { lat: 1, lng: 1 }, b: { lat: 1, lng: 2 }, horizDistM: 5, slopeDistM: 5.2 }];

const project = {
  id: PROJECT_ID,
  name: 'BRAIDON M PILLA — Solar',
  address: '3 Melvin Drive, Granite City, IL 62040',
  lat: MELVIN.lat, lng: MELVIN.lng,
  systemType: 'roof',
  client: { id: 'c1', name: 'Braidon', address: '3 Melvin Drive', city: 'Granite City', state: 'IL', zip: '62040' },
} as unknown as Project;

// ── The network ─────────────────────────────────────────────────────────────
type Posted = { url: string; body: Record<string, any> };
let posted: Posted[] = [];

/** The stored layout row, as the GET would return it. */
let storedLayout: Record<string, any> | null = null;

function installFetch() {
  posted = [];
  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

    if (url.includes('/layout') && method === 'POST') {
      const body = JSON.parse(init.body);
      posted.push({ url, body });
      // Behave like the real route: the active columns take the payload, the
      // archive column takes siteArchives.
      storedLayout = { ...(storedLayout ?? {}), ...body };
      return json({ success: true, data: { projectId: PROJECT_ID, panelCount: body.panels?.length ?? 0 } });
    }
    if (url.includes('/layout')) return json({ success: true, data: storedLayout });
    if (url.includes('/api/hardware')) return json({ success: true, data: { panels: [], inverters: [], batteries: [] } });
    if (url.includes('/api/geocode')) return json({ success: true, data: { lat: MELVIN.lat, lng: MELVIN.lng, short_name: project.address } });
    return json({ success: true, data: null });
  }));
}

/** Wait for the 3s autosave debounce to fire and its promise to settle. */
async function flushAutosave() {
  await act(async () => {
    vi.advanceTimersByTime(3500);
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** The most recent layout POST body. */
const lastPost = () => posted[posted.length - 1]?.body;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  installFetch();
  storedLayout = {
    panels: MELVIN_PANELS,
    roofPlanes: MELVIN_PLANES,
    obstructions: MELVIN_OBS,
    measurements: MELVIN_MEAS,
    mapCenter: MELVIN,
    siteArchives: { version: 1, activeSiteKey: KEY_A, sites: {} },
  };
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function mountStudio() {
  let utils!: ReturnType<typeof render>;
  await act(async () => { utils = render(<DesignStudio project={project} />); });
  // Let the mount-time restore resolve.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  return utils;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('🚨 DesignStudio: picking the house next door and coming back', () => {
  it('the engine is wired to a location-pick handler at all', async () => {
    await mountStudio();
    expect(typeof engine.props.onLocationPick).toBe('function');
  });

  it('A → B: the save that follows carries the ARCHIVE, not an empty design', async () => {
    await mountStudio();
    posted = [];

    // The user clicks the neighbour's house in Pick House mode.
    await act(async () => { engine.props.onLocationPick!(NEIGHBOUR.lat, NEIGHBOUR.lng, '5 Melvin Drive'); });
    await flushAutosave();

    const body = lastPost();
    expect(body, 'a property change must produce a save').toBeDefined();
    // The active columns describe the neighbour — empty, correctly.
    expect(body.panels).toEqual([]);
    expect(body.roofPlanes).toEqual([]);
    // 🚨 …and Melvin travels in the archive. The old code sent `panels: []`
    // with nothing else and Melvin's layout was simply gone.
    expect(body.siteArchives).toBeDefined();
    expect(body.siteArchives.activeSiteKey).toBe(KEY_B);
    expect(body.siteArchives.sites[KEY_A].panels.map((p: any) => p.id))
      .toEqual(MELVIN_PANELS.map(p => p.id));
    expect(body.siteArchives.sites[KEY_A].roofPlanes).toHaveLength(6);
    expect(body.siteArchives.sites[KEY_A].obstructions).toHaveLength(1);
    expect(body.siteArchives.sites[KEY_A].measurements).toHaveLength(1);
  });

  it('🚨 A → B → A: the panels come back, by ID', async () => {
    await mountStudio();
    await act(async () => { engine.props.onLocationPick!(NEIGHBOUR.lat, NEIGHBOUR.lng, '5 Melvin Drive'); });
    await flushAutosave();
    posted = [];

    // Pick the original house again.
    await act(async () => { engine.props.onLocationPick!(MELVIN.lat, MELVIN.lng, '3 Melvin Drive'); });
    await flushAutosave();

    const body = lastPost();
    expect(body.panels.map((p: any) => p.id)).toEqual(MELVIN_PANELS.map(p => p.id));
    expect(body.roofPlanes.map((p: any) => p.id)).toEqual(MELVIN_PLANES.map(p => p.id));
    expect(body.obstructions.map((o: any) => o.id)).toEqual(MELVIN_OBS.map(o => o.id));
    expect(body.measurements.map((m: any) => m.id)).toEqual(MELVIN_MEAS.map(m => m.id));
    expect(body.siteArchives.activeSiteKey).toBe(KEY_A);
    // Melvin is no longer in the archive — it is active.
    expect(body.siteArchives.sites[KEY_A]).toBeUndefined();
  });

  it('A → B → A → B: the neighbour\'s own work is kept too', async () => {
    await mountStudio();
    await act(async () => { engine.props.onLocationPick!(NEIGHBOUR.lat, NEIGHBOUR.lng, '5 Melvin Drive'); });
    // Place an obstruction at the neighbour, the way the 3D engine reports one.
    const nObs = [{ id: 'neighbour-o0', lat: NEIGHBOUR.lat, lng: NEIGHBOUR.lng, height: 2, radiusM: 1, type: 'chimney' }];
    await act(async () => { engine.props.onObstructionsChange?.(nObs); });
    await flushAutosave();

    await act(async () => { engine.props.onLocationPick!(MELVIN.lat, MELVIN.lng, '3 Melvin Drive'); });
    await flushAutosave();
    expect(lastPost().obstructions.map((o: any) => o.id)).toEqual(['melvin-o0']);

    await act(async () => { engine.props.onLocationPick!(NEIGHBOUR.lat, NEIGHBOUR.lng, '5 Melvin Drive'); });
    await flushAutosave();
    expect(lastPost().obstructions.map((o: any) => o.id)).toEqual(['neighbour-o0']);
  });

  it('rapid A → B → A inside one debounce window saves Melvin, not an empty set', async () => {
    await mountStudio();
    posted = [];
    await act(async () => {
      engine.props.onLocationPick!(NEIGHBOUR.lat, NEIGHBOUR.lng, '5 Melvin Drive');
      engine.props.onLocationPick!(MELVIN.lat, MELVIN.lng, '3 Melvin Drive');
    });
    await flushAutosave();
    expect(lastPost().panels).toHaveLength(52);
    expect(lastPost().siteArchives.activeSiteKey).toBe(KEY_A);
  });

  it('picking the SAME house changes nothing and archives nothing', async () => {
    await mountStudio();
    posted = [];
    await act(async () => { engine.props.onLocationPick!(MELVIN.lat, MELVIN.lng, '3 Melvin Drive'); });
    await flushAutosave();
    const body = lastPost();
    if (body) {
      expect(body.panels).toHaveLength(52);
      expect(Object.keys(body.siteArchives.sites)).toEqual([]);
    }
  });

  it('a reload at the neighbour restores the neighbour and still holds Melvin', async () => {
    await mountStudio();
    await act(async () => { engine.props.onLocationPick!(NEIGHBOUR.lat, NEIGHBOUR.lng, '5 Melvin Drive'); });
    await flushAutosave();
    // storedLayout now holds what the route received. Remount against it,
    // standing at the neighbour: project.lat/lng move with the pick in the
    // real app, so mirror that.
    cleanup();
    const neighbourProject = { ...project, lat: NEIGHBOUR.lat, lng: NEIGHBOUR.lng } as Project;
    await act(async () => { render(<DesignStudio project={neighbourProject} />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    posted = [];
    await act(async () => { engine.props.onLocationPick!(MELVIN.lat, MELVIN.lng, '3 Melvin Drive'); });
    await flushAutosave();
    expect(lastPost().panels.map((p: any) => p.id)).toEqual(MELVIN_PANELS.map(p => p.id));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('🚨 the restore gate still protects the stored design', () => {
  it('a failed restore disables saving entirely', async () => {
    storedLayout = null;
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.includes('/layout') && method === 'POST') {
        posted.push({ url, body: JSON.parse(init.body) });
        return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
      }
      if (url.includes('/layout')) {
        // The route returns success:false as JSON for a 4xx — the case that
        // used to fall through every branch and still open the fence.
        return new Response(JSON.stringify({ success: false, error: 'nope' }), { status: 404 });
      }
      if (url.includes('/api/hardware')) {
        return new Response(JSON.stringify({ success: true, data: { panels: [], inverters: [], batteries: [] } }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true, data: null }), { status: 200 });
    }));
    posted = [];
    await mountStudio();
    await act(async () => { engine.props.onLocationPick!(NEIGHBOUR.lat, NEIGHBOUR.lng, '5 Melvin Drive'); });
    await flushAutosave();
    expect(posted.filter(p => p.url.includes('/layout'))).toHaveLength(0);
  });
});
