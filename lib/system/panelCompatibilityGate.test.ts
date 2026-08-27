/**
 * v47.423 — Panel Compatibility Gate regression tests.
 *
 * Locks in the brand-agnostic gate behaviour: tiered classification,
 * margin threshold, suggestion ranking, and a sweep across every
 * currently-active brand in BRAND_PROFILES.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluatePanelBrandCompatibility,
  getBrandMinMpptCurrent,
  getBrandMinMicroMaxDcVoltage,
} from './panelCompatibilityGate';
import { SOLAR_PANELS } from '../equipment-db';
import { BRAND_PROFILES, getBrandProfile } from './brandProfiles';
import type { BrandProfile } from './brandProfiles';

// ─── Fixture helpers ───────────────────────────────────────────────────────

function qcells400() {
  const p = SOLAR_PANELS.find(x => x.id === 'qcells-peak-duo-400');
  if (!p) throw new Error('fixture missing: qcells-peak-duo-400');
  return p;
}
function evervolt410() {
  const p = SOLAR_PANELS.find(x => x.id === 'pan-evervolt-410');
  if (!p) throw new Error('fixture missing: pan-evervolt-410');
  return p;
}
function silfab430() {
  const p = SOLAR_PANELS.find(x => x.id === 'silfab-sil430');
  if (!p) throw new Error('fixture missing: silfab-sil430');
  return p;
}
function growatt() {
  const b = getBrandProfile('growatt');
  if (!b) throw new Error('fixture missing: growatt brand profile');
  return b;
}
function solArk() {
  const b = getBrandProfile('sol-ark');
  if (!b) throw new Error('fixture missing: sol-ark brand profile');
  return b;
}

// ═══════════════════════════════════════════════════════════════════════════
// getBrandMinMpptCurrent()
// ═══════════════════════════════════════════════════════════════════════════

describe('v47.423 — getBrandMinMpptCurrent()', () => {
  it('returns the minimum cap for Growatt (13.5 A across every MIN TL-XH-US SKU)', () => {
    const cap = getBrandMinMpptCurrent(growatt());
    expect(cap).toBe(13.5);
  });

  it('returns a positive cap for Sol-Ark', () => {
    const cap = getBrandMinMpptCurrent(solArk());
    expect(cap).not.toBeNull();
    expect(cap!).toBeGreaterThan(0);
  });

  it('returns null for null/undefined', () => {
    expect(getBrandMinMpptCurrent(null)).toBeNull();
    expect(getBrandMinMpptCurrent(undefined)).toBeNull();
  });

  it('returns null for a brand with no supported models', () => {
    const fake: BrandProfile = {
      ...growatt(),
      supportedInverterModels: [],
    };
    expect(getBrandMinMpptCurrent(fake)).toBeNull();
  });

  it('returns null when every equipmentDbId misses the registry', () => {
    const fake: BrandProfile = {
      ...growatt(),
      supportedInverterModels: [
        { equipmentDbId: 'nonexistent-inverter-xyz', acKw: 5, dcKwMax: 10, mpptCount: 2 },
      ],
    };
    expect(getBrandMinMpptCurrent(fake)).toBeNull();
  });

  it('is brand-agnostic — every active brand resolves to a finite cap or null (no crashes)', () => {
    for (const brand of BRAND_PROFILES) {
      const cap = getBrandMinMpptCurrent(brand);
      // Micro topology brands return null (models live in MICROINVERTERS,
      // not STRING_INVERTERS) — this is expected and handled by the
      // micro topology short-circuit in evaluatePanelBrandCompatibility().
      // String/optimizer/hybrid brands should resolve to a finite positive cap.
      if (cap !== null) {
        expect(cap).toBeGreaterThan(0);
        expect(Number.isFinite(cap)).toBe(true);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// evaluatePanelBrandCompatibility() — core classification
// ═══════════════════════════════════════════════════════════════════════════

describe('v47.423 — evaluatePanelBrandCompatibility() core classification', () => {
  // BRAIDON PDF AUDIT 2026-08-27 (N1) — the Isc moved 12.26 → 11.05 A because the equipment-db
  // record was carrying a generic copy-paste template rather than the Qcells datasheet
  // (ML-G10+ 395-415 Rev06, 400 W class: Isc 11.05 A). The CLASSIFICATION this test exists to
  // pin is unchanged — 11.05 × 1.25 = 13.81 A still exceeds Growatt's 13.5 A per-MPPT cap, so
  // the panel is still INCOMPATIBLE and the headroom is still negative. Only the arithmetic moved.
  it('flags Q.PEAK DUO 400W on Growatt as INCOMPATIBLE (11.05 × 1.25 = 13.81 A > 13.5 A)', () => {
    const r = evaluatePanelBrandCompatibility(qcells400(), growatt());
    expect(r.status).toBe('incompatible');
    expect(r.panel.designCurrent).toBeCloseTo(11.05 * 1.25, 1);
    expect(r.brand.effectiveMaxInputCurrentPerMppt).toBe(13.5);
    expect(r.headroomPct).toBeLessThan(0);
  });

  it('includes at least one suggestion when the panel is incompatible', () => {
    const r = evaluatePanelBrandCompatibility(qcells400(), growatt());
    expect(r.suggestions.length).toBeGreaterThan(0);
    const top = r.suggestions[0];
    expect(top.id).not.toBe('qcells-peak-duo-400');  // do not suggest the offender itself
    // Top suggestion's design current must fit within the cap
    expect(top.designCurrent).toBeLessThanOrEqual(13.5);
  });

  it('suggestion headroomPct is expressed as a PERCENT, not a fraction', () => {
    const r = evaluatePanelBrandCompatibility(qcells400(), growatt());
    // Any reasonable compatible panel should have at least a few percent headroom
    const top = r.suggestions[0];
    expect(top.headroomPct).toBeGreaterThanOrEqual(0);
    expect(top.headroomPct).toBeLessThanOrEqual(100);
  });

  it('flags EverVolt HK Black 410W on Growatt as MARGINAL (12.58 A design vs 13.5 A cap ≈ 6.85% headroom)', () => {
    const r = evaluatePanelBrandCompatibility(evervolt410(), growatt());
    expect(r.status).toBe('marginal');
    expect(r.headroomPct).toBeGreaterThan(0);
    expect(r.headroomPct).toBeLessThan(15);
  });

  it('flags Silfab SIL-430 on Growatt as INCOMPATIBLE (13.30 × 1.25 = 16.625 A > 13.5 A)', () => {
    const r = evaluatePanelBrandCompatibility(silfab430(), growatt());
    expect(r.status).toBe('incompatible');
    expect(r.suggestions.length).toBeGreaterThan(0);
  });

  it('flags Q.PEAK DUO 400W on Sol-Ark as COMPATIBLE or MARGINAL (never incompatible — Sol-Ark has more headroom)', () => {
    const r = evaluatePanelBrandCompatibility(qcells400(), solArk());
    expect(r.status).not.toBe('incompatible');
    expect(r.status).not.toBe('unknown');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Marginal-threshold boundary tests
// ═══════════════════════════════════════════════════════════════════════════

describe('v47.423 — marginal threshold boundary', () => {
  it('respects a custom marginalThreshold override (20%)', () => {
    // EverVolt on Growatt: ~4.1% headroom (datasheet-corrected Isc 10.35A). With default 15% it's marginal.
    // Crank threshold down to 3% and it should flip to compatible.
    const r = evaluatePanelBrandCompatibility(
      evervolt410(),
      growatt(),
      { marginalThreshold: 0.03 },
    );
    expect(r.status).toBe('compatible');
  });

  it('classifies just-below-threshold as marginal (default 15%)', () => {
    // Forged panel: Isc = 10.0 A → design = 12.5 A → headroom on 13.5 cap = 7.4%
    const forged = { ...evervolt410(), id: 'forged-boundary-panel', isc: 10.0 };
    const r = evaluatePanelBrandCompatibility(forged, growatt());
    expect(r.status).toBe('marginal');
  });

  it('classifies clearly over-cap as incompatible even if barely so', () => {
    // Isc = 10.9 A → design = 13.625 A → just over 13.5 A
    const forged = { ...evervolt410(), id: 'forged-over-cap', isc: 10.9 };
    const r = evaluatePanelBrandCompatibility(forged, growatt());
    expect(r.status).toBe('incompatible');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Unknown / fail-open behaviour
// ═══════════════════════════════════════════════════════════════════════════

describe('v47.423 — unknown status (fail-open)', () => {
  it('returns status=unknown when panel is null', () => {
    const r = evaluatePanelBrandCompatibility(null, growatt());
    expect(r.status).toBe('unknown');
    expect(r.suggestions).toEqual([]);
  });

  it('returns status=unknown when brand is null', () => {
    const r = evaluatePanelBrandCompatibility(qcells400(), null);
    expect(r.status).toBe('unknown');
    expect(r.suggestions).toEqual([]);
  });

  it('returns status=unknown when the brand has no resolvable models', () => {
    const fake: BrandProfile = {
      ...growatt(),
      supportedInverterModels: [
        { equipmentDbId: 'missing-from-registry', acKw: 5, dcKwMax: 10, mpptCount: 2 },
      ],
    };
    const r = evaluatePanelBrandCompatibility(qcells400(), fake);
    expect(r.status).toBe('unknown');
    expect(r.brand.effectiveMaxInputCurrentPerMppt).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Micro topology — Enphase, APsystems, Hoymiles
// v47.431: no longer an unconditional 'compatible' short-circuit — module
// cold-corrected Voc is gated against the brand's max DC input voltage.
// ═══════════════════════════════════════════════════════════════════════════

function enphase() {
  const b = getBrandProfile('enphase');
  if (!b) throw new Error('fixture missing: enphase brand profile');
  return b;
}
function apsystems() {
  const b = getBrandProfile('apsystems');
  if (!b) throw new Error('fixture missing: apsystems brand profile');
  return b;
}
function hoymiles() {
  const b = getBrandProfile('hoymiles');
  if (!b) throw new Error('fixture missing: hoymiles brand profile');
  return b;
}
function maxeon3() {
  const p = SOLAR_PANELS.find(x => x.id === 'sp-maxeon3-400');
  if (!p) throw new Error('fixture missing: sp-maxeon3-400');
  return p;
}

describe('v47.423 — micro topology (Voc-fitting panels)', () => {
  it('Enphase IQ8 with a standard-Voc panel returns compatible — never unknown', () => {
    const r = evaluatePanelBrandCompatibility(qcells400(), enphase());
    expect(r.status).toBe('compatible');
    expect(r.status).not.toBe('unknown');
    expect(r.status).not.toBe('incompatible');
  });

  it('Enphase reason mentions microinverters are not subject to MPPT gating', () => {
    const r = evaluatePanelBrandCompatibility(qcells400(), enphase());
    expect(r.reason).toContain('microinverter');
    expect(r.reason).toContain('does not apply');
  });

  it('Enphase result has effectiveMaxInputCurrentPerMppt = null (cap not applicable)', () => {
    const r = evaluatePanelBrandCompatibility(qcells400(), enphase());
    expect(r.brand.effectiveMaxInputCurrentPerMppt).toBeNull();
  });

  it('Enphase result has no auto-swap suggestions for a Voc-fitting panel', () => {
    const r = evaluatePanelBrandCompatibility(qcells400(), enphase());
    expect(r.suggestions).toEqual([]);
  });

  it('APsystems micro brand also returns compatible (not unknown)', () => {
    const r = evaluatePanelBrandCompatibility(qcells400(), apsystems());
    expect(r.status).toBe('compatible');
    expect(r.status).not.toBe('unknown');
  });

  it('Hoymiles micro brand also returns compatible (not unknown)', () => {
    const r = evaluatePanelBrandCompatibility(qcells400(), hoymiles());
    expect(r.status).toBe('compatible');
    expect(r.status).not.toBe('unknown');
  });

  it('all three micro brands with Silfab SIL-430 (high Isc, standard Voc) return compatible', () => {
    for (const brand of [enphase(), apsystems(), hoymiles()]) {
      const r = evaluatePanelBrandCompatibility(silfab430(), brand);
      expect(r.status).toBe('compatible');
      expect(r.status).not.toBe('unknown');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// v47.431 — Micro Voc gate (TEARDOWN-v47379 P0)
// Module cold-corrected Voc vs microinverter max DC input voltage (NEC 690.7)
// ═══════════════════════════════════════════════════════════════════════════

describe('v47.431 — getBrandMinMicroMaxDcVoltage()', () => {
  it('resolves Enphase IQ8 to 60 V (all IQ8 variants)', () => {
    expect(getBrandMinMicroMaxDcVoltage(enphase())).toBe(60);
  });

  it('resolves APsystems to 60 V', () => {
    expect(getBrandMinMicroMaxDcVoltage(apsystems())).toBe(60);
  });

  it('returns null for null/undefined and for empty model lists', () => {
    expect(getBrandMinMicroMaxDcVoltage(null)).toBeNull();
    expect(getBrandMinMicroMaxDcVoltage(undefined)).toBeNull();
    const fake: BrandProfile = { ...enphase(), supportedInverterModels: [] };
    expect(getBrandMinMicroMaxDcVoltage(fake)).toBeNull();
  });

  it('returns null when no equipmentDbId resolves against MICROINVERTERS', () => {
    const fake: BrandProfile = {
      ...enphase(),
      supportedInverterModels: [
        { equipmentDbId: 'nonexistent-micro-xyz', acKw: 0.3, dcKwMax: 0.5, mpptCount: 1 },
      ],
    };
    expect(getBrandMinMicroMaxDcVoltage(fake)).toBeNull();
  });
});

describe('v47.431 — micro Voc gate classification', () => {
  it('SunPower Maxeon 3 (Voc 75.6 V) on Enphase IQ8 is INCOMPATIBLE (75.6 × 1.12 = 84.7 V > 60 V)', () => {
    const r = evaluatePanelBrandCompatibility(maxeon3(), enphase());
    expect(r.status).toBe('incompatible');
    expect(r.brand.effectiveMaxDcInputVoltage).toBe(60);
    expect(r.panel.voc).toBeCloseTo(75.6, 1);
    expect(r.panel.vocColdCorrected!).toBeGreaterThan(60);
    expect(r.headroomPct).toBeLessThan(0);
    expect(r.reason).toContain('max DC input');
  });

  it('Maxeon 3 on every micro brand is incompatible with Voc-fitting suggestions', () => {
    for (const brand of [enphase(), apsystems(), hoymiles()]) {
      const r = evaluatePanelBrandCompatibility(maxeon3(), brand);
      expect(r.status).toBe('incompatible');
      expect(r.suggestions.length).toBeGreaterThan(0);
      for (const s of r.suggestions) {
        expect(s.id).not.toBe('sp-maxeon3-400');
        const p = SOLAR_PANELS.find(x => x.id === s.id)!;
        expect(p.voc * 1.12).toBeLessThanOrEqual(60);
      }
    }
  });

  it('classifies a near-cap panel as MARGINAL (forged Voc 52 V → 58.2 V cold, 3% headroom)', () => {
    const forged = { ...qcells400(), id: 'forged-high-voc', voc: 52.0 };
    const r = evaluatePanelBrandCompatibility(forged, enphase());
    expect(r.status).toBe('marginal');
    expect(r.headroomPct).toBeGreaterThan(0);
    expect(r.headroomPct).toBeLessThan(5);
    expect(r.suggestions).toEqual([]);
  });

  it('uses the exact NEC 690.7(A)(1) formula when designTempMinC is provided', () => {
    // Maxeon 3 tempCoeffVoc −0.236 %/°C at a mild 10 °C design low:
    // factor = 1 + (−0.236/100)(10−25) = 1.0354 → 78.3 V, still > 60 V.
    const r = evaluatePanelBrandCompatibility(maxeon3(), enphase(), { designTempMinC: 10 });
    expect(r.status).toBe('incompatible');
    expect(r.panel.vocColdCorrected!).toBeCloseTo(75.6 * 1.0354, 0);
  });

  it('fails open to compatible when no micro model resolves (cap unknown)', () => {
    const fake: BrandProfile = {
      ...enphase(),
      supportedInverterModels: [
        { equipmentDbId: 'nonexistent-micro-xyz', acKw: 0.3, dcKwMax: 0.5, mpptCount: 1 },
      ],
    };
    const r = evaluatePanelBrandCompatibility(maxeon3(), fake);
    expect(r.status).toBe('compatible'); // fail-open, matches gate philosophy
    expect(r.brand.effectiveMaxDcInputVoltage).toBeNull();
  });
});
// ═══════════════════════════════════════════════════════════════════════════
// Payload shape
// ═══════════════════════════════════════════════════════════════════════════

describe('v47.423 — result payload shape', () => {
  it('returns a fully populated panel block', () => {
    const r = evaluatePanelBrandCompatibility(qcells400(), growatt());
    expect(r.panel).toMatchObject({
      id:           'qcells-peak-duo-400',
      manufacturer: 'Q CELLS',
      isc:          11.05,        // N1 — datasheet value (was the copy-paste 12.26)
    });
    expect(r.panel.designCurrent).toBeGreaterThan(0);
  });

  it('returns a fully populated brand block', () => {
    const r = evaluatePanelBrandCompatibility(qcells400(), growatt());
    expect(r.brand).toMatchObject({
      id:          'growatt',
      displayName: 'Growatt',
    });
    expect(r.brand.effectiveMaxInputCurrentPerMppt).toBe(13.5);
  });

  it('returns a non-empty reason string', () => {
    const r = evaluatePanelBrandCompatibility(qcells400(), growatt());
    expect(typeof r.reason).toBe('string');
    expect(r.reason.length).toBeGreaterThan(0);
  });

  it('suggestion fields include manufacturer and model for UI rendering', () => {
    const r = evaluatePanelBrandCompatibility(qcells400(), growatt());
    const top = r.suggestions[0];
    expect(top.manufacturer).toBeTruthy();
    expect(top.model).toBeTruthy();
    expect(top.watts).toBeGreaterThan(0);
    expect(top.headroomPct).toBeGreaterThanOrEqual(0);
  });

  it('respects maxSuggestions option', () => {
    const r = evaluatePanelBrandCompatibility(
      qcells400(),
      growatt(),
      { maxSuggestions: 1 },
    );
    expect(r.suggestions.length).toBeLessThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Brand-agnostic sweep — every active brand must produce a coherent result
// for a representative panel without crashing.
// ═══════════════════════════════════════════════════════════════════════════

describe('v47.423 — brand-agnostic sweep', () => {
  const representativePanels = [
    'qcells-peak-duo-400',   // high Isc (12.26)
    'pan-evervolt-410',      // low Isc  (10.06)
    'silfab-sil430',         // very high Isc (13.30)
  ];

  for (const panelId of representativePanels) {
    const panel = SOLAR_PANELS.find(p => p.id === panelId);
    if (!panel) continue;

    for (const brand of BRAND_PROFILES) {
      it(`${panelId} on ${brand.id} returns a valid status`, () => {
        const r = evaluatePanelBrandCompatibility(panel, brand);
        expect([
          'compatible', 'marginal', 'incompatible', 'unknown',
        ]).toContain(r.status);
        // Micro topology brands must never be 'unknown'. All three
        // representative panels have standard Voc (≤ 49 V → cold ≤ 54.9 V),
        // safely under every micro brand's 60 V max DC input, so they must
        // classify 'compatible' (v47.431: high-Voc panels like Maxeon 3
        // would instead be 'incompatible' — covered in the micro Voc suite).
        if (brand.topology === 'micro') {
          expect(r.status).toBe('compatible');
        }
        // incompatible results MUST produce either suggestions or an explanatory reason
        if (r.status === 'incompatible') {
          expect(r.reason.length).toBeGreaterThan(0);
        }
        // Payload structural sanity
        expect(r.panel.id).toBe(panel.id);
        expect(r.brand.id).toBe(brand.id);
      });
    }
  }
});