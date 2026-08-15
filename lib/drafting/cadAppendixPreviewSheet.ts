import type { CADModelExportBundle } from '@/lib/cad/cadModelExportBundle';
import type { CADSvgArtifactPreview } from '@/lib/cad/cadSvgArtifactPreview';
import type { CADSystemType } from '@/lib/cad/types';

export const CAD_APPENDIX_PREVIEW_SHEET_ID = 'APP-CAD' as const;

export type PlanSetCADAppendixPreviewSheetSchemaVersion = 'plan_set_cad_appendix_preview_sheet_v1';
export type PlanSetCADAppendixPreviewSheetType = 'cad_preview_appendix';
export type PlanSetCADAppendixPreviewPersistenceMode = 'deterministic_appendix_preview_dto_only_v1';

export interface PlanSetCADAppendixPreviewAuthorityFlagsV1 {
  persistenceAllowed: false;
  solverExecutionAllowed: false;
  cadMutationAllowed: false;
  canonicalGeometryMutationAllowed: false;
  planSetProductionSheetMutationAllowed: false;
  pv2ReplacementAllowed: false;
  pv3ReplacementAllowed: false;
  engineeringInfluenceAllowed: false;
  necInfluenceAllowed: false;
  bomInfluenceAllowed: false;
  routeInfluenceAllowed: false;
  workflowInfluenceAllowed: false;
  recommendationInfluenceAllowed: false;
  permitAuthorityAllowed: false;
  constructionDrawingAuthorityAllowed: false;
  downstreamAuthority: false;
}

export interface PlanSetCADAppendixPreviewSheetInputV1 {
  exportBundle: CADModelExportBundle;
  svgArtifact: CADSvgArtifactPreview;
  renderingWarnings?: string[];
}

export interface PlanSetCADAppendixPreviewSheetV1 {
  sheetSchemaVersion: PlanSetCADAppendixPreviewSheetSchemaVersion;
  persistenceMode: PlanSetCADAppendixPreviewPersistenceMode;
  sheetType: PlanSetCADAppendixPreviewSheetType;
  sheetId: typeof CAD_APPENDIX_PREVIEW_SHEET_ID;
  sheetTitle: 'CAD PREVIEW APPENDIX';
  systemType: CADSystemType;
  sourceCADExportHash: string;
  sourceSVGArtifactHash: string;
  cadModelVersion: string;
  units: CADModelExportBundle['units'];
  viewBox: CADSvgArtifactPreview['viewBox'];
  layerSummary: CADSvgArtifactPreview['layerSummary'];
  previewOnlyLabels: readonly [
    'CAD PREVIEW ONLY',
    'NON-AUTHORITATIVE',
    'NOT PERMIT AUTHORITY',
    'NOT ENGINEERING AUTHORITY',
    'NOT CONSTRUCTION DRAWING',
  ];
  authorityFlags: PlanSetCADAppendixPreviewAuthorityFlagsV1;
  svgPayload: string;
  renderingWarnings: string[];
  deterministicNotes: string[];
  sheetHash: string;
}

export const CAD_APPENDIX_PREVIEW_LABELS = [
  'CAD PREVIEW ONLY',
  'NON-AUTHORITATIVE',
  'NOT PERMIT AUTHORITY',
  'NOT ENGINEERING AUTHORITY',
  'NOT CONSTRUCTION DRAWING',
] as const;

export const CAD_APPENDIX_PREVIEW_AUTHORITY_FLAGS: PlanSetCADAppendixPreviewAuthorityFlagsV1 = {
  persistenceAllowed: false,
  solverExecutionAllowed: false,
  cadMutationAllowed: false,
  canonicalGeometryMutationAllowed: false,
  planSetProductionSheetMutationAllowed: false,
  pv2ReplacementAllowed: false,
  pv3ReplacementAllowed: false,
  engineeringInfluenceAllowed: false,
  necInfluenceAllowed: false,
  bomInfluenceAllowed: false,
  routeInfluenceAllowed: false,
  workflowInfluenceAllowed: false,
  recommendationInfluenceAllowed: false,
  permitAuthorityAllowed: false,
  constructionDrawingAuthorityAllowed: false,
  downstreamAuthority: false,
};

