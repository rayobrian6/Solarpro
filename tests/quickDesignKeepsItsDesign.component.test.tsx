/**
 * @vitest-environment jsdom
 *
 * tests/quickDesignKeepsItsDesign.component.test.tsx
 *
 * QUICK DESIGN — "THE FLOW RAY ACTUALLY WORKS IN" — MUST NOT LOSE THE DESIGN.
 *
 * Drives the real DesignStudio (the 3D engine is a prop-capturing stub, as in
 * tests/designStudioSiteSwitch.component.test.tsx) against a fetch stub that
 * answers the way the real routes do:
 *
 *   · a Quick Design's id is `demo-<timestamp>`, and GET /api/projects/<id>/layout
 *     answers 400 to any non-UUID id. The restore treated that 400 as a failed
 *     read: "Could not load the saved design — saving is disabled", and the
 *     session could never save;
 *   · promoting the Quick Design (POST /api/projects, when Nearmap is chosen)
 *     swaps the studio to the new UUID, whose layout row is EMPTY — and the
 *     restore for the new id hydrated from it, wiping every panel and face the
 *     user had drawn.
 *
 * Also: a layout save that fails after its version claim answers with
 * `currentVersion`, and the studio's NEXT save must state it (otherwise every
 * later save is refused as stale by the failed one).
 */

import React, { useState } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, cleanup } from '@testing-library/react';
import type { Project } from '@/types';

type EngineProps = {
  panels?: unknown[];
  roofPlanes?: unknown[];
  onPanelsChange?: (p: unknown[]) => void;
  onRoofPlaneCreated?: (p: unknown) => void;
  onLoadAerialReference?: (opts?: unknown) => Promise<unknown>;
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
  success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(),
  loading: vi.fn(() => 'id'), update: vi.fn(), dismiss: vi.fn(),
};
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => toastApi,
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const DesignStudio = (await import('@/components/design/DesignStudio')).default;

const SITE = { lat: 38.6657, lng: -90.2266 };
const NEW_ID = '9d2f1a44-5b6c-4d7e-8f90-a1b2c3d4e5f6';

const panel = (id: string) => ({
  id, lat: SITE.lat, lng: SITE.lng, wattage: 400, systemType: 'roof',
  tilt: 20, azimuth: 180, widthFeet: 3.3, heightFeet: 5.5,
});
const DESIGN = Array.from({ length: 9 }, (_, i) => panel(`qd-p${i}`));

const demoProject = {
  id: 'demo-1759150000000', userId: 'demo', name: 'Quick Design — 1010 Franklin Ave, St Louis, MO',
  status: 'lead', systemType: 'roof', address: '1010 Franklin Ave, St Louis, MO',
  lat: SITE.lat, lng: SITE.lng, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
} as unknown as Project;

type Call = { url: string; method: string; body?: Record<string, any> };
let calls: Call[] = [];
let layoutRows: Record<string, Record<string, any> | null> = {};
let failNextLayoutPostWith: string | null = null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function installFetch() {
  calls = [];
  layoutRows = {};
  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

    const m = url.match(/\/api\/projects\/([^/?]+)\/layout/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      // The real route: any non-UUID id is a 400 before the body is read.
      if (!UUID.test(id)) return json({ success: false, error: 'Invalid project ID' }, 400);
      if (method === 'POST') {
        if (failNextLayoutPostWith) {
          const v = failNextLayoutPostWith; failNextLayoutPostWith = null;
          return json({ success: false, error: 'Service temporarily unavailable.', code: 'DB_STARTING', currentVersion: v }, 503);
        }
        const updatedAt = new Date(Date.now() + calls.length).toISOString();
        layoutRows[id] = { ...(layoutRows[id] ?? {}), ...body, updatedAt };
        return json({ success: true, data: { ...layoutRows[id] } });
      }
      return json({ success: true, data: layoutRows[id] ?? null });
    }
    if (url.endsWith('/api/projects') && method === 'POST') {
      return json({ success: true, data: { ...demoProject, id: NEW_ID, userId: 'u1', name: body?.name } });
    }
    if (url.includes('/api/hardware')) return json({ success: true, data: { panels: [], inverters: [], batteries: [] } });
    if (url.includes('/api/geocode')) return json({ success: true, data: { lat: SITE.lat, lng: SITE.lng, short_name: demoProject.address } });
    return json({ success: true, data: null });
  }));
}

