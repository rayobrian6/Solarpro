/**
 * tests/buildingModeJourney.test.ts
 *
 * THE PRODUCT MUST NAME THE OBJECT A TOOL CREATES, WHERE THE TOOL IS CHOSEN.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE OWNER'S REPORT, AND WHAT A UX AUDIT FOUND BEHIND IT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   "I was already in Building mode when I traced this geometry. That means the
 *    product allowed me to create a state that later became difficult to edit
 *    correctly. SolarPro should be difficult to use incorrectly. I should not
 *    need to understand internal distinctions such as standalone RoofPlane,
 *    BuildingSection-owned face, section scope, face scope, just to model a
 *    house."
 *
 * 🏚 Building is a RENDER toggle — it extrudes walls for the view. It changes no
 * tool and never did: `activateTool` does not read it, and neither does any
 * finalize path. So "in Building mode" was true and irrelevant.
 *
 * Meanwhile the only three tools that produce a BuildingSection — Gable, Hip and
 * Block — sat in "📏 Tools", between Obstruction and a decorative Tree, while
 * the group a person opens first, "🏠 Place", offered Mark Plane and Custom
 * Array, which produce a SINGLE STANDALONE FACE with no wall, pad or ridge. The
 * product required the user to know the very distinction they said they should
 * not have to know, in order to pick a tool — and then offered the wrong one
 * first, and advertised the missing capability afterwards:
 *
 *   - the dock chip read "⬡ Inspector → this section" for ANY selected face,
 *     while the inspector simultaneously read "not part of a building section"
 *   - the Section level chip was lit for a standalone face and did nothing
 *   - turning 🏚 Building on with nothing built said "trace a roof face first",
 *     which sends the reader to Mark Plane, the tool that cannot build one
 *   - the inspector's remedy, "trace it as a building section", named no
 *     control and silently meant "delete, re-trace, and lose your panels"
 *
 * These are source guards because the defect is one of NAMING AND PLACEMENT:
 * every function behaved as designed. What was wrong was what the product said.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const ENGINE = strip(read('components/3d/SolarEngine3D.tsx'));
const INSPECTOR = strip(read('components/3d/inspector/SectionInspector.tsx'));

/** The tool-group table, as the source declares it. */
function groupOf(mode: string): string | null {
  // Each group is `id: '<name>', icon: …, label: …,` followed by its tools.
  const ids = [...ENGINE.matchAll(/id: '(place|building|auto|tools)',\s*icon:/g)];
  const at = ENGINE.indexOf(`mode: '${mode}'`);
  if (at < 0) return null;
  let found: string | null = null;
  for (const m of ids) if (m.index! < at) found = m[1];
  return found;
}

// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 the tools that build a BUILDING are filed under Building', () => {
  it('Gable, Hip and Block are in the Building group', () => {
    for (const mode of ['roof_gable', 'roof_hip', 'block']) {
      expect(groupOf(mode), `${mode} is not in the Building group`).toBe('building');
    }
  });

  it('…and the group exists, second in the spine, before Auto and Tools', () => {
    const building = ENGINE.indexOf("id: 'building',");
    const place = ENGINE.indexOf("id: 'place',");
    const auto = ENGINE.indexOf("id: 'auto',");
    const tools = ENGINE.indexOf("id: 'tools',");
    expect(building, 'there is no Building group').toBeGreaterThan(-1);
    expect(building).toBeGreaterThan(place);
    expect(building).toBeLessThan(auto);
    expect(building).toBeLessThan(tools);
  });

  it('🚨 they are NOT still filed under Tools as well — one home per tool', () => {
    // Two homes for one tool is two answers to "where do I model a house".
    for (const mode of ['roof_gable', 'roof_hip', 'block']) {
      expect((ENGINE.match(new RegExp(`mode: '${mode}'`, 'g')) ?? []).length,
        `${mode} is declared in more than one group`).toBe(1);
    }
    // Positive control: Tools still exists and still holds its own tools.
    expect(groupOf('measure')).toBe('tools');
    expect(groupOf('obstruction')).toBe('tools');
  });

  it('the single-face tools SAY they make a single face, and where to go instead', () => {
    for (const mode of ['mark_plane', 'plane3d']) {
      const at = ENGINE.indexOf(`mode: '${mode}'`);
      const line = ENGINE.slice(at, ENGINE.indexOf('\n', at));
      expect(line, `${mode} does not say it makes ONE face`).toMatch(/ONE roof face/);
      expect(line, `${mode} does not say what it lacks`).toMatch(/no wall height, no pad, no ridge/);
      expect(line, `${mode} does not point at the Building group`).toMatch(/Building group/);
      // …and they are still where panels are placed from.
      expect(groupOf(mode)).toBe('place');
    }
  });
});

