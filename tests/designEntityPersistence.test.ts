/**
 * tests/designEntityPersistence.test.ts
 *
 * THE LAST TWO DESIGN ENTITIES THAT NEVER SURVIVED A RELOAD.
 *
 * 🚨 OBSTRUCTIONS ARE NOT ANNOTATIONS. removeObstructedPanels() runs against
 * them, so a vent, skylight, chimney, HVAC unit or dormer physically REMOVES
 * panels from the array. They lived only in SolarEngine3D component state, so
 * reloading a design silently re-filled panels over every one the user had
 * placed — and the panel count, the BOM, the production model and the permit
 * drawing all changed with it, with nothing to indicate anything was lost.
 *
 * Measurements are the field record taken off the model. Evidence, discarded on
 * unmount for the same reason.
 *
 * TWO ENTITIES, ONE WORD
 * ----------------------
 * 🚨 DesignStudio already had `obstructions: NearmapObstruction[]` — AI
 * DETECTIONS read off aerial imagery. The ones persisted here are
 * `PlacedObstruction[]`, the keep-outs a PERSON placed in the 3D engine. Two
 * different entities that both mean "obstruction"; the names are deliberately
 * kept apart (`placedObstructions`), and this file pins that, because saving
 * one as the other would be silent and wrong.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { layoutSignature, SIGNED_DESIGN_PARAMS } from '@/lib/roofPlanesSignature';
import type { PlacedObstruction, LayoutMeasurement } from '@/types';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const STUDIO = read('components/design/DesignStudio.tsx');
const ENGINE = read('components/3d/SolarEngine3D.tsx');
const ROUTE = read('app/api/projects/[id]/layout/route.ts');
const DB = read('lib/db/projects.ts');
const CORE = read('lib/db/core.ts');
const SQL_122 = read('lib/migrations/122_layout_obstructions_measurements.sql');

const vent = (id: string): PlacedObstruction => ({
  id, lat: 38.89, lng: -89.57, height: 142, radiusM: 0.6,
  widthM: 0.5, depthM: 0.5, heightM: 0.9, type: 'vent', label: 'Kitchen vent',
});
const measure = (id: string): LayoutMeasurement => ({
  id, a: { lat: 38.89, lng: -89.57, height: 142 }, b: { lat: 38.8901, lng: -89.57, height: 142 },
  horizDistM: 11.1, slopeDistM: 11.4,
});

describe('they can TRIGGER a save', () => {
  it('both are in the signed design parameters', () => {
    expect(SIGNED_DESIGN_PARAMS as readonly string[]).toContain('obstructions');
    expect(SIGNED_DESIGN_PARAMS as readonly string[]).toContain('measurements');
  });

  it('placing an obstruction changes the signature', () => {
    // Without this the edit schedules nothing: on a design where the panels do
    // not otherwise move, placing a vent was simply lost.
    const before = layoutSignature({ designParams: { obstructions: [] } });
    expect(layoutSignature({ designParams: { obstructions: [vent('o1')] } })).not.toBe(before);
  });

  it('deleting the last obstruction changes the signature', () => {
    const before = layoutSignature({ designParams: { obstructions: [vent('o1')] } });
    expect(layoutSignature({ designParams: { obstructions: [] } })).not.toBe(before);
  });

  it('editing an obstruction changes the signature', () => {
    const before = layoutSignature({ designParams: { obstructions: [vent('o1')] } });
    const moved = { ...vent('o1'), widthM: 1.2 };
    expect(layoutSignature({ designParams: { obstructions: [moved] } })).not.toBe(before);
  });

  it('taking a measurement changes the signature', () => {
    const before = layoutSignature({ designParams: { measurements: [] } });
    expect(layoutSignature({ designParams: { measurements: [measure('m1')] } })).not.toBe(before);
  });

  it('identical content signs identically — no churn', () => {
    const a = layoutSignature({ designParams: { obstructions: [vent('o1')], measurements: [measure('m1')] } });
    const b = layoutSignature({ designParams: { obstructions: [vent('o1')], measurements: [measure('m1')] } });
    expect(b).toBe(a);
  });
});

describe('the round trip', () => {
  it('an obstruction survives JSON storage with every keep-out field', () => {
    const revived: PlacedObstruction[] = JSON.parse(JSON.stringify([vent('o1')]));
    // radiusM/widthM/depthM/heightM are what removeObstructedPanels uses. Losing
    // any of them silently changes which panels come back.
    expect(revived[0]).toEqual(vent('o1'));
  });

  it('a measurement survives JSON storage', () => {
    const revived: LayoutMeasurement[] = JSON.parse(JSON.stringify([measure('m1')]));
    expect(revived[0]).toEqual(measure('m1'));
  });
});

describe('the whole persistence chain is wired — a miss anywhere drops the field silently', () => {
  it('the engine REPORTS and does not save', () => {
    // Single-writer architecture: DesignStudio owns the layout row.
    expect(ENGINE).toMatch(/onObstructionsChange\?:/);
    expect(ENGINE).toMatch(/onMeasurementsChange\?:/);
    expect(ENGINE).not.toMatch(/sendBeacon/);
    expect(ENGINE).not.toMatch(/fetch\(\s*`?\/api\/projects/);
  });

  it('obstructions are emitted from an EFFECT, not per mutation site', () => {
    // There are several mutation sites and a per-site callback is one somebody
    // eventually forgets — which is how these went unpersisted at all.
    expect(ENGINE).toMatch(/onObstructionsChange\?\.\(obstructions\)/);
    expect(ENGINE).toMatch(/skipFirstObstructionEmit/);
  });

  it('the studio sends both in the payload', () => {
    expect(STUDIO).toMatch(/obstructions: designParams\.obstructions/);
    expect(STUDIO).toMatch(/measurements: designParams\.measurements/);
  });

  it('🚨 the ROUTE destructures them — the step that drops a field with no error', () => {
    expect(ROUTE).toMatch(/obstructions, measurements,/);
  });

  it('the route merges with ?? existing, so [] can clear', () => {
    expect(ROUTE).toMatch(/obstructions:\s+obstructions\s+\?\? existingLayout\?\.obstructions/);
    expect(ROUTE).toMatch(/measurements:\s+measurements\s+\?\? existingLayout\?\.measurements/);
  });

  it('the db layer writes them', () => {
    expect(DB).toMatch(/SET obstructions = /);
    expect(DB).toMatch(/SET measurements = /);
  });

  it('the db layer reads them back', () => {
    expect(CORE).toMatch(/obstructions: \(row\.obstructions/);
    expect(CORE).toMatch(/measurements: \(row\.measurements/);
  });

  it('the studio restores them', () => {
    // They are no longer restored by two loose setter calls. Both entities are
    // SITE-BOUND, so they are restored as part of the site design bundle —
    // atomically, with panels and roof planes, by the one call that decides
    // which property the stored row describes (lib/design/siteDesignModel.ts).
    // Restoring them separately is exactly how they came apart: the old code
    // set panels unconditionally, split only the roof by site, and gave these
    // two no owner at all.
    expect(STUDIO).toMatch(/const hydrated = site\.hydrateFromStored\(\{/);
    expect(STUDIO).toMatch(/obstructions: restoredParams\.obstructions,/);
    expect(STUDIO).toMatch(/measurements: restoredParams\.measurements,/);
    // …and the hook is what actually drives the component state for them.
    expect(STUDIO).toMatch(/const \{ placedObstructions, setPlacedObstructions, measurements, setMeasurements \} = site;/);
  });

  it('the write degrades gracefully before migration 122 runs', () => {
    // Mirrors design_electrical: a separate conditional write, so the main
    // layout save never depends on the column existing.
    expect(DB).toMatch(/run migration 122/);
  });
});

describe('the two entities that share a word stay apart', () => {
  it('the PLACED keep-outs use a distinct name from the Nearmap DETECTIONS', () => {
    // `placedObstructions` now comes from useSiteDesign — it is site-bound, so
    // it is owned by the site design bundle rather than by a loose useState.
    // `obstructions` (the Nearmap AI DETECTIONS) is a per-site FETCH RESULT,
    // re-fetched rather than archived, and deliberately stays a plain useState.
    // Two different entities that both mean "obstruction"; keeping the names
    // apart is the only thing stopping one from being saved as the other.
    expect(STUDIO).toMatch(/const \{ placedObstructions, setPlacedObstructions, measurements, setMeasurements \} = site;/);
    expect(STUDIO).toMatch(/const \[obstructions, setObstructions\] = useState<NearmapObstruction\[\]>/);
    // The hook must declare the placed set as a site-bound entity, by that name.
    const HOOK = readFileSync(join(process.cwd(), 'components/design/useSiteDesign.ts'), 'utf8');
    expect(HOOK).toMatch(/placedObstructions: PlacedObstruction\[\]/);
  });

  it('what is persisted is the PLACED set', () => {
    expect(STUDIO).toMatch(/obstructions: placedObstructionsRef\.current/);
  });
});

describe('migration 122 itself', () => {
  const body = SQL_122.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');

  it('is idempotent — safe to run twice', () => {
    const adds = body.match(/ADD COLUMN/gi) ?? [];
    const guarded = body.match(/ADD COLUMN IF NOT EXISTS/gi) ?? [];
    expect(adds.length).toBe(2);
    expect(guarded.length).toBe(adds.length);
  });

  it('is non-destructive', () => {
    for (const op of ['DROP', 'DELETE', 'TRUNCATE', 'UPDATE ', 'INSERT']) {
      expect(body.toUpperCase().includes(op), `122 must not contain ${op}`).toBe(false);
    }
  });

  it('adds no default and no constraint — the gate admits only a bare ADD COLUMN', () => {
    expect(/ADD COLUMN IF NOT EXISTS \w+ JSONB NULL;/i.test(body)).toBe(true);
    expect(/DEFAULT/i.test(body)).toBe(false);
    expect(/NOT NULL/i.test(body)).toBe(false);
  });

  it('targets the layouts table only', () => {
    const tables = [...body.matchAll(/ALTER TABLE (\w+)/gi)].map(m => m[1]);
    expect(new Set(tables)).toEqual(new Set(['layouts']));
  });
});
