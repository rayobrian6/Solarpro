import { describe, expect, it } from 'vitest';
import { buildCADModelExportBundle } from '@/lib/cad/cadModelExportBundle';
import { buildCADSvgArtifactPreview } from '@/lib/cad/cadSvgArtifactPreview';
import type { CADModel, CADPanel } from '@/lib/cad/types';
import type { BBox } from '@/lib/cad/geometry';

function panel(overrides: Partial<CADPanel> = {}): CADPanel {
  return {
    id: 'panel-1',
    x: 1,
    y: 1,
    widthM: 1.7,
    heightM: 1.1,
    orientation: 'landscape',
    row: 0,
    col: 0,
    ...overrides,
  };
}

function bbox(minX: number, minY: number, maxX: number, maxY: number): BBox {
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

function baseModel(overrides: Partial<CADModel> = {}): CADModel {
  return {
    systemType: 'roof',
    version: 'cad-svg-test-v1',
    totalPanels: 1,
    totalDcKw: 0.4,
    panelWidthM: 1.7,
    panelHeightM: 1.1,
    originLat: 38.9,
    originLng: -77.01,
    bounds: bbox(0, 0, 4, 3),
    dimensions: [{ id: 'dim-1', type: 'horizontal', x1: 0, y1: 0, x2: 4, y2: 0, valueFt: 13.12, label: '13.1 ft', level: 3 }],
    solveMs: 12,
    warnings: [],
    ...overrides,
  };
}

function roofModel(): CADModel {
  const roofPanel = panel({ id: 'roof-panel-1', planeId: 'roof-plane-1' });
  return baseModel({
    systemType: 'roof',
    roof: {
      totalPanels: 1,
      setbackIn: 12,
      ridgeSetbackIn: 18,
      planes: [{
        id: 'roof-plane-1',
        polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }],
        usablePolygon: [{ x: 0.3, y: 0.3 }, { x: 3.7, y: 0.3 }, { x: 3.7, y: 2.7 }, { x: 0.3, y: 2.7 }],
        pitch: 25,
        azimuth: 180,
        areaSqM: 12,
        setbacks: { eaveM: 0.3, ridgeM: 0.3, rakeM: 0.3 },
        panels: [roofPanel],
        dimensions: { widthM: 4, heightM: 3, panelCountX: 1, panelCountY: 1 },
      }],
    },
    obstructions: [{
      id: 'obs-1',
      type: 'vent',
      x: 2,
      y: 2,
      radiusM: 0.2,
      setbackM: 0.5,
      totalRadiusM: 0.7,
      heightFt: 1,
      roofPlaneId: 'roof-plane-1',
      source: 'manual',
      confidence: 1,
    }],
  });
}

function groundModel(): CADModel {
  const groundPanel = panel({ id: 'ground-panel-1', arrayId: 'ground-array-1' });
  return baseModel({
    systemType: 'ground_mount',
    bounds: bbox(0, 0, 6, 4),
    ground: {
      totalPanels: 1,
      setbackFt: 10,
      arrays: [{
        id: 'ground-array-1',
        originX: 0,
        originY: 0,
        rows: [{ id: 'ground-row-1', rowIndex: 0, x: 0, y: 0, widthM: 6, panels: [groundPanel] }],
        panels: [groundPanel],
        tiltDeg: 25,
        azimuth: 180,
        rowSpacingM: 3,
        groundClearanceM: 0.9,
        structureType: 'pile',
        pileDepthM: 1.5,
        pileSpacingM: 2,
        dimensions: { arrayWidthM: 6, arrayDepthM: 4, rowCount: 1, panelsPerRow: 1 },
      }],
    },
  });
}

function fenceModel(): CADModel {
  const fencePanel = panel({ id: 'fence-panel-1', segmentId: 'fence-segment-1' });
  return baseModel({
    systemType: 'solar_fence',
    bounds: bbox(0, 0, 8, 0),
    fence: {
      totalPanels: 1,
      segments: [{
        id: 'fence-segment-1',
        startX: 0,
        startY: 0,
        endX: 8,
        endY: 0,
        lengthM: 8,
        azimuth: 90,
        panelCount: 1,
        panels: [fencePanel],
        posts: [{ id: 'post-1', x: 0, y: 0, embedM: 0.9, heightM: 2 }],
        tiltDeg: 90,
        bifacial: true,
        label: 'A',
      }],
      sections: [{ id: 'section-1', segmentId: 'fence-segment-1', index: 0, type: 'solar', startM: 0, widthM: 1.7, heightM: 2, x: 0.85, y: 0, panelCount: 1 }],
      totalLengthM: 8,
      postSpacingM: 2,
      postEmbedM: 0.9,
      panelHeightM: 2,
      railCount: 2,
      gateOpenings: [],
    },
  });
}

const exportInput = {
  exportedAt: '2026-02-02T00:00:00.000Z',
  exportedBy: 'cad-svg-preview-test',
  exportReason: 'CAD SVG preview artifact boundary test.',
  sourceProjectId: 'project-cad-svg-preview-v1',
  sourceSurveyId: 'survey-cad-svg-preview-v1',
  sourceCadRunId: 'cad-run-svg-preview-v1',
  sourcePlanSetId: 'planset-svg-preview-v1',
};

