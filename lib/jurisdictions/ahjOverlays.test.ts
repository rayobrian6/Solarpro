// lib/jurisdictions/ahjOverlays.test.ts
import { describe, it, expect } from 'vitest';
import {
  AHJ_OVERLAYS,
  getApplicableOverlays,
  applyAhjOverlays,
  getFullComplianceChecklist,
  getAhjOverlaySummary,
} from './ahjOverlays';
import type { ComplianceCheckItem } from './ahj';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function baseChecklist(): ComplianceCheckItem[] {
  return [
    { id: 'rsd_required',    category: 'Rapid Shutdown',   requirement: 'RSD required',    necReference: 'NEC 690.12', required: true },
    { id: 'permit',          category: 'Permitting',       requirement: 'Permit required', necReference: 'Local',      required: true, notes: 'Standard notes' },
    { id: 'gfdi_required',   category: 'Ground Fault',     requirement: 'GFDI required',   necReference: 'NEC 690.5',  required: true },
  ];
}

// ── Overlay registry ──────────────────────────────────────────────────────────

describe('AHJ_OVERLAYS registry', () => {
  it('contains at least 5 overlays', () => {
    expect(AHJ_OVERLAYS.length).toBeGreaterThanOrEqual(5);
  });

  it('all overlays have required fields', () => {
    for (const overlay of AHJ_OVERLAYS) {
      expect(overlay.id, `${overlay.id} missing id`).toBeTruthy();
      expect(overlay.name, `${overlay.id} missing name`).toBeTruthy();
      expect(overlay.authority, `${overlay.id} missing authority`).toBeTruthy();
      expect(overlay.items, `${overlay.id} missing items`).toBeInstanceOf(Array);
    }
  });

  it('contains CA Rule 21 overlay', () => {
    const ca = AHJ_OVERLAYS.find(o => o.id === 'ca-rule-21');
    expect(ca).toBeDefined();
    expect(ca!.appliesTo.stateCodes).toContain('CA');
  });

  it('contains HECO overlay', () => {
    const heco = AHJ_OVERLAYS.find(o => o.id === 'heco-rule-14h');
    expect(heco).toBeDefined();
    expect(heco!.appliesTo.stateCodes).toContain('HI');
  });

  it('contains PREPA overlay', () => {
    const prepa = AHJ_OVERLAYS.find(o => o.id === 'prepa-pr');
    expect(prepa).toBeDefined();
    expect(prepa!.appliesTo.stateCodes).toContain('PR');
  });

  it('contains NYC overlay', () => {
    const nyc = AHJ_OVERLAYS.find(o => o.id === 'nyc-local-law-39');
    expect(nyc).toBeDefined();
    expect(nyc!.appliesTo.stateCodes).toContain('NY');
  });
});

// ── getApplicableOverlays ─────────────────────────────────────────────────────

describe('getApplicableOverlays', () => {
  it('returns CA Rule 21 for PG&E in California', () => {
    const overlays = getApplicableOverlays('CA', 'PG&E (Pacific Gas & Electric)');
    const ids = overlays.map(o => o.id);
    expect(ids).toContain('ca-rule-21');
  });

  it('returns CA Rule 21 for SCE in California', () => {
    const overlays = getApplicableOverlays('CA', 'Southern California Edison');
    const ids = overlays.map(o => o.id);
    expect(ids).toContain('ca-rule-21');
  });

  it('returns CA Rule 21 for SDG&E in California', () => {
    const overlays = getApplicableOverlays('CA', 'SDG&E (San Diego Gas & Electric)');
    const ids = overlays.map(o => o.id);
    expect(ids).toContain('ca-rule-21');
  });

  it('returns HECO overlay for Hawaii', () => {
    const overlays = getApplicableOverlays('HI', 'HECO');
    const ids = overlays.map(o => o.id);
    expect(ids).toContain('heco-rule-14h');
  });

  it('returns HECO overlay for Maui Electric (MECO)', () => {
    const overlays = getApplicableOverlays('HI', 'Maui Electric');
    const ids = overlays.map(o => o.id);
    expect(ids).toContain('heco-rule-14h');
  });

  it('returns PREPA overlay for Puerto Rico', () => {
    const overlays = getApplicableOverlays('PR', 'LUMA Energy');
    const ids = overlays.map(o => o.id);
    expect(ids).toContain('prepa-pr');
  });

  it('returns NYC overlay for New York City', () => {
    const overlays = getApplicableOverlays('NY', undefined, 'New York City');
    const ids = overlays.map(o => o.id);
    expect(ids).toContain('nyc-local-law-39');
  });

  it('returns NYC overlay for Brooklyn (part of NYC)', () => {
    const overlays = getApplicableOverlays('NY', undefined, 'Brooklyn');
    const ids = overlays.map(o => o.id);
    expect(ids).toContain('nyc-local-law-39');
  });

  it('does NOT return CA overlay for Texas', () => {
    const overlays = getApplicableOverlays('TX', 'Oncor');
    const ids = overlays.map(o => o.id);
    expect(ids).not.toContain('ca-rule-21');
  });

  it('does NOT return NYC overlay for upstate NY with non-NYC city', () => {
    const overlays = getApplicableOverlays('NY', undefined, 'Albany');
    const ids = overlays.map(o => o.id);
    expect(ids).not.toContain('nyc-local-law-39');
  });

  it('returns Texas PUCT overlay for Oncor in Texas', () => {
    const overlays = getApplicableOverlays('TX', 'Oncor');
    const ids = overlays.map(o => o.id);
    expect(ids).toContain('tx-puct-ercot');
  });

  it('returns Florida NEM overlay for FPL', () => {
    const overlays = getApplicableOverlays('FL', 'Florida Power & Light');
    const ids = overlays.map(o => o.id);
    expect(ids).toContain('fl-net-metering');
  });

  it('returns empty array for generic state with no overlays', () => {
    const overlays = getApplicableOverlays('KS', 'Evergy');
    // Kansas has no special overlay
    expect(overlays.length).toBe(0);
  });

  it('is case-insensitive for state code', () => {
    const upper = getApplicableOverlays('CA', 'pge');
    const lower = getApplicableOverlays('ca', 'pge');
    expect(upper.map(o => o.id)).toEqual(lower.map(o => o.id));
  });
});

