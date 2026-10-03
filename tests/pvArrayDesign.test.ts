// ═══════════════════════════════════════════════════════════════════════════
// The physical PV array, as Design placed it — `resolvePvArrayDesign`.
//
//   PHYSICAL PV DESIGN ≠ INVERTER FLEET
//
// Every invariant Ray named is a case below, each with the control that proves the guard can see
// the defect it exists for.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { stripComments } from './support/stripSource';

const RAYS_MODULE = 'panel-fence-ps1';   // Philadelphia Solar Nexus PS-MNB108(HCBF)-440W

describe('the array Design placed survives every electrical architecture', () => {
  it('Ray: 37 × 440 W = 16.28 kW from Design, with the inverter fleet retired', () => {
    const pv = resolvePvArrayDesign({
      placedModuleCount: 37, layoutTotalPanels: 37, selectedPanelId: RAYS_MODULE,
      engineeringStrings: [],
    });
    expect(pv.moduleCount).toBe(37);
    expect(pv.moduleCountSource).toBe('design-placed-modules');
    expect(pv.module?.panelId).toBe(RAYS_MODULE);
    expect(pv.module?.watts).toBe(440);
    expect(pv.dcStcKw).toBe(16.28);
    expect(pv.assignmentState).toBe('NO_ASSIGNMENT');
    expect(pv.missing).toEqual([]);
  });

  it('removing the inverter cannot remove a module (fleet present vs retired → identical array)', () => {
    const withFleet = resolvePvArrayDesign({
      placedModuleCount: 37, selectedPanelId: RAYS_MODULE,
      engineeringStrings: [{ panelId: RAYS_MODULE, panelCount: 19 }, { panelId: RAYS_MODULE, panelCount: 18 }],
    });
    const retired = resolvePvArrayDesign({ placedModuleCount: 37, selectedPanelId: RAYS_MODULE, engineeringStrings: [] });
    expect(retired.moduleCount).toBe(withFleet.moduleCount);
    expect(retired.dcStcW).toBe(withFleet.dcStcW);
    expect(withFleet.assignmentState).toBe('MATCHES_DESIGN');
  });

  it('a string assignment cannot invent modules: 5 × 9 = 45 against a 37-module design is reported, not adopted', () => {
    const pv = resolvePvArrayDesign({
      placedModuleCount: 37, selectedPanelId: RAYS_MODULE,
      engineeringStrings: Array.from({ length: 5 }, () => ({ panelId: RAYS_MODULE, panelCount: 9 })),
    });
    expect(pv.moduleCount).toBe(37);
    expect(pv.assignedModuleCount).toBe(45);
    expect(pv.assignmentState).toBe('DIFFERS_FROM_DESIGN');
    expect(pv.dcStcKw).toBe(16.28);
  });

  it('a stale 400 W panel left on the strings does not resize a single-module array', () => {
    const pv = resolvePvArrayDesign({
      placedModuleCount: 37, selectedPanelId: RAYS_MODULE,
      engineeringStrings: [{ panelId: 'qcells-peak-duo-400', panelCount: 37 }],
    });
    expect(pv.dcStcKw).toBe(16.28);
    expect(pv.dcSizeSource).toBe('module-identity');
  });

  it('a mixed-module design (roof + fence on different modules) is sized string by string when the assignment covers it', () => {
    const roof = 'panel-std440';   // 440 W
    const fence = 'panel-fence1';  // 400 W
    const pv = resolvePvArrayDesign({
      placedModuleCount: 30, selectedPanelId: roof,
      engineeringStrings: [{ panelId: roof, panelCount: 20 }, { panelId: fence, panelCount: 10 }],
    });
    expect(pv.dcSizeSource).toBe('string-assignment');
    expect(pv.dcStcW).toBe(20 * 440 + 10 * 400);
  });
});

