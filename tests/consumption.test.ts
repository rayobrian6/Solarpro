/**
 * tests/consumption.test.ts
 *
 * Unit tests for the Consumption Profile feature. Hits the pure
 * modules in lib/consumption/* — no React, no fetch, no DOM.
 *
 * Coverage:
 *   - defaultConsumptionForm() shape
 *   - validateConsumptionProfile() — all 8 rules from DESIGN.md §4
 *   - sumAnnualKwh() — happy path + bad inputs
 *   - options.ts lookups + filter helpers
 *   - storage.ts — SSR-safe (no localStorage in node) + parses JSON
 *     via a stubbed window
 *
 * Run: `npx vitest run tests/consumption.test.ts`
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  validateConsumptionProfile,
  sumAnnualKwh,
  defaultConsumptionForm,
  MONTHS_IN_YEAR,
  MIN_ANNUAL_KWH,
  MAX_ANNUAL_KWH,
} from '@/lib/consumption/validation';
import {
  UTILITY_PROVIDERS,
  UTILITY_RATES,
  RATE_EFFECTIVE_PERIODS,
  CONSUMPTION_LOCATIONS,
  getProvider,
  getRate,
  getRatePeriod,
  getLocation,
  ratesForProviderAndType,
  periodsForRate,
} from '@/lib/consumption/options';
import {
  STORAGE_KEY,
  loadSavedProfile,
  saveProfile,
  clearSavedProfile,
} from '@/lib/consumption/storage';
import type { ConsumptionProfileForm, ConsumptionProfileResult } from '@/lib/consumption/types';

/* ────────────────────────────────────────────────────────────────────
 * Test fixtures
 * ──────────────────────────────────────────────────────────────────── */

function makeValidForm(overrides: Partial<ConsumptionProfileForm> = {}): ConsumptionProfileForm {
  return {
    profileType: 'residential',
    providerId: 'sdge',
    rateId: 'sdge-dr',
    ratePeriodId: 'sdge-dr-2017-present',
    locationId: 'san-diego-miramar-nas',
    source: 'none',
    ...overrides,
  };
}

/* ────────────────────────────────────────────────────────────────────
 * defaultConsumptionForm
 * ──────────────────────────────────────────────────────────────────── */

describe('defaultConsumptionForm', () => {
  it('returns the SDG&E / San Diego defaults that match the Aurora screenshot', () => {
    const def = defaultConsumptionForm();
    expect(def.profileType).toBe('residential');
    expect(def.providerId).toBe('sdge');
    expect(def.rateId).toBe('sdge-dr');
    expect(def.ratePeriodId).toBe('sdge-dr-2017-present');
    expect(def.locationId).toBe('san-diego-miramar-nas');
    expect(def.source).toBe('none');
  });
});

/* ────────────────────────────────────────────────────────────────────
 * validateConsumptionProfile — happy path
 * ──────────────────────────────────────────────────────────────────── */

