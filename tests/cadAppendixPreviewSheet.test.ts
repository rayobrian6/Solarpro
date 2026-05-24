import { describe, expect, it } from 'vitest';
import { buildCADModelExportBundle } from '@/lib/cad/cadModelExportBundle';
import { buildCADSvgArtifactPreview } from '@/lib/cad/cadSvgArtifactPreview';
import {
  CAD_APPENDIX_PREVIEW_AUTHORITY_FLAGS,
  CAD_APPENDIX_PREVIEW_LABELS,
  CAD_APPENDIX_PREVIEW_SHEET_ID,
  buildPlanSetCADAppendixPreviewSheetV1,
  renderPlanSetCADAppendixPreviewSheetV1,
} from '@/lib/drafting/cadAppendixPreviewSheet';
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

function roofModel(): CADModel {
  const roofPanel = panel({ id: 'roof-panel-1', planeId: 'roof-plane-1' });
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
  };
}

const exportInput = {
  exportedAt: '2026-02-01T00:00:00.000Z',
  exportedBy: 'cad-appendix-preview-test',
  exportReason: 'plan-set-cad-appendix-preview-v1-test',
};

describe('PlanSetCADAppendixPreviewSheetV1', () => {
  it('builds a deterministic JSON-safe preview-only appendix DTO from CAD export and SVG artifact boundaries', () => {
    const bundle = buildCADModelExportBundle(roofModel(), exportInput);
    const artifact = buildCADSvgArtifactPreview(bundle);
    const sheet = buildPlanSetCADAppendixPreviewSheetV1({ exportBundle: bundle, svgArtifact: artifact, renderingWarnings: ['preview warning'] });
    const replay = buildPlanSetCADAppendixPreviewSheetV1({ exportBundle: bundle, svgArtifact: artifact, renderingWarnings: ['preview warning'] });

    expect(sheet).toEqual(replay);
    expect(JSON.parse(JSON.stringify(sheet))).toEqual(sheet);
    expect(sheet.sheetSchemaVersion).toBe('plan_set_cad_appendix_preview_sheet_v1');
    expect(sheet.persistenceMode).toBe('deterministic_appendix_preview_dto_only_v1');
    expect(sheet.sheetType).toBe('cad_preview_appendix');
    expect(sheet.sheetId).toBe(CAD_APPENDIX_PREVIEW_SHEET_ID);
    expect(sheet.sheetId).not.toBe('PV-2');
    expect(sheet.sheetId).not.toBe('PV-3');
    expect(sheet.sheetTitle).toBe('CAD PREVIEW APPENDIX');
    expect(sheet.systemType).toBe('roof');
    expect(sheet.sourceCADExportHash).toBe(bundle.exportHash);
    expect(sheet.sourceSVGArtifactHash).toBe(artifact.artifactHash);
    expect(sheet.cadModelVersion).toBe(bundle.cadModelVersion);
    expect(sheet.units).toBe('meters_local_xy');
    expect(sheet.viewBox).toEqual(artifact.viewBox);
    expect(sheet.layerSummary).toEqual(artifact.layerSummary);
    expect(sheet.previewOnlyLabels).toEqual(CAD_APPENDIX_PREVIEW_LABELS);
    expect(Object.values(sheet.authorityFlags)).toEqual(Object.values(CAD_APPENDIX_PREVIEW_AUTHORITY_FLAGS));
    expect(Object.values(sheet.authorityFlags).every(value => value === false)).toBe(true);
    expect(sheet.svgPayload).toBe(artifact.svg);
    expect(sheet.renderingWarnings).toEqual(['preview warning']);
    expect(sheet.sheetHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('renders visible non-authoritative labels and source hashes into the appendix SVG sheet', () => {
    const bundle = buildCADModelExportBundle(roofModel(), exportInput);
    const artifact = buildCADSvgArtifactPreview(bundle);
    const sheet = buildPlanSetCADAppendixPreviewSheetV1({ exportBundle: bundle, svgArtifact: artifact });
    const svg = renderPlanSetCADAppendixPreviewSheetV1(sheet);

    expect(svg).toContain('CAD PREVIEW ONLY');
    expect(svg).toContain('NON-AUTHORITATIVE');
    expect(svg).toContain('NOT PERMIT AUTHORITY');
    expect(svg).toContain('NOT ENGINEERING AUTHORITY');
    expect(svg).toContain('NOT CONSTRUCTION DRAWING');
    expect(svg).toContain(bundle.exportHash);
    expect(svg).toContain(artifact.artifactHash);
    expect(svg).toContain('data-layer="roof-plane"');
    expect(svg).toContain('does not replace PV-2 or PV-3');
  });

  it('fails closed when the SVG artifact does not match the CAD export boundary', () => {
    const bundle = buildCADModelExportBundle(roofModel(), exportInput);
    const artifact = buildCADSvgArtifactPreview(bundle);

    expect(() => buildPlanSetCADAppendixPreviewSheetV1({
      exportBundle: bundle,
      svgArtifact: { ...artifact, sourceExportHash: '00000000' },
    })).toThrow(/source export hash mismatch/i);

    expect(() => buildPlanSetCADAppendixPreviewSheetV1({
      exportBundle: bundle,
      svgArtifact: { ...artifact, systemType: 'ground_mount' },
    })).toThrow(/system type mismatch/i);

    expect(() => buildPlanSetCADAppendixPreviewSheetV1({
      exportBundle: { ...bundle, validation: { ...bundle.validation, valid: false, errors: ['invalid'], warnings: [] } },
      svgArtifact: artifact,
    })).toThrow(/valid source CAD export/i);
  });
});
