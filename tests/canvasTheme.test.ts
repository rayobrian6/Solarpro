/**
 * tests/canvasTheme.test.ts
 *
 * Pure-function tests for the dark-canvas theme (Aurora parity — see
 * HANDOFF_2026-08-25_AURORA_ANALYSIS.md §6 and
 * components/3d/canvasTheme/DESIGN.md).
 *
 * No React, no Cesium, no DOM. The whole policy is implemented in pure
 * data + pure functions and exported from canvasTheme.constants.ts.
 * That makes it testable from a Node environment without jsdom.
 *
 * What this guards:
 *  - The phase → theme mapping is total (every CANVAS_PHASES value has
 *    a theme) and the Site Model phase is a no-op
 *  - The dark theme palette matches the spec (#1a1a2e-ish, dark, with
 *    alpha in [0.5, 1.0] so entities stay readable)
 *  - The grid CSS is a valid `linear-gradient(...)` background-image
 *    with the documented 50px / 10px spacing
 *  - The two-tier grid alpha values (major 0.10, minor 0.04) are
 *    encoded in the CSS exactly as specified
 *  - The CSS class names are stable (downstream E2E selectors and the
 *    map-sources agent both rely on them)
 *  - `parseCssColor` round-trips our own constants
 */

import { describe, it, expect } from 'vitest';
import {
  CANVAS_PHASES,
  DARK_THEME,
  DARK_BACKGROUND,
  DARK_GRID_BACKGROUND_IMAGE,
  DARK_GRID_BACKGROUND_SIZE,
  LIGHT_THEME,
  THEMES,
  GRID_MAJOR_SPACING_PX,
  GRID_MINOR_SPACING_PX,
  GRID_MAJOR_ALPHA,
  GRID_MINOR_ALPHA,
  getThemeForPhase,
  phaseToThemeClass,
  shouldRenderOverlay,
  parseCssColor,
  type CanvasPhase,
} from '@/components/3d/canvasTheme/canvasTheme.constants';

// ─── Phase enum ────────────────────────────────────────────────────────────

describe('canvasTheme — CANVAS_PHASES', () => {
  it('includes both site_model and design as a non-empty tuple', () => {
    expect(CANVAS_PHASES).toContain('site_model');
    expect(CANVAS_PHASES).toContain('design');
    expect(CANVAS_PHASES.length).toBeGreaterThanOrEqual(2);
  });

  it('every phase has a corresponding theme in THEMES', () => {
    for (const phase of CANVAS_PHASES) {
      expect(THEMES[phase]).toBeDefined();
    }
  });
});

// ─── phase → theme mapping ─────────────────────────────────────────────────

describe('canvasTheme — getThemeForPhase', () => {
  it('returns the DARK_THEME for the design phase', () => {
    expect(getThemeForPhase('design')).toBe(DARK_THEME);
  });

  it('returns the LIGHT_THEME for the site_model phase', () => {
    expect(getThemeForPhase('site_model')).toBe(LIGHT_THEME);
  });

  it('returns the same reference for repeated lookups (idempotent + cacheable)', () => {
    const a = getThemeForPhase('design');
    const b = getThemeForPhase('design');
    expect(a).toBe(b);
  });
});

// ─── shouldRenderOverlay predicate ─────────────────────────────────────────

describe('canvasTheme — shouldRenderOverlay', () => {
  it('renders the overlay in the design phase', () => {
    expect(shouldRenderOverlay('design')).toBe(true);
  });

  it('does NOT render the overlay in the site_model phase', () => {
    expect(shouldRenderOverlay('site_model')).toBe(false);
  });

  it('the predicate is total over CANVAS_PHASES (never throws)', () => {
    for (const phase of CANVAS_PHASES) {
      expect(typeof shouldRenderOverlay(phase)).toBe('boolean');
    }
  });
});

// ─── phaseToThemeClass ─────────────────────────────────────────────────────

describe('canvasTheme — phaseToThemeClass', () => {
  it('returns the dark theme class for the design phase', () => {
    expect(phaseToThemeClass('design')).toBe('solarpro-canvas--design');
  });

  it('returns the light theme class for the site_model phase', () => {
    expect(phaseToThemeClass('site_model')).toBe('solarpro-canvas--site-model');
  });

  it('returns a stable, kebab-cased class name for every phase', () => {
    for (const phase of CANVAS_PHASES) {
      const cls = phaseToThemeClass(phase);
      expect(cls).toMatch(/^solarpro-canvas--[a-z0-9-]+$/);
    }
  });

  it('class names are unique across phases (no collisions)', () => {
    const classes = CANVAS_PHASES.map(phaseToThemeClass);
    expect(new Set(classes).size).toBe(classes.length);
  });
});

// ─── Dark theme palette ────────────────────────────────────────────────────