describe('🚨 nothing claims a capability a standalone face does not have', () => {
  it('the dock chip distinguishes a section from a single face', () => {
    expect(ENGINE).toMatch(/selectedFaceHasSection/);
    expect(ENGINE).toMatch(/Single roof face/);
    // 🚨 THE OLD TEXT, ASSERTED AGAINST: it claimed a section for every face.
    expect(ENGINE).not.toMatch(/activeFaceId \? '\\u2B21 Inspector/);
  });

  it('…and the flag requires the RECORD, not a face id that merely parses', () => {
    // A face whose section record is missing can be measured but not edited as
    // a volume, and saying "section" about it is the same contradiction.
    expect(ENGINE).toMatch(/inspectorPlanes\.find\(p => p\.id === activeFaceId\)\?\.section\)/);
  });

  it('the Section level chip is not lit for a face that has no section', () => {
    expect(INSPECTOR).toMatch(
      /levelChip\('section', 'Section', state\.level === 'section',\s*\n?\s*!!s \|\| !!\(f && f\.sectionId\) \|\| !!\(w && w\.sectionId\)\)/);
  });

  it('turning Building on with nothing built names the tools that can build one', () => {
    const at = ENGINE.indexOf('Nothing to extrude yet');
    expect(at, 'the empty-state message is gone').toBeGreaterThan(-1);
    const msg = ENGINE.slice(at, ENGINE.indexOf('\n', at));
    expect(msg).toMatch(/Gable, Hip or Flat\/Block/);
    // 🚨 THE OLD TEXT sent the reader to the tool that cannot do it.
    expect(ENGINE).not.toMatch(/No roof faces yet — trace a roof face first/);
  });

  it('🚨 the standalone advice names a real control AND states its cost', () => {
    const at = INSPECTOR.indexOf('This is a single traced face');
    expect(at, 'the standalone advice is gone').toBeGreaterThan(-1);
    const block = INSPECTOR.slice(at, at + 700);
    expect(block, 'it does not name the tools').toMatch(/Gable, Hip or Flat\/Block/);
    // Re-tracing mints new face ids, so every panel on the old face orphans.
    // Telling only the first half sends a person to lose an array silently.
    expect(block, 'it does not say the panels would have to be laid again')
      .toMatch(/panels on this one would have to be laid again/);
    // 🚨 THE OLD TEXT named an action that does not exist anywhere.
    expect(INSPECTOR).not.toMatch(/Trace it as a building section to get real/);
  });
});

describe('🚨 the Building toggle is still only a view, and is not pretended otherwise', () => {
  it('no tool activation reads it — that is the honest fact the UI now works with', () => {
    // The fix is NOT to make the toggle secretly change tools. A view control
    // that silently re-aims the palette is a mode error waiting to happen. The
    // fix is that the palette names what it builds, so the toggle does not have
    // to carry a meaning it never had.
    const at = ENGINE.indexOf('const activateTool = (mode: PlacementMode) => {');
    expect(at).toBeGreaterThan(-1);
    const body = ENGINE.slice(at, at + 1800);
    expect(body).not.toMatch(/showBuilding3D/);
  });
});
