import { describe, expect, it } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { roofCAD } from '@/lib/cad/roof/roofCAD';
import { chooseAerialCenter } from '@/lib/permit/sections/sitePlan';
import { roofProject } from '@/test-fixtures/roofProject';
import { groundProject } from '@/test-fixtures/groundProject';
import { fenceProject } from '@/test-fixtures/fenceProject';
import type { PermitInput } from '@/lib/permit/types';
import type { PermitInputShape } from '@/lib/drafting/permitInputShape';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function pagesFrom(html: string): string[] {
  return [...html.matchAll(/<div class="page"[\s\S]*?(?=<div class="page"|<\/body>|$)/g)].map(match => match[0]);
}

function sheetPage(html: string, sheetId: string): string {
  const page = pagesFrom(html).find(candidate => candidate.includes(`<div class="tb-sheet-id">${sheetId}</div>`));
  expect(page, `Expected generated planset to include sheet ${sheetId}`).toBeTruthy();
  return page!;
}

function firstSvg(page: string): string {
  const svg = page.match(/<svg\b[\s\S]*?<\/svg>/)?.[0];
  expect(svg, 'Expected page to include a primary SVG drawing').toBeTruthy();
  return svg!;
}

function normalizedSvg(svg: string): string {
  return svg.replace(/\s+/g, ' ').trim();
}

function designPanelCount(input: PermitInput): number {
  return input.project.panelPositions?.length ?? input.layout?.panels?.length ?? input.system.totalPanels;
}

// Mirrors app/api/engineering/permit/route.ts hasRealDesignRoofGeometry. Keep this
// behavior pinned so Design Studio roofPlanes + GPS panelPositions can generate a
// draft planset instead of being hard-blocked when no promoted canonical model exists.
function hasRealDesignRoofGeometry(project: any): boolean {
  const designRoofPlanes = (project?.roofPlanes ?? []) as Array<{ vertices?: Array<{ lat?: number; lng?: number }> }>;
  const designPanels = (project?.panelPositions ?? []) as Array<{ lat?: number; lng?: number }>;
  return (
    designRoofPlanes.some(p =>
      Array.isArray(p?.vertices) &&
      p.vertices.length >= 3 &&
      p.vertices.every(v => Number.isFinite(Number(v?.lat)) && Number.isFinite(Number(v?.lng)) && Math.abs(Number(v?.lat)) > 0.001),
    ) &&
    designPanels.some(p => Number.isFinite(Number(p?.lat)) && Number.isFinite(Number(p?.lng)) && Math.abs(Number(p?.lat)) > 0.001)
  );
}

