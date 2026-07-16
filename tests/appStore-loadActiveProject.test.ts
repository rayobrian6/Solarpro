/** @vitest-environment node */
/**
 * Regression: appStore.loadActiveProject must return FRESH server data on load,
 * not a stale in-memory / localStorage cache. Reproduces the bug where a panel
 * changed in Engineering never reached the Design Studio because the cached
 * project (with a layout) short-circuited the server fetch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ localProjects: [] as unknown[] }));

vi.mock('@/lib/clientStorage', () => ({
  localSaveClient: vi.fn(), localGetClients: () => [], localSetClients: vi.fn(),
  localSaveProject: vi.fn(), localGetProjects: () => h.localProjects, localSetProjects: vi.fn(),
  localDeleteClient: vi.fn(), localDeleteProject: vi.fn(),
}));

import { useAppStore } from '@/store/appStore';

const ID = '00000000-0000-0000-0000-0000000000cc';
const stale = { id: ID, selectedPanel: { id: 'old', model: 'OLD 600W' }, layout: {}, utilityRatePerKwh: 0.13 };
const fresh = { id: ID, selectedPanel: { id: 'new', model: 'NEW 440W' }, layout: {}, utilityRatePerKwh: 0.13 };

beforeEach(() => {
  h.localProjects = [];
  useAppStore.setState({ projects: [], activeProjectId: null });
  vi.restoreAllMocks();
});

describe('appStore.loadActiveProject — server wins over stale cache', () => {
  it('returns FRESH server data even when a stale project is already cached in the store', async () => {
    useAppStore.setState({ projects: [stale as never] });
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, data: fresh }) })) as never;

    const result = await useAppStore.getState().loadActiveProject(ID);

    expect(result?.selectedPanel?.model).toBe('NEW 440W');
    expect(global.fetch).toHaveBeenCalledWith(`/api/projects/${ID}`);
    // store is updated to the fresh copy
    expect(useAppStore.getState().projects.find(p => p.id === ID)?.selectedPanel?.model).toBe('NEW 440W');
  });

  it('falls back to the cached project when the server is UNREACHABLE (offline)', async () => {
    useAppStore.setState({ projects: [stale as never] });
    global.fetch = vi.fn(async () => { throw new Error('network down'); }) as never;

    const result = await useAppStore.getState().loadActiveProject(ID);
    expect(result?.selectedPanel?.model).toBe('OLD 600W'); // graceful offline fallback
  });

  it('falls back to localStorage when the server errors and the store is empty', async () => {
    h.localProjects = [stale];
    global.fetch = vi.fn(async () => ({ ok: false })) as never;

    const result = await useAppStore.getState().loadActiveProject(ID);
    expect(result?.id).toBe(ID);
  });
});
