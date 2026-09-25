/**
 * tests/activeModeIsAnnounced.test.ts
 *
 * YOU MUST NEVER BE IN A TOOL WITHOUT BEING TOLD WHICH ONE.
 *
 * SolarEngine3D has 24 armed placement modes. It announced the armed one as a GOLD
 * ICON on a collapsible group header, inside a panel the user can drag
 * anywhere, with the tool's NAME visible only while that group's flyout
 * happened to be open. So "why did clicking the roof just plant another
 * chimney" was answerable only by recognising a glyph, somewhere on screen.
 *
 * That is hidden state, and it is the mode error this file exists to prevent.
 * Aurora uses one grammar for every drawing mode and never varies it — help,
 * the mode's NAME IN WORDS, then the exit, always in the same place — and says
 * the escape key out loud in its own tutorial. The banner is what makes the
 * Escape fix (see tests/screenSpaceHandlerRegistration.test.ts) discoverable
 * rather than folklore.
 *
 * 🚨 THE NAMING AUTHORITY IS THE POINT. The banner reads its label out of the
 * same `groups` catalogue the palette buttons render from. A second mode->name
 * map would drift from the buttons the first time anyone renamed a tool, and
 * then the banner would confidently name the wrong tool — worse than silence.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';

const SRC_PATH = join(__dirname, '..', 'components', '3d', 'SolarEngine3D.tsx');
const RAW = readFileSync(SRC_PATH, 'utf8');
const SRC = stripComments(RAW);

/**
 * The banner's JSX, from its testid to the end of the guarded block.
 *
 * 🚨 SLICED TO A REAL ANCHOR, NOT A CHARACTER COUNT. A fixed slice is a guess
 * at the block's length, and `stripComments` blanks comments to whitespace
 * rather than deleting them — so adding a comment inside the banner pushes
 * real code out of the window and fails the guard for a reason that has
 * nothing to do with what it guards. That happened here, and in
 * screenSpaceHandlerRegistration, on the same day.
 */
function banner(): string {
  const i = SRC.indexOf('data-testid="active-mode-banner"');
  expect(i, 'the active-mode banner was not found').toBeGreaterThan(-1);
  const end = SRC.indexOf('})()) : null}', i);
  expect(end, 'the end of the banner block was not found').toBeGreaterThan(i);
  return SRC.slice(i, end);
}

