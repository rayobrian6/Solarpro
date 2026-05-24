import { describe, expect, it } from 'vitest';
import { buildCADModelExportBundle } from '@/lib/cad/cadModelExportBundle';
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
    version: 'cad-test-v1',
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
  exportedAt: '2026-02-01T00:00:00.000Z',
  exportedBy: 'cad-export-test',
  exportReason: 'Open-source CAD adapter boundary test.',
  sourceProjectId: 'project-cad-export-v1',
  sourceSurveyId: 'survey-cad-export-v1',
  sourceCadRunId: 'cad-run-export-v1',
  sourcePlanSetId: 'planset-export-v1',
};

describe('CAD model export bundle v1', () => {
  it('builds a deterministic DTO-only export bundle for a valid roof CAD model', () => {
    const cad = roofModel();
    const bundle = buildCADModelExportBundle(cad, exportInput);
    const replay = buildCADModelExportBundle(cad, exportInput);

    expect(bundle).toEqual(replay);
    expect(bundle.exportSchemaVersion).toBe('cad_model_export_bundle_v1');
    expect(bundle.persistenceMode).toBe('deterministic_dto_only_v1');
    expect(bundle.exportHash).toMatch(/^[0-9a-f]{8}$/);
    expect(bundle.systemType).toBe('roof');
    expect(bundle.units).toBe('meters_local_xy');
    expect(bundle.validation.valid).toBe(true);
    expect(bundle.validation.errors).toEqual([]);
    expect(bundle.modelSummary).toMatchObject({
      totalPanels: 1,
      totalDcKw: 0.4,
      hasRoof: true,
      hasGround: false,
      hasFence: false,
      obstructionCount: 1,
      dimensionCount: 1,
    });
    expect(bundle.sanitizedModelSnapshot).toEqual(cad);
    expect(bundle.authorityFlags).toEqual({
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
      thirdPartyCadAuthorityAllowed: false,
      downstreamAuthority: false,
    });
    expect(bundle.deterministicNotes.join(' ')).toContain('Open-source CAD libraries may consume this bundle as rendering/export adapters only');
  });

  it('supports valid ground and fence models while preserving system-specific summaries', () => {
    const ground = buildCADModelExportBundle(groundModel(), exportInput);
    const fence = buildCADModelExportBundle(fenceModel(), exportInput);

    expect(ground.systemType).toBe('ground_mount');
    expect(ground.validation.valid).toBe(true);
    expect(ground.modelSummary.hasGround).toBe(true);
    expect(ground.modelSummary.hasRoof).toBe(false);
    expect(ground.modelSummary.hasFence).toBe(false);

    expect(fence.systemType).toBe('solar_fence');
    expect(fence.validation.valid).toBe(true);
    expect(fence.modelSummary.hasFence).toBe(true);
    expect(fence.modelSummary.hasRoof).toBe(false);
    expect(fence.modelSummary.hasGround).toBe(false);
  });

  it('rejects missing metadata, invalid solved models, cross-contamination, and non-finite geometry', () => {
    expect(() => buildCADModelExportBundle(roofModel(), { ...exportInput, exportedAt: '   ' })).toThrow(/exportedAt/i);
    expect(() => buildCADModelExportBundle(roofModel(), { ...exportInput, exportedBy: '   ' })).toThrow(/exportedBy/i);

    expect(() => buildCADModelExportBundle(baseModel({ systemType: 'roof', roof: undefined }), exportInput)).toThrow(/valid solved CAD model/i);

    expect(() => buildCADModelExportBundle({
      ...roofModel(),
      ground: groundModel().ground,
    }, exportInput)).toThrow(/cross-contamination/i);

    expect(() => buildCADModelExportBundle({
      ...roofModel(),
      bounds: bbox(0, Number.NaN, 4, 3),
    }, exportInput)).toThrow(/finite bounds\.minY/i);
  });

  it('strips unsupported non-json fields from the sanitized snapshot before hashing', () => {
    const cad = {
      ...roofModel(),
      debugCallback: () => 'not serializable',
      debugUndefined: undefined,
    } as CADModel & { debugCallback?: () => string; debugUndefined?: undefined };
    const bundle = buildCADModelExportBundle(cad, exportInput);

    expect(bundle.sanitizedModelSnapshot).not.toHaveProperty('debugCallback');
    expect(bundle.sanitizedModelSnapshot).not.toHaveProperty('debugUndefined');
    expect(bundle.exportHash).toMatch(/^[0-9a-f]{8}$/);
  });
});
