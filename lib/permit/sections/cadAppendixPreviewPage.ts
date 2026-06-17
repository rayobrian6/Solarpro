import type { CADModel, CADPanel, CADRoofPlane } from '@/lib/cad/types';
import type { EngineeringSurveyEvidence } from '@/lib/engineering/surveyEvidence';
import type { PermitInput } from '../types';
import { buildCADModelExportBundle } from '@/lib/cad/cadModelExportBundle';
import { buildCADSvgArtifactPreview } from '@/lib/cad/cadSvgArtifactPreview';
import {
  buildPlanSetCADAppendixPreviewSheetV1,
  CAD_APPENDIX_PREVIEW_SHEET_ID,
  renderPlanSetCADAppendixPreviewSheetV1,
} from '@/lib/drafting/cadAppendixPreviewSheet';
import { titleBlock } from '../utils/titleBlock';

export function pageCADAppendixPreview(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number): string {
  const surveyEvidence = input.surveyEvidence ?? null;
  const exportBundle = buildCADModelExportBundle(cad, {
    exportedAt: '1970-01-01T00:00:00.000Z',
    exportedBy: 'generatePermitHTML.cadAppendixPreviewV1',
    exportReason: 'permit-package-cad-appendix-preview-v1',
    sourceProjectId: normalizeSourceId(input.project.projectId ?? surveyEvidence?.projectId),
    sourceSurveyId: normalizeSourceId(surveyEvidence?.surveyId),
    sourcePlanSetId: normalizeSourceId(input.planSetId),
  });
  const svgArtifact = buildCADSvgArtifactPreview(exportBundle);
  const appendixSheet = buildPlanSetCADAppendixPreviewSheetV1({
    exportBundle,
    svgArtifact,
    renderingWarnings: cad.warnings ?? [],
  });
  const appendixSvg = renderPlanSetCADAppendixPreviewSheetV1(appendixSheet);
  const surveyCadBridgeSvg = buildSurveyDerivedCadBridgeSvg(input, cad, surveyEvidence);

  return `
  <div class="page cad-appendix-preview-page" data-sheet-id="${CAD_APPENDIX_PREVIEW_SHEET_ID}" data-preview-only="true" data-authority="none">
    ${titleBlock(input, CAD_APPENDIX_PREVIEW_SHEET_ID, 'CAD PREVIEW APPENDIX', pageNum, totalPages)}
    <div class="cad-appendix-wrap" style="height:calc(100% - 150px);padding:10px 14px 14px 14px;display:grid;grid-template-columns:${surveyCadBridgeSvg ? '1.32fr 0.68fr' : '1fr'};gap:10px;align-items:stretch;">
      <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;border:var(--border);background:#fff;overflow:hidden;">
        ${appendixSvg.replace('<svg ', '<svg style="width:100%;height:100%;display:block;" ')}
      </div>
      ${surveyCadBridgeSvg ? `<div class="site-survey-cad-bridge-wrap" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;border:var(--border);background:#fff;overflow:hidden;">${surveyCadBridgeSvg}</div>` : ''}
    </div>
    <div style="position:absolute;left:32px;right:32px;bottom:18px;font-family:var(--sans);font-size:7px;font-weight:900;text-align:center;letter-spacing:0.5px;color:#000;border:var(--border);padding:5px;background:#fff;">
      CAD PREVIEW ONLY · NON-AUTHORITATIVE · NOT PERMIT AUTHORITY · NOT ENGINEERING AUTHORITY · NOT CONSTRUCTION DRAWING · DOES NOT REPLACE PV-2 OR PV-3
    </div>
  </div>`;
}

function buildSurveyDerivedCadBridgeSvg(input: PermitInput, cad: CADModel, surveyEvidence: EngineeringSurveyEvidence | null): string {
  if (!surveyEvidence) return '';
  const roofPlanes = cad.roof?.planes ?? [];
  const panels = roofPlanes.flatMap(plane => plane.panels ?? []);
  const bounds = bridgeBounds(cad, roofPlanes, panels);
  const tx = (x: number) => Math.round(38 + (x - bounds.minX) * bounds.scale);
  const ty = (y: number) => Math.round(350 - (y - bounds.minY) * bounds.scale);
  const sourceSurveyId = normalizeSourceId(surveyEvidence.surveyId) ?? 'SURVEY-ID-PENDING';
  const sourceProjectId = normalizeSourceId(surveyEvidence.projectId) ?? normalizeSourceId(input.project.projectId) ?? 'PROJECT-ID-PENDING';
  const readiness = surveyEvidence.manifestV1?.engineeringBridge.readiness ?? (surveyEvidence.completeness === 'sufficient' ? 'ready_for_engineering' : surveyEvidence.completeness === 'partial' ? 'needs_review' : 'blocked');
  const field = surveyEvidence.fieldEvidence;
  const roofGeometryLine = field.hasRoofGeometry
    ? `${field.roofPlaneCount || roofPlanes.length} roof plane(s) · pitch ${valueOr(field.roofPitchDegrees, 'n/a')}° · material ${valueOr(field.roofMaterial, 'n/a')}`
    : `${roofPlanes.length} CAD roof plane(s) · survey roof geometry needs review`;
  const structuralLine = field.hasStructuralData
    ? `Rafters ${valueOr(field.rafterSize, 'n/a')} @ ${valueOr(field.rafterSpacingInches, 'n/a')} in. o.c.`
    : 'Structural field evidence not complete';
  const evidenceLine = `${surveyEvidence.canonicalEvidenceCount} canonical evidence · ${surveyEvidence.rawPhotoCount} raw photo(s) · ${surveyEvidence.evidenceTruthSource}`;
  const bridgeStatus = `${surveyEvidence.completeness.toUpperCase()} · ${readiness.replace(/_/g, ' ').toUpperCase()}`;
  const roofSvg = roofPlanes.length
    ? roofPlanes.map((plane, index) => renderBridgeRoofPlane(plane, index, tx, ty)).join('')
    : '<rect x="66" y="154" width="270" height="132" fill="#f8fafc" stroke="#991b1b" stroke-width="2" stroke-dasharray="8 5"/><text x="86" y="222" font-family="Arial,sans-serif" font-size="12" font-weight="900" fill="#991b1b">NO CAD ROOF GEOMETRY AVAILABLE</text>';
  const panelSvg = panels.map(panel => renderBridgePanel(panel, tx, ty, bounds.scale)).join('');
  const obstructionSvg = (cad.obstructions ?? []).slice(0, 8).map(obs => `<g><circle cx="${tx(obs.x)}" cy="${ty(obs.y)}" r="${Math.max(5, obs.totalRadiusM * bounds.scale)}" fill="#fff7ed" stroke="#92400e" stroke-width="1.5" stroke-dasharray="4 3"/><text x="${tx(obs.x) + 8}" y="${ty(obs.y) - 8}" font-family="Arial,sans-serif" font-size="8" font-weight="700" fill="#92400e">${escapeText(obs.type)}</text></g>`).join('');
  const electricalSvg = (cad.electricalNodes ?? []).slice(0, 6).map(node => `<g><rect x="${tx(node.x) - 8}" y="${ty(node.y) - 8}" width="16" height="16" fill="#fff" stroke="#991b1b" stroke-width="2"/><text x="${tx(node.x) + 12}" y="${ty(node.y) + 4}" font-family="Arial,sans-serif" font-size="8" font-weight="700" fill="#991b1b">${escapeText(node.type)}</text></g>`).join('');
  const conduitSvg = (cad.conduitRoutes ?? []).slice(0, 4).map(route => {
    const d = route.waypoints.map((pt, index) => `${index === 0 ? 'M' : 'L'} ${tx(pt.x)} ${ty(pt.y)}`).join(' ');
    return d ? `<path d="${d}" fill="none" stroke="#6d28d9" stroke-width="2" stroke-dasharray="8 5"><title>${escapeText(route.routeMethod)} · ${route.totalLengthM.toFixed(1)}m</title></path>` : '';
  }).join('');
  const panelCountLabel = panels.length ? `${panels.length} CAD module(s) over survey-linked roof model` : `${cad.totalPanels} module(s) in CAD model`;

  return `<svg class="site-survey-derived-cad-visual" xmlns="http://www.w3.org/2000/svg" width="430" height="720" viewBox="0 0 430 720" role="img" aria-label="Site survey derived CAD bridge visual">
    <rect width="430" height="720" fill="#ffffff"/>
    <rect x="14" y="14" width="402" height="692" fill="#ffffff" stroke="#0f172a" stroke-width="2"/>
    <rect x="26" y="28" width="378" height="50" fill="#111827"/>
    <text x="38" y="58" font-family="Arial,sans-serif" font-size="18" font-weight="900" fill="#ffffff">SITE-SURVEY CAD BRIDGE</text>
    <text x="38" y="73" font-family="Arial,sans-serif" font-size="8" font-weight="700" fill="#bfdbfe">ACTUAL PERMIT APPENDIX VISUAL FROM HYDRATED SURVEY EVIDENCE + CAD MODEL</text>
    <rect x="26" y="92" width="378" height="280" fill="#f8fafc" stroke="#334155" stroke-width="1.5"/>
    <g opacity="0.22">${Array.from({ length: 8 }, (_, i) => `<line x1="${44 + i * 44}" y1="106" x2="${44 + i * 44}" y2="356" stroke="#94a3b8" stroke-width="0.7"/>`).join('')}${Array.from({ length: 6 }, (_, i) => `<line x1="40" y1="${120 + i * 40}" x2="390" y2="${120 + i * 40}" stroke="#94a3b8" stroke-width="0.7"/>`).join('')}</g>
    <text x="38" y="114" font-family="Arial,sans-serif" font-size="9" font-weight="900" fill="#166534">SOURCE SURVEY ${escapeText(sourceSurveyId)}</text>
    <text x="38" y="128" font-family="Arial,sans-serif" font-size="8" font-weight="700" fill="#475569">PROJECT ${escapeText(sourceProjectId)}</text>
    ${roofSvg}${panelSvg}${obstructionSvg}${conduitSvg}${electricalSvg}
    <text x="38" y="390" font-family="Arial,sans-serif" font-size="12" font-weight="900" fill="#0f172a">SURVEY-DERIVED SIGNALS VISIBLE IN THIS PLANSET</text>
    ${bridgeRow(38, 418, 'SURVEY', sourceSurveyId)}
    ${bridgeRow(38, 440, 'EVIDENCE', evidenceLine)}
    ${bridgeRow(38, 462, 'STATUS', bridgeStatus)}
    ${bridgeRow(38, 484, 'ROOF', roofGeometryLine)}
    ${bridgeRow(38, 506, 'STRUCT', structuralLine)}
    ${bridgeRow(38, 528, 'ARRAY', panelCountLabel)}
    ${bridgeRow(38, 550, 'ELECTRICAL', field.hasElectricalData ? `MSP ${valueOr(field.mainPanelRatingAmps, 'n/a')}A · bus ${valueOr(field.busbarRatingAmps, 'n/a')}A · ${valueOr(field.interconnectionPoint, 'n/a')}` : 'Electrical field evidence not complete')}
    <rect x="26" y="584" width="378" height="76" fill="#ecfdf5" stroke="#166534" stroke-width="1.5"/>
    <text x="38" y="608" font-family="Arial,sans-serif" font-size="11" font-weight="900" fill="#166534">VISUAL PROOF OF WIRING</text>
    <text x="38" y="628" font-family="Arial,sans-serif" font-size="9" fill="#14532d">This appendix is rendered only when EngineeringSurveyEvidence reaches generatePermitHTML().</text>
    <text x="38" y="646" font-family="Arial,sans-serif" font-size="9" fill="#14532d">It combines survey IDs/counts/field signals with the current CAD roof/panel model.</text>
    <rect x="26" y="672" width="378" height="22" fill="#fee2e2" stroke="#991b1b" stroke-width="1"/>
    <text x="215" y="687" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" font-weight="900" fill="#991b1b">PREVIEW ONLY · NON-AUTHORITATIVE · DOES NOT ALTER PERMIT CALCS</text>
  </svg>`;
}

function renderBridgeRoofPlane(plane: CADRoofPlane, index: number, tx: (x: number) => number, ty: (y: number) => number): string {
  const polygon = plane.polygon.length ? plane.polygon : plane.usablePolygon;
  const d = polygon.map((pt, pointIndex) => `${pointIndex === 0 ? 'M' : 'L'} ${tx(pt.x)} ${ty(pt.y)}`).join(' ') + ' Z';
  const c = centroid(polygon);
  return `<g><path d="${d}" fill="#ffffff" stroke="#111827" stroke-width="2.4"/><path d="${d}" fill="none" stroke="#166534" stroke-width="1.2" stroke-dasharray="5 4" transform="translate(4 4)"/><text x="${tx(c.x)}" y="${ty(c.y) - 7}" text-anchor="middle" font-family="Arial,sans-serif" font-size="10" font-weight="900" fill="#111827">${escapeText(plane.id || `RP-${index + 1}`)}</text><text x="${tx(c.x)}" y="${ty(c.y) + 7}" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" font-weight="700" fill="#475569">PITCH ${plane.pitch}° / AZ ${plane.azimuth}°</text></g>`;
}

