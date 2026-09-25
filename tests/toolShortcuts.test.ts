/**
 * tests/toolShortcuts.test.ts
 *
 * A TOOL THAT COSTS TWO CLICKS, FIFTEEN TIMES IN A ROW.
 *
 * SolarEngine3D had no letter shortcuts at all — every tool cost a click to
 * open its group plus a click to pick it, every single time. The tools that
 * suffer most are the ones you repeat: obstruction and tree.
 *
 * Aurora prints the accelerator on the tool row itself ("SmartRoof R",
 * "Draw Tree T") and repeats it in the tooltip ("FILL WITH MODULES (F)").
 * That is why its shortcuts get learned — they are never hidden behind a
 * cheatsheet nobody opens.
 *
 * Two things this file protects:
 *
 * 1. ONE MAP, BOTH CONSUMERS. The keydown handler and the printed letter must
 *    come from the same object. A separate display list drifts, and a button
 *    that advertises the WRONG key is worse than a button with no key.
 *
 * 2. THE SHORTCUT ARMS THE TOOL THE WAY THE BUTTON DOES. `activateTool` does
 *    real work beyond setting the mode — picking Tree sets the obstruction
 *    PRESET to tree, and leaving Tree resets it, or a vent is placed as a
 *    tree. A shortcut calling `onPlacementModeChange` directly would skip all
 *    of that and silently place the wrong object.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';
import { TOOL_SHORTCUTS, shortcutForMode } from '../components/3d/SolarEngine3D';

const SRC_PATH = join(__dirname, '..', 'components', '3d', 'SolarEngine3D.tsx');
const RAW = readFileSync(SRC_PATH, 'utf8');
const SRC = stripComments(RAW);

describe('the shortcut map is coherent', () => {
  it('every key is a single lowercase letter', () => {
    for (const k of Object.keys(TOOL_SHORTCUTS)) {
      expect(k, `"${k}" is not a bare lowercase letter`).toMatch(/^[a-z]$/);
    }
  });

  it('no two tools claim the same key', () => {
    const keys = Object.keys(TOOL_SHORTCUTS);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('no tool claims two keys', () => {
    const modes = Object.values(TOOL_SHORTCUTS);
    expect(new Set(modes).size, 'a tool with two keys makes the printed letter ambiguous')
      .toBe(modes.length);
  });

  it('every mapped mode is a real PlacementMode', () => {
    const m = RAW.match(/export type PlacementMode =([^;]+);/);
    expect(m).toBeTruthy();
    const modes = new Set((m![1].match(/'[a-z0-9_]+'/g) || []).map(s => s.slice(1, -1)));
    for (const target of Object.values(TOOL_SHORTCUTS)) {
      expect(modes.has(target), `${target} is not a PlacementMode`).toBe(true);
    }
  });

  it('never binds the idle mode — Escape already owns leaving a tool', () => {
    expect(Object.values(TOOL_SHORTCUTS)).not.toContain('select');
  });

  it('keeps T for Tree, the key Aurora uses', () => {
    // A roofer who knows one product should not have to unlearn it.
    expect(TOOL_SHORTCUTS.t).toBe('tree');
    expect(shortcutForMode('tree')).toBe('T');
  });

  it('shortcutForMode is the exact inverse of the map', () => {
    for (const [k, mode] of Object.entries(TOOL_SHORTCUTS)) {
      expect(shortcutForMode(mode)).toBe(k.toUpperCase());
    }
    // And silent for everything else, rather than inventing a letter.
    expect(shortcutForMode('select')).toBeNull();
    expect(shortcutForMode('pick_house')).toBeNull();
  });

  it('stays small — the point is fewer things to learn', () => {
    const n = Object.keys(TOOL_SHORTCUTS).length;
    expect(n).toBeGreaterThanOrEqual(6);
    expect(n, 'a letter for every mode is a cheatsheet, not a shortcut set')
      .toBeLessThanOrEqual(12);
  });
});

describe('the keyboard arms tools through the same path as the buttons', () => {
  /** The keydown handler body. */
  function handler(): string {
    const i = SRC.indexOf('function setupKeyboardHandler()');
    expect(i, 'setupKeyboardHandler was not found').toBeGreaterThan(-1);
    const end = SRC.indexOf("window.addEventListener('keydown', onKey)", i);
    expect(end).toBeGreaterThan(i);
    return SRC.slice(i, end);
  }

  it('it reads the shared map, not a second list of letters', () => {
    expect(handler()).toMatch(/TOOL_SHORTCUTS\[e\.key\.toLowerCase\(\)\]/);
  });

  it('🚨 it calls activateTool, NOT onPlacementModeChange directly', () => {
    const h = handler();
    const i = h.indexOf('TOOL_SHORTCUTS[e.key.toLowerCase()]');
    const branch = h.slice(i, i + 400);
    expect(branch, 'bypassing activateTool skips the preset reset and places the wrong object')
      .toMatch(/activateToolRef\.current\?\.\(shortcutMode\)/);
    expect(branch).not.toMatch(/onPlacementModeChange\(/);
  });

  it('it ignores modified keys, so browser and rotate bindings survive', () => {
    const h = handler();
    const i = h.indexOf('TOOL_SHORTCUTS[e.key.toLowerCase()]');
    const guard = h.slice(Math.max(0, i - 260), i);
    for (const mod of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) {
      expect(guard, `${mod} must not trigger a tool`).toMatch(new RegExp('!e\\.' + mod));
    }
    // '<' and '>' rotate the selected array and are Shift+comma/period.
    expect(SRC).toMatch(/e\.key === ',' \|\| e\.key === '<'/);
  });

  it('it never fires while the user is typing', () => {
    const h = handler();
    const typing = h.indexOf('keyEventIsTyping(e)');
    const shortcut = h.indexOf('TOOL_SHORTCUTS');
    expect(typing).toBeGreaterThan(-1);
    expect(typing, 'the typing guard must come first, or "t" in a name box plants a tree')
      .toBeLessThan(shortcut);
  });

  it('the ref is refreshed by the render, or it is frozen at mount', () => {
    expect(SRC).toMatch(/activateToolRef\.current = activateTool;/);
    // And declared as a ref, not state — the handler is installed once.
    expect(SRC).toMatch(/const activateToolRef = useRef</);
  });
});

describe('the letter is visible, or nobody learns it', () => {
  it('each shortcut tool prints its key on the button', () => {
    expect(SRC).toMatch(/data-testid=\{`tool-key-\$\{mode\}`\}/);
    expect(SRC, 'the printed letter must come from the shared map')
      .toMatch(/const key = shortcutForMode\(mode\);/);
  });

  it('the tooltip repeats it', () => {
    expect(SRC).toMatch(/label\+\(key\?' \('\+key\+'\)':''\)\+': '\+tip/);
  });

  it('a tool with no shortcut prints nothing rather than an empty badge', () => {
    expect(SRC).toMatch(/\{key \? \(/);
  });
});
