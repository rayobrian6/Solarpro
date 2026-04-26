/**
 * resolveSystemPanelCount — tests for the single-source-of-truth resolver.
 *
 * Implements the priority rule:
 *   1. CAD placed panels (cad.panels.length)
 *   2. CAD precomputed totalPanels
 *   3. SystemDefinition.layout.totalPanels (or systemDefinition.totalPanels)
 *   4. Config-derived fallback (last resort)
 *
 * The key test is the spec scenario: CAD says 36, config says 10 → resolver
 * MUST return 36 and flag mismatchedWithConfig=true.
 */

import { describe, it, expect } from 'vitest';
import { resolveSystemPanelCount } from './panelCountSource';

describe('resolveSystemPanelCount — priority rule', () => {
  it('MASTER TASK spec: CAD=36, config=10 → returns 36 and flags mismatch', () => {
    const result = resolveSystemPanelCount({
      cad: { panels: new Array(36).fill({}) },
      configFallback: 10,
    });
    expect(result.value).toBe(36);
    expect(result.source).toBe('cad-panels');
    expect(result.mismatchedWithConfig).toBe(true);
  });

  it('returns CAD panel count when both CAD panels[] and totalPanels are present', () => {
    // panels[].length must win over cad.totalPanels when both exist.
    const result = resolveSystemPanelCount({
      cad: { panels: new Array(12).fill(null), totalPanels: 14 },
      configFallback: 12,
    });
    expect(result.value).toBe(12);
    expect(result.source).toBe('cad-panels');
    expect(result.mismatchedWithConfig).toBe(false);
  });

  it('falls back to cad.totalPanels when panels[] is empty', () => {
    const result = resolveSystemPanelCount({
      cad: { panels: [], totalPanels: 24 },
      configFallback: 24,
    });
    expect(result.value).toBe(24);
    expect(result.source).toBe('cad-total');
  });

  it('falls back to cad.totalPanels when panels[] is missing', () => {
    const result = resolveSystemPanelCount({
      cad: { totalPanels: 18 },
      configFallback: 18,
    });
    expect(result.value).toBe(18);
    expect(result.source).toBe('cad-total');
  });

  it('falls back to SystemDefinition.layout.totalPanels when no CAD', () => {
    const result = resolveSystemPanelCount({
      systemDefinition: { layout: { totalPanels: 20 } },
      configFallback: 20,
    });
    expect(result.value).toBe(20);
    expect(result.source).toBe('system-definition');
  });

  it('falls back to SystemDefinition.totalPanels (top-level shape)', () => {
    const result = resolveSystemPanelCount({
      systemDefinition: { totalPanels: 30 },
    });
    expect(result.value).toBe(30);
    expect(result.source).toBe('system-definition');
  });

  it('falls back to config only when neither CAD nor SystemDefinition provide a value', () => {
    const result = resolveSystemPanelCount({ configFallback: 8 });
    expect(result.value).toBe(8);
    expect(result.source).toBe('config-fallback');
    // Mismatch never reported against self.
    expect(result.mismatchedWithConfig).toBe(false);
  });

  it('returns 0 and source=none when no source is available', () => {
    const result = resolveSystemPanelCount({});
    expect(result.value).toBe(0);
    expect(result.source).toBe('none');
  });

  it('ignores zero/negative values in every source', () => {
    const result = resolveSystemPanelCount({
      cad: { panels: [], totalPanels: 0 },
      systemDefinition: { layout: { totalPanels: -5 } },
      configFallback: 12,
    });
    // Should skip all zero/negative sources and land on config fallback.
    expect(result.value).toBe(12);
    expect(result.source).toBe('config-fallback');
  });

  it('mismatchedWithConfig=false when CAD and config agree', () => {
    const result = resolveSystemPanelCount({
      cad: { panels: new Array(36).fill({}) },
      configFallback: 36,
    });
    expect(result.value).toBe(36);
    expect(result.mismatchedWithConfig).toBe(false);
  });

  it('mismatchedWithConfig=true when SystemDefinition disagrees with config', () => {
    const result = resolveSystemPanelCount({
      systemDefinition: { layout: { totalPanels: 36 } },
      configFallback: 10,
    });
    expect(result.value).toBe(36);
    expect(result.source).toBe('system-definition');
    expect(result.mismatchedWithConfig).toBe(true);
  });

  it('floors fractional CAD totalPanels', () => {
    const result = resolveSystemPanelCount({
      cad: { totalPanels: 36.9 },
    });
    expect(result.value).toBe(36);
  });
});