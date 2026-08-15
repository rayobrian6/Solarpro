import type { CADModel, CADPanel, CADSystemType } from './types';
import type { CADModelExportBundle } from './cadModelExportBundle';

export type CADSvgArtifactSchemaVersion = 'cad_svg_artifact_preview_v1';
export type CADSvgArtifactPersistenceMode = 'deterministic_preview_dto_only_v1';
export type CADSvgArtifactKind = 'svg_preview';

export interface CADSvgArtifactAuthorityFlags {
  persistenceAllowed: false;
  solverExecutionAllowed: false;
  cadMutationAllowed: false;
  canonicalGeometryMutationAllowed: false;
  planSetMutationAllowed: false;
  engineeringInfluenceAllowed: false;
  necInfluenceAllowed: false;
  bomInfluenceAllowed: false;
  routeInfluenceAllowed: false;
  workflowInfluenceAllowed: false;
  recommendationInfluenceAllowed: false;
  permitAuthorityAllowed: false;
  downstreamAuthority: false;
}

export interface CADSvgArtifactPreview {
  artifactSchemaVersion: CADSvgArtifactSchemaVersion;
  persistenceMode: CADSvgArtifactPersistenceMode;
  artifactKind: CADSvgArtifactKind;
  sourceExportSchemaVersion: CADModelExportBundle['exportSchemaVersion'];
  sourceExportHash: string;
  sourceCadModelVersion: string;
  systemType: CADSystemType;
  units: CADModelExportBundle['units'];
  coordinateSpace: 'cad_local_xy_meters_scaled_to_svg_viewbox';
  viewBox: {
    minX: number;
    minY: number;
    width: number;
    height: number;
    paddingM: number;
    scale: number;
  };
  layerSummary: {
    roofPlaneCount: number;
    groundArrayCount: number;
    fenceSegmentCount: number;
    panelCount: number;
    obstructionCount: number;
    dimensionCount: number;
  };
  svg: string;
  authorityFlags: CADSvgArtifactAuthorityFlags;
  artifactHash: string;
  deterministicNotes: string[];
}

export const CAD_SVG_ARTIFACT_AUTHORITY_FLAGS: CADSvgArtifactAuthorityFlags = {
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
};

const SVG_WIDTH = 900;
const SVG_HEIGHT = 620;
const MIN_SPAN_M = 1;
const PADDING_M = 1;

export function buildCADSvgArtifactPreview(bundle: CADModelExportBundle): CADSvgArtifactPreview {
  assertExportBundle(bundle);

  const cad = bundle.sanitizedModelSnapshot;
  const viewBox = buildViewBox(cad);
  const layers = renderLayers(cad, viewBox);
  const layerSummary = summarizeLayers(cad);

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" role="img" aria-label="${escapeAttribute(`CAD SVG preview ${bundle.systemType} ${bundle.exportHash}`)}">`,
    '<rect x="0" y="0" width="900" height="620" fill="#f8fafc"/>',
    '<g data-layer="cad-preview-grid" stroke="#dbeafe" stroke-width="1" opacity="0.55">',
    renderGrid(),
    '</g>',
    `<text x="24" y="34" font-family="SolarPro Sans, SolarPro Symbols" font-size="18" font-weight="700" fill="#0f172a">${escapeText(`CAD SVG Preview · ${bundle.systemType}`)}</text>`,
    `<text x="24" y="58" font-family="SolarPro Sans, SolarPro Symbols" font-size="11" fill="#475569">${escapeText(`sourceExportHash=${bundle.exportHash} · units=${bundle.units} · preview-only/no downstream authority`)}</text>`,
    `<g data-layer="cad-preview-geometry" transform="translate(0 0)">${layers.join('')}</g>`,
    '<rect x="18" y="78" width="864" height="510" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="6 4"/>',
    '<text x="24" y="604" font-family="SolarPro Sans, SolarPro Symbols" font-size="10" fill="#64748b">Preview artifact only. Not permit, plan-set, engineering, NEC, BOM, route, workflow, recommendation, or geometry authority.</text>',
    '</svg>',
  ].join('');

  const artifactWithoutHash = {
    artifactSchemaVersion: 'cad_svg_artifact_preview_v1' as const,
    persistenceMode: 'deterministic_preview_dto_only_v1' as const,
    artifactKind: 'svg_preview' as const,
    sourceExportSchemaVersion: bundle.exportSchemaVersion,
    sourceExportHash: bundle.exportHash,
    sourceCadModelVersion: bundle.cadModelVersion,
    systemType: bundle.systemType,
    units: bundle.units,
    coordinateSpace: 'cad_local_xy_meters_scaled_to_svg_viewbox' as const,
    viewBox,
    layerSummary,
    svg,
    authorityFlags: CAD_SVG_ARTIFACT_AUTHORITY_FLAGS,
    deterministicNotes: [
      'CAD SVG artifact preview consumes CADModelExportBundle only and does not execute the CAD solver.',
      'The SVG is a deterministic read-only preview DTO and is not persisted by this module.',
      'The preview does not mutate CAD geometry, canonical geometry, roof planes, setbacks, layout, plan sets, engineering, NEC, BOM, routing, workflow, recommendations, permits, or source exports.',
      'Open-source CAD or SVG tooling may replace the internal renderer later only behind this preview artifact boundary.',
    ],
  } satisfies Omit<CADSvgArtifactPreview, 'artifactHash'>;

  return {
    ...artifactWithoutHash,
    artifactHash: deterministicHash(artifactWithoutHash),
  };
}