describe('nothing is invented', () => {
  it('no Design and no assignment ⇒ count not established, and it says who owns it', () => {
    const pv = resolvePvArrayDesign({});
    expect(pv.moduleCount).toBeNull();
    expect(pv.dcStcW).toBeNull();
    expect(pv.missing[0].fact).toBe('PV module count');
    expect(pv.missing[0].owner).toMatch(/Design/);
    expect(pv.missing[0].blocks).toContain('SLD');
  });

  it('a count with no module ⇒ module not established; never a 400 W default', () => {
    const pv = resolvePvArrayDesign({ placedModuleCount: 37 });
    expect(pv.module).toBeNull();
    expect(pv.dcStcW).toBeNull();
    expect(pv.missing.map(m => m.fact)).toContain('PV module model');
  });

  it('…unless Design stamped a wattage on the placed modules, which sizes the DC (and still reports the missing model)', () => {
    const pv = resolvePvArrayDesign({ placedModuleCount: 37, placedModuleWatts: 440 });
    expect(pv.dcStcKw).toBe(16.28);
    expect(pv.dcSizeSource).toBe('design-placed-wattage');
    expect(pv.missing.map(m => m.fact)).toContain('PV module model');
  });

  it('a recorded module id that does not resolve FAILS CLOSED — the next store is not a substitute', () => {
    const pv = resolvePvArrayDesign({
      placedModuleCount: 37, selectedPanelId: 'nexus-ps-mnb108-440w', designElectricalPanelId: RAYS_MODULE,
    });
    expect(pv.module).toBeNull();
    expect(pv.moduleSource).toBe('not-established');
  });

  it('a layout that exists and places nothing is an answer — 0 modules, 0 W — not "unknown"', () => {
    const pv = resolvePvArrayDesign({ placedModuleCount: 0, layoutTotalPanels: 0 });
    expect(pv.moduleCount).toBe(0);
    expect(pv.dcStcW).toBe(0);
    expect(pv.missing).toEqual([]);
  });
});

describe('authority order', () => {
  it('Design placed count outranks the layout total, which outranks the string assignment', () => {
    expect(resolvePvArrayDesign({ placedModuleCount: 37, layoutTotalPanels: 36 }).moduleCount).toBe(37);
    expect(resolvePvArrayDesign({ layoutTotalPanels: 36, engineeringStrings: [{ panelCount: 20 }] }).moduleCount).toBe(36);
  });

  it('the string assignment is the count ONLY when the project has no Design at all — and says so', () => {
    const pv = resolvePvArrayDesign({ engineeringStrings: [{ panelId: RAYS_MODULE, panelCount: 12 }] });
    expect(pv.moduleCount).toBe(12);
    expect(pv.moduleCountSource).toBe('engineering-entry');
    expect(pv.assignmentState).toBe('NO_DESIGN');
    expect(pv.module?.panelId).toBe(RAYS_MODULE);
    expect(pv.moduleSource).toBe('engineering-entry');
  });

  it('selected_equipment outranks Design Studio\'s recorded module, which outranks the strings', () => {
    expect(resolvePvArrayDesign({
      placedModuleCount: 10, selectedPanelId: RAYS_MODULE, designElectricalPanelId: 'panel-std440',
    }).module?.panelId).toBe(RAYS_MODULE);
    expect(resolvePvArrayDesign({
      placedModuleCount: 10, designElectricalPanelId: 'panel-std440',
      engineeringStrings: [{ panelId: RAYS_MODULE, panelCount: 10 }],
    }).module?.panelId).toBe('panel-std440');
  });
});

describe('the page reads the array from Design, not from its fleet (source guard on live lines)', () => {
  // Comments stripped (string literals KEPT — the literal values are what these guards look for),
  // so the prose explaining a removed fallback cannot satisfy or defeat the guard.
  const page = stripComments(readFileSync(join(__dirname, '..', 'app', 'engineering', 'page.tsx'), 'utf8'));

  it('`totalPanels` is the Design array, and the fleet sum carries its real name', () => {
    expect(page).toMatch(/const totalPanels = pvArray\.moduleCount \?\? 0;/);
    expect(page).toMatch(/const fleetModuleSum = config\.inverters\.reduce/);
    // Control: the old definition, which made the array vanish with the fleet, is gone.
    expect(page).not.toMatch(/const totalPanels = config\.inverters\.reduce/);
  });

  it('DC size is the Design array × its module, not Σ strings × (panel?.watts || 400)', () => {
    expect(page).toMatch(/const totalWatts = pvArray\.dcStcW \?\? 0;/);
  });

  it('the SLD request no longer fills an absent module with a literal', () => {
    const at = page.indexOf('const fetchSLDSvg = async');
    const body = page.slice(at, page.indexOf('const fetchSLD = async', at));
    expect(body).not.toMatch(/panelWatts:\s*panelData\?\.watts \|\| 400/);
    expect(body).not.toMatch(/'Solar Panel'/);
    expect(body).toMatch(/\?\? pvModule/);
  });

  it('the PDF export no longer names SolarEdge / SE7600H / IQ8+ for an absent inverter', () => {
    const at = page.indexOf("fetch('/api/engineering/sld/pdf'");
    const body = page.slice(at, at + 9000);
    expect(body).not.toMatch(/'SE7600H'|'SolarEdge'\)|'IQ8\+'/);
    expect(body).toMatch(/topologyType: sldRequestTopology/);
  });
});