describe('planset structural/golden coverage — Design Studio to permit guardrails', () => {
  it('renders PV-1 and PV-1B as different primary SVG drawings', () => {
    const html = generatePermitHTML(clone(roofProject));

    const pv1 = sheetPage(html, 'PV-1');
    const pv1b = sheetPage(html, 'PV-1B');

    expect(pv1).toContain('ROOF PLAN');
    expect(pv1b).toContain('ARRAY GEOMETRY');
    expect(pv1b).toContain('STRING LAYOUT');

    const pv1Svg = normalizedSvg(firstSvg(pv1));
    const pv1bSvg = normalizedSvg(firstSvg(pv1b));

    expect(pv1Svg.length).toBeGreaterThan(1000);
    expect(pv1bSvg.length).toBeGreaterThan(1000);
    expect(pv1Svg).not.toEqual(pv1bSvg);
  });
  it('PV-1B branch-colored circuit plan has circuit layout title and differs from PV-1', () => {
    const html = generatePermitHTML(clone(roofProject));

    const pv1 = sheetPage(html, 'PV-1');
    const pv1b = sheetPage(html, 'PV-1B');

    const pv1Svg = firstSvg(pv1);
    const pv1bSvg = firstSvg(pv1b);

    // PV-1B SVG must contain CIRCUIT LAYOUT title (replaces PV-1's ROOF PLAN)
    expect(pv1bSvg).toContain('CIRCUIT LAYOUT');
    // v47376: the SVG BRANCH LEGEND overlay was REMOVED — it duplicated the
    // data-zone HTML legend and painted over the viewport title. The legend
    // must exist in the PAGE (data zone), not the drawing SVG.
    expect(pv1bSvg).not.toContain('BRANCH LEGEND');
    expect(pv1b).toContain('BRANCH LEGEND');

    // PV-1 must NOT contain CIRCUIT LAYOUT or BRANCH LEGEND in its SVG
    expect(pv1Svg).not.toContain('CIRCUIT LAYOUT');
    expect(pv1Svg).not.toContain('BRANCH LEGEND');

    // PV-1B modules use branch-colored fills (at least the default navy #1b3f74)
    // For multi-branch systems, multiple distinct stringColors appear.
    // For single-branch systems (e.g. small micro arrays), only one color appears
    // but the sheet is still distinct from PV-1 via title and legend overlay.
    const branchColors = ['#1b3f74', '#cc0000', '#cc6600', '#5500cc', '#0891b2', '#be185d', '#65a30d', '#e5a100'];
    const fillsFound = new Set<string>();
    for (const color of branchColors) {
      if (pv1bSvg.includes('fill="' + color + '"')) {
        fillsFound.add(color);
      }
    }
    // At least one branch color fill must be present
    expect(fillsFound.size).toBeGreaterThanOrEqual(1);

    // Confirm PV-1 and PV-1B are not identical
    expect(normalizedSvg(pv1Svg)).not.toEqual(normalizedSvg(pv1bSvg));
  });


  it('preserves real roof design panel count and IDs through roofCAD', () => {
    const input = clone(roofProject) as PermitInputShape;
    const model = roofCAD(input);
    const planePanels = model.roof?.planes.flatMap(plane => plane.panels) ?? [];
    const expectedIds = new Set((roofProject.project.panelPositions ?? []).map(panel => panel.id));

    expect(model.systemType).toBe('roof');
    expect(model.totalPanels).toBe(designPanelCount(roofProject));
    expect(planePanels).toHaveLength(designPanelCount(roofProject));
    expect(planePanels.every(panel => expectedIds.has(panel.id))).toBe(true);
    expect(planePanels.some(panel => panel.id.startsWith('plane-') || panel.id.startsWith('schematic-'))).toBe(false);
  });

  it('centers aerial imagery on the designed array/project roof instead of a neighbor roof', () => {
    const pinLat = 38.7009;
    const pinLng = -90.1487;
    const metersLat = (m: number) => m / 111_320;
    const metersLng = (m: number) => m / (111_320 * Math.cos(pinLat * Math.PI / 180));
    const myArrayCenter = { lat: pinLat + metersLat(4), lng: pinLng + metersLng(2) };
    const neighborRoof = {
      center: { lat: pinLat + metersLat(60), lng: pinLng + metersLng(10) },
      azimuthDegrees: 185,
      areaM2: 400,
    };

    const result = chooseAerialCenter(pinLat, pinLng, myArrayCenter, [neighborRoof]);

    expect(result.source).toBe('array');
    expect(result.lat).toBeCloseTo(myArrayCenter.lat, 7);
    expect(result.lng).toBeCloseTo(myArrayCenter.lng, 7);
  });

  it('allows generation gate for real roofPlanes plus GPS panelPositions and blocks invalid geometry', () => {
    expect(hasRealDesignRoofGeometry(roofProject.project)).toBe(true);

    expect(hasRealDesignRoofGeometry({ roofPlanes: [], panelPositions: [] })).toBe(false);
    expect(hasRealDesignRoofGeometry({ roofPlanes: roofProject.project.roofPlanes, panelPositions: [{ x: 1, y: 2 }] })).toBe(false);
    expect(hasRealDesignRoofGeometry({
      roofPlanes: [{ vertices: [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }] }],
      panelPositions: roofProject.project.panelPositions,
    })).toBe(false);
    expect(hasRealDesignRoofGeometry({
      roofPlanes: [{ vertices: [{ lat: 33.1, lng: -112.1 }, { lat: 33.1, lng: -112.0 }] }],
      panelPositions: roofProject.project.panelPositions,
    })).toBe(false);
  });

  it.each([
    ['roof', roofProject, 'PV-1', 'PV-1B'],
    ['ground', groundProject, 'PV-1', 'PV-1B'],
    ['fence', fenceProject, 'PV-1', 'PV-1B'],
  ] as const)('generates a valid multi-sheet planset for %s systems without throwing', (_label, fixture, pv2Sheet, pv2bSheet) => {
    const html = generatePermitHTML(clone(fixture));
    const pages = pagesFrom(html);

    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(20_000);
    expect(pages.length).toBeGreaterThanOrEqual(10);
    expect(html).toContain(`<div class="tb-sheet-id">${pv2Sheet}</div>`);
    expect(html).toContain(`<div class="tb-sheet-id">${pv2bSheet}</div>`);
    expect(html).toContain(`${fixture.system.totalPanels} modules`);
    expect(html).toContain(fixture.project.projectName);
  });
});