function assertExportBundle(bundle: CADModelExportBundle | null | undefined): asserts bundle is CADModelExportBundle {
  if (!bundle) throw new Error('CAD SVG preview requires a CAD model export bundle.');
  if (bundle.exportSchemaVersion !== 'cad_model_export_bundle_v1') throw new Error('CAD SVG preview requires cad_model_export_bundle_v1 input.');
  if (bundle.persistenceMode !== 'deterministic_dto_only_v1') throw new Error('CAD SVG preview requires deterministic DTO export input.');
  if (!bundle.validation?.valid) throw new Error('CAD SVG preview requires a valid source CAD export bundle.');
  if (!/^[0-9a-f]{8}$/.test(bundle.exportHash)) throw new Error('CAD SVG preview requires a deterministic source export hash.');
  if (bundle.units !== 'meters_local_xy') throw new Error('CAD SVG preview requires meters_local_xy source units.');
  if (bundle.systemType !== 'roof' && bundle.systemType !== 'ground_mount' && bundle.systemType !== 'solar_fence') {
    throw new Error('CAD SVG preview requires a supported CAD system type.');
  }
  if (!bundle.sanitizedModelSnapshot || bundle.sanitizedModelSnapshot.systemType !== bundle.systemType) {
    throw new Error('CAD SVG preview requires source snapshot system type to match export system type.');
  }
}

function buildViewBox(cad: CADModel): CADSvgArtifactPreview['viewBox'] {
  const minX = finiteOr(cad.bounds.minX, 0) - PADDING_M;
  const minY = finiteOr(cad.bounds.minY, 0) - PADDING_M;
  const maxX = finiteOr(cad.bounds.maxX, minX + MIN_SPAN_M) + PADDING_M;
  const maxY = finiteOr(cad.bounds.maxY, minY + MIN_SPAN_M) + PADDING_M;
  const widthM = Math.max(maxX - minX, MIN_SPAN_M);
  const heightM = Math.max(maxY - minY, MIN_SPAN_M);
  const scale = Math.min(820 / widthM, 460 / heightM);

  return {
    minX: round(minX),
    minY: round(minY),
    width: round(widthM),
    height: round(heightM),
    paddingM: round(PADDING_M),
    scale: round(scale),
  };
}