const layoutPosts = (id: string) =>
  calls.filter(c => c.method === 'POST' && c.url.includes(`/api/projects/${id}/layout`));

async function flush(ms = 3500) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

function Host() {
  const [p, setP] = useState<Project>(demoProject);
  return <DesignStudio project={p} onProjectPromoted={setP} />;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  installFetch();
  Object.values(toastApi).forEach(f => (f as ReturnType<typeof vi.fn>).mockClear?.());
  failNextLayoutPostWith = null;
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('🚨 a Quick Design can save', () => {
  it('opening a Quick Design does not report "saving is disabled"', async () => {
    await act(async () => { render(<Host />); });
    await flush(500);
    const disabled = toastApi.error.mock.calls.filter(c => /saving is disabled/i.test(String(c[0])));
    expect(disabled, 'a Quick Design was told its saving is disabled').toEqual([]);
  });

  it('a Quick Design never POSTs to a layout route that can only answer 400', async () => {
    await act(async () => { render(<Host />); });
    await flush(500);
    await act(async () => { engine.props.onPanelsChange?.(DESIGN); });
    await flush();
    expect(calls.filter(c => c.method === 'POST' && /\/api\/projects\/demo-/.test(c.url))).toEqual([]);
  });
});

describe('🚨 promoting a Quick Design keeps the design', () => {
  it('Quick Design → design → promote → the same panels, saved under the new project', async () => {
    await act(async () => { render(<Host />); });
    await flush(500);

    // design
    await act(async () => { engine.props.onPanelsChange?.(DESIGN); });
    await flush();
    expect(engine.props.panels).toHaveLength(DESIGN.length);

    // promote (what choosing Nearmap does)
    await act(async () => { await engine.props.onLoadAerialReference?.(); });
    await flush(500);
    expect(calls.some(c => c.method === 'POST' && c.url.endsWith('/api/projects')),
      'the promotion never created a project').toBe(true);

    // the design is still on screen …
    expect(engine.props.panels, 'promotion wiped the in-memory design').toHaveLength(DESIGN.length);

    // … and is written under the new id, as a first save (no version token).
    await flush();
    const saved = layoutPosts(NEW_ID);
    expect(saved.length, 'the promoted design was never saved under its new project').toBeGreaterThan(0);
    expect(saved[0].body?.panels).toHaveLength(DESIGN.length);
    expect(saved[0].body?.expectedUpdatedAt).toBeUndefined();
    expect(layoutRows[NEW_ID]?.panels).toHaveLength(DESIGN.length);
  });
});

describe('🚨 a save that failed after its claim does not wedge the studio', () => {
  it('the next save states the version the failed save reported', async () => {
    // A real project with a stored layout.
    layoutRows[NEW_ID] = { panels: DESIGN.slice(0, 3), updatedAt: '2026-09-29T10:00:00.000Z', mapCenter: SITE };
    const real = { ...demoProject, id: NEW_ID } as Project;
    await act(async () => { render(<DesignStudio project={real} />); });
    await flush(500);

    const REPORTED = '2026-09-29T10:00:05.123Z';
    failNextLayoutPostWith = REPORTED;
    await act(async () => { engine.props.onPanelsChange?.(DESIGN.slice(0, 5)); });
    await flush();
    await act(async () => { engine.props.onPanelsChange?.(DESIGN.slice(0, 6)); });
    await flush();

    const posts = layoutPosts(NEW_ID);
    expect(posts.length).toBeGreaterThanOrEqual(2);
    expect(posts[posts.length - 1].body?.expectedUpdatedAt,
      'the studio kept the stale token after a failed save').toBe(REPORTED);
  });
});