export function buildPlanSetCADAppendixPreviewSheetV1(
  input: PlanSetCADAppendixPreviewSheetInputV1,
): PlanSetCADAppendixPreviewSheetV1 {
  assertAppendixInputs(input.exportBundle, input.svgArtifact);

  const renderingWarnings = [...(input.renderingWarnings ?? [])].map(warning => String(warning));
  const sheetWithoutHash = {
    sheetSchemaVersion: 'plan_set_cad_appendix_preview_sheet_v1' as const,
    persistenceMode: 'deterministic_appendix_preview_dto_only_v1' as const,
    sheetType: 'cad_preview_appendix' as const,
    sheetId: CAD_APPENDIX_PREVIEW_SHEET_ID,
    sheetTitle: 'CAD PREVIEW APPENDIX' as const,
    systemType: input.exportBundle.systemType,
    sourceCADExportHash: input.exportBundle.exportHash,
    sourceSVGArtifactHash: input.svgArtifact.artifactHash,
    cadModelVersion: input.exportBundle.cadModelVersion,
    units: input.exportBundle.units,
    viewBox: input.svgArtifact.viewBox,
    layerSummary: input.svgArtifact.layerSummary,
    previewOnlyLabels: CAD_APPENDIX_PREVIEW_LABELS,
    authorityFlags: CAD_APPENDIX_PREVIEW_AUTHORITY_FLAGS,
    svgPayload: input.svgArtifact.svg,
    renderingWarnings,
    deterministicNotes: [
      'Plan-set CAD appendix preview is an additive deterministic DTO sheet only.',
      'The appendix consumes CADModelExportBundle and CADSvgArtifactPreview boundaries and does not execute CAD solving.',
      'The appendix does not replace PV-2, replace PV-3, mutate CAD, mutate canonical geometry, mutate engineering, mutate NEC, mutate BOM, mutate routing, mutate workflow, mutate recommendations, or become permit authority.',
      'The appendix SVG is preview-only visibility for reviewed solved CAD data and is not a construction drawing.',
    ],
  } satisfies Omit<PlanSetCADAppendixPreviewSheetV1, 'sheetHash'>;

  return {
    ...sheetWithoutHash,
    sheetHash: deterministicHash(sheetWithoutHash),
  };
}

export function renderPlanSetCADAppendixPreviewSheetV1(sheet: PlanSetCADAppendixPreviewSheetV1): string {
  assertAppendixSheet(sheet);
  const warnings = sheet.renderingWarnings.length > 0
    ? sheet.renderingWarnings.map((warning, index) => `<text x="44" y="${548 + index * 13}" font-family="SolarPro Sans, SolarPro Symbols" font-size="10" fill="#92400e">${escapeText(warning)}</text>`).join('')
    : '<text x="44" y="548" font-family="SolarPro Sans, SolarPro Symbols" font-size="10" fill="#475569">No rendering warnings reported by CAD preview appendix boundary.</text>';

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="850" viewBox="0 0 1100 850" role="img" aria-label="CAD preview appendix non-authoritative">',
    '<rect width="1100" height="850" fill="#ffffff"/>',
    '<rect x="28" y="26" width="1044" height="798" fill="#ffffff" stroke="#0f172a" stroke-width="2"/>',
    '<rect x="42" y="42" width="1016" height="62" fill="#111827"/>',
    `<text x="58" y="72" font-family="SolarPro Sans, SolarPro Symbols" font-size="24" font-weight="900" fill="#ffffff">${escapeText(sheet.sheetTitle)} · ${escapeText(sheet.sheetId)}</text>`,
    `<text x="58" y="94" font-family="SolarPro Sans, SolarPro Symbols" font-size="12" fill="#fecaca">${escapeText(sheet.previewOnlyLabels.join(' · '))}</text>`,
    '<rect x="42" y="118" width="704" height="472" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.5"/>',
    `<g transform="translate(64 134) scale(0.74)">${stripOuterSvg(sheet.svgPayload)}</g>`,
    '<rect x="766" y="118" width="292" height="472" fill="#f9fafb" stroke="#94a3b8" stroke-width="1.5"/>',
    '<text x="786" y="148" font-family="SolarPro Sans, SolarPro Symbols" font-size="16" font-weight="900" fill="#0f172a">CAD PREVIEW METADATA</text>',
    metadataRow(786, 180, 'SYSTEM', sheet.systemType),
    metadataRow(786, 204, 'CAD VERSION', sheet.cadModelVersion),
    metadataRow(786, 228, 'UNITS', sheet.units),
    metadataRow(786, 252, 'EXPORT HASH', sheet.sourceCADExportHash),
    metadataRow(786, 276, 'ARTIFACT HASH', sheet.sourceSVGArtifactHash),
    metadataRow(786, 300, 'SHEET HASH', sheet.sheetHash),
    metadataRow(786, 336, 'PANELS', String(sheet.layerSummary.panelCount)),
    metadataRow(786, 360, 'ROOF PLANES', String(sheet.layerSummary.roofPlaneCount)),
    metadataRow(786, 384, 'GROUND ARRAYS', String(sheet.layerSummary.groundArrayCount)),
    metadataRow(786, 408, 'FENCE SEGMENTS', String(sheet.layerSummary.fenceSegmentCount)),
    metadataRow(786, 432, 'OBSTRUCTIONS', String(sheet.layerSummary.obstructionCount)),
    metadataRow(786, 456, 'DIMENSIONS', String(sheet.layerSummary.dimensionCount)),
    '<text x="786" y="498" font-family="SolarPro Sans, SolarPro Symbols" font-size="11" font-weight="900" fill="#991b1b">NO PERMIT / ENGINEERING / CONSTRUCTION AUTHORITY</text>',
    '<text x="786" y="518" font-family="SolarPro Sans, SolarPro Symbols" font-size="10" fill="#475569">Generated from read-only CAD export + SVG artifact DTOs.</text>',
    '<text x="44" y="626" font-family="SolarPro Sans, SolarPro Symbols" font-size="15" font-weight="900" fill="#0f172a">BOUNDARY NOTES</text>',
    ...sheet.deterministicNotes.slice(0, 4).map((note, index) => `<text x="44" y="${650 + index * 18}" font-family="SolarPro Sans, SolarPro Symbols" font-size="11" fill="#334155">${escapeText(note)}</text>`),
    '<text x="44" y="532" font-family="SolarPro Sans, SolarPro Symbols" font-size="13" font-weight="900" fill="#0f172a">WARNINGS</text>',
    warnings,
    '<rect x="42" y="744" width="1016" height="58" fill="#fee2e2" stroke="#991b1b" stroke-width="1.5"/>',
    '<text x="550" y="770" text-anchor="middle" font-family="SolarPro Sans, SolarPro Symbols" font-size="18" font-weight="900" fill="#991b1b">CAD PREVIEW ONLY · NON-AUTHORITATIVE · NOT CONSTRUCTION DRAWING</text>',
    '<text x="550" y="790" text-anchor="middle" font-family="SolarPro Sans, SolarPro Symbols" font-size="12" fill="#7f1d1d">This appendix does not replace PV-2 or PV-3 and does not alter permit, engineering, NEC, BOM, routing, workflow, or recommendation outputs.</text>',
    '</svg>',
  ].join('');
}

