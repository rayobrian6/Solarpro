import { describe, expect, it, vi } from 'vitest';
import type { CADModel, CADPanel } from '@/lib/cad/types';
import type { BBox } from '@/lib/cad/geometry';
import type { DraftingInput } from '@/lib/drafting/types';

vi.mock('@/lib/drafting/templates/roof', () => ({
  drawRoofPlan: vi.fn(() => '<svg data-test="roof-pv-2">ROOF PV-2</svg>'),
  drawRoofStructural: vi.fn(() => '<svg data-test="roof-pv-3">ROOF PV-3</svg>'),
}));

vi.mock('@/lib/drafting/templates/ground', () => ({
  drawGroundArray: vi.fn(() => '<svg data-test="ground-pv-2">GROUND PV-2</svg>'),
  drawGroundStructural: vi.fn(() => '<svg data-test="ground-pv-3">GROUND PV-3</svg>'),
}));

vi.mock('@/lib/drafting/templates/fence', () => ({
  drawFencePlan: vi.fn(() => '<svg data-test="fence-pv-2">FENCE PV-2</svg>'),
  drawFenceElevation: vi.fn(() => '<svg data-test="fence-pv-3">FENCE PV-3</svg>'),
}));

import { renderPlanSet } from '@/lib/drafting/renderPlanSet';

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

const draftingInput: DraftingInput = {
  project: { systemType: 'roof' },
  layout: {},
  engineering: { totalDcKw: 0.4, totalAcKw: 0.32, totalPanels: 1 },
};

describe('renderPlanSet CAD appendix preview V1', () => {
  it('omits APP-CAD by default and preserves production PV-2/PV-3 sheets', () => {
    const result = renderPlanSet(roofModel(), 'roof', draftingInput);

    expect(Object.keys(result.sheets).sort()).toEqual(['PV-2', 'PV-3']);
    expect(result.sheets['PV-2']).toBe('<svg data-test="roof-pv-2">ROOF PV-2</svg>');
    expect(result.sheets['PV-3']).toBe('<svg data-test="roof-pv-3">ROOF PV-3</svg>');
    expect(result.sheets['APP-CAD']).toBeUndefined();
  });

  it('adds APP-CAD only when explicitly opted in without changing PV-2/PV-3', () => {
    const cad = roofModel();
    const before = JSON.stringify(cad);
    const baseline = renderPlanSet(cad, 'roof', draftingInput);
    const enabled = renderPlanSet(cad, 'roof', draftingInput, null, null, { cadAppendixPreviewV1: true });

    expect(JSON.stringify(cad)).toBe(before);
    expect(enabled.sheets['PV-2']).toBe(baseline.sheets['PV-2']);
    expect(enabled.sheets['PV-3']).toBe(baseline.sheets['PV-3']);
    expect(enabled.sheets['APP-CAD']).toContain('CAD PREVIEW ONLY');
    expect(enabled.sheets['APP-CAD']).toContain('NON-AUTHORITATIVE');
    expect(enabled.sheets['APP-CAD']).toContain('NOT PERMIT AUTHORITY');
    expect(enabled.sheets['APP-CAD']).toContain('NOT ENGINEERING AUTHORITY');
    expect(enabled.sheets['APP-CAD']).toContain('NOT CONSTRUCTION DRAWING');
    expect(Object.keys(enabled.sheets).sort()).toEqual(['APP-CAD', 'PV-2', 'PV-3']);
  });

  it('renders independent roof, ground, and fence appendix previews without cross-system contamination', () => {
    const roof = renderPlanSet(roofModel(), 'roof', draftingInput, null, null, { cadAppendixPreviewV1: true });
    const ground = renderPlanSet(groundModel(), 'ground_mount', draftingInput, null, null, { cadAppendixPreviewV1: true });
    const fence = renderPlanSet(fenceModel(), 'solar_fence', draftingInput, null, null, { cadAppendixPreviewV1: true });

    expect(roof.sheets['APP-CAD']).toContain('data-layer="roof-plane"');
    expect(roof.sheets['APP-CAD']).not.toContain('data-layer="ground-array"');
    expect(roof.sheets['APP-CAD']).not.toContain('data-layer="fence-segment"');

    expect(ground.sheets['APP-CAD']).toContain('data-layer="ground-array"');
    expect(ground.sheets['APP-CAD']).not.toContain('data-layer="roof-plane"');
    expect(ground.sheets['APP-CAD']).not.toContain('data-layer="fence-segment"');

    expect(fence.sheets['APP-CAD']).toContain('data-layer="fence-segment"');
    expect(fence.sheets['APP-CAD']).not.toContain('data-layer="roof-plane"');
    expect(fence.sheets['APP-CAD']).not.toContain('data-layer="ground-array"');
  });

  it('preserves validation and fails before appendix generation on cross-system contamination', () => {
    const contaminated = roofModel();
    contaminated.ground = groundModel().ground;

    expect(() => renderPlanSet(contaminated, 'roof', draftingInput, null, null, { cadAppendixPreviewV1: true })).toThrow(/validation failed/i);
  });
});