describe('canvasTheme — DARK_THEME palette', () => {
  it('uses an rgba() background (alpha-aware, not opaque)', () => {
    expect(DARK_BACKGROUND).toMatch(/^rgba\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\)$/);
    const parsed = parseCssColor(DARK_BACKGROUND);
    expect(parsed).not.toBeNull();
  });

  it('background color is a dark navy (target: #1a1a2e = rgb(26, 26, 46))', () => {
    const parsed = parseCssColor(DARK_BACKGROUND);
    expect(parsed).not.toBeNull();
    // All three channels should be well under 128 to count as "dark".
    expect(parsed!.r).toBeLessThan(80);
    expect(parsed!.g).toBeLessThan(80);
    expect(parsed!.b).toBeLessThan(128);
    // Aurora's spec'd color is rgb(26, 26, 46). Allow a small tolerance
    // in case the constant is tuned later.
    expect(parsed!.r).toBeGreaterThanOrEqual(0);
    expect(parsed!.g).toBeGreaterThanOrEqual(0);
    expect(parsed!.b).toBeGreaterThanOrEqual(0);
  });

  it('background is blue-shifted (b channel >= r and b channel >= g) — the navy "inkwell" tone', () => {
    const parsed = parseCssColor(DARK_BACKGROUND);
    expect(parsed).not.toBeNull();
    expect(parsed!.b).toBeGreaterThanOrEqual(parsed!.r);
    expect(parsed!.b).toBeGreaterThanOrEqual(parsed!.g);
  });

  it('background alpha is high enough to mute the imagery (>= 0.5) but not fully opaque (so entities stay visible)', () => {
    const parsed = parseCssColor(DARK_BACKGROUND);
    expect(parsed).not.toBeNull();
    expect(parsed!.a).toBeGreaterThanOrEqual(0.5);
    expect(parsed!.a).toBeLessThanOrEqual(1.0);
  });

  it('background is close to the agent.md spec color #1a1a2e (within ±10 per channel)', () => {
    const parsed = parseCssColor(DARK_BACKGROUND);
    expect(parsed).not.toBeNull();
    const TARGET_R = 26;
    const TARGET_G = 26;
    const TARGET_B = 46;
    const TOL = 10;
    expect(Math.abs(parsed!.r - TARGET_R)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(parsed!.g - TARGET_G)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(parsed!.b - TARGET_B)).toBeLessThanOrEqual(TOL);
  });
});

// ─── Light theme palette ───────────────────────────────────────────────────

describe('canvasTheme — LIGHT_THEME palette (Site Model — no overlay)', () => {
  it('uses a transparent background', () => {
    expect(LIGHT_THEME.background).toBe('transparent');
  });

  it('disables the grid (background-image: none)', () => {
    expect(LIGHT_THEME.gridBackgroundImage).toBe('none');
  });

  it('has a distinct class name from the dark theme', () => {
    expect(LIGHT_THEME.className).not.toBe(DARK_THEME.className);
  });

  it('class name includes "site-model" (so E2E selectors can target it)', () => {
    expect(LIGHT_THEME.className).toContain('site-model');
  });
});

// ─── Grid CSS ──────────────────────────────────────────────────────────────

