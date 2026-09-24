/**
 * tests/toolFlyoutIsClickable.test.ts
 *
 * EVERY OVERLAY CONTROL MUST BE REACHABLE BY A REAL CLICK.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT COST
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Twenty floating panels over the 3D canvas each chose their own z-index —
 * 20, 25, 50, 51, 52, 53, 60, 62 — and eleven of them chose 50, where nothing
 * decides the order but the sequence they are written in.
 *
 * 🚨 AN AUDIT FOUND EIGHTEEN CONTROLS A CLICK COULD NOT REACH. Measured with
 * `document.elementFromPoint` at each control's own centre, in a real browser:
 *
 *   - The tool spine's SELECT arrow — the default tool — returned the LiDAR
 *     properties panel, so clicking it nudged that panel's offset steppers.
 *   - Of the five buttons in the Tools flyout, only the BOTTOM one returned
 *     itself. Measure, Obstruction, Direction and Origin were all covered.
 *   - Of the nine obstruction TYPE chips, only Tree was reachable. Chimney,
 *     vent, skylight, hatch and HVAC were under the instructions text.
 *   - The top-left dock's "Building" toggle was 100% covered, and
 *     `setShowBuilding3D` has exactly one call site in ~16k lines — that button.
 *     So the solid-building view had no reachable entry point at all.
 *   - The Gable/Hip ROOF PITCH slider was under the instructions text.
 *
 * Every one looked normal — correct cursor, correct hover, no feedback. The
 * owner's report was "Chimney may also not be wired end-to-end". The wiring was
 * perfect; the BUTTON could not be pressed. Twice over: Chimney is a type inside
 * the Obstruction tool, and BOTH the tool button and the type chip were buried.
 *
 * 🚨 AND A FORCED CLICK HIDES THIS RATHER THAN SURVIVING IT. `force: true` skips
 * the actionability CHECK; the event is still dispatched at the element's
 * coordinates and still lands on whatever is painted on top. A forced click
 * reports a passing control that no person can press.
 *
 * So the order is now declared once, by role, in `lib/3d/overlayLayers.ts`, and
 * this file holds that file to its own rules.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { OVERLAY_Z } from '@/lib/3d/overlayLayers';

const ENGINE = fs.readFileSync(
  path.join(process.cwd(), 'components/3d/SolarEngine3D.tsx'),
  'utf8',
);

/** Every `<DraggablePanel id="..." zIndex={...}>` and the expression it uses. */
function panels(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of ENGINE.matchAll(
    /<DraggablePanel\s+id="([a-z0-9-]+)"\s+zIndex=\{([^}]+)\}/g,
  )) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

describe('🚨 no overlay panel may invent its own z-index', () => {
  it('every panel takes a named layer from the authority', () => {
    const all = panels();
    expect(Object.keys(all).length, 'no panels found — the matcher is broken')
      .toBeGreaterThan(15);

    const bare = Object.entries(all)
      .filter(([, expr]) => !expr.includes('OVERLAY_Z.'))
      .map(([id, expr]) => `${id}={${expr}}`);
    expect(
      bare,
      'these panels chose a number instead of a layer. A number cannot be ' +
      'ordered against the others, and eleven panels picking 50 is how ' +
      'eighteen controls became unclickable: ' + bare.join(', '),
    ).toEqual([]);
  });

  it('🚨 and every layer it names actually exists', () => {
    const named = new Set<string>();
    for (const expr of Object.values(panels())) {
      for (const m of expr.matchAll(/OVERLAY_Z\.([A-Z_]+)/g)) named.add(m[1]);
    }
    expect(named.size).toBeGreaterThan(4);
    const unknown = [...named].filter(n => !(n in OVERLAY_Z));
    expect(unknown, `not a layer in overlayLayers.ts: ${unknown.join(', ')}`).toEqual([]);
  });
});

