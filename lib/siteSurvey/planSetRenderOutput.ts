import type { ProfessionalSurveyReadinessReportV1 } from './professionalSurveyReadinessReport';

export type PlanSetSheetTypeV1 = 'cover_summary' | 'site_plan_render' | 'evidence_review';

export interface PlanSetRenderNoAuthorityV1 {
  readOnly: true;
  renderOutputOnly: true;
  stampedEngineeringPackage: false;
  automaticCadGenerationAllowed: false;
  canonicalGeometryMutationAllowed: false;
  cadMutationAllowed: false;
  cadSolverExecutionAllowed: false;
  persistenceAllowed: false;
  downstreamEngineeringAllowed: false;
  downstreamPermitAllowed: false;
  downstreamBomAllowed: false;
}

export interface PlanSetRenderSheetV1 {
  schemaVersion: 'professional_plan_set_render_sheet_v1';
  sheetId: string;
  sheetNumber: string;
  sheetType: PlanSetSheetTypeV1;
  title: string;
  width: number;
  height: number;
  svg: string;
  layerOrder: string[];
  annotations: string[];
  renderHash: string;
  noAuthorityEnforcement: PlanSetRenderNoAuthorityV1;
}

export interface PlanSetRenderPackageV1 {
  schemaVersion: 'professional_plan_set_render_package_v1';
  mode: 'deterministic_svg_plan_set_preview_review_only';
  sourceSurveyId: string;
  sourceRenderReadinessHash: string;
  packageHash: string;
  sheets: PlanSetRenderSheetV1[];
  htmlPreview: string;
  summary: {
    sheetCount: number;
    renderReadinessState: string;
    renderConfidenceScore: number;
    enabledRenderLayerCount: number;
    reviewCalloutCount: number;
    visibleQualityImprovements: string[];
    contractorUsabilityImprovements: string[];
  };
  noAuthorityEnforcement: PlanSetRenderNoAuthorityV1;
  deterministicNotes: string[];
}

const SHEET = { width: 1320, height: 1020, margin: 48, titleBlockH: 118 } as const;
const STYLE = {
  ink: '#172033', muted: '#64748b', grid: '#d8dee9', roof: '#111827', roofFill: '#f8fafc', setback: '#f59e0b', module: '#2563eb', conduit: '#7c3aed', equipment: '#dc2626', review: '#b45309', ok: '#15803d', banner: '#fff7ed', note: '#f1f5f9', paper: '#ffffff', photo: '#e0f2fe', trust: '#ecfdf5', blocked: '#fef2f2', shadow: '#cbd5e1',
} as const;

const LAYERS = ['sheet-background', 'viewport-frame', 'grid', 'roof-outlines', 'setbacks', 'module-previews', 'conduit-candidates', 'equipment-markers', 'annotations', 'review-callouts', 'legend', 'title-block', 'preview-stamp'] as const;

export function buildProfessionalPlanSetRenderPackage(report: ProfessionalSurveyReadinessReportV1): PlanSetRenderPackageV1 {
  const context = buildContext(report);
  const sheets = [renderCoverSheet(context), renderSitePlanSheet(context), renderEvidenceSheet(context)];
  const withoutHash = {
    schemaVersion: 'professional_plan_set_render_package_v1' as const,
    mode: 'deterministic_svg_plan_set_preview_review_only' as const,
    sourceSurveyId: report.source.surveyId,
    sourceRenderReadinessHash: report.renderReadiness.renderReadinessHash,
    sheets,
    htmlPreview: buildHtmlPreview(sheets),
    summary: {
      sheetCount: sheets.length,
      renderReadinessState: report.renderReadiness.state,
      renderConfidenceScore: report.renderReadiness.renderConfidenceScore,
      enabledRenderLayerCount: report.renderRecommendationReport.summary.previewEnabledLayerCount,
      reviewCalloutCount: report.renderReadiness.blockers.length + report.renderReadiness.reviewItems.length,
      visibleQualityImprovements: [
        'Professional title blocks, legends, review stamps, and sheet numbering create contractor-facing plan-set identity.',
        'Canonical roof geometry is rendered as export-safe vector linework with consistent line-weight hierarchy.',
        'Render readiness, confidence, and review-required callouts are visible directly on sheets.',
        'Photo evidence and geometry trust summaries are packaged into readable evidence/review sheets.',
      ],
      contractorUsabilityImprovements: [
        'Roof labels, pitch/azimuth labels, setbacks, equipment markers, and module preview zones are visually grouped.',
        'Blocked/review states are explicit, reducing risk that preview renders are mistaken for stamped engineering.',
        'Legends and notes explain symbol meaning and non-authoritative boundaries on every output package.',
      ],
    },
    noAuthorityEnforcement: noAuthority(),
    deterministicNotes: [
      'SVG sheets are deterministic render previews built from existing survey readiness DTOs only.',
      'Plan-set render output does not execute CAD solvers, mutate CAD, mutate canonical geometry, write persistence, or trigger engineering/permit/BOM workflows.',
      'PDF-ready output means vector composition suitable for export; it is not a stamped engineering package.',
    ],
  };
  return { ...withoutHash, packageHash: hash(stripSvgHashes(withoutHash)) };
}

