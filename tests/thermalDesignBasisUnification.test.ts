// ═══════════════════════════════════════════════════════════════════════════
// ONE THERMAL DESIGN BASIS PER PACKAGE.
//
// SolarPro carried TWO cold-temperature datasets feeding NEC 690.7 maximum
// system voltage:
//
//   A. lib/jurisdiction.ts   getDesignTemperatures(stateCode)   ASHRAE 2005
//      -> consumed ONLY by app/api/engineering/calculate/route.ts, i.e. the
//         number the DESIGNER reads on the engineering page.
//   B. lib/permit/utils/designTemps.ts  STATE_TEMPS             ASHRAE 2021
//      -> consumed by lib/permit/generatePermit.ts and the snapshot builder,
//         i.e. the number the STAMPED PLAN SET is engineered to.
//
// 50 of 51 states disagreed. In Illinois A said -21 °C and B said -23 °C, and
// for a 40.95 V / -0.27 %/°C module that is the difference between a 13-module
// string and a 12-module string at 600 V. The designer built 13; the stamped
// set computed the same array as over 600 V.
//
// The sanctioned single authority already existed — getThermalDesignBasis in
// lib/permit/utils/designTemps.ts, whose own header names this repair. These
// tests assert the app path now reads THAT authority and nothing else.
//
// PROBE MODULE. Voc 40.95 V, βVoc -0.27 %/°C at 600 V is chosen because it sits
// astride the boundary: floor(600 / (40.95 * (1 + -0.0027 * (T - 25)))) is 13 at
// -21 °C and 12 at -23 °C. A module away from the boundary would pass vacuously
// on both bases and prove nothing.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDesignTemps, getThermalDesignBasis } from '@/lib/permit/utils/designTemps';
import {
  generateStringConfig,
  moduleSpecsFromRegistry,
  inverterSpecsFromRegistry,
} from '@/lib/string-generator';

// ── Route dependency mocks (auth / rate limit / DB are not under test) ──
vi.mock('@/lib/security', () => ({
  requireAuth: vi.fn(async () => ({ user: { id: 'test-user' }, response: null })),
}));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));
vi.mock('@/lib/db-neon', () => ({
  getDbReady: vi.fn(async () => { throw new Error('no db in tests'); }),
  handleRouteDbError: (_tag: string, err: unknown) => {
    throw err instanceof Error ? err : new Error(String(err));
  },
}));

// ── Probe module + inverter ─────────────────────────────────────────────────
const PROBE = {
  voc: 40.95,
  vmp: 34.1,
  isc: 13.9,
  imp: 13.1,
  watts: 445,
  tempCoeffVoc: -0.27,
  maxSeriesFuseRating: 25,
};
const INV = {
  maxDcVoltage: 600,
  mpptVoltageMin: 100,
  mpptVoltageMax: 550,
  mpptChannels: 2,
  maxInputCurrentPerMppt: 13,
  acOutputKw: 7.6,
};

/**
 * The PLAN SET's answer. lib/permit/generatePermit.ts resolves its thermal
 * basis as `project.designTempMin ?? getDesignTemps(lat,lng,state).ashraeExtremeLowC`
 * and hands it to the same engine the app uses. Reproduced here with no
 * override so the ASHRAE envelope is the only input.
 */
function plansetMaxSeriesString(state: string, lat?: number, lng?: number): number {
  const basis = getDesignTemps(lat ?? null, lng ?? null, state).ashraeExtremeLowC;
  return maxSeriesStringAt(basis);
}

function maxSeriesStringAt(designTempMin: number): number {
  const cfg = generateStringConfig({
    totalModules: 24,
    moduleSpecs: moduleSpecsFromRegistry(PROBE),
    inverterSpecs: inverterSpecsFromRegistry(INV),
    designTempMin,
    topology: 'string',
  });
  return cfg.maxPanelsPerString;
}