describe('🚨 the order says what a person is doing', () => {
  it('reading loses to working, working loses to deciding', () => {
    // The whole point of the file, asserted as one chain. If a later edit
    // reshuffles these, the audit's eighteen findings come back.
    const order: Array<keyof typeof OVERLAY_Z> = [
      'READOUT', 'REFERENCE', 'DATA', 'BASEMAP',
      'DOCK', 'DOCK_OVER', 'ACTION', 'PLACEMENT', 'INSPECTOR', 'MENU', 'MODAL',
    ];
    for (let i = 1; i < order.length; i++) {
      expect(
        OVERLAY_Z[order[i]],
        `${order[i]} must outrank ${order[i - 1]}`,
      ).toBeGreaterThan(OVERLAY_Z[order[i - 1]]);
    }
    expect(OVERLAY_Z.TOOLTIP, 'the tooltip must never be occluded')
      .toBeGreaterThan(OVERLAY_Z.MODAL);
  });

  it('🚨 the thing you SELECTED outranks the thing you ARMED', () => {
    // A live P0: with an object selected and the Obstruction tool armed, the
    // inspector's "Delete this chimney" button and all four of its dimension
    // fields sat under the placement panel. You could not delete or resize the
    // object you had picked, and a click aimed at its Height field pressed a
    // preset chip instead.
    expect(OVERLAY_Z.INSPECTOR, 'the inspector is buried under the placement panel')
      .toBeGreaterThan(OVERLAY_Z.PLACEMENT);
    expect(panels()['obstruction-inspector']).toBe('OVERLAY_Z.INSPECTOR');
    expect(panels()['section-inspector']).toBe('OVERLAY_Z.INSPECTOR');
  });

  it('🚨 controls outrank the text that explains them', () => {
    // instructions-panel covered the obstruction type chips, the Gable/Hip
    // pitch slider, the ground-mount tilt select and the racking toggles —
    // all because it shared their z-index and was written later in the file.
    expect(OVERLAY_Z.DOCK, 'the help text still covers the controls')
      .toBeGreaterThan(OVERLAY_Z.REFERENCE);
    expect(panels()['instructions-panel']).toBe('OVERLAY_Z.REFERENCE');

    // lidar-properties buried the Select tool and the whole top-left dock.
    expect(OVERLAY_Z.DOCK, 'the LiDAR panel still covers the tool spine and the dock')
      .toBeGreaterThan(OVERLAY_Z.DATA);
    expect(panels()['lidar-properties']).toBe('OVERLAY_Z.DATA');
    expect(panels()['top-left-dock']).toBe('OVERLAY_Z.DOCK');
  });

  it('🚨 an open flyout is a menu and wins', () => {
    const spine = panels()['tool-spine'];
    expect(spine, 'the tool spine no longer changes layer when a group opens')
      .toBe('openGroup ? OVERLAY_Z.MENU : OVERLAY_Z.DOCK');
    expect(OVERLAY_Z.MENU).toBeGreaterThan(OVERLAY_Z.INSPECTOR);
  });

  it('the placement panel rises only while a tool is armed', () => {
    expect(panels()['top-right-stack'])
      .toBe('isPlacingObject ? OVERLAY_Z.PLACEMENT : OVERLAY_Z.DOCK');
  });

  it('🚨 nothing on the READOUT layer contains a control', () => {
    // READOUT is the bottom of the scale — it loses to every other panel. That
    // is correct for text a person reads and never clicks, and silently fatal
    // for anything with a button in it. Six panels were demoted to this layer
    // when the scale was introduced; each was checked, and this keeps the next
    // one honest.
    const readout = Object.entries(panels())
      .filter(([, expr]) => expr === 'OVERLAY_Z.READOUT')
      .map(([id]) => id);
    expect(readout.length, 'no READOUT panels found — the matcher is broken')
      .toBeGreaterThan(3);

    const withControls: string[] = [];
    for (const id of readout) {
      const at = ENGINE.indexOf(`<DraggablePanel id="${id}"`);
      // To the next panel, or 2500 chars, whichever comes first.
      const next = ENGINE.indexOf('<DraggablePanel id="', at + 20);
      const block = ENGINE.slice(at, next === -1 ? at + 2500 : Math.min(next, at + 2500));
      if (/onClick=|<button/.test(block)) withControls.push(id);
    }
    expect(
      withControls,
      'these panels are on the bottom layer but contain something clickable, so ' +
      'every other panel will cover it: ' + withControls.join(', '),
    ).toEqual([]);
  });

  it('🚨 raising the spine cannot blanket the canvas — the wrapper stays click-through', () => {
    // Why a high z-index is safe here at all: the wrapper is a transparent
    // full-height box. If it became interactive it would swallow canvas clicks
    // across the middle of the screen — worse than the bug being fixed.
    const at = ENGINE.indexOf('<DraggablePanel id="tool-spine"');
    expect(ENGINE.slice(at, at + 400), 'the spine wrapper is no longer pointerEvents:none')
      .toContain("pointerEvents: 'none'");
  });
});
