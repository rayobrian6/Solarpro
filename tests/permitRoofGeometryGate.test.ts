import { describe, expect, it } from 'vitest';
import { roofProject } from '../test-fixtures/roofProject';

// Mirrors the route gate predicate (app/api/engineering/permit/route.ts).
// A roof permit may generate when it has EITHER a promoted CanonicalBuildingModel
// OR real design roof geometry (roofPlanes + GPS panels). This test guards the
// "real design geometry is sufficient for a draft" rule so the hard-422 can't
// silently come back.
function hasRealDesignRoofGeometry(project: any): boolean {
  const rp = (project?.roofPlanes ?? []) as Array<{ vertices?: Array<{ lat?: number; lng?: number }> }>;
  const pp = (project?.panelPositions ?? []) as Array<{ lat?: number; lng?: number }>;
  return (
    rp.some(p =>
      Array.isArray(p?.vertices) && p.vertices.length >= 3 &&
      p.vertices.every(v => isFinite(Number(v?.lat)) && isFinite(Number(v?.lng)) && Math.abs(Number(v?.lat)) > 0.001),
    ) &&
    pp.some(p => isFinite(Number(p?.lat)) && isFinite(Number(p?.lng)) && Math.abs(Number(p?.lat)) > 0.001)
  );
}

describe('permit roof-geometry gate', () => {
  it('a real design (roofPlanes + GPS panels) is allowed to generate', () => {
    expect(hasRealDesignRoofGeometry(roofProject.project)).toBe(true);
  });

  it('a project with no roof geometry is still blocked', () => {
    expect(hasRealDesignRoofGeometry({ roofPlanes: [], panelPositions: [] })).toBe(false);
    expect(hasRealDesignRoofGeometry({})).toBe(false);
  });

  it('roof planes without GPS panels are not sufficient', () => {
    expect(
      hasRealDesignRoofGeometry({
        roofPlanes: roofProject.project.roofPlanes,
        panelPositions: [{ x: 1, y: 2 }],
      }),
    ).toBe(false);
  });
});