// ── applyAhjOverlays ─────────────────────────────────────────────────────────

describe('applyAhjOverlays', () => {
  it('adds new items from overlays', () => {
    const base = baseChecklist();
    const overlays = getApplicableOverlays('CA', 'PG&E');
    const result = applyAhjOverlays(base, overlays);
    const ids = result.map(i => i.id);
    expect(ids).toContain('ca_rule21_smart_inverter');
    expect(ids).toContain('ca_rule21_nem3');
    expect(ids).toContain('ca_rule21_pto');
  });

  it('does not add duplicate items', () => {
    const base = baseChecklist();
    const overlays = getApplicableOverlays('CA', 'PG&E');
    // Apply twice
    const result1 = applyAhjOverlays(base, overlays);
    const result2 = applyAhjOverlays(result1, overlays);
    const ids1 = result1.filter(i => i.id === 'ca_rule21_smart_inverter').length;
    const ids2 = result2.filter(i => i.id === 'ca_rule21_smart_inverter').length;
    expect(ids1).toBe(1);
    expect(ids2).toBe(1);
  });

  it('modifies existing item notes for NYC permit', () => {
    const base = baseChecklist();
    const overlays = getApplicableOverlays('NY', undefined, 'New York City');
    const result = applyAhjOverlays(base, overlays);
    const permitItem = result.find(i => i.id === 'permit');
    expect(permitItem?.notes).toContain('NYC DOB');
  });

  it('preserves base items not targeted by overlay', () => {
    const base = baseChecklist();
    const overlays = getApplicableOverlays('CA', 'PG&E');
    const result = applyAhjOverlays(base, overlays);
    expect(result.find(i => i.id === 'rsd_required')).toBeDefined();
    expect(result.find(i => i.id === 'gfdi_required')).toBeDefined();
  });

  it('HECO overlay adds smart export item', () => {
    const base = baseChecklist();
    const overlays = getApplicableOverlays('HI', 'HECO');
    const result = applyAhjOverlays(base, overlays);
    expect(result.find(i => i.id === 'heco_smart_export')).toBeDefined();
    expect(result.find(i => i.id === 'heco_ul1741sa')).toBeDefined();
  });

  it('PREPA overlay adds hurricane rating item', () => {
    const base = baseChecklist();
    const overlays = getApplicableOverlays('PR', 'LUMA Energy');
    const result = applyAhjOverlays(base, overlays);
    expect(result.find(i => i.id === 'prepa_hurricane_rating')).toBeDefined();
    expect(result.find(i => i.id === 'prepa_pe_stamp')).toBeDefined();
  });

  it('returns unmodified base for no overlays', () => {
    const base = baseChecklist();
    const result = applyAhjOverlays(base, []);
    expect(result).toHaveLength(base.length);
    expect(result).toEqual(base);
  });
});

// ── getFullComplianceChecklist ────────────────────────────────────────────────

describe('getFullComplianceChecklist', () => {
  it('returns checklist + appliedOverlays for CA', () => {
    const { checklist, appliedOverlays } = getFullComplianceChecklist({
      base: baseChecklist(),
      stateCode: 'CA',
      utilityName: 'PG&E',
    });
    expect(appliedOverlays).toContain('ca-rule-21');
    expect(checklist.length).toBeGreaterThan(baseChecklist().length);
  });

  it('returns unmodified for state with no overlay', () => {
    const { checklist, appliedOverlays } = getFullComplianceChecklist({
      base: baseChecklist(),
      stateCode: 'ID',
      utilityName: 'Idaho Power',
    });
    expect(appliedOverlays).toHaveLength(0);
    expect(checklist).toEqual(baseChecklist());
  });
});

// ── getAhjOverlaySummary ──────────────────────────────────────────────────────

describe('getAhjOverlaySummary', () => {
  it('returns hasOverlays=true for CA PG&E', () => {
    const summary = getAhjOverlaySummary('CA', 'PG&E');
    expect(summary.hasOverlays).toBe(true);
    expect(summary.overlayNames.length).toBeGreaterThan(0);
    expect(summary.keyWarnings.length).toBeGreaterThan(0);
  });

  it('returns hasOverlays=false for state with no overlays', () => {
    const summary = getAhjOverlaySummary('KS', 'Evergy');
    expect(summary.hasOverlays).toBe(false);
    expect(summary.overlayNames).toHaveLength(0);
    expect(summary.keyWarnings).toHaveLength(0);
  });

  it('keyWarnings are strings under 130 chars', () => {
    const summary = getAhjOverlaySummary('CA', 'SCE');
    for (const w of summary.keyWarnings) {
      expect(typeof w).toBe('string');
      expect(w.length).toBeLessThanOrEqual(130);
    }
  });
});
