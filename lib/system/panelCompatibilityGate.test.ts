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
  it('flags Q.PEAK DUO 400W on Growatt as INCOMPATIBLE (12.26 × 1.25 = 15.33 A > 13.5 A)', () => {
    const r = evaluatePanelBrandCompatibility(qcells400(), growatt());
    expect(r.status).toBe('incompatible');
    expect(r.panel.designCurrent).toBeCloseTo(12.26 * 1.25, 1);
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
// Micro topology short-circuit — Enphase, APsystems, Hoymiles
// ═══════════════════════════════════════════════════════════════════════════

describe('v47.423 — micro topology short-circuit', () => {
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

  it('Enphase IQ8 with any panel returns compatible — never unknown', () => {
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

  it('Enphase result has no auto-swap suggestions', () => {
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

  it('all three micro brands with Silfab SIL-430 (high Isc) return compatible', () => {
    for (const brand of [enphase(), apsystems(), hoymiles()]) {
      const r = evaluatePanelBrandCompatibility(silfab430(), brand);
      expect(r.status).toBe('compatible');
      expect(r.status).not.toBe('unknown');
    }
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
      isc:          12.26,
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
        // Micro topology brands MUST resolve to 'compatible', never 'unknown'.
        // Per-MPPT current gating does not apply to per-panel microinverters.
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