function renderLayers(cad: CADModel, viewBox: CADSvgArtifactPreview['viewBox']): string[] {
  const parts: string[] = [];
  if (cad.roof) {
    for (const plane of cad.roof.planes) {
      parts.push(`<polygon data-layer="roof-plane" data-id="${escapeAttribute(plane.id)}" points="${plane.polygon.map(point => projectPoint(point.x, point.y, viewBox)).join(' ')}" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/>`);
      parts.push(`<polygon data-layer="roof-usable-plane" data-id="${escapeAttribute(plane.id)}" points="${plane.usablePolygon.map(point => projectPoint(point.x, point.y, viewBox)).join(' ')}" fill="#eff6ff" stroke="#60a5fa" stroke-width="1.5" stroke-dasharray="5 4"/>`);
      for (const panel of plane.panels) parts.push(renderPanel(panel, viewBox, 'roof-panel'));
    }
  }

  if (cad.ground) {
    for (const array of cad.ground.arrays) {
      const x = projectX(array.originX, viewBox);
      const y = projectY(array.originY, viewBox);
      const width = round(array.dimensions.arrayWidthM * viewBox.scale);
      const height = round(Math.max(array.dimensions.arrayDepthM, 0.25) * viewBox.scale);
      parts.push(`<rect data-layer="ground-array" data-id="${escapeAttribute(array.id)}" x="${x}" y="${round(y - height)}" width="${width}" height="${height}" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/>`);
      for (const row of array.rows) {
        const rowStart = projectPoint(row.x, row.y, viewBox);
        const rowEnd = projectPoint(row.x + row.widthM, row.y, viewBox);
        parts.push(`<line data-layer="ground-row" data-id="${escapeAttribute(row.id)}" x1="${rowStart.split(',')[0]}" y1="${rowStart.split(',')[1]}" x2="${rowEnd.split(',')[0]}" y2="${rowEnd.split(',')[1]}" stroke="#15803d" stroke-width="1.5" stroke-dasharray="4 3"/>`);
        for (const panel of row.panels) parts.push(renderPanel(panel, viewBox, 'ground-panel'));
      }
    }
  }

  if (cad.fence) {
    for (const segment of cad.fence.segments) {
      const start = projectPoint(segment.startX, segment.startY, viewBox);
      const end = projectPoint(segment.endX, segment.endY, viewBox);
      const [x1, y1] = start.split(',');
      const [x2, y2] = end.split(',');
      parts.push(`<line data-layer="fence-segment" data-id="${escapeAttribute(segment.id)}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#7c3aed" stroke-width="5" stroke-linecap="round"/>`);
      for (const post of segment.posts) {
        const postPoint = projectPoint(post.x, post.y, viewBox).split(',');
        parts.push(`<circle data-layer="fence-post" data-id="${escapeAttribute(post.id)}" cx="${postPoint[0]}" cy="${postPoint[1]}" r="4" fill="#4c1d95"/>`);
      }
      for (const panel of segment.panels) parts.push(renderPanel(panel, viewBox, 'fence-panel'));
    }
  }

  for (const obstruction of cad.obstructions ?? []) {
    const cx = projectX(obstruction.x, viewBox);
    const cy = projectY(obstruction.y, viewBox);
    const radius = round(Math.max(obstruction.totalRadiusM, obstruction.radiusM, 0.05) * viewBox.scale);
    parts.push(`<circle data-layer="obstruction" data-id="${escapeAttribute(obstruction.id)}" cx="${cx}" cy="${cy}" r="${radius}" fill="#fee2e2" stroke="#dc2626" stroke-width="1.5" opacity="0.75"/>`);
  }

  for (const dimension of cad.dimensions) {
    const p1 = projectPoint(dimension.x1, dimension.y1, viewBox).split(',');
    const p2 = projectPoint(dimension.x2, dimension.y2, viewBox).split(',');
    const labelX = round((Number(p1[0]) + Number(p2[0])) / 2);
    const labelY = round((Number(p1[1]) + Number(p2[1])) / 2 - 6);
    parts.push(`<line data-layer="dimension" data-id="${escapeAttribute(dimension.id)}" x1="${p1[0]}" y1="${p1[1]}" x2="${p2[0]}" y2="${p2[1]}" stroke="#334155" stroke-width="1" stroke-dasharray="3 3"/>`);
    parts.push(`<text data-layer="dimension-label" data-id="${escapeAttribute(dimension.id)}" x="${labelX}" y="${labelY}" font-family="SolarPro Sans, SolarPro Symbols" font-size="10" text-anchor="middle" fill="#334155">${escapeText(dimension.label)}</text>`);
  }

  return parts;
}

function renderPanel(panel: CADPanel, viewBox: CADSvgArtifactPreview['viewBox'], layer: string): string {
  const width = round(panel.widthM * viewBox.scale);
  const height = round(panel.heightM * viewBox.scale);
  const cx = projectX(panel.x, viewBox);
  const cy = projectY(panel.y, viewBox);
  const x = round(cx - width / 2);
  const y = round(cy - height / 2);
  const fill = layer === 'roof-panel' ? '#1d4ed8' : layer === 'ground-panel' ? '#15803d' : '#6d28d9';
  return `<rect data-layer="${escapeAttribute(layer)}" data-id="${escapeAttribute(panel.id)}" x="${x}" y="${y}" width="${width}" height="${height}" rx="2" fill="${fill}" stroke="#0f172a" stroke-width="1" opacity="0.92"/>`;
}

function summarizeLayers(cad: CADModel): CADSvgArtifactPreview['layerSummary'] {
  return {
    roofPlaneCount: cad.roof?.planes.length ?? 0,
    groundArrayCount: cad.ground?.arrays.length ?? 0,
    fenceSegmentCount: cad.fence?.segments.length ?? 0,
    panelCount: cad.totalPanels,
    obstructionCount: cad.obstructions?.length ?? 0,
    dimensionCount: cad.dimensions.length,
  };
}

function renderGrid(): string {
  const parts: string[] = [];
  for (let x = 60; x <= 840; x += 60) parts.push(`<line x1="${x}" y1="78" x2="${x}" y2="588"/>`);
  for (let y = 108; y <= 558; y += 60) parts.push(`<line x1="18" y1="${y}" x2="882" y2="${y}"/>`);
  return parts.join('');
}

function projectPoint(x: number, y: number, viewBox: CADSvgArtifactPreview['viewBox']): string {
  return `${projectX(x, viewBox)},${projectY(y, viewBox)}`;
}

function projectX(x: number, viewBox: CADSvgArtifactPreview['viewBox']): number {
  return round(40 + (x - viewBox.minX) * viewBox.scale);
}

function projectY(y: number, viewBox: CADSvgArtifactPreview['viewBox']): number {
  return round(560 - (y - viewBox.minY) * viewBox.scale);
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

function deterministicHash(value: unknown): string {
  let hash = 0x811c9dc5;
  const text = stableStringify(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
