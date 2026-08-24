// ═══════════════════════════════════════════════════════════════════════════
// CAD module footprint authority — the per-sub canonical size, fail-closed.
//
// The defect these pin: all three CAD solvers read `project.panelLengthIn ?? 66`,
// and the client seam that was supposed to fill that scalar read `.lengthIn` off
// a `SolarPanel` (which has `.length`), so it was undefined on every generate.
// Every design was solved at 66×40 — a size no catalogue module has.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  resolveCADPanelFootprint,
  panelFootprintWarning,
  UNESTABLISHED_PANEL_LENGTH_IN,
  UNESTABLISHED_PANEL_WIDTH_IN,
} from '@/lib/cad/panelFootprint';
import { SOLAR_PANELS, getPanelById } from '@/lib/equipment-db';

const QCELLS = 'qcells-peak-duo-400';

describe('CAD panel footprint — the catalogue never produced 66×40', () => {
  it('no catalogue module is 66×40, so the old default described no real product', () => {
    expect(SOLAR_PANELS.length).toBeGreaterThan(0);
    const exact = SOLAR_PANELS.filter(p => p.length === 66 && p.width === 40);
    expect(exact).toHaveLength(0);
  });

  it('SolarPanel carries length/width — NOT lengthIn/widthIn (the seam bug)', () => {
    const p = getPanelById(QCELLS) as unknown as Record<string, unknown>;
    expect(p).toBeTruthy();
    expect(typeof p.length).toBe('number');
    expect(typeof p.width).toBe('number');
    // These are the properties app/engineering/page.tsx reads through `as any`.
    expect(p.lengthIn).toBeUndefined();
    expect(p.widthIn).toBeUndefined();
    expect(p.weightLbs).toBeUndefined();
  });
});

describe('CAD panel footprint — resolution precedence', () => {
  it('resolves the per-sub map entry to the exact catalogue footprint', () => {
    const spec = getPanelById(QCELLS)!;
    const fp = resolveCADPanelFootprint(
      { project: { subSystems: { roof: { panelId: QCELLS } } } }, 'roof');
    expect(fp.established).toBe(true);
    expect(fp.source).toBe('subsystem-map');
    expect(fp.panelId).toBe(QCELLS);
    expect(fp.lengthIn).toBe(Math.max(spec.length, spec.width));
    expect(fp.widthIn).toBe(Math.min(spec.length, spec.width));
    expect(fp.lengthIn).not.toBe(66);
    expect(fp.widthIn).not.toBe(40);
  });

  it('inherits an UNAMBIGUOUS fleet identity when the sub has no map entry', () => {
    const fp = resolveCADPanelFootprint({
      system: { inverters: [{ strings: [{ panelId: QCELLS }, { panelId: QCELLS }] }] },
    }, 'roof');
    expect(fp.established).toBe(true);
    expect(fp.source).toBe('fleet-unique');
    expect(fp.panelId).toBe(QCELLS);
  });

  it('REFUSES to guess when the fleet carries two different modules', () => {
    const other = SOLAR_PANELS.find(p => p.id !== QCELLS)!;
    const fp = resolveCADPanelFootprint({
      system: { inverters: [{ strings: [{ panelId: QCELLS }, { panelId: other.id }] }] },
    }, 'roof');
    // This is the hybrid case: guessing here puts the fence module's dimensions
    // on the roof, which is the disease panelSpecs.ts exists to prevent.
    expect(fp.established).toBe(false);
    expect(fp.source).toBe('unestablished-placeholder');
    expect(fp.basis).toContain('2 distinct modules');
  });

  it('a per-sub map entry BEATS a conflicting fleet', () => {
    const other = SOLAR_PANELS.find(p => p.id !== QCELLS)!;
    const fp = resolveCADPanelFootprint({
      project: { subSystems: { fence: { panelId: other.id } } },
      system: { inverters: [{ strings: [{ panelId: QCELLS }] }] },
    }, 'fence');
    expect(fp.panelId).toBe(other.id);
    expect(fp.source).toBe('subsystem-map');
  });

  it('falls to posted scalars only when no identity resolves, and says so', () => {
    const fp = resolveCADPanelFootprint(
      { project: { panelLengthIn: 71.2, panelWidthIn: 41.1 } }, 'roof');
    expect(fp.established).toBe(true);
    expect(fp.source).toBe('project-scalars');
    expect(fp.panelId).toBeNull();
    expect(panelFootprintWarning(fp, 'roof')).toContain('posted project scalars');
  });

  it('long ≥ short always, even when the scalars arrive transposed', () => {
    const fp = resolveCADPanelFootprint(
      { project: { panelLengthIn: 41.1, panelWidthIn: 71.2 } }, 'roof');
    expect(fp.lengthIn).toBe(71.2);
    expect(fp.widthIn).toBe(41.1);
  });
});

describe('CAD panel footprint — fail-closed', () => {
  it('an empty input yields a FLAGGED placeholder, never a silent size', () => {
    const fp = resolveCADPanelFootprint({}, 'roof');
    expect(fp.established).toBe(false);
    expect(fp.lengthIn).toBe(UNESTABLISHED_PANEL_LENGTH_IN);
    expect(fp.widthIn).toBe(UNESTABLISHED_PANEL_WIDTH_IN);
    const warn = panelFootprintWarning(fp, 'roof');
    expect(warn).toBeTruthy();
    expect(warn).toContain('MODULE FOOTPRINT NOT ESTABLISHED');
  });

  it('a dangling panelId does not fall back to the placeholder silently', () => {
    const fp = resolveCADPanelFootprint(
      { project: { subSystems: { roof: { panelId: 'no-such-module-xyz' } } } }, 'roof');
    expect(fp.established).toBe(false);
    expect(panelFootprintWarning(fp, 'roof')).toContain('NOT ESTABLISHED');
  });

  it('an established footprint emits NO warning', () => {
    const fp = resolveCADPanelFootprint(
      { project: { subSystems: { ground: { panelId: QCELLS } } } }, 'ground');
    expect(panelFootprintWarning(fp, 'ground')).toBeNull();
  });

  it('the placeholder is never returned as established', () => {
    for (const sub of ['roof', 'ground', 'fence'] as const) {
      const fp = resolveCADPanelFootprint({}, sub);
      expect(fp.established).toBe(false);
      expect(fp.panelId).toBeNull();
    }
  });
});