function buildContext(report: ProfessionalSurveyReadinessReportV1) {
  const bounds = geometryBounds(report.canonicalGeometry.roofPlanes.flatMap(p => p.polygon));
  const viewport = { x: 64, y: 84, w: 842, h: 704 };
  return { report, bounds, viewport, projectTitle: `Survey ${report.source.surveyId}`, date: new Date(0).toISOString().slice(0, 10) };
}

function renderCoverSheet(ctx: ReturnType<typeof buildContext>): PlanSetRenderSheetV1 {
  const r = ctx.report;
  const body = [
    text(72, 138, 'PROFESSIONAL PLAN-SET RENDER PREVIEW', 26, '700'),
    badge(72, 166, 360, 38, `Render state: ${r.renderReadiness.state}`, stateColor(r.renderReadiness.state)),
    metricCard(72, 230, 'Render Confidence', `${r.renderReadiness.renderConfidenceScore}/100`, STYLE.trust),
    metricCard(312, 230, 'Preview Layers', `${r.renderRecommendationReport.summary.previewEnabledLayerCount}`, '#eff6ff'),
    metricCard(552, 230, 'Review Callouts', `${r.renderReadiness.blockers.length + r.renderReadiness.reviewItems.length}`, '#fff7ed'),
    section(72, 342, 558, 250, 'Commercial Render Layer Summary', r.renderRecommendationReport.summary.topCommercialRenderLayers.map(v => `• ${human(v)}`)),
    section(682, 342, 520, 250, 'Geometry / Trust Indicators', [
      `Geometry trust: ${r.geometryIntelligence.scores.geometryConfidenceScore}/100`,
      `Topology integrity: ${r.geometryIntelligence.scores.topologyIntegrityScore}/100`,
      `Readiness trust: ${r.geometryIntelligence.scores.readinessTrustScore}/100`,
      `Discrepancy severity: ${r.geometryIntelligence.scores.discrepancySeverityScore}/100`,
    ]),
    section(72, 636, 1130, 170, 'Review-First Boundary', [
      'Preview output only — not stamped engineering, not permit authority, not BOM authority.',
      'No CAD solver execution, no CAD mutation, no canonical geometry mutation, no persistence side effects.',
      'Use as contractor/demo visualization and operator review artifact before production plan-set work.',
    ]),
  ].join('');
  return sheet(ctx, 'A-000', 'cover_summary', 'Cover / Render Readiness Summary', body, ['render readiness summary', 'geometry trust summary', 'non-authoritative preview stamp']);
}