describe('the armed tool is announced in words', () => {
  it('a banner exists and renders only when a tool is armed', () => {
    const i = SRC.indexOf('data-testid="active-mode-banner"');
    expect(i).toBeGreaterThan(-1);
    // The guard sits just above the element it controls.
    const before = SRC.slice(Math.max(0, i - 900), i);
    expect(before, "the banner must not show in the editor's idle mode")
      .toMatch(/placementMode !== 'select'/);
  });

  it('it names the tool from the SAME catalogue the buttons use', () => {
    const b = banner();
    const before = SRC.slice(Math.max(0, SRC.indexOf('data-testid="active-mode-banner"') - 900),
                            SRC.indexOf('data-testid="active-mode-banner"'));
    // Not a second mode->label map: it looks the mode up in `groups`.
    expect(before, 'the label must come from the tool catalogue, not a second map')
      .toMatch(/groups\.flatMap\(g => g\.tools\)\.find\(t => t\.mode === placementMode\)/);
    expect(b + before, 'it must render the catalogue label').toMatch(/activeTool\.label/);
  });

  it('a mode with no palette button is still named, never left blank', () => {
    const before = SRC.slice(Math.max(0, SRC.indexOf('data-testid="active-mode-banner"') - 900),
                            SRC.indexOf('data-testid="active-mode-banner"'));
    // ground_array, measurements, ruler and plane are armed modes with no
    // button. Silence for those would reintroduce exactly the hidden state.
    expect(before).toMatch(/placementMode\.replace\(/);
  });

  it('it carries an exit control that actually leaves the tool', () => {
    const b = banner();
    expect(b).toMatch(/data-testid="active-mode-exit"/);
    expect(b, 'the exit must return to the idle mode')
      .toMatch(/onClick=\{\(\) => onPlacementModeChange\('select'\)\}/);
  });

  it('the exit says ESC, so the keyboard route is discoverable', () => {
    const b = banner();
    expect(b, 'the banner must name the key, or Escape stays folklore')
      .toMatch(/ESC/);
    expect(b, 'and it must be labelled for assistive tech')
      .toMatch(/aria-label=\{'Leave ' \+ label \+ ' \(Escape\)'\}/);
  });

  it('it offers the mode help without leaving the mode', () => {
    const b = banner();
    expect(b).toMatch(/data-testid="active-mode-help"/);
    expect(b, 'help must use the catalogue tip, not new prose').toMatch(/tip/);
  });
});

describe('the banner cannot be lost or occluded', () => {
  it('it is NOT a DraggablePanel', () => {
    const i = SRC.indexOf('data-testid="active-mode-banner"');
    const around = SRC.slice(Math.max(0, i - 400), i);
    // An announcement the user can drag behind their own layout is not an
    // announcement.
    expect(around).not.toMatch(/<DraggablePanel[^>]*$/);
  });

  it('it takes a NAMED layer from the overlay authority, not a bare number', () => {
    const b = banner();
    expect(b, 'z-index whack-a-mole is how the last 18 unreachable controls happened')
      .toMatch(/zIndex: OVERLAY_Z\.[A-Z_]+/);
    // PLACEMENT is the layer whose documented meaning is "the tool that is
    // ARMED right now", which is exactly what this banner reports.
    expect(b).toMatch(/zIndex: OVERLAY_Z\.PLACEMENT/);
  });

  it('it is clickable — the exit is useless behind pointer-events:none', () => {
    const b = banner();
    expect(b).toMatch(/pointerEvents: 'auto'/);
  });

  it('it sits top-centre, and STACKS with the roof wizard instead of on it', () => {
    const b = banner();
    expect(b).toMatch(/left: '50%'/);
    // 🚨 The offset is not a constant. At a fixed 54 this banner sat on the
    // wizard's step 1, and at 10 it buried Street View and LiDAR — both
    // caught by e2e/mode-banner-acceptance.spec.ts, which hit-tests every
    // control. The vertical position must therefore depend on whether the
    // other top-centre strip is showing.
    expect(b, 'the banner must move when the wizard is up')
      .toMatch(/top: isRoofDrawMode\(placementMode\) \? \d+ : \d+/);

    // And it must key off the SAME predicate the wizard mounts on, or the two
    // can disagree about whether the wizard is on screen.
    const m = b.match(/top: isRoofDrawMode\(placementMode\) \? (\d+) : (\d+)/);
    expect(m).toBeTruthy();
    const [withWizard, alone] = [Number(m![1]), Number(m![2])];
    expect(withWizard, 'the wizard is above it, so the offset must be larger')
      .toBeGreaterThan(alone);
    expect(alone, 'it must clear the map-source toolbar band, measured at 44')
      .toBeGreaterThan(44);
  });

  it('the wizard predicate is imported, not re-implemented', () => {
    expect(SRC, 'a local copy of isRoofDrawMode would drift from the wizard')
      .toMatch(/import \{ RoofWizard, isRoofDrawMode \} from '\.\/wizard'/);
  });
});

describe('every armed mode can be named', () => {
  it('the PlacementMode union is still what this guard assumes', () => {
    const m = RAW.match(/export type PlacementMode =([^;]+);/);
    expect(m, 'the PlacementMode union was not found').toBeTruthy();
    const modes = (m![1].match(/'[a-z0-9_]+'/g) || []).map(s => s.slice(1, -1));
    expect(modes).toContain('select');
    expect(modes).toContain('tree');
    expect(modes).toContain('obstruction');
    // If this count moves, a new mode was added — check it is either in the
    // palette catalogue or still readable through the humanised fallback.
    // 25 total = the idle mode 'select' plus 24 that can be ARMED.
    expect(modes.length, 'a placement mode was added or removed').toBe(25);
    expect(modes.filter(x => x !== 'select').length,
      'every one of these must be nameable by the banner').toBe(24);
  });

  it('the humanised fallback produces something readable for every mode', () => {
    const m = RAW.match(/export type PlacementMode =([^;]+);/);
    const modes = (m![1].match(/'[a-z0-9_]+'/g) || []).map(s => s.slice(1, -1));
    for (const mode of modes) {
      const shown = mode.replace(/_/g, ' ');
      expect(shown.length, mode + ' renders blank').toBeGreaterThan(0);
      expect(shown, mode + ' still shows an underscore to the user').not.toMatch(/_/);
    }
  });
});
