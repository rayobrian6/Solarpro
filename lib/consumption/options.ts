/**
 * lib/consumption/options.ts
 *
 * Seed option lists for the Consumption Profile form dropdowns.
 * Mirrors Aurora's provider/rate/location dropdowns but ships as a
 * static JSON-style list (no backend round-trip). When the platform
 * gets a real `/api/consumption/options` endpoint, this file becomes
 * a client-side cache or is removed entirely.
 *
 * PURE DATA — no React, no fetch, no fs. Safe to import from the
 * client component, the server route, AND the test file.
 */

import type {
  UtilityProvider,
  UtilityRate,
  RateEffectivePeriod,
  ConsumptionLocation,
} from './types';

export const UTILITY_PROVIDERS: UtilityProvider[] = [
  { id: 'sdge', name: 'San Diego Gas & Electric Co.', state: 'CA', residential: true,  commercial: true  },
  { id: 'pge',  name: 'Pacific Gas & Electric Co.',  state: 'CA', residential: true,  commercial: true  },
  { id: 'sce',  name: 'Southern California Edison',  state: 'CA', residential: true,  commercial: true  },
  { id: 'ladwp',name: 'Los Angeles Dept. of Water & Power', state: 'CA', residential: true, commercial: true },
  { id: 'smud', name: 'Sacramento Municipal Utility District', state: 'CA', residential: true, commercial: true },
  { id: 'coned',name: 'Consolidated Edison',         state: 'NY', residential: true,  commercial: true  },
  { id: 'comed',name: 'Commonwealth Edison',         state: 'IL', residential: true,  commercial: true  },
  { id: 'duke', name: 'Duke Energy',                 state: 'NC', residential: true,  commercial: true  },
];

/**
 * Tariff codes per provider. Codes are real where I knew them offhand
 * (SDG&E DR, PG&E E-1, ConEd B-19) and reasonable analogues otherwise.
 * This is a stub — replace with a real tariff DB when the backend
 * service comes online.
 */
export const UTILITY_RATES: UtilityRate[] = [
  // SDG&E
  { id: 'sdge-dr',  providerId: 'sdge', code: 'DR',  label: 'DR - Coastal Baseline Region',     residential: true,  commercial: false },
  { id: 'sdge-e1',  providerId: 'sdge', code: 'E-1', label: 'E-1 Residential',                  residential: true,  commercial: false },
  { id: 'sdge-alti',providerId: 'sdge', code: 'AL-TI',label: 'AL-TII Commercial Time-of-Use',    residential: false, commercial: true  },

  // PG&E
  { id: 'pge-e1',   providerId: 'pge',  code: 'E-1',     label: 'E-1 Residential',                 residential: true,  commercial: false },
  { id: 'pge-etouc',providerId: 'pge',  code: 'E-TOU-C', label: 'E-TOU-C Time-of-Use',              residential: true,  commercial: false },
  { id: 'pge-b19',  providerId: 'pge',  code: 'B-19',    label: 'B-19 Medium General Demand',      residential: false, commercial: true  },

  // SCE
  { id: 'sce-d',    providerId: 'sce',  code: 'D',     label: 'D Residential',                    residential: true,  commercial: false },
  { id: 'sce-tou8', providerId: 'sce',  code: 'TOU-8', label: 'TOU-8 Residential Time-of-Use',    residential: true,  commercial: false },
  { id: 'sce-tou9', providerId: 'sce',  code: 'TOU-9', label: 'TOU-9 General Service',            residential: false, commercial: true  },

  // LADWP
  { id: 'ladwp-r1', providerId: 'ladwp',code: 'R-1',   label: 'R-1 Residential',                  residential: true,  commercial: false },
  { id: 'ladwp-a1', providerId: 'ladwp',code: 'A-1',   label: 'A-1 Small Commercial',             residential: false, commercial: true  },

  // SMUD
  { id: 'smud-rs1', providerId: 'smud', code: 'RS-1',  label: 'RS-1 Residential Standard',        residential: true,  commercial: false },
  { id: 'smud-gs2', providerId: 'smud', code: 'GS-2',  label: 'GS-2 General Service',             residential: false, commercial: true  },

  // ConEd
  { id: 'coned-sc1',providerId: 'coned',code: 'SC-1',  label: 'SC-1 Residential',                 residential: true,  commercial: false },
  { id: 'coned-b19',providerId: 'coned',code: 'B-19',  label: 'B-19 Commercial / Industrial',     residential: false, commercial: true  },

  // ComEd
  { id: 'comed-bes',providerId: 'comed',code: 'BES',   label: 'BES Residential Basic Electric',   residential: true,  commercial: false },
  { id: 'comed-bch',providerId: 'comed',code: 'BCH',   label: 'BCH Commercial Hourly Pricing',    residential: false, commercial: true  },

  // Duke
  { id: 'duke-rs',  providerId: 'duke', code: 'RS',    label: 'RS Residential Service',           residential: true,  commercial: false },
  { id: 'duke-sgs', providerId: 'duke', code: 'SGS',   label: 'SGS Small General Service',        residential: false, commercial: true  },
];

