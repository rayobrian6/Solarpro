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
  it('renders PV-2 and PV-2B as different primary SVG drawings', () => {
    const html = generatePermitHTML(clone(roofProject));

    const pv2 = sheetPage(html, 'PV-2');
    const pv2b = sheetPage(html, 'PV-2B');

    expect(pv2).toContain('ROOF PLAN');
    expect(pv2b).toContain('ARRAY GEOMETRY');
    expect(pv2b).toContain('STRING LAYOUT');

    const pv2Svg = normalizedSvg(firstSvg(pv2));
    const pv2bSvg = normalizedSvg(firstSvg(pv2b));

    expect(pv2Svg.length).toBeGreaterThan(1000);
    expect(pv2bSvg.length).toBeGreaterThan(1000);
    expect(pv2Svg).not.toEqual(pv2bSvg);
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
    ['roof', roofProject, 'PV-2', 'PV-2B'],
    ['ground', groundProject, 'PV-2', 'PV-2B'],
    ['fence', fenceProject, 'PV-2', 'PV-2B'],
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