function renderBridgePanel(panel: CADPanel, tx: (x: number) => number, ty: (y: number) => number, scale: number): string {
  const w = Math.max(8, panel.widthM * scale);
  const h = Math.max(12, panel.heightM * scale);
  const x = tx(panel.x) - w / 2;
  const y = ty(panel.y) - h / 2;
  return `<g><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#dbeafe" stroke="#1d4ed8" stroke-width="1.2"><title>${escapeText(panel.id)} · row ${panel.row} col ${panel.col} · ${panel.orientation}</title></rect><line x1="${(x + w / 2).toFixed(1)}" y1="${(y + 2).toFixed(1)}" x2="${(x + w / 2).toFixed(1)}" y2="${(y + h - 2).toFixed(1)}" stroke="#93c5fd" stroke-width="0.6"/></g>`;
}

function bridgeBounds(cad: CADModel, roofPlanes: CADRoofPlane[], panels: CADPanel[]): { minX: number; minY: number; scale: number } {
  const points = [
    ...roofPlanes.flatMap(plane => plane.polygon.length ? plane.polygon : plane.usablePolygon),
    ...panels.map(panel => ({ x: panel.x, y: panel.y })),
    ...(cad.obstructions ?? []).map(obs => ({ x: obs.x, y: obs.y })),
    ...(cad.electricalNodes ?? []).map(node => ({ x: node.x, y: node.y })),
    ...(cad.conduitRoutes ?? []).flatMap(route => route.waypoints.map(point => ({ x: point.x, y: point.y }))),
  ];
  if (points.length === 0) return { minX: 0, minY: 0, scale: 2.4 };
  const minX = Math.min(...points.map(point => point.x));
  const maxX = Math.max(...points.map(point => point.x));
  const minY = Math.min(...points.map(point => point.y));
  const maxY = Math.max(...points.map(point => point.y));
  const scale = Math.min(320 / Math.max(1, maxX - minX), 210 / Math.max(1, maxY - minY));
  return { minX, minY, scale };
}

function centroid(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 };
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function bridgeRow(x: number, y: number, label: string, value: string): string {
  return `<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="8" font-weight="900" fill="#64748b">${escapeText(label)}</text><text x="${x + 74}" y="${y}" font-family="Arial,sans-serif" font-size="8" font-weight="700" fill="#0f172a">${escapeText(truncate(value, 54))}</text>`;
}

function valueOr(value: string | number | null | undefined, fallback: string): string {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function normalizeSourceId(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : undefined;
}