/**
 * Every rate has a single current "effective period" matching Aurora's
 * default `01 Jan 2017 – Present` display. Multi-period support is a
 * trivial extension (add a second row with effectiveTo set).
 */
export const RATE_EFFECTIVE_PERIODS: RateEffectivePeriod[] = UTILITY_RATES.map(
  (rate): RateEffectivePeriod => ({
    id: `${rate.id}-2017-present`,
    rateId: rate.id,
    effectiveFrom: '2017-01-01',
    effectiveTo: null,
    label: '01 Jan 2017 – Present',
  }),
);

/**
 * California NREL TMY3 weather stations. These are the locations the
 * user can pick to "represent the project's consumption profile" —
 * matching Aurora's location dropdown contents.
 */
export const CONSUMPTION_LOCATIONS: ConsumptionLocation[] = [
  { id: 'san-diego-miramar-nas', name: 'SAN DIEGO MIRAMAR NAS',  state: 'CA', lat: 32.8683, lng: -117.1433, tmyStation: '722902' },
  { id: 'san-francisco-intl',   name: 'SAN FRANCISCO INTL AP',   state: 'CA', lat: 37.6213, lng: -122.3790, tmyStation: '724940' },
  { id: 'los-angeles-intl',     name: 'LOS ANGELES INTL AP',     state: 'CA', lat: 33.9425, lng: -118.4081, tmyStation: '722950' },
  { id: 'sacramento-exec',      name: 'SACRAMENTO EXEC AP',      state: 'CA', lat: 38.5069, lng: -121.4950, tmyStation: '724830' },
  { id: 'fresno-yosemite-intl', name: 'FRESNO YOSEMITE INTL AP', state: 'CA', lat: 36.7801, lng: -119.7180, tmyStation: '723890' },
  { id: 'san-jose-intl',        name: 'SAN JOSE INTL AP',        state: 'CA', lat: 37.3639, lng: -121.9289, tmyStation: '724940' },
];

/* ────────────────────────────────────────────────────────────────────
 * Lookup helpers — pure functions, no React.
 * ──────────────────────────────────────────────────────────────────── */

export function getProvider(id: string): UtilityProvider | undefined {
  return UTILITY_PROVIDERS.find((p) => p.id === id);
}

export function getRate(id: string): UtilityRate | undefined {
  return UTILITY_RATES.find((r) => r.id === id);
}

export function getRatePeriod(id: string): RateEffectivePeriod | undefined {
  return RATE_EFFECTIVE_PERIODS.find((p) => p.id === id);
}

export function getLocation(id: string): ConsumptionLocation | undefined {
  return CONSUMPTION_LOCATIONS.find((l) => l.id === id);
}

/**
 * Rates filtered by the selected provider AND profile type. This is
 * what the UI binds to the rate `<select>`.
 */
export function ratesForProviderAndType(
  providerId: string,
  profileType: 'residential' | 'commercial',
): UtilityRate[] {
  return UTILITY_RATES.filter(
    (r) => r.providerId === providerId && r[profileType],
  );
}

/**
 * Periods filtered by the selected rate id.
 */
export function periodsForRate(rateId: string): RateEffectivePeriod[] {
  return RATE_EFFECTIVE_PERIODS.filter((p) => p.rateId === rateId);
}