function renderSitePlanSheet(ctx: ReturnType<typeof buildContext>): PlanSetRenderSheetV1 {
  const r = ctx.report;
  const roof = renderRoofGeometry(ctx);
  const modules = enabled(r, 'module_layout_previews') ? renderModulePreview(ctx) : '';
  const setbacks = enabled(r, 'fire_setback_overlays') ? renderSetbacks(ctx) : '';
  const equipment = renderEquipment(ctx);
  const annotations = renderPlanAnnotations(ctx);
  const callouts = renderReviewCallouts(ctx, 930, 96, 304, 392);
  const legend = renderLegend(930, 520);
  const body = [viewportFrame(ctx), roof, setbacks, modules, equipment, annotations, callouts, legend].join('');
  return sheet(ctx, 'A-101', 'site_plan_render', 'Roof Plan Render Preview', body, ['roof outlines', 'pitch/azimuth annotations', 'setback overlays', 'module preview zones', 'equipment markers', 'review callouts']);
}

function renderEvidenceSheet(ctx: ReturnType<typeof buildContext>): PlanSetRenderSheetV1 {
  const r = ctx.report;
  const photos = r.photoEvidence.evidence.slice(0, 12).map((p, i) => photoTile(72 + (i % 3) * 270, 132 + Math.floor(i / 3) * 132, p.source.slotKey, p.classification.category, p.classification.confidence)).join('');
  const review = section(922, 132, 300, 470, 'Review Required / Confidence Notes', [...r.renderReadiness.blockers, ...r.renderReadiness.reviewItems].slice(0, 10));
  const coverage = section(72, 690, 1150, 150, 'Evidence Coverage', [
    `Roof/mount photos: ${yes(r.photoEvidence.coverage.roofOrMountCoverage)}`,
    `Electrical photos: ${yes(r.photoEvidence.coverage.electricalCoverage)}`,
    `Obstruction photos: ${yes(r.photoEvidence.coverage.obstructionCoverage)}`,
    `Render-relevant photos: ${r.photoEvidence.coverage.renderRelevantPhotoCount}`,
    `Human review photo slots: ${r.photoEvidence.reviewNeededPhotoSlotKeys.join(', ') || 'none'}`,
  ]);
  return sheet(ctx, 'A-201', 'evidence_review', 'Photo Evidence / Review Callout Sheet', photos + review + coverage, ['photo evidence tiles', 'review notes', 'confidence notes']);
}

function sheet(ctx: ReturnType<typeof buildContext>, sheetNumber: string, type: PlanSetSheetTypeV1, title: string, body: string, annotations: string[]): PlanSetRenderSheetV1 {
  const svgNoHash = svgWrap(body + titleBlock(ctx, sheetNumber, title) + stamp(ctx.report));
  const withoutHash = { schemaVersion: 'professional_plan_set_render_sheet_v1' as const, sheetId: `${ctx.report.source.surveyId}-${sheetNumber}`, sheetNumber, sheetType: type, title, width: SHEET.width, height: SHEET.height, svg: svgNoHash, layerOrder: [...LAYERS], annotations, noAuthorityEnforcement: noAuthority() };
  return { ...withoutHash, renderHash: hash({ ...withoutHash, svg: normalizeSvg(svgNoHash) }) };
}

