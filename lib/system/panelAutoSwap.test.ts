/**
 * v47.423 — Panel Auto-Swap end-to-end integration tests.
 *
 * Exercises sizeSystemFromBrand() with real SizingInputs that mirror the
 * user's screenshot scenario: Growatt MIN 5000TL-XH-US ecosystem + Q CELLS
 * Q.PEAK DUO 400W (incompatible due to 12.26 A Isc × 1.25 = 15.33 A >
 * 13.5 A per-MPPT cap). The sizer must auto-switch panels and surface the
 * PANEL_AUTO_SWITCHED info warning.
 *
 * Also covers:
 *   - Marginal (non-swap) pairing
 *   - Compatible pass-through (no banner)
 *   - Backwards compatibility (no panelId → gate skipped)
 *   - Brand-agnostic sweep (every active brand produces a coherent result)
 */
import { describe, it, expect } from 'vitest';
import { sizeSystemFromBrand } from './sizingEngine';
import { SOLAR_PANELS } from '../equipment-db';
import { BRAND_PROFILES } from './brandProfiles';

// ─── Helpers ───────────────────────────────────────────────────────────────

function panelSpecs(id: string) {
  const p = SOLAR_PANELS.find(x => x.id === id);
  if (!p) throw new Error(`fixture missing: ${id}`);
  return {
    panelId:           p.id,
    panelWattage:      p.watts,
    panelVoc:          p.voc,
    panelVmp:          p.vmp,
    panelIsc:          p.isc,
    panelTempCoeffVoc: p.tempCoeffVoc,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Screenshot scenario — Growatt + QCells 400W = auto-swap
// ═══════════════════════════════════════════════════════════════════════════

describe('v47.423 — auto-swap when incompatible (Growatt + QCells 400W)', () => {
  it('emits PANEL_AUTO_SWITCHED info warning', () => {
    const r = sizeSystemFromBrand({
      systemType:  'roof',
      panelCount:  36,  // matches user's 2× 5000TL-XH-US × 18 panels
      selectedBrand: 'growatt',
      ...panelSpecs('qcells-peak-duo-400'),
    });

    const auto = r.warnings.find(w => w.code === 'PANEL_AUTO_SWITCHED');
    expect(auto).toBeDefined();
    expect(auto!.severity).toBe('info');
    expect(auto!.message.length).toBeGreaterThan(10);
  });

  it('populates panelCompatibility payload with autoSwitched=true', () => {
    const r = sizeSystemFromBrand({
      systemType:  'roof',
      panelCount:  36,
      selectedBrand: 'growatt',
      ...panelSpecs('qcells-peak-duo-400'),
    });

    expect(r.panelCompatibility).toBeDefined();
    expect(r.panelCompatibility!.autoSwitched).toBe(true);
    expect(r.panelCompatibility!.originalPanelId).toBe('qcells-peak-duo-400');
    expect(r.panelCompatibility!.effectivePanelId).not.toBe('qcells-peak-duo-400');
    expect(r.panelCompatibility!.status).toBe('compatible');
    expect(r.panelCompatibility!.suggestions.length).toBeGreaterThan(0);
    expect(r.panelCompatibility!.brand.id).toBe('growatt');
  });

  it('the swapped-to panel resolves to a real SolarPanel in the registry', () => {
    const r = sizeSystemFromBrand({
      systemType:  'roof',
      panelCount:  36,
      selectedBrand: 'growatt',
      ...panelSpecs('qcells-peak-duo-400'),
    });
    const swappedId = r.panelCompatibility!.effectivePanelId;
    const panel = SOLAR_PANELS.find(p => p.id === swappedId);
    expect(panel).toBeDefined();
    // Must have an Isc that fits the Growatt cap
    expect(panel!.isc * 1.25).toBeLessThanOrEqual(13.5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Marginal — EverVolt 410W on Growatt (fits but <15% headroom)
// ═══════════════════════════════════════════════════════════════════════════

describe('v47.423 — marginal pairing (Growatt + EverVolt 410W)', () => {
  it('emits PANEL_MARGINAL warning (not info), does NOT auto-switch', () => {
    const r = sizeSystemFromBrand({
      systemType:  'roof',
      panelCount:  18,
      selectedBrand: 'growatt',
      ...panelSpecs('pan-evervolt-410'),
    });

    const marginal = r.warnings.find(w => w.code === 'PANEL_MARGINAL');
    expect(marginal).toBeDefined();
    expect(marginal!.severity).toBe('warning');

    const swap = r.warnings.find(w => w.code === 'PANEL_AUTO_SWITCHED');
    expect(swap).toBeUndefined();
  });

  it('leaves the effective panel unchanged when marginal', () => {
    const r = sizeSystemFromBrand({
      systemType:  'roof',
      panelCount:  18,
      selectedBrand: 'growatt',
      ...panelSpecs('pan-evervolt-410'),
    });
    expect(r.panelCompatibility!.autoSwitched).toBe(false);
    expect(r.panelCompatibility!.effectivePanelId).toBe('pan-evervolt-410');
    expect(r.panelCompatibility!.status).toBe('marginal');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Compatible — silent pass-through
// ═══════════════════════════════════════════════════════════════════════════

describe('v47.423 — compatible pairing (Sol-Ark + Panasonic EverVolt)', () => {
  it('does NOT emit PANEL_AUTO_SWITCHED or PANEL_MARGINAL', () => {
    const r = sizeSystemFromBrand({
      systemType:  'roof',
      panelCount:  24,
      selectedBrand: 'sol-ark',
      ...panelSpecs('pan-evervolt-410'),
    });

    expect(r.warnings.find(w => w.code === 'PANEL_AUTO_SWITCHED')).toBeUndefined();
    expect(r.warnings.find(w => w.code === 'PANEL_MARGINAL')).toBeUndefined();
    expect(r.panelCompatibility!.autoSwitched).toBe(false);
    expect(r.panelCompatibility!.status).toBe('compatible');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Backwards compatibility — no panelId → gate skipped
// ═══════════════════════════════════════════════════════════════════════════

describe('v47.423 — backwards compat (no panelId)', () => {
  it('skips the gate entirely when panelId is omitted', () => {
    const r = sizeSystemFromBrand({
      systemType:  'roof',
      panelCount:  18,
      selectedBrand: 'growatt',
      // No panelId, no electrical specs — engine uses defaults
    });

    expect(r.panelCompatibility).toBeUndefined();
    expect(r.warnings.find(w => w.code === 'PANEL_AUTO_SWITCHED')).toBeUndefined();
    expect(r.warnings.find(w => w.code === 'PANEL_MARGINAL')).toBeUndefined();
  });

  it('skips the gate when panelId does not resolve in the registry', () => {
    const r = sizeSystemFromBrand({
      systemType:  'roof',
      panelCount:  18,
      selectedBrand: 'growatt',
      panelId: 'nonexistent-panel-xyz',
    });

    expect(r.panelCompatibility).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Multi-unit softening — FEASIBILITY_NO_VIABLE_MODEL gets downgraded
// ═══════════════════════════════════════════════════════════════════════════

describe('v47.423 — multi-unit feasibility softening', () => {
  it('converts scary FEASIBILITY_NO_VIABLE_MODEL warnings into MULTI_UNIT_CONFIGURED info when the sizer rolls up to >1 unit', () => {
    // This scenario is likely to auto-size to multiple units.
    const r = sizeSystemFromBrand({
      systemType:  'roof',
      panelCount:  60,
      selectedBrand: 'growatt',
      ...panelSpecs('qcells-peak-duo-400'),
    });

    const unitCount = r.inverterModels.reduce((s, i) => s + i.qty, 0);
    if (unitCount > 1) {
      // No bare FEASIBILITY_NO_VIABLE_MODEL warnings should survive
      expect(r.warnings.find(w => w.code === 'FEASIBILITY_NO_VIABLE_MODEL')).toBeUndefined();
      // If any were softened, we must see the info note
      const rolled = r.warnings.find(w => w.code === 'FEASIBILITY_ROLLED_UP_MULTI_UNIT');
      if (rolled) {
        expect(r.warnings.find(w => w.code === 'MULTI_UNIT_CONFIGURED')).toBeDefined();
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Brand-agnostic sweep — every active brand must produce a coherent result
// when a representative panel is supplied.
// ═══════════════════════════════════════════════════════════════════════════

describe('v47.423 — brand-agnostic sweep', () => {
  const brands = BRAND_PROFILES
    // Skip micro / pure-micro brands — panel/MPPT gate is string-centric.
    .filter(b => b.topology !== 'micro')
    .filter(b => b.supportedInverterModels.length > 0)
    .map(b => b.id);

  for (const brandId of brands) {
    it(`${brandId} + QCells 400W produces a coherent sizing result`, () => {
      const r = sizeSystemFromBrand({
        systemType:  'roof',
        panelCount:  18,
        selectedBrand: brandId,
        ...panelSpecs('qcells-peak-duo-400'),
      });

      // Every sizing result MUST have a panelCompatibility payload when
      // panelId is supplied, regardless of brand.
      expect(r.panelCompatibility).toBeDefined();
      expect(['compatible', 'marginal', 'incompatible', 'unknown']).toContain(
        r.panelCompatibility!.status,
      );

      // The effective panel id MUST exist in the registry.
      const effId = r.panelCompatibility!.effectivePanelId;
      expect(SOLAR_PANELS.some(p => p.id === effId)).toBe(true);

      // No uncaught exceptions. The sizing engine completed.
      expect(r.brand.id).toBe(brandId);
    });
  }
});