function exportBundle(cad: CADModel) {
  return buildCADModelExportBundle(cad, exportInput);
}

describe('CAD SVG artifact preview v1', () => {
  it('builds a deterministic read-only roof SVG artifact from a CAD export bundle', () => {
    const cad = roofModel();
    const bundle = exportBundle(cad);
    const before = JSON.stringify(bundle);
    const artifact = buildCADSvgArtifactPreview(bundle);
    const replay = buildCADSvgArtifactPreview(bundle);

    expect(artifact).toEqual(replay);
    expect(JSON.stringify(bundle)).toBe(before);
    expect(artifact.artifactSchemaVersion).toBe('cad_svg_artifact_preview_v1');
    expect(artifact.persistenceMode).toBe('deterministic_preview_dto_only_v1');
    expect(artifact.artifactKind).toBe('svg_preview');
    expect(artifact.sourceExportHash).toBe(bundle.exportHash);
    expect(artifact.artifactHash).toMatch(/^[0-9a-f]{8}$/);
    expect(artifact.systemType).toBe('roof');
    expect(artifact.units).toBe('meters_local_xy');
    expect(artifact.layerSummary).toMatchObject({ roofPlaneCount: 1, groundArrayCount: 0, fenceSegmentCount: 0, panelCount: 1, obstructionCount: 1, dimensionCount: 1 });
    expect(artifact.svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(artifact.svg).toContain('data-layer="roof-plane"');
    expect(artifact.svg).toContain('data-layer="roof-panel"');
    expect(artifact.svg).toContain('data-layer="obstruction"');
    expect(artifact.svg).toContain('preview-only/no downstream authority');
    expect(artifact.authorityFlags).toEqual({
      persistenceAllowed: false,
      solverExecutionAllowed: false,
      cadMutationAllowed: false,
      canonicalGeometryMutationAllowed: false,
      planSetMutationAllowed: false,
      engineeringInfluenceAllowed: false,
      necInfluenceAllowed: false,
      bomInfluenceAllowed: false,
      routeInfluenceAllowed: false,
      workflowInfluenceAllowed: false,
      recommendationInfluenceAllowed: false,
      permitAuthorityAllowed: false,
      downstreamAuthority: false,
    });
  });

  it('renders ground and fence system-specific preview layers without plan-set authority', () => {
    const ground = buildCADSvgArtifactPreview(exportBundle(groundModel()));
    const fence = buildCADSvgArtifactPreview(exportBundle(fenceModel()));

    expect(ground.systemType).toBe('ground_mount');
    expect(ground.layerSummary).toMatchObject({ roofPlaneCount: 0, groundArrayCount: 1, fenceSegmentCount: 0, panelCount: 1 });
    expect(ground.svg).toContain('data-layer="ground-array"');
    expect(ground.svg).toContain('data-layer="ground-row"');
    expect(ground.svg).toContain('data-layer="ground-panel"');
    expect(ground.authorityFlags.planSetMutationAllowed).toBe(false);

    expect(fence.systemType).toBe('solar_fence');
    expect(fence.layerSummary).toMatchObject({ roofPlaneCount: 0, groundArrayCount: 0, fenceSegmentCount: 1, panelCount: 1 });
    expect(fence.svg).toContain('data-layer="fence-segment"');
    expect(fence.svg).toContain('data-layer="fence-post"');
    expect(fence.svg).toContain('data-layer="fence-panel"');
    expect(fence.authorityFlags.permitAuthorityAllowed).toBe(false);
  });

  it('rejects invalid source bundles and mismatched source snapshots', () => {
    const bundle = exportBundle(roofModel());

    expect(() => buildCADSvgArtifactPreview(null as unknown as Parameters<typeof buildCADSvgArtifactPreview>[0])).toThrow(/requires a CAD model export bundle/i);
    expect(() => buildCADSvgArtifactPreview({ ...bundle, exportSchemaVersion: 'wrong' as typeof bundle.exportSchemaVersion })).toThrow(/cad_model_export_bundle_v1/i);
    expect(() => buildCADSvgArtifactPreview({ ...bundle, validation: { ...bundle.validation, valid: false, errors: ['bad source'] } })).toThrow(/valid source CAD export bundle/i);
    expect(() => buildCADSvgArtifactPreview({ ...bundle, exportHash: 'not-a-hash' })).toThrow(/source export hash/i);
    expect(() => buildCADSvgArtifactPreview({ ...bundle, sanitizedModelSnapshot: { ...bundle.sanitizedModelSnapshot, systemType: 'ground_mount' } })).toThrow(/system type to match/i);
  });

  it('escapes source labels and remains deterministic for SVG text/attributes', () => {
    const cad = roofModel();
    cad.dimensions = [{ ...cad.dimensions[0], id: 'dim-<bad>&"', label: '<script>alert("x")</script>' }];
    const artifact = buildCADSvgArtifactPreview(exportBundle(cad));

    expect(artifact.svg).not.toContain('<script>');
    expect(artifact.svg).toContain('&lt;script&gt;alert("x")&lt;/script&gt;');
    expect(artifact.svg).toContain('data-id="dim-&lt;bad&gt;&amp;&quot;"');
    expect(artifact.artifactHash).toMatch(/^[0-9a-f]{8}$/);
  });
});
