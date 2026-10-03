// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE MODULE DESIGN PLACED IS NOT AN INVERTER GATE'S TO REPLACE.
//
// Found by driving the production build on Ray's job (37 × Philadelphia Solar 440 W, four Powerwall 3,
// no PV inverter): the panel-compatibility auto-heal judged the module against ENPHASE — a migration
// default the project never chose — and rewrote every string to a Canadian Solar 620 W; the autosave
// wrote that over `projects.selected_equipment`; the sheet drew "37 × 620W · 22.94 kW DC".
//
// The rule (lib/electrical/moduleAuthority.ts) is pure; the page's three consumers of the gate's swap
// are pinned to it on the live lines (the page needs a browser to mount — see
// e2e/system-config-interview.spec.ts for the same defect driven end to end).
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';
import { gateMayReplaceModule, moduleSwapWithheld } from '@/lib/electrical/moduleAuthority';

const RAYS = { autoSwitched: true, originalPanelId: 'panel-fence-ps1', effectivePanelId: 'panel-cs2' };

describe('the rule', () => {
  it('never replaces the project\'s recorded module', () => {
    const ctx = { canonicalPanelId: 'panel-fence-ps1', pvOnStorageDc: false };
    expect(gateMayReplaceModule(RAYS, ctx)).toBe(false);
    expect(moduleSwapWithheld(RAYS, ctx)).toBe('recorded-module');
  });

  it('never replaces any module when the strings land on a battery\'s own PV inputs', () => {
    const ctx = { canonicalPanelId: null, pvOnStorageDc: true };
    expect(gateMayReplaceModule(RAYS, ctx)).toBe(false);
    expect(moduleSwapWithheld(RAYS, ctx)).toBe('dc-coupled-storage');
  });

  it('control: a module SolarPro planted (no recorded selection) may still be healed', () => {
    expect(gateMayReplaceModule(RAYS, { canonicalPanelId: null, pvOnStorageDc: false })).toBe(true);
    // …and a recorded module that is NOT the one the gate objected to does not block it.
    expect(gateMayReplaceModule(RAYS, { canonicalPanelId: 'panel-std440', pvOnStorageDc: false })).toBe(true);
  });

  it('a verdict that switched nothing is never a replacement', () => {
    const ctx = { canonicalPanelId: null, pvOnStorageDc: false };
    expect(gateMayReplaceModule({ ...RAYS, autoSwitched: false }, ctx)).toBe(false);
    expect(gateMayReplaceModule({ ...RAYS, effectivePanelId: null }, ctx)).toBe(false);
    expect(gateMayReplaceModule(null, ctx)).toBe(false);
  });
});

describe('the page\'s three consumers of the gate\'s swap obey it (live lines, comments stripped)', () => {
  const page = stripComments(readFileSync(join(__dirname, '..', 'app', 'engineering', 'page.tsx'), 'utf8'));

  it('the v47.424 auto-heal returns before writing the swap when the rule withholds it', () => {
    const at = page.indexOf("'[v47.424 AUTO-HEAL] Panel compatibility mismatch");
    expect(at).toBeGreaterThan(0);
    const start = page.lastIndexOf('useEffect(() => {', at);
    const body = page.slice(start, page.indexOf('setConfig(prev', at));
    const guard = body.indexOf('if (!gateMayReplaceModule(compat, { canonicalPanelId, pvOnStorageDc })) {');
    expect(guard, 'the auto-heal no longer consults the module-authority rule').toBeGreaterThan(0);
    expect(body.slice(guard, guard + 400)).toMatch(/return;/);
  });

  it('applySizingRecommendation adopts the gate\'s module only through the rule, read from a live ref', () => {
    const at = page.indexOf('const applySizingRecommendation = useCallback(');
    const body = page.slice(at, page.indexOf('const existingPanelId', at));
    expect(body).toMatch(/const gateEffectivePanelId = gateMayReplaceModule\(rec\.panelCompatibility, moduleAuthorityRef\.current\)/);
    expect(page).toMatch(/moduleAuthorityRef\.current = \{ canonicalPanelId, pvOnStorageDc \};/);
  });

  it('the banner never announces a switch the rule withheld, and is absent on a DC-coupled job', () => {
    const at = page.indexOf('<PanelCompatibilityBanner');
    const head = page.slice(page.lastIndexOf('{sizingRecommendation?.panelCompatibility', at), at + 600);
    expect(head).toMatch(/!== 'dc-coupled-storage'/);
    expect(head).toMatch(/=== 'recorded-module'\s*\?\s*\{ \.\.\.sizingRecommendation\.panelCompatibility, autoSwitched: false \}/);
  });
});
