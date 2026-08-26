/**
 * CreateDesignModal — pure-logic unit tests.
 * See components/3d/designs/DESIGN.md for the spec.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  appendDesign,
  COST_MAX,
  COST_MIN,
  DEFAULT_COST_PER_WATT,
  listDesignsForProject,
  NAME_MAX_LEN,
  readDesigns,
  suggestDesignName,
  validateDesignDraft,
  writeDesigns,
  __resetDesignsForTesting,
  type Design,
} from '@/components/3d/designs';

// ── In-memory localStorage shim (node env, matches tests/consumption.test.ts) ──
interface MemStore {
  data: Record<string, string>;
}

function installLocalStorageShim(store: MemStore = { data: {} }) {
  const ls = {
    getItem: (key: string) => (key in store.data ? store.data[key] : null),
    setItem: (key: string, value: string) => {
      store.data[key] = value;
    },
    removeItem: (key: string) => {
      delete store.data[key];
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = { localStorage: ls };
  return store;
}

function uninstallLocalStorageShim() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).window;
}

beforeEach(() => {
  installLocalStorageShim();
  __resetDesignsForTesting();
});

afterEach(() => {
  uninstallLocalStorageShim();
  __resetDesignsForTesting();
});

describe('validateDesignDraft', () => {
  it('accepts a valid draft', () => {
    expect(validateDesignDraft({ name: 'Design 1', costPerWatt: 4 })).toEqual({ ok: true });
  });

  it('rejects an empty / whitespace name', () => {
    expect(validateDesignDraft({ name: '', costPerWatt: 4 }).ok).toBe(false);
    expect(validateDesignDraft({ name: '   ', costPerWatt: 4 }).ok).toBe(false);
    expect(validateDesignDraft({ name: '', costPerWatt: 4 }).name).toMatch(/required/i);
  });

  it('rejects an over-long name', () => {
    const longName = 'a'.repeat(NAME_MAX_LEN + 1);
    const v = validateDesignDraft({ name: longName, costPerWatt: 4 });
    expect(v.ok).toBe(false);
    expect(v.name).toMatch(/characters or fewer/i);
  });

  it('rejects a non-finite cost', () => {
    const v = validateDesignDraft({ name: 'Design 1', costPerWatt: NaN });
    expect(v.ok).toBe(false);
    expect(v.costPerWatt).toMatch(/number/i);
  });

  it('rejects zero / negative cost', () => {
    expect(validateDesignDraft({ name: 'Design 1', costPerWatt: 0 }).ok).toBe(false);
    expect(validateDesignDraft({ name: 'Design 1', costPerWatt: -1 }).ok).toBe(false);
    const v = validateDesignDraft({ name: 'Design 1', costPerWatt: 0 });
    expect(v.costPerWatt).toMatch(/greater than 0/i);
  });

  it('rejects cost above COST_MAX', () => {
    const v = validateDesignDraft({ name: 'Design 1', costPerWatt: COST_MAX + 1 });
    expect(v.ok).toBe(false);
    expect(v.costPerWatt).toMatch(/or less/i);
  });

  it('accepts the boundary costs COST_MIN and COST_MAX', () => {
    expect(validateDesignDraft({ name: 'Design 1', costPerWatt: COST_MIN }).ok).toBe(true);
    expect(validateDesignDraft({ name: 'Design 1', costPerWatt: COST_MAX }).ok).toBe(true);
  });
});

describe('suggestDesignName', () => {
  it('returns "Design 1" for an empty list', () => {
    expect(suggestDesignName([])).toBe('Design 1');
  });

  it('returns "Design N+1" for N existing', () => {
    expect(suggestDesignName(['Design 1'])).toBe('Design 2');
    expect(suggestDesignName(['Design 1', 'Design 2', 'Design 3'])).toBe('Design 4');
  });

  it('skips gaps in numeric suffixes', () => {
    expect(suggestDesignName(['Design 1', 'Design 2', 'Design 4'])).toBe('Design 5');
  });

  it('ignores names without the numeric suffix', () => {
    expect(suggestDesignName(['My Roof', 'Side Panels'])).toBe('Design 1');
    expect(suggestDesignName(['My Roof', 'Design 1', 'Side Panels'])).toBe('Design 2');
  });

  it('handles non-array input defensively', () => {
    expect(suggestDesignName(undefined as unknown as string[])).toBe('Design 1');
    expect(suggestDesignName(null as unknown as string[])).toBe('Design 1');
  });
});

describe('storage helpers', () => {
  const sampleDesign = (overrides: Partial<Design> = {}): Design => ({
    id: 'd-1',
    projectId: 'p-1',
    name: 'Design 1',
    costPerWatt: 4,
    createdAt: '2026-08-26T00:00:00.000Z',
    active: true,
    ...overrides,
  });

  it('DEFAULT_COST_PER_WATT is 4 (matches Aurora frame 145)', () => {
    expect(DEFAULT_COST_PER_WATT).toBe(4);
  });

  it('appendDesign persists to localStorage and returns the new list', () => {
    const d1 = sampleDesign({ id: 'd-1', name: 'Design 1' });
    const d2 = sampleDesign({ id: 'd-2', name: 'Design 2' });
    const result = appendDesign(d1);
    expect(result).toEqual([d1]);
    const result2 = appendDesign(d2);
    expect(result2).toEqual([d1, d2]);
    expect(readDesigns()).toEqual([d1, d2]);
  });

  it('writeDesigns replaces the full list', () => {
    writeDesigns([sampleDesign({ id: 'x' })]);
    expect(readDesigns()).toHaveLength(1);
    writeDesigns([]);
    expect(readDesigns()).toHaveLength(0);
  });

  it('listDesignsForProject filters by projectId', () => {
    appendDesign(sampleDesign({ id: '1', projectId: 'p-a' }));
    appendDesign(sampleDesign({ id: '2', projectId: 'p-b' }));
    appendDesign(sampleDesign({ id: '3', projectId: 'p-a' }));
    expect(listDesignsForProject('p-a').map((d) => d.id)).toEqual(['1', '3']);
    expect(listDesignsForProject('p-b').map((d) => d.id)).toEqual(['2']);
    expect(listDesignsForProject('p-missing')).toEqual([]);
  });

  it('readDesigns returns [] on a corrupted store', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = (globalThis as any).window;
    w.localStorage.setItem('solarpro.designs.v1', 'not json');
    expect(readDesigns()).toEqual([]);
  });

  it('readDesigns returns [] when the store is not an array', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = (globalThis as any).window;
    w.localStorage.setItem('solarpro.designs.v1', JSON.stringify({ not: 'array' }));
    expect(readDesigns()).toEqual([]);
  });
});