describe('validateConsumptionProfile — happy path', () => {
  it('accepts a fully-populated valid form', () => {
    const r = validateConsumptionProfile(makeValidForm());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.providerId).toBe('sdge');
      expect(r.data.rateId).toBe('sdge-dr');
      expect(r.data.locationId).toBe('san-diego-miramar-nas');
    }
  });

  it('accepts a commercial profile with a commercial rate', () => {
    const r = validateConsumptionProfile(
      makeValidForm({
        profileType: 'commercial',
        rateId: 'sdge-alti',
        ratePeriodId: 'sdge-alti-2017-present',
      }),
    );
    expect(r.ok).toBe(true);
  });

  it('accepts a form that includes monthly kWh data when source=electric-bill', () => {
    const r = validateConsumptionProfile(
      makeValidForm({
        source: 'electric-bill',
        monthlyKwh: [400, 380, 420, 450, 500, 600, 720, 700, 580, 460, 410, 420],
      }),
    );
    expect(r.ok).toBe(true);
  });

  it('accepts a form with annualKwh within bounds', () => {
    const r = validateConsumptionProfile(
      makeValidForm({ source: 'none', annualKwh: 6500 }),
    );
    expect(r.ok).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────────────
 * validateConsumptionProfile — error rules
 * ──────────────────────────────────────────────────────────────────── */

describe('validateConsumptionProfile — error rules', () => {
  it('R1: rejects missing profileType', () => {
    const r = validateConsumptionProfile({ ...makeValidForm(), profileType: undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.profileType).toBeTruthy();
  });

  it('R1: rejects invalid profileType', () => {
    // Cast to bypass the type system — we want to test runtime defense.
    const r = validateConsumptionProfile({
      ...makeValidForm(),
      profileType: 'industrial' as unknown as 'residential',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.profileType).toMatch(/residential|commercial/);
  });

  it('R2: rejects unknown providerId', () => {
    const r = validateConsumptionProfile({ ...makeValidForm(), providerId: 'nope-utility' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.providerId).toBeTruthy();
  });

  it('R3: rejects rate that is not available for the selected profileType', () => {
    // sdge-alti is commercial-only — picking it with residential should fail
    const r = validateConsumptionProfile(
      makeValidForm({ profileType: 'residential', rateId: 'sdge-alti' }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.rateId).toMatch(/not available/);
  });

  it('R4: rejects rate that belongs to a different provider', () => {
    // pge-e1 belongs to PG&E, not SDG&E
    const r = validateConsumptionProfile(
      makeValidForm({ providerId: 'sdge', rateId: 'pge-e1' }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.rateId).toMatch(/does not belong/);
  });

  it('R5: rejects rate period that does not apply to the selected rate', () => {
    const r = validateConsumptionProfile(
      makeValidForm({ rateId: 'sdge-dr', ratePeriodId: 'pge-e1-2017-present' }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.ratePeriodId).toMatch(/not apply/);
  });

  it('R6: rejects unknown locationId', () => {
    const r = validateConsumptionProfile({ ...makeValidForm(), locationId: 'pluto' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.locationId).toBeTruthy();
  });

  it('R7: rejects missing monthlyKwh when source=electric-bill', () => {
    const r = validateConsumptionProfile(makeValidForm({ source: 'electric-bill' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.monthlyKwh).toMatch(/required/i);
  });

  it('R7: rejects monthlyKwh that is not 12 elements long', () => {
    const r = validateConsumptionProfile(
      makeValidForm({ source: 'green-button', monthlyKwh: [100, 200, 300] }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.monthlyKwh).toMatch(/12 months/);
  });

  it('R7: rejects monthlyKwh with a negative value', () => {
    const r = validateConsumptionProfile(
      makeValidForm({
        source: 'green-button',
        monthlyKwh: [100, -50, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.monthlyKwh).toBeTruthy();
  });

  it('R7: rejects monthlyKwh with a non-number value', () => {
    const r = validateConsumptionProfile(
      makeValidForm({
        source: 'green-button',
        // cast through unknown to inject a bad value
        monthlyKwh: [100, 'oops' as unknown as number, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.monthlyKwh).toBeTruthy();
  });

  it('R8: rejects annualKwh below the minimum', () => {
    const r = validateConsumptionProfile(makeValidForm({ annualKwh: MIN_ANNUAL_KWH - 1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.annualKwh).toBeTruthy();
  });

  it('R8: rejects annualKwh above the maximum', () => {
    const r = validateConsumptionProfile(makeValidForm({ annualKwh: MAX_ANNUAL_KWH + 1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.annualKwh).toBeTruthy();
  });

  it('reports multiple errors at once', () => {
    const r = validateConsumptionProfile({
      profileType: 'residential',
      providerId: 'sdge',
      // missing rateId, ratePeriodId, locationId
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.rateId).toBeTruthy();
      expect(r.errors.ratePeriodId).toBeTruthy();
      expect(r.errors.locationId).toBeTruthy();
    }
  });
});

/* ────────────────────────────────────────────────────────────────────
 * sumAnnualKwh
 * ──────────────────────────────────────────────────────────────────── */

describe('sumAnnualKwh', () => {
  it('returns the sum of 12 monthly values', () => {
    const arr = Array(MONTHS_IN_YEAR).fill(500) as number[];
    expect(sumAnnualKwh(arr)).toBe(500 * MONTHS_IN_YEAR);
  });

  it('returns undefined for a non-array', () => {
    expect(sumAnnualKwh(undefined)).toBeUndefined();
  });

  it('returns undefined for an array of the wrong length', () => {
    expect(sumAnnualKwh([100, 200, 300])).toBeUndefined();
  });

  it('returns undefined if any value is non-finite', () => {
    const arr = Array(MONTHS_IN_YEAR).fill(100) as number[];
    arr[3] = Number.NaN;
    expect(sumAnnualKwh(arr)).toBeUndefined();
  });
});

/* ────────────────────────────────────────────────────────────────────
 * options.ts — shape, lookups, filters
 * ──────────────────────────────────────────────────────────────────── */

describe('options — provider list', () => {
  it('has at least 4 providers', () => {
    expect(UTILITY_PROVIDERS.length).toBeGreaterThanOrEqual(4);
  });

  it('every provider has a non-empty id and name', () => {
    for (const p of UTILITY_PROVIDERS) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
    }
  });

  it('provider ids are unique', () => {
    const ids = UTILITY_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('SDG&E is present (matches the Aurora screenshot)', () => {
    expect(getProvider('sdge')).toBeDefined();
    expect(getProvider('sdge')?.name).toMatch(/San Diego/i);
  });
});

describe('options — rate list', () => {
  it('every rate references a real provider', () => {
    for (const r of UTILITY_RATES) {
      expect(getProvider(r.providerId), `rate ${r.id} provider ${r.providerId}`).toBeDefined();
    }
  });

  it('every provider has at least one rate', () => {
    for (const p of UTILITY_PROVIDERS) {
      const rates = UTILITY_RATES.filter((r) => r.providerId === p.id);
      expect(rates.length, `provider ${p.id} has no rates`).toBeGreaterThan(0);
    }
  });

  it('ratesForProviderAndType returns only matching rates', () => {
    const resi = ratesForProviderAndType('sdge', 'residential');
    expect(resi.length).toBeGreaterThan(0);
    for (const r of resi) {
      expect(r.providerId).toBe('sdge');
      expect(r.residential).toBe(true);
    }
    const comm = ratesForProviderAndType('sdge', 'commercial');
    expect(comm.length).toBeGreaterThan(0);
    for (const r of comm) {
      expect(r.providerId).toBe('sdge');
      expect(r.commercial).toBe(true);
    }
    // no overlap (residential-only rates should not appear in commercial)
    expect(resi.some((r) => r.id === 'sdge-alti')).toBe(false);
    expect(comm.some((r) => r.id === 'sdge-alti')).toBe(true);
  });
});

describe('options — rate effective periods', () => {
  it('every period references a real rate', () => {
    for (const p of RATE_EFFECTIVE_PERIODS) {
      expect(getRate(p.rateId), `period ${p.id} rate ${p.rateId}`).toBeDefined();
    }
  });

  it('periodsForRate returns only periods for the given rate', () => {
    const ps = periodsForRate('sdge-dr');
    expect(ps.length).toBeGreaterThan(0);
    for (const p of ps) {
      expect(p.rateId).toBe('sdge-dr');
    }
  });

  it('every period has a label that includes the effective range', () => {
    for (const p of RATE_EFFECTIVE_PERIODS) {
      expect(p.label).toMatch(/\d{2} \w{3} \d{4}/);
    }
  });
});

describe('options — locations', () => {
  it('has at least 3 California locations', () => {
    expect(CONSUMPTION_LOCATIONS.length).toBeGreaterThanOrEqual(3);
    for (const l of CONSUMPTION_LOCATIONS) {
      expect(l.state).toBe('CA');
      expect(l.lat).toBeGreaterThan(30);
      expect(l.lat).toBeLessThan(45);
      expect(l.lng).toBeLessThan(-110);
      expect(l.lng).toBeGreaterThan(-130);
    }
  });

  it('SAN DIEGO MIRAMAR NAS is present (matches Aurora screenshot)', () => {
    expect(getLocation('san-diego-miramar-nas')).toBeDefined();
    expect(getLocation('san-diego-miramar-nas')?.name).toBe('SAN DIEGO MIRAMAR NAS');
  });

  it('location ids are unique', () => {
    const ids = CONSUMPTION_LOCATIONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/* ────────────────────────────────────────────────────────────────────
 * storage — SSR-safe (node has no window.localStorage)
 * ──────────────────────────────────────────────────────────────────── */

describe('storage — SSR-safe (no window)', () => {
  it('loadSavedProfile returns null when window is undefined', () => {
    // vitest default env is node — no window — so the SSR path is hit.
    expect(typeof window).toBe('undefined');
    expect(loadSavedProfile()).toBeNull();
  });

  it('saveProfile returns false when window is undefined', () => {
    expect(saveProfile({
      id: 'x',
      profile: makeValidForm(),
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    })).toBe(false);
  });

  it('clearSavedProfile returns false when window is undefined', () => {
    expect(clearSavedProfile()).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────
 * storage — with a stubbed window.localStorage
 * ──────────────────────────────────────────────────────────────────── */

interface MemStore {
  data: Record<string, string>;
  failGet?: boolean;
  failSet?: boolean;
  failRemove?: boolean;
}

function installLocalStorageShim(store: MemStore = { data: {} }) {
  const ls = {
    getItem: (key: string) => {
      if (store.failGet) throw new Error('getItem failed');
      return key in store.data ? store.data[key] : null;
    },
    setItem: (key: string, value: string) => {
      if (store.failSet) throw new Error('setItem failed');
      store.data[key] = value;
    },
    removeItem: (key: string) => {
      if (store.failRemove) throw new Error('removeItem failed');
      delete store.data[key];
    },
  };
  // eslint-disable-next-line
  (globalThis as { window?: unknown }).window = { localStorage: ls };
  return store;
}

function uninstallLocalStorageShim() {
  // eslint-disable-next-line
  delete (globalThis as { window?: unknown }).window;
}

describe('storage — with stubbed localStorage', () => {
  let store: MemStore;
  beforeEach(() => {
    store = installLocalStorageShim({ data: {} });
  });
  afterEach(() => {
    uninstallLocalStorageShim();
  });

  it('round-trips a saved profile through localStorage', () => {
    const result: ConsumptionProfileResult = {
      id: 'test-1',
      profile: makeValidForm(),
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    expect(saveProfile(result)).toBe(true);
    expect(store.data[STORAGE_KEY]).toBeDefined();
    expect(loadSavedProfile()).toEqual(result);
  });

  it('returns null when nothing is saved', () => {
    expect(loadSavedProfile()).toBeNull();
  });

  it('returns null when the stored JSON is malformed', () => {
    store.data[STORAGE_KEY] = '{not-json';
    expect(loadSavedProfile()).toBeNull();
  });

  it('returns null when the stored shape is wrong (no id)', () => {
    store.data[STORAGE_KEY] = JSON.stringify({ profile: {}, createdAt: 'x', updatedAt: 'y' });
    expect(loadSavedProfile()).toBeNull();
  });

  it('returns null when the stored shape is wrong (no profile)', () => {
    store.data[STORAGE_KEY] = JSON.stringify({ id: 'x', createdAt: 'x', updatedAt: 'y' });
    expect(loadSavedProfile()).toBeNull();
  });

  it('clearSavedProfile removes the key', () => {
    saveProfile({
      id: 'x',
      profile: makeValidForm(),
      createdAt: 't',
      updatedAt: 't',
    });
    expect(store.data[STORAGE_KEY]).toBeDefined();
    expect(clearSavedProfile()).toBe(true);
    expect(store.data[STORAGE_KEY]).toBeUndefined();
    expect(loadSavedProfile()).toBeNull();
  });

  it('swallows save errors and returns false (e.g. quota exceeded)', () => {
    uninstallLocalStorageShim();
    installLocalStorageShim({ data: {}, failSet: true });
    expect(saveProfile({
      id: 'x',
      profile: makeValidForm(),
      createdAt: 't',
      updatedAt: 't',
    })).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────
 * storage — STORAGE_KEY contract
 * ──────────────────────────────────────────────────────────────────── */

describe('storage — STORAGE_KEY', () => {
  it('starts with solarpro:', () => {
    expect(STORAGE_KEY.startsWith('solarpro:')).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────────────
 * Sanity: type imports
 * ──────────────────────────────────────────────────────────────────── */

describe('type-only sanity check', () => {
  it('can construct a ConsumptionProfileResult with a typed profile', () => {
    const r: ConsumptionProfileResult = {
      id: 't',
      profile: makeValidForm(),
      createdAt: 't',
      updatedAt: 't',
    };
    expect(r.profile.profileType).toBe('residential');
  });
});

// Mark vi as "used" so the import isn't elided by ts-isolated-modules
void vi;
