/**
 * tests/qualityLadderScope.test.ts
 *
 * TWO SEPARATE CAPABILITIES THAT KEEP GETTING CONFLATED.
 *
 * Commit e6584935 made /api/dsm and /api/solar-rgb walk HIGH -> MEDIUM -> BASE,
 * because asking only for HIGH returned nothing at rural Illinois addresses. It
 * is regularly described as "the fix that makes Lane A work at Pocahontas".
 *
 * 🚨 IT IS NOT. Lane A's roof segments come from the digital twin, which calls
 * `/api/solar?endpoint=buildingInsights&quality=MEDIUM` (lib/digitalTwin.ts).
 * That route has no ladder at all — its quality is a plain query parameter, and
 * buildingInsights has been pinned at MEDIUM since long before e6584935. So:
 *
 *   • If Lane A fails at an address, the ladder is NOT the reason, and changing
 *     the ladder will not help.
 *   • The inconsistency is what HID the DSM bug: building detection worked at
 *     addresses where the DSM did not, because they ask different tiers.
 *
 * These tests exist so that distinction survives the next person who reads the
 * commit message and assumes one capability explains the other.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const TWIN = read('lib/digitalTwin.ts');
const DSM = read('app/api/dsm/route.ts');
const RGB = read('app/api/solar-rgb/route.ts');
const SOLAR = read('app/api/solar/route.ts');

describe('Lane A does NOT use the quality ladder', () => {
  it('the twin requests buildingInsights pinned at MEDIUM', () => {
    expect(TWIN).toMatch(/endpoint=buildingInsights[^`'"]*quality=MEDIUM/);
  });

  it('/api/solar has no HIGH -> MEDIUM -> BASE ladder', () => {
    // Its quality is a query parameter, not a walk. If a ladder is ever added
    // here it becomes a THIRD capability and this test should be updated
    // deliberately rather than deleted.
    expect(SOLAR).not.toMatch(/\[['"]HIGH['"],\s*['"]MEDIUM['"],\s*['"]BASE['"]\]/);
  });

  it('the twin does not call /api/dsm or /api/solar-rgb for its roof segments', () => {
    const segFn = TWIN.slice(TWIN.indexOf('export function extractRoofSegments'));
    expect(segFn).not.toMatch(/\/api\/dsm/);
    expect(segFn).not.toMatch(/\/api\/solar-rgb/);
  });
});

describe('the DSM ladder', () => {
  it('walks HIGH -> MEDIUM -> BASE in order', () => {
    expect(DSM).toMatch(/QUALITY_LADDER = \['HIGH', 'MEDIUM', 'BASE'\]/);
  });

  it('stops at the first success', () => {
    // `break` on the first tier that yields a dsmUrl — it must not keep walking
    // and overwrite a better tier with a worse one.
    const ladder = DSM.slice(DSM.indexOf('QUALITY_LADDER'), DSM.indexOf('if (!dlData'));
    expect(ladder).toMatch(/usedQuality = q; break;/);
  });

  it('🚨 REPORTS which tier succeeded', () => {
    // It used to exist only in a console.log and be dropped before the
    // response, so a roof modelled from 0.25m BASE looked identical to one
    // modelled from 0.1m HIGH.
    expect(DSM).toMatch(/qualityUsed: usedQuality \|\| null/);
  });

  it('reports what was tried, so "no coverage" is a diagnosis', () => {
    expect(DSM).toMatch(/qualityAttempts: attempts/);
    expect(DSM).toMatch(/attempts\.push\(/);
  });

  it('fails loudly when no tier has coverage', () => {
    expect(DSM).toMatch(/no DSM at any quality tier \(tried \$\{attempts\.join/);
  });
});

describe('the imagery ladder', () => {
  it('walks HIGH -> MEDIUM -> BASE in order', () => {
    expect(RGB).toMatch(/IMAGERY_LADDER = \['HIGH', 'MEDIUM', 'BASE'\]/);
  });

  it('stops at the first success', () => {
    const ladder = RGB.slice(RGB.indexOf('IMAGERY_LADDER'), RGB.indexOf('if (!dlUrl)'));
    expect(ladder).toMatch(/usedQuality = q;/);
    expect(ladder).toMatch(/break;/);
  });

  it('🚨 REPORTS which tier succeeded', () => {
    // An operator told "HD imagery on" while looking at BASE pixels may tag
    // vents off a blurry raster.
    expect(RGB).toMatch(/qualityUsed: usedQuality \|\| null/);
  });

  it('records why each tier declined rather than failing silently', () => {
    expect(RGB).toMatch(/qualityAttempts/);
    expect(RGB).toMatch(/qualityAttempts\.push\(/);
  });
});

describe('a late response cannot poison newer site state', () => {
  it('the twin load discards a response whose site no longer matches', () => {
    const engine = read('components/3d/SolarEngine3D.tsx');
    expect(engine).toMatch(/const requestedSiteKey = siteKeyFromCoords\(lat, lng\)/);
    expect(engine).toMatch(/discarded stale twin for/);
  });

  it('the guard runs BEFORE twinRef is written', () => {
    // Writing twinRef first would apply one property's data to another, which
    // is the whole failure this prevents.
    const engine = read('components/3d/SolarEngine3D.tsx');
    const block = engine.slice(engine.indexOf('const requestedSiteKey'), engine.indexOf('const requestedSiteKey') + 1800);
    const guardIdx = block.indexOf('discarded stale twin for');
    const writeIdx = block.indexOf('twinRef.current = newTwin');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeGreaterThan(guardIdx);
  });
});