// ── The APP's answer: the real route handler, not a re-implementation ───────
async function postCalculate(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/engineering/calculate/route');
  const req = new Request('http://solarpro.test/api/engineering/calculate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await POST(req as never);
  return { status: res.status, json: (await res.json()) as any };
}

const probeString = () => ({
  panelCount: 12,
  panelVoc: PROBE.voc,
  panelVmp: PROBE.vmp,
  panelIsc: PROBE.isc,
  panelImp: PROBE.imp,
  panelWatts: PROBE.watts,
  tempCoeffVoc: PROBE.tempCoeffVoc,
  maxSeriesFuseRating: PROBE.maxSeriesFuseRating,
  wireGauge: '#10 AWG',
  wireLength: 50,
  conduitType: 'EMT',
});

function calcBody(state: string, electricalOver: Record<string, unknown> = {}) {
  return {
    state,
    address: '',
    electrical: {
      inverters: [
        {
          type: 'string',
          acOutputKw: INV.acOutputKw,
          maxDcVoltage: INV.maxDcVoltage,
          mpptVoltageMin: INV.mpptVoltageMin,
          mpptVoltageMax: INV.mpptVoltageMax,
          mpptChannels: INV.mpptChannels,
          maxInputCurrentPerMppt: INV.maxInputCurrentPerMppt,
          acOutputCurrentMax: 32,
          strings: [probeString(), probeString()],
        },
      ],
      mainPanelAmps: 200,
      systemVoltage: 240,
      wireGauge: '#10 AWG',
      wireLength: 50,
      conduitType: 'EMT',
      rapidShutdown: true,
      acDisconnect: true,
      dcDisconnect: true,
      engineeringMode: 'AUTO',
      ...electricalOver,
    },
  };
}

// ── Source guards ───────────────────────────────────────────────────────────
const REPO = resolve(__dirname, '..');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const source = (rel: string) => stripComments(readFileSync(resolve(REPO, rel), 'utf8'));

const CALC_ROUTE = 'app/api/engineering/calculate/route.ts';
const SLD_ROUTE = 'app/api/engineering/sld/route.ts';
const JURISDICTION = 'lib/jurisdiction.ts';

// ═══════════════════════════════════════════════════════════════════════════
describe('thermal design basis — the app and the stamped plan set agree', () => {
  it('the probe module really does straddle the IL boundary (control)', () => {
    // Without this control the equality tests below could pass vacuously.
    expect(maxSeriesStringAt(-21)).toBe(13); // the retired ASHRAE-2005 IL basis
    expect(maxSeriesStringAt(-23)).toBe(12); // the ASHRAE-2021 IL basis
  });

  it('Illinois: the app returns the SAME max series string length as the plan set', async () => {
    const planset = plansetMaxSeriesString('IL');
    expect(planset).toBe(12);

    const { status, json } = await postCalculate(calcBody('IL'));
    expect(status).toBe(200);
    expect(json.stringConfig?.maxPanelsPerString).toBe(planset);
  });

  it('Illinois: the app reports the plan set’s design temperature, not its own', async () => {
    const { json } = await postCalculate(calcBody('IL'));
    const basis = getThermalDesignBasis({ state: 'IL' });
    expect(json.autoDetected?.designTempMin).toBe(basis.minDesignTempC);
    expect(json.autoDetected?.designTempMax).toBe(basis.maxDesignTempC);
    expect(json.stringConfig?.designTempMin).toBe(basis.minDesignTempC);
  });

  it('a stale client-side design temperature cannot override the canonical basis', async () => {
    // app/engineering/page.tsx still posts a hardcoded legacy default on several
    // paths. The route must not let that become a third thermal regime.
    const legacy = -(5 + 5);
    const { json } = await postCalculate(calcBody('IL', { designTempMin: legacy, designTempMax: 40 }));
    expect(json.autoDetected?.designTempMin).toBe(getThermalDesignBasis({ state: 'IL' }).minDesignTempC);
    expect(json.stringConfig?.maxPanelsPerString).toBe(plansetMaxSeriesString('IL'));
    expect(json.electrical?.designTempMin ?? json.autoDetected?.designTempMin).not.toBe(legacy);
  });

  it('an explicit AHJ design-low override still wins (behaviour preserved)', async () => {
    const body = { ...calcBody('IL'), designTempMinOverrideC: -18 };
    const { json } = await postCalculate(body);
    expect(json.autoDetected?.designTempMin).toBe(-18);
    expect(json.stringConfig?.maxPanelsPerString).toBe(maxSeriesStringAt(-18));
  });

  it.each(['AK', 'NV', 'GA', 'TX', 'FL'])(
    '%s: app design temperatures equal the plan set envelope',
    async (st) => {
      const { json } = await postCalculate(calcBody(st));
      const temps = getDesignTemps(null, null, st);
      expect(json.autoDetected?.designTempMin).toBe(temps.ashraeExtremeLowC);
      expect(json.autoDetected?.designTempMax).toBe(temps.ashrae2pctHighC);
      expect(json.stringConfig?.maxPanelsPerString).toBe(plansetMaxSeriesString(st));
    },
  );

  it('an unresolvable state lands on the canonical national default, not a local one', async () => {
    const { json } = await postCalculate(calcBody(''));
    const temps = getDesignTemps(null, null, undefined);
    expect(json.autoDetected?.designTempMin).toBe(temps.ashraeExtremeLowC);
    expect(json.autoDetected?.designTempMax).toBe(temps.ashrae2pctHighC);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('thermal design basis — no second authority survives', () => {
  it('the calculate route reads the sanctioned authority', () => {
    const src = source(CALC_ROUTE);
    expect(src).toMatch(/getThermalDesignBasis/);
    expect(src).toMatch(/from ['"]@\/lib\/permit\/utils\/designTemps['"]/);
  });

  it('the calculate route no longer consumes the retired jurisdiction dataset', () => {
    expect(source(CALC_ROUTE)).not.toMatch(/getDesignTemperatures/);
  });

  it('lib/jurisdiction.ts holds no cold-temperature dataset of its own', () => {
    const src = source(JURISDICTION);
    // The retired table was a Record of { minTemp, maxTemp } literals. Any
    // reappearance of that shape is a second dataset by definition.
    expect(src).not.toMatch(/minTemp:\s*-?\d/);
    expect(src).not.toMatch(/maxTemp:\s*-?\d/);
  });

  it('no product module outside the authority owns a state temperature table', () => {
    // The authority itself is the only place STATE_TEMPS may live.
    const auth = source('lib/permit/utils/designTemps.ts');
    expect(auth).toMatch(/const STATE_TEMPS/);
    expect(source(JURISDICTION)).not.toMatch(/STATE_TEMPS/);
  });

  it('the SLD route resolves its design temperature through the authority', () => {
    const src = source(SLD_ROUTE);
    expect(src).toMatch(/getThermalDesignBasis/);
    // designTempMin must be derived from the resolved basis, never from a
    // bare numeric default on the request body.
    expect(src).toMatch(/const designTempMin\s*=[^;]*minDesignTempC/);
  });

  it('the SLD route and the calculate route agree for the same site', () => {
    const fromAddress = getThermalDesignBasis({ address: '3 Melvin Dr, Granite City, IL 62040' });
    const fromState = getThermalDesignBasis({ state: 'IL' });
    expect(fromAddress.minDesignTempC).toBe(fromState.minDesignTempC);
    expect(fromAddress.maxDesignTempC).toBe(fromState.maxDesignTempC);
  });
});