function assertAppendixInputs(exportBundle: CADModelExportBundle, svgArtifact: CADSvgArtifactPreview): void {
  if (exportBundle.exportSchemaVersion !== 'cad_model_export_bundle_v1') throw new Error('CAD appendix requires CADModelExportBundle V1 input.');
  if (exportBundle.persistenceMode !== 'deterministic_dto_only_v1') throw new Error('CAD appendix requires deterministic export DTO persistence mode.');
  if (!exportBundle.validation?.valid) throw new Error('CAD appendix requires a valid source CAD export bundle.');
  if (svgArtifact.artifactSchemaVersion !== 'cad_svg_artifact_preview_v1') throw new Error('CAD appendix requires CAD SVG artifact preview V1 input.');
  if (svgArtifact.persistenceMode !== 'deterministic_preview_dto_only_v1') throw new Error('CAD appendix requires deterministic SVG artifact preview persistence mode.');
  if (svgArtifact.artifactKind !== 'svg_preview') throw new Error('CAD appendix requires an SVG preview artifact.');
  if (svgArtifact.sourceExportHash !== exportBundle.exportHash) throw new Error('CAD appendix source export hash mismatch.');
  if (svgArtifact.sourceCadModelVersion !== exportBundle.cadModelVersion) throw new Error('CAD appendix CAD model version mismatch.');
  if (svgArtifact.systemType !== exportBundle.systemType) throw new Error('CAD appendix system type mismatch.');
  if (svgArtifact.units !== exportBundle.units) throw new Error('CAD appendix units mismatch.');
  if (!/^[0-9a-f]{8}$/.test(exportBundle.exportHash)) throw new Error('CAD appendix requires deterministic source CAD export hash.');
  if (!/^[0-9a-f]{8}$/.test(svgArtifact.artifactHash)) throw new Error('CAD appendix requires deterministic source SVG artifact hash.');
}

function assertAppendixSheet(sheet: PlanSetCADAppendixPreviewSheetV1): void {
  if (sheet.sheetSchemaVersion !== 'plan_set_cad_appendix_preview_sheet_v1') throw new Error('Invalid CAD appendix sheet schema version.');
  if (sheet.persistenceMode !== 'deterministic_appendix_preview_dto_only_v1') throw new Error('Invalid CAD appendix persistence mode.');
  if (sheet.sheetType !== 'cad_preview_appendix') throw new Error('Invalid CAD appendix sheet type.');
  if (sheet.sheetId !== CAD_APPENDIX_PREVIEW_SHEET_ID) throw new Error('CAD appendix sheet must use APP-CAD sheet id.');
  const sheetId: string = sheet.sheetId;
  if (sheetId === 'PV-2' || sheetId === 'PV-3') throw new Error('CAD appendix cannot use production PV-2/PV-3 sheet ids.');
  if (!sheet.previewOnlyLabels.includes('CAD PREVIEW ONLY')) throw new Error('CAD appendix missing preview-only label.');
  if (Object.values(sheet.authorityFlags).some(Boolean)) throw new Error('CAD appendix authority flags must all be false.');
}

function metadataRow(x: number, y: number, label: string, value: string): string {
  return `<text x="${x}" y="${y}" font-family="SolarPro Sans, SolarPro Symbols" font-size="10" fill="#64748b">${escapeText(label)}</text><text x="${x + 92}" y="${y}" font-family="SolarPro Sans, SolarPro Symbols" font-size="10" font-weight="700" fill="#0f172a">${escapeText(value)}</text>`;
}

function stripOuterSvg(svg: string): string {
  const openEnd = svg.indexOf('>');
  const closeStart = svg.lastIndexOf('</svg>');
  if (!svg.startsWith('<svg') || openEnd < 0 || closeStart < openEnd) return escapeText(svg);
  return svg.slice(openEnd + 1, closeStart);
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