function renderRoofGeometry(ctx: ReturnType<typeof buildContext>) {
  return ctx.report.canonicalGeometry.roofPlanes.map((plane, i) => {
    const d = plane.polygon.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${tx(ctx, p.x)} ${ty(ctx, p.y)}`).join(' ') + ' Z';
    const c = centroid(plane.polygon, ctx);
    return `<path d="${d}" fill="${STYLE.roofFill}" stroke="${STYLE.roof}" stroke-width="3.2"/><text x="${c.x}" y="${c.y}" text-anchor="middle" class="label">${esc(plane.planeId)}</text><text x="${c.x}" y="${c.y + 18}" text-anchor="middle" class="tiny">${plane.pitchDeg}° pitch / ${plane.azimuthDeg}° az</text>${i === 0 ? northArrow(820, 116) : ''}`;
  }).join('');
}

function renderSetbacks(ctx: ReturnType<typeof buildContext>) {
  return ctx.report.canonicalGeometry.roofPlanes.map(plane => {
    const b = geometryBounds(plane.polygon);
    const x = tx(ctx, b.minX), y = ty(ctx, b.maxY), w = Math.max(18, tx(ctx, b.maxX) - tx(ctx, b.minX)), h = Math.max(18, ty(ctx, b.minY) - ty(ctx, b.maxY));
    return `<rect x="${x + 12}" y="${y + 12}" width="${Math.max(1, w - 24)}" height="${Math.max(1, h - 24)}" fill="none" stroke="${STYLE.setback}" stroke-width="2" stroke-dasharray="8 6"/><text x="${x + 18}" y="${y + 30}" class="tiny" fill="${STYLE.setback}">fire setback preview</text>`;
  }).join('');
}

function renderModulePreview(ctx: ReturnType<typeof buildContext>) {
  const cells: string[] = [];
  for (const plane of ctx.report.canonicalGeometry.roofPlanes) {
    const b = geometryBounds(plane.polygon); const x0 = tx(ctx, b.minX) + 40; const y0 = ty(ctx, b.maxY) + 56;
    for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) cells.push(`<rect x="${x0 + col * 44}" y="${y0 + row * 70}" width="34" height="58" rx="2" fill="#dbeafe" stroke="${STYLE.module}" stroke-width="1.4"/>`);
  }
  return cells.join('');
}

function renderEquipment(ctx: ReturnType<typeof buildContext>) {
  const on = ctx.report.photoEvidence.coverage.electricalCoverage;
  const opacity = on ? 1 : 0.38;
  return `<g opacity="${opacity}"><circle cx="760" cy="700" r="15" fill="${STYLE.equipment}"/><text x="782" y="706" class="small">MSP/Meter</text><path d="M 760 700 C 710 630, 640 590, 560 548" fill="none" stroke="${STYLE.conduit}" stroke-width="3" stroke-dasharray="10 7"/><text x="640" y="626" class="tiny" fill="${STYLE.conduit}">conduit candidate</text></g>`;
}

function renderPlanAnnotations(ctx: ReturnType<typeof buildContext>) {
  return ctx.report.renderRecommendationReport.recommendations.filter(r => r.enabledForPreview).slice(0, 8).map((r, i) => annotation(86, 820 + i * 20, human(r.type), r.confidence)).join('');
}

function renderReviewCallouts(ctx: ReturnType<typeof buildContext>, x: number, y: number, w: number, h: number) {
  const items = [...ctx.report.renderReadiness.blockers, ...ctx.report.renderReadiness.reviewItems].slice(0, 8);
  return panel(x, y, w, h, 'Review / Confidence Callouts', items.length ? items : ['No active render blockers. Continue normal operator review.'], STYLE.banner);
}

function renderLegend(x: number, y: number) { return panel(x, y, 304, 230, 'Legend', ['Heavy black: roof outline', 'Orange dashed: setback preview', 'Blue rectangles: module preview', 'Purple dashed: conduit candidate', 'Red dot: MSP/meter/equipment', 'Amber panel: review-required note'], STYLE.note); }
function viewportFrame(ctx: ReturnType<typeof buildContext>) { const v = ctx.viewport; return `<rect x="${v.x}" y="${v.y}" width="${v.w}" height="${v.h}" fill="#fff" stroke="${STYLE.ink}" stroke-width="2"/><g opacity="0.24">${Array.from({ length: 12 }, (_, i) => `<line x1="${v.x + i * 72}" y1="${v.y}" x2="${v.x + i * 72}" y2="${v.y + v.h}" stroke="${STYLE.grid}"/>`).join('')}${Array.from({ length: 10 }, (_, i) => `<line x1="${v.x}" y1="${v.y + i * 72}" x2="${v.x + v.w}" y2="${v.y + i * 72}" stroke="${STYLE.grid}"/>`).join('')}</g>`; }
function titleBlock(ctx: ReturnType<typeof buildContext>, num: string, title: string) { return `<g><rect x="48" y="870" width="1224" height="104" fill="#f8fafc" stroke="${STYLE.ink}" stroke-width="1.6"/><text x="72" y="910" class="title">SolarPro Preview</text><text x="72" y="936" class="small">${esc(ctx.projectTitle)} · ${esc(ctx.report.source.projectId ?? 'project pending')}</text><text x="72" y="960" class="tiny">Deterministic render preview · review required before production use</text><text x="1008" y="912" class="small">SHEET</text><text x="1008" y="952" class="sheetno">${num}</text><text x="838" y="912" class="small">TITLE</text><text x="838" y="940" class="small">${esc(title)}</text></g>`; }
function stamp(r: ProfessionalSurveyReadinessReportV1) { const blocked = r.renderReadiness.state === 'render_blocked'; return `<g><rect x="930" y="34" width="300" height="34" rx="17" fill="${blocked ? STYLE.blocked : STYLE.trust}" stroke="${blocked ? '#991b1b' : '#166534'}"/><text x="1080" y="56" text-anchor="middle" class="stamp">NON-AUTHORITATIVE PREVIEW · ${r.renderReadiness.renderConfidenceScore}/100</text></g>`; }
function section(x: number, y: number, w: number, h: number, title: string, lines: string[]) { return panel(x, y, w, h, title, lines, '#ffffff'); }
function panel(x: number, y: number, w: number, h: number, title: string, lines: string[], fill: string) { return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${STYLE.shadow}"/><text x="${x + 18}" y="${y + 30}" class="panelTitle">${esc(title)}</text>${lines.slice(0, 10).map((l, i) => `<text x="${x + 18}" y="${y + 62 + i * 22}" class="small">${esc(trunc(l, 72))}</text>`).join('')}</g>`; }
function metricCard(x: number, y: number, label: string, value: string, fill: string) { return `<g><rect x="${x}" y="${y}" width="202" height="84" rx="12" fill="${fill}" stroke="${STYLE.shadow}"/><text x="${x + 18}" y="${y + 32}" class="small">${esc(label)}</text><text x="${x + 18}" y="${y + 66}" class="metric">${esc(value)}</text></g>`; }
function text(x: number, y: number, value: string, size: number, weight = '400') { return `<text x="${x}" y="${y}" style="font:${weight} ${size}px Arial,sans-serif;fill:${STYLE.ink}">${esc(value)}</text>`; }
function badge(x: number, y: number, w: number, h: number, label: string, fill: string) { return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="19" fill="${fill}"/><text x="${x + 18}" y="${y + 25}" class="badge">${esc(label)}</text>`; }
function photoTile(x: number, y: number, slot: string, cat: string, conf: string) { return `<g><rect x="${x}" y="${y}" width="236" height="104" rx="10" fill="${STYLE.photo}" stroke="#7dd3fc"/><rect x="${x + 14}" y="${y + 16}" width="72" height="54" fill="#bae6fd" stroke="#38bdf8"/><text x="${x + 98}" y="${y + 32}" class="small">${esc(trunc(slot, 22))}</text><text x="${x + 98}" y="${y + 56}" class="tiny">${esc(cat)}</text><text x="${x + 98}" y="${y + 78}" class="tiny">confidence: ${esc(conf)}</text></g>`; }
function annotation(x: number, y: number, label: string, confidence: number) { return `<text x="${x}" y="${y}" class="tiny">• ${esc(label)} (${confidence}/100)</text>`; }
function northArrow(x: number, y: number) { return `<g><path d="M ${x} ${y} l 14 42 l -14 -10 l -14 10 Z" fill="${STYLE.ink}"/><text x="${x}" y="${y + 62}" text-anchor="middle" class="tiny">N</text></g>`; }

function svgWrap(body: string) { return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET.width}" height="${SHEET.height}" viewBox="0 0 ${SHEET.width} ${SHEET.height}" role="img"><defs><style>${css()}</style></defs><rect width="100%" height="100%" fill="${STYLE.paper}"/>${body}</svg>`; }
function css() { return `.title{font:700 24px Arial,sans-serif;fill:${STYLE.ink}}.sheetno{font:800 32px Arial,sans-serif;fill:${STYLE.ink}}.metric{font:800 28px Arial,sans-serif;fill:${STYLE.ink}}.panelTitle{font:700 16px Arial,sans-serif;fill:${STYLE.ink}}.label{font:700 15px Arial,sans-serif;fill:${STYLE.ink}}.small{font:13px Arial,sans-serif;fill:${STYLE.ink}}.tiny{font:11px Arial,sans-serif;fill:${STYLE.muted}}.badge{font:700 14px Arial,sans-serif;fill:${STYLE.ink}}.stamp{font:700 10px Arial,sans-serif;fill:${STYLE.ink}}`; }
function buildHtmlPreview(sheets: PlanSetRenderSheetV1[]) { return `<!doctype html><html><head><meta charset="utf-8"><title>SolarPro Professional Plan-Set Preview</title><style>body{margin:0;background:#e5e7eb;font-family:Arial,sans-serif}.sheet{width:1320px;margin:24px auto;background:white;box-shadow:0 8px 28px #94a3b8;page-break-after:always}@media print{body{background:white}.sheet{margin:0;box-shadow:none}}</style></head><body>${sheets.map(s => `<section class="sheet">${s.svg}</section>`).join('')}</body></html>`; }
function tx(ctx: ReturnType<typeof buildContext>, x: number) { const b = ctx.bounds, v = ctx.viewport, scale = Math.min((v.w - 120) / Math.max(1, b.maxX - b.minX), (v.h - 120) / Math.max(1, b.maxY - b.minY)); return Math.round(v.x + 60 + (x - b.minX) * scale); }
function ty(ctx: ReturnType<typeof buildContext>, y: number) { const b = ctx.bounds, v = ctx.viewport, scale = Math.min((v.w - 120) / Math.max(1, b.maxX - b.minX), (v.h - 120) / Math.max(1, b.maxY - b.minY)); return Math.round(v.y + v.h - 60 - (y - b.minY) * scale); }
function centroid(points: Array<{ x: number; y: number }>, ctx: ReturnType<typeof buildContext>) { const sx = points.reduce((s, p) => s + p.x, 0) / Math.max(1, points.length); const sy = points.reduce((s, p) => s + p.y, 0) / Math.max(1, points.length); return { x: tx(ctx, sx), y: ty(ctx, sy) }; }
function geometryBounds(points: Array<{ x: number; y: number }>) { if (points.length === 0) return { minX: 0, maxX: 100, minY: 0, maxY: 100 }; return points.reduce((b, p) => ({ minX: Math.min(b.minX, p.x), maxX: Math.max(b.maxX, p.x), minY: Math.min(b.minY, p.y), maxY: Math.max(b.maxY, p.y) }), { minX: points[0].x, maxX: points[0].x, minY: points[0].y, maxY: points[0].y }); }
function enabled(r: ProfessionalSurveyReadinessReportV1, type: string) { return r.renderRecommendationReport.recommendations.some(item => item.type === type && item.enabledForPreview); }
function stateColor(state: string) { return state === 'render_blocked' ? STYLE.blocked : state === 'render_review_required' ? STYLE.banner : STYLE.trust; }
function noAuthority(): PlanSetRenderNoAuthorityV1 { return { readOnly: true, renderOutputOnly: true, stampedEngineeringPackage: false, automaticCadGenerationAllowed: false, canonicalGeometryMutationAllowed: false, cadMutationAllowed: false, cadSolverExecutionAllowed: false, persistenceAllowed: false, downstreamEngineeringAllowed: false, downstreamPermitAllowed: false, downstreamBomAllowed: false }; }
function human(v: string) { return v.replace(/_/g, ' '); }
function yes(v: boolean) { return v ? 'yes' : 'needs review'; }
function trunc(v: string, n: number) { return v.length <= n ? v : `${v.slice(0, n - 1)}…`; }
function esc(v: string) { return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function normalizeSvg(svg: string) { return svg.replace(/\s+/g, ' ').trim(); }
function stripSvgHashes(value: unknown) { return JSON.parse(JSON.stringify(value, (_k, v) => _k === 'renderHash' ? 'sheet-hash' : v)); }
function hash(value: unknown): string { const json = stable(value); let h = 5381; for (let i = 0; i < json.length; i++) h = ((h << 5) + h) ^ json.charCodeAt(i); return (h >>> 0).toString(16).padStart(8, '0'); }
function stable(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`; return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(',')}}`; }