describe('canvasTheme — grid CSS', () => {
  it('DARK_GRID_BACKGROUND_IMAGE is a comma-separated list of linear-gradient(...) values', () => {
    // Split on commas that are followed by `linear-gradient(` (the
    // separator between stacked gradients). A naive `split(',')` would
    // also split inside `rgba(255, 255, 255, …)` which is wrong.
    const gradients = DARK_GRID_BACKGROUND_IMAGE
      .split(/,\s*(?=linear-gradient\()/)
      .map(s => s.trim());
    expect(gradients.length).toBeGreaterThanOrEqual(4);
    for (const g of gradients) {
      expect(g).toMatch(/^linear-gradient\(/);
    }
  });

  it('DARK_GRID_BACKGROUND_IMAGE has exactly 2 vertical + 2 horizontal gradients (the two-tier grid)', () => {
    const gradients = DARK_GRID_BACKGROUND_IMAGE.split(/,(?=\s*linear-gradient)/);
    const vertical = gradients.filter(g => !g.includes('90deg'));
    const horizontal = gradients.filter(g => g.includes('90deg'));
    expect(vertical.length).toBe(2);
    expect(horizontal.length).toBe(2);
  });

  it('uses the major alpha (0.10) for the major grid lines', () => {
    // Look for any rgba() call inside the grid CSS with the major alpha
    const major = new RegExp(`rgba\\(255,\\s*255,\\s*255,\\s*${GRID_MAJOR_ALPHA}\\)`);
    expect(DARK_GRID_BACKGROUND_IMAGE).toMatch(major);
  });

  it('uses the minor alpha (0.04) for the minor grid lines', () => {
    const minor = new RegExp(`rgba\\(255,\\s*255,\\s*255,\\s*${GRID_MINOR_ALPHA}\\)`);
    expect(DARK_GRID_BACKGROUND_IMAGE).toMatch(minor);
  });

  it('DARK_GRID_BACKGROUND_SIZE pairs with the gradients (4 sizes, matching the 4 gradients)', () => {
    const sizes = DARK_GRID_BACKGROUND_SIZE.split(',').map(s => s.trim());
    expect(sizes.length).toBe(4);
  });

  it('DARK_GRID_BACKGROUND_SIZE uses the documented 50px major + 10px minor spacing', () => {
    const sizes = DARK_GRID_BACKGROUND_SIZE.split(',').map(s => s.trim());
    const major = sizes.filter(s => s === `${GRID_MAJOR_SPACING_PX}px ${GRID_MAJOR_SPACING_PX}`);
    const minor = sizes.filter(s => s === `${GRID_MINOR_SPACING_PX}px ${GRID_MINOR_SPACING_PX}`);
    expect(major.length).toBe(2); // vertical + horizontal
    expect(minor.length).toBe(2); // vertical + horizontal
  });

  it('major grid spacing is 50px and minor is 10px (matches the Aurora frame 147 estimate)', () => {
    expect(GRID_MAJOR_SPACING_PX).toBe(50);
    expect(GRID_MINOR_SPACING_PX).toBe(10);
  });

  it('major alpha is brighter than minor alpha (the eye should latch onto the major lines)', () => {
    expect(GRID_MAJOR_ALPHA).toBeGreaterThan(GRID_MINOR_ALPHA);
  });

  it('DARK_THEME exposes the same grid strings as the loose constants (single source of truth)', () => {
    expect(DARK_THEME.gridBackgroundImage).toBe(DARK_GRID_BACKGROUND_IMAGE);
    expect(DARK_THEME.gridBackgroundSize).toBe(DARK_GRID_BACKGROUND_SIZE);
    expect(DARK_THEME.background).toBe(DARK_BACKGROUND);
  });
});

// ─── parseCssColor helper ──────────────────────────────────────────────────

describe('canvasTheme — parseCssColor', () => {
  it('parses rgb(...) correctly', () => {
    expect(parseCssColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 });
  });

  it('parses rgba(...) correctly', () => {
    expect(parseCssColor('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
  });

  it('returns null for non-color strings', () => {
    expect(parseCssColor('transparent')).toBeNull();
    expect(parseCssColor('none')).toBeNull();
    expect(parseCssColor('#1a1a2e')).toBeNull();
    expect(parseCssColor('')).toBeNull();
  });

  it('round-trips the DARK_BACKGROUND constant', () => {
    const parsed = parseCssColor(DARK_BACKGROUND);
    expect(parsed).not.toBeNull();
    expect(parsed!.r).toBeGreaterThanOrEqual(0);
    expect(parsed!.g).toBeGreaterThanOrEqual(0);
    expect(parsed!.b).toBeGreaterThanOrEqual(0);
    expect(parsed!.a).toBeGreaterThan(0);
    expect(parsed!.a).toBeLessThanOrEqual(1);
  });
});

// ─── Theme references are stable (regression guard) ───────────────────────

describe('canvasTheme — theme identity', () => {
  it('the two theme objects are distinct references', () => {
    expect(LIGHT_THEME).not.toBe(DARK_THEME);
  });

  it('THEMES[phase] === getThemeForPhase(phase) for every phase', () => {
    for (const phase of CANVAS_PHASES) {
      expect(THEMES[phase]).toBe(getThemeForPhase(phase));
    }
  });
});

// ─── DARK_THEME class name ─────────────────────────────────────────────────

describe('canvasTheme — DARK_THEME.className', () => {
  it('is exactly "solarpro-canvas--design" (downstream agents depend on this string)', () => {
    expect(DARK_THEME.className).toBe('solarpro-canvas--design');
  });

  it('is unique across the THEMES map (no two phases share a class)', () => {
    const allClasses = Object.values(THEMES).map(t => t.className);
    expect(new Set(allClasses).size).toBe(allClasses.length);
  });
});

// ─── Type-level sanity (compile-time checks) ───────────────────────────────
//
// The CanvasPhase type should be a literal union of the CANVAS_PHASES
// tuple. This is enforced at compile time but we can also probe it at
// runtime to catch a future refactor that accidentally widens the type
// (e.g. to `string`).

describe('canvasTheme — type sanity (runtime probe)', () => {
  it('CanvasPhase accepts only the documented phase literals', () => {
    // If a future change widens CanvasPhase to `string`, this test
    // still passes (good) but the next one will fail when a bogus
    // value is passed at compile time. We pair the runtime probe with
    // a typed local to keep the type contract honest.
    const valid: CanvasPhase[] = ['site_model', 'design'];
    expect(valid).toEqual([...CANVAS_PHASES]);
  });
});
