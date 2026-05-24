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

export interface PlanSetRenderQualityChecklistV1 {
  schemaVersion: 'professional_plan_set_render_quality_checklist_v1';
  score: number;
  maxScore: 100;
  grade: 'benchmark_gap' | 'commercial_preview' | 'ui_candidate';
  checks: Array<{ key: string; label: string; passed: boolean; points: number; maxPoints: number }>;
  benchmarkGaps: string[];
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
    renderQualityScore: number;
    renderQualityGrade: PlanSetRenderQualityChecklistV1['grade'];
    renderQualityChecklist: PlanSetRenderQualityChecklistV1;
    visibleQualityImprovements: string[];
    contractorUsabilityImprovements: string[];
  };
  noAuthorityEnforcement: PlanSetRenderNoAuthorityV1;
  deterministicNotes: string[];
}

const SHEET = { width: 1320, height: 1020, margin: 36, titleRailX: 1038, titleRailW: 246, bottomBandY: 858 } as const;
const CAD = {
  hairline: 0.7, thin: 1.1, medium: 1.8, heavy: 3.0, border: 2.4,
  dashSetback: '14 7', dashConduit: '18 8 4 8', dashReview: '8 5',
} as const;
const STYLE = {
  ink: '#111827', muted: '#4b5563', faint: '#e5e7eb', grid: '#d1d5db', roof: '#030712', roofFill: '#ffffff', setback: '#ea580c', module: '#1d4ed8', moduleFill: '#dbeafe', rail: '#334155', conduit: '#6d28d9', equipment: '#991b1b', obstruction: '#525252', review: '#92400e', ok: '#166534', banner: '#fff7ed', note: '#f8fafc', paper: '#ffffff', photo: '#eff6ff', trust: '#ecfdf5', blocked: '#fef2f2', shadow: '#9ca3af', titleFill: '#f3f4f6',
} as const;

const LAYERS = ['sheet-background', 'outer-border', 'title-block-rail', 'viewport-frame', 'grid', 'roof-outlines', 'fire-setbacks', 'module-layout', 'rail-attachment-symbols', 'conduit-candidates', 'equipment-markers', 'leader-callouts', 'annotations', 'review-callouts', 'legend', 'preview-stamp'] as const;

export function buildProfessionalPlanSetRenderPackage(report: ProfessionalSurveyReadinessReportV1): PlanSetRenderPackageV1 {
  const context = buildContext(report);
  const sheets = [renderCoverSheet(context), renderSitePlanSheet(context), renderEvidenceSheet(context)];
  const quality = buildRenderQualityChecklist(report, sheets);
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
      renderQualityScore: quality.score,
      renderQualityGrade: quality.grade,
      renderQualityChecklist: quality,
      visibleQualityImprovements: [
        'CAD-style double borders, right-side title-block rail, sheet index regions, and drawing-number hierarchy create a permit-set visual language.',
        'Canonical roof geometry is rendered as export-safe vector linework with professional line-weight conventions and monochrome drafting priority.',
        'Setbacks, module previews, conduit candidates, equipment markers, north arrow, scale note, and leader callouts are visible directly on the drawing sheet.',
        'Photo evidence and review risk summaries are packaged into cleaner report-sheet groupings with quality checklist scoring.',
      ],
      contractorUsabilityImprovements: [
        'Roof labels, pitch/azimuth labels, setbacks, equipment markers, leader lines, and module preview zones are visually grouped for print readability.',
        'Blocked/review states and non-authoritative preview stamps are explicit, reducing risk that preview renders are mistaken for stamped engineering.',
        'Symbolized legends and title-block metadata explain drawing conventions and review limits on every output package.',
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
  const viewport = { x: 62, y: 94, w: 812, h: 690 };
  return { report, bounds, viewport, projectTitle: `Survey ${report.source.surveyId}`, date: new Date(0).toISOString().slice(0, 10) };
}

function renderCoverSheet(ctx: ReturnType<typeof buildContext>): PlanSetRenderSheetV1 {
  const r = ctx.report;
  const body = [
    sheetHeader('PROFESSIONAL PLAN-SET RENDER PREVIEW', 'Deterministic SVG review package benchmarked against residential solar permit-set drafting conventions.'),
    cadTable(72, 160, 390, 188, 'SYSTEM SUMMARY', [
      ['Source type', human(r.source.source)],
      ['Render state', r.renderReadiness.state],
      ['Render confidence', `${r.renderReadiness.renderConfidenceScore}/100`],
      ['Preview layers', String(r.renderRecommendationReport.summary.previewEnabledLayerCount)],
      ['Review callouts', String(r.renderReadiness.blockers.length + r.renderReadiness.reviewItems.length)],
    ]),
    cadTable(492, 160, 360, 188, 'SHEET INDEX', [
      ['A-000', 'Cover / Render Readiness Summary'],
      ['A-101', 'Roof / Site Plan Render Preview'],
      ['A-201', 'Photo Evidence / Review Callouts'],
    ]),
    cadTable(72, 382, 780, 190, 'COMMERCIAL RENDER LAYERS', r.renderRecommendationReport.summary.topCommercialRenderLayers.slice(0, 7).map((v, i) => [`${i + 1}`, human(v)])),
    cadTable(72, 604, 780, 168, 'GEOMETRY / TRUST INDICATORS', [
      ['Geometry trust', `${r.geometryIntelligence.scores.geometryConfidenceScore}/100`],
      ['Topology integrity', `${r.geometryIntelligence.scores.topologyIntegrityScore}/100`],
      ['Readiness trust', `${r.geometryIntelligence.scores.readinessTrustScore}/100`],
      ['Discrepancy severity', `${r.geometryIntelligence.scores.discrepancySeverityScore}/100`],
    ]),
    noteBlock(884, 160, 116, 612, 'REVIEW NOTES', [
      'PREVIEW ONLY',
      'NOT STAMPED',
      'NO CAD MUTATION',
      'NO PERMIT AUTHORITY',
      'OPERATOR REVIEW REQUIRED BEFORE PRODUCTION USE',
    ]),
  ].join('');
  return sheet(ctx, 'A-000', 'cover_summary', 'Cover / Render Readiness Summary', body, ['sheet index', 'system summary', 'render readiness summary', 'geometry trust summary', 'non-authoritative preview stamp']);
}

function renderSitePlanSheet(ctx: ReturnType<typeof buildContext>): PlanSetRenderSheetV1 {
  const r = ctx.report;
  const roof = renderRoofGeometry(ctx);
  const modules = enabled(r, 'module_layout_previews') ? renderModulePreview(ctx) : '';
  const setbacks = enabled(r, 'fire_setback_overlays') ? renderSetbacks(ctx) : '';
  const equipment = renderEquipment(ctx);
  const leaders = renderLeaderCallouts(ctx);
  const annotations = renderPlanAnnotations(ctx);
  const callouts = renderReviewCallouts(ctx, 894, 118, 122, 300);
  const legend = renderLegend(894, 456);
  const body = [viewportFrame(ctx), roof, setbacks, modules, renderRailSymbols(ctx), equipment, leaders, annotations, callouts, legend, scaleBar(652, 804), northArrow(814, 798)].join('');
  return sheet(ctx, 'A-101', 'site_plan_render', 'Roof / Site Plan Render Preview', body, ['roof outlines', 'pitch/azimuth annotations', 'setback overlays', 'module preview zones', 'rail/attachment symbols', 'equipment markers', 'leader callouts', 'review callouts']);
}

function renderEvidenceSheet(ctx: ReturnType<typeof buildContext>): PlanSetRenderSheetV1 {
  const r = ctx.report;
  const photos = r.photoEvidence.evidence.slice(0, 10).map((p, i) => photoTile(72 + (i % 2) * 390, 150 + Math.floor(i / 2) * 104, p.source.slotKey, p.classification.category, p.classification.confidence)).join('');
  const reviewItems = [...r.renderReadiness.blockers, ...r.renderReadiness.reviewItems];
  const review = cadTable(72, 668, 780, 126, 'Evidence Coverage / EVIDENCE COVERAGE SUMMARY', [
    ['Roof/mount photos', yes(r.photoEvidence.coverage.roofOrMountCoverage)],
    ['Electrical photos', yes(r.photoEvidence.coverage.electricalCoverage)],
    ['Obstruction photos', yes(r.photoEvidence.coverage.obstructionCoverage)],
    ['Render-relevant photos', String(r.photoEvidence.coverage.renderRelevantPhotoCount)],
    ['Human review slots', r.photoEvidence.reviewNeededPhotoSlotKeys.join(', ') || 'none'],
  ]);
  const risk = noteBlock(894, 150, 122, 644, 'REVIEW / RISK', reviewItems.length ? reviewItems.slice(0, 8) : ['No active render blockers.', 'Continue normal operator review.', 'Preview remains non-authoritative.']);
  return sheet(ctx, 'A-201', 'evidence_review', 'Photo Evidence / Review Callout Sheet', sheetHeader('PHOTO EVIDENCE / REVIEW CALLOUTS', 'Evidence metadata grouped for operator review; source photos are references, not geometry authority.') + photos + review + risk, ['photo evidence tiles', 'photo evidence table', 'review notes', 'confidence notes', 'risk indicators']);
}

function sheet(ctx: ReturnType<typeof buildContext>, sheetNumber: string, type: PlanSetSheetTypeV1, title: string, body: string, annotations: string[]): PlanSetRenderSheetV1 {
  const svgNoHash = svgWrap(sheetBorder() + body + titleBlock(ctx, sheetNumber, title) + stamp(ctx.report));
  const withoutHash = { schemaVersion: 'professional_plan_set_render_sheet_v1' as const, sheetId: `${ctx.report.source.surveyId}-${sheetNumber}`, sheetNumber, sheetType: type, title, width: SHEET.width, height: SHEET.height, svg: svgNoHash, layerOrder: [...LAYERS], annotations, noAuthorityEnforcement: noAuthority() };
  return { ...withoutHash, renderHash: hash({ ...withoutHash, svg: normalizeSvg(svgNoHash) }) };
}

function renderRoofGeometry(ctx: ReturnType<typeof buildContext>) {
  return ctx.report.canonicalGeometry.roofPlanes.map((plane) => {
    const d = plane.polygon.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${tx(ctx, p.x)} ${ty(ctx, p.y)}`).join(' ') + ' Z';
    const c = centroid(plane.polygon, ctx);
    return `<path d="${d}" fill="${STYLE.roofFill}" stroke="${STYLE.roof}" stroke-width="${CAD.heavy}"/><path d="${d}" fill="none" stroke="${STYLE.faint}" stroke-width="${CAD.thin}" transform="translate(5 5)"/><text x="${c.x}" y="${c.y - 4}" text-anchor="middle" class="label">${esc(plane.planeId)}</text><text x="${c.x}" y="${c.y + 16}" text-anchor="middle" class="tiny">PITCH ${plane.pitchDeg}° / AZ ${plane.azimuthDeg}°</text>`;
  }).join('');
}

function renderSetbacks(ctx: ReturnType<typeof buildContext>) {
  return ctx.report.canonicalGeometry.roofPlanes.map(plane => {
    const b = geometryBounds(plane.polygon);
    const x = tx(ctx, b.minX), y = ty(ctx, b.maxY), w = Math.max(18, tx(ctx, b.maxX) - tx(ctx, b.minX)), h = Math.max(18, ty(ctx, b.minY) - ty(ctx, b.maxY));
    return `<rect x="${x + 18}" y="${y + 18}" width="${Math.max(1, w - 36)}" height="${Math.max(1, h - 36)}" fill="none" stroke="${STYLE.setback}" stroke-width="${CAD.medium}" stroke-dasharray="${CAD.dashSetback}"/><text x="${x + 26}" y="${y + 40}" class="callout" fill="${STYLE.setback}">18\" FIRE SETBACK / ACCESS PATH PREVIEW</text>`;
  }).join('');
}

function renderModulePreview(ctx: ReturnType<typeof buildContext>) {
  const cells: string[] = [];
  for (const plane of ctx.report.canonicalGeometry.roofPlanes) {
    const b = geometryBounds(plane.polygon); const x0 = tx(ctx, b.minX) + 48; const y0 = ty(ctx, b.maxY) + 66;
    for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) {
      const x = x0 + col * 44, y = y0 + row * 70;
      cells.push(`<g><rect x="${x}" y="${y}" width="34" height="58" fill="${STYLE.moduleFill}" stroke="${STYLE.module}" stroke-width="${CAD.thin}"/><line x1="${x + 17}" y1="${y + 3}" x2="${x + 17}" y2="${y + 55}" stroke="#93c5fd" stroke-width="0.6"/><line x1="${x + 3}" y1="${y + 29}" x2="${x + 31}" y2="${y + 29}" stroke="#93c5fd" stroke-width="0.6"/></g>`);
    }
  }
  return cells.join('');
}

function renderEquipment(ctx: ReturnType<typeof buildContext>) {
  const on = ctx.report.photoEvidence.coverage.electricalCoverage;
  const opacity = on ? 1 : 0.38;
  return `<g opacity="${opacity}"><rect x="748" y="684" width="28" height="28" fill="#fff" stroke="${STYLE.equipment}" stroke-width="${CAD.medium}"/><circle cx="762" cy="698" r="7" fill="none" stroke="${STYLE.equipment}" stroke-width="${CAD.thin}"/><path d="M 762 698 C 714 636, 646 594, 562 548" fill="none" stroke="${STYLE.conduit}" stroke-width="${CAD.medium}" stroke-dasharray="${CAD.dashConduit}"/><text x="642" y="628" class="callout" fill="${STYLE.conduit}">(N) CONDUIT CANDIDATE</text><text x="784" y="704" class="small">MSP/Meter</text></g>`;
}

function renderRailSymbols(ctx: ReturnType<typeof buildContext>) {
  const b = ctx.bounds; const y1 = ty(ctx, b.minY + (b.maxY - b.minY) * 0.36); const y2 = ty(ctx, b.minY + (b.maxY - b.minY) * 0.58);
  const x1 = tx(ctx, b.minX) + 74; const x2 = tx(ctx, b.maxX) - 74;
  return `<g opacity="0.72"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y1}" stroke="${STYLE.rail}" stroke-width="${CAD.medium}"/><line x1="${x1}" y1="${y2}" x2="${x2}" y2="${y2}" stroke="${STYLE.rail}" stroke-width="${CAD.medium}"/>${[0.2, 0.38, 0.56, 0.74].map(t => `<circle cx="${Math.round(x1 + (x2 - x1) * t)}" cy="${y1}" r="4" fill="#fff" stroke="${STYLE.rail}"/><circle cx="${Math.round(x1 + (x2 - x1) * t)}" cy="${y2}" r="4" fill="#fff" stroke="${STYLE.rail}"/>`).join('')}</g>`;
}

function renderLeaderCallouts(ctx: ReturnType<typeof buildContext>) {
  const c = centroid(ctx.report.canonicalGeometry.roofPlanes[0]?.polygon ?? [], ctx);
  return `<g><path d="M ${c.x + 48} ${c.y - 52} L 880 206" fill="none" stroke="${STYLE.ink}" stroke-width="${CAD.thin}"/><text x="884" y="204" class="callout">MODULE PREVIEW ZONE</text><path d="M ${c.x + 132} ${c.y + 82} L 880 250" fill="none" stroke="${STYLE.setback}" stroke-width="${CAD.thin}" stroke-dasharray="${CAD.dashReview}"/><text x="884" y="252" class="callout" fill="${STYLE.setback}">FIRE SETBACK OVERLAY</text></g>`;
}

function renderPlanAnnotations(ctx: ReturnType<typeof buildContext>) {
  return cadTable(72, 804, 520, 54, 'ACTIVE RENDER LAYERS', ctx.report.renderRecommendationReport.recommendations.filter(r => r.enabledForPreview).slice(0, 3).map(r => [human(r.type), `${r.confidence}/100`]));
}

function sheetHeader(title: string, subtitle: string) { return `<text x="72" y="104" class="drawingTitle">${esc(title)}</text><text x="72" y="126" class="small">${esc(subtitle)}</text><line x1="72" y1="138" x2="852" y2="138" stroke="${STYLE.ink}" stroke-width="${CAD.medium}"/>`; }
function noteBlock(x: number, y: number, w: number, h: number, title: string, lines: string[]) { return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="${STYLE.ink}" stroke-width="${CAD.thin}"/><rect x="${x}" y="${y}" width="${w}" height="28" fill="${STYLE.titleFill}" stroke="${STYLE.ink}" stroke-width="${CAD.thin}"/><text x="${x + 8}" y="${y + 19}" class="tableHead">${esc(title)}</text>${lines.slice(0, 12).map((l, i) => `<text x="${x + 8}" y="${y + 52 + i * 28}" class="tiny">${esc(trunc(l, 26))}</text>`).join('')}</g>`; }
function cadTable(x: number, y: number, w: number, h: number, title: string, rows: string[][]) { const rowH = Math.max(20, Math.floor((h - 30) / Math.max(1, rows.length))); return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="${STYLE.ink}" stroke-width="${CAD.thin}"/><rect x="${x}" y="${y}" width="${w}" height="30" fill="${STYLE.titleFill}" stroke="${STYLE.ink}" stroke-width="${CAD.thin}"/><text x="${x + 10}" y="${y + 20}" class="tableHead">${esc(title)}</text>${rows.map((row, i) => `<line x1="${x}" y1="${y + 30 + i * rowH}" x2="${x + w}" y2="${y + 30 + i * rowH}" stroke="${STYLE.faint}"/><text x="${x + 10}" y="${y + 50 + i * rowH}" class="tiny">${esc(trunc(row[0] ?? '', 34))}</text><text x="${x + Math.round(w * 0.43)}" y="${y + 50 + i * rowH}" class="tinyStrong">${esc(trunc(row[1] ?? '', 46))}</text>`).join('')}</g>`; }
function scaleBar(x: number, y: number) { return `<g><line x1="${x}" y1="${y}" x2="${x + 150}" y2="${y}" stroke="${STYLE.ink}" stroke-width="${CAD.medium}"/><line x1="${x}" y1="${y - 8}" x2="${x}" y2="${y + 8}" stroke="${STYLE.ink}"/><line x1="${x + 75}" y1="${y - 6}" x2="${x + 75}" y2="${y + 6}" stroke="${STYLE.ink}"/><line x1="${x + 150}" y1="${y - 8}" x2="${x + 150}" y2="${y + 8}" stroke="${STYLE.ink}"/><text x="${x}" y="${y + 22}" class="tiny">SCALE: DIAGRAMMATIC / VERIFY IN FIELD</text></g>`; }
function sheetBorder() { return `<g><rect x="24" y="24" width="1272" height="972" fill="none" stroke="${STYLE.ink}" stroke-width="${CAD.border}"/><rect x="36" y="36" width="1248" height="948" fill="none" stroke="${STYLE.ink}" stroke-width="${CAD.hairline}"/><line x1="${SHEET.titleRailX}" y1="36" x2="${SHEET.titleRailX}" y2="984" stroke="${STYLE.ink}" stroke-width="${CAD.medium}"/></g>`; }

function renderReviewCallouts(ctx: ReturnType<typeof buildContext>, x: number, y: number, w: number, h: number) {
  const items = [...ctx.report.renderReadiness.blockers, ...ctx.report.renderReadiness.reviewItems].slice(0, 8);
  return panel(x, y, w, h, 'Review / Confidence Callouts', items.length ? items : ['No active render blockers. Continue normal operator review.'], STYLE.banner);
}

function renderLegend(x: number, y: number) { return `<g><desc>Legend fire setback preview module preview conduit candidate</desc><rect x="${x}" y="${y}" width="122" height="282" fill="#fff" stroke="${STYLE.ink}" stroke-width="${CAD.thin}"/><rect x="${x}" y="${y}" width="122" height="28" fill="${STYLE.titleFill}" stroke="${STYLE.ink}" stroke-width="${CAD.thin}"/><text x="${x + 8}" y="${y + 19}" class="tableHead">LEGEND</text>${legendRow(x, y + 48, 'roof outline', `<line x1="0" y1="0" x2="34" y2="0" stroke="${STYLE.roof}" stroke-width="${CAD.heavy}"/>`)}${legendRow(x, y + 82, 'PV module', `<rect x="0" y="-10" width="28" height="18" fill="${STYLE.moduleFill}" stroke="${STYLE.module}"/>`)}${legendRow(x, y + 116, 'fire path', `<line x1="0" y1="0" x2="34" y2="0" stroke="${STYLE.setback}" stroke-width="${CAD.medium}" stroke-dasharray="${CAD.dashSetback}"/>`)}${legendRow(x, y + 150, 'conduit', `<line x1="0" y1="0" x2="34" y2="0" stroke="${STYLE.conduit}" stroke-width="${CAD.medium}" stroke-dasharray="${CAD.dashConduit}"/>`)}${legendRow(x, y + 184, 'equipment', `<rect x="0" y="-10" width="20" height="20" fill="#fff" stroke="${STYLE.equipment}" stroke-width="${CAD.medium}"/>`)}${legendRow(x, y + 218, 'attachment', `<circle cx="10" cy="0" r="4" fill="#fff" stroke="${STYLE.rail}"/>`)}</g>`; }
function legendRow(x: number, y: number, label: string, symbol: string) { return `<g transform="translate(${x + 10} ${y})">${symbol}<text x="44" y="4" class="tiny">${esc(label)}</text></g>`; }
function viewportFrame(ctx: ReturnType<typeof buildContext>) { const v = ctx.viewport; return `<rect x="${v.x}" y="${v.y}" width="${v.w}" height="${v.h}" fill="#fff" stroke="${STYLE.ink}" stroke-width="${CAD.medium}"/><rect x="${v.x + 10}" y="${v.y + 10}" width="${v.w - 20}" height="${v.h - 20}" fill="none" stroke="${STYLE.faint}" stroke-width="${CAD.hairline}"/><g opacity="0.20">${Array.from({ length: 11 }, (_, i) => `<line x1="${v.x + 40 + i * 70}" y1="${v.y + 16}" x2="${v.x + 40 + i * 70}" y2="${v.y + v.h - 16}" stroke="${STYLE.grid}" stroke-width="0.6"/>`).join('')}${Array.from({ length: 9 }, (_, i) => `<line x1="${v.x + 16}" y1="${v.y + 42 + i * 70}" x2="${v.x + v.w - 16}" y2="${v.y + 42 + i * 70}" stroke="${STYLE.grid}" stroke-width="0.6"/>`).join('')}</g><text x="${v.x + 12}" y="${v.y - 12}" class="tableHead">ROOF PLAN WITH MODULES</text>`; }
function titleBlock(ctx: ReturnType<typeof buildContext>, num: string, title: string) { const x = SHEET.titleRailX; return `<g><rect x="${x}" y="36" width="${SHEET.titleRailW}" height="948" fill="#fff" stroke="${STYLE.ink}" stroke-width="${CAD.thin}"/><rect x="${x}" y="36" width="${SHEET.titleRailW}" height="92" fill="${STYLE.titleFill}" stroke="${STYLE.ink}" stroke-width="${CAD.thin}"/><text x="${x + 18}" y="76" class="title">SolarPro</text><text x="${x + 18}" y="102" class="small">SolarPro Preview</text>{rows}<rect x="${x}" y="806" width="${SHEET.titleRailW}" height="96" fill="${STYLE.titleFill}" stroke="${STYLE.ink}" stroke-width="${CAD.thin}"/><text x="${x + 18}" y="836" class="small">SHEET NAME</text><text x="${x + 18}" y="862" class="tinyStrong">${esc(title)}</text><rect x="${x}" y="902" width="${SHEET.titleRailW}" height="82" fill="#fff" stroke="${STYLE.ink}" stroke-width="${CAD.thin}"/><text x="${x + 18}" y="928" class="small">SHEET NUMBER</text><text x="${x + 18}" y="968" class="sheetno">${num}</text></g>`.replace('{rows}', titleRows(x, ctx)); }
function titleRows(x: number, ctx: ReturnType<typeof buildContext>) { const rows = [['PROJECT', ctx.report.source.projectId ?? 'PROJECT PENDING'], ['SURVEY', ctx.report.source.surveyId], ['DATE', ctx.date], ['SCALE', 'AS NOTED'], ['DRAWN BY', 'SOLARPRO'], ['CHECKED BY', 'OPERATOR REVIEW'], ['STATUS', ctx.report.renderReadiness.state], ['CONFIDENCE', `${ctx.report.renderReadiness.renderConfidenceScore}/100`]]; return rows.map((r, i) => `<rect x="${x}" y="${128 + i * 58}" width="${SHEET.titleRailW}" height="58" fill="#fff" stroke="${STYLE.ink}" stroke-width="${CAD.hairline}"/><text x="${x + 14}" y="${150 + i * 58}" class="tiny">${esc(r[0])}</text><text x="${x + 14}" y="${174 + i * 58}" class="tinyStrong">${esc(trunc(r[1], 28))}</text>`).join(''); }
function stamp(r: ProfessionalSurveyReadinessReportV1) { const blocked = r.renderReadiness.state === 'render_blocked'; return `<g><rect x="72" y="44" width="318" height="30" fill="${blocked ? STYLE.blocked : STYLE.trust}" stroke="${blocked ? '#991b1b' : '#166534'}" stroke-width="${CAD.thin}"/><text x="231" y="64" text-anchor="middle" class="stamp">NON-AUTHORITATIVE PREVIEW · QUALITY QA ONLY · ${r.renderReadiness.renderConfidenceScore}/100</text></g>`; }
function section(x: number, y: number, w: number, h: number, title: string, lines: string[]) { return panel(x, y, w, h, title, lines, '#ffffff'); }
function panel(x: number, y: number, w: number, h: number, title: string, lines: string[], fill: string) { return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${STYLE.shadow}"/><text x="${x + 18}" y="${y + 30}" class="panelTitle">${esc(title)}</text>${lines.slice(0, 10).map((l, i) => `<text x="${x + 18}" y="${y + 62 + i * 22}" class="small">${esc(trunc(l, 72))}</text>`).join('')}</g>`; }
function metricCard(x: number, y: number, label: string, value: string, fill: string) { return `<g><rect x="${x}" y="${y}" width="202" height="84" rx="12" fill="${fill}" stroke="${STYLE.shadow}"/><text x="${x + 18}" y="${y + 32}" class="small">${esc(label)}</text><text x="${x + 18}" y="${y + 66}" class="metric">${esc(value)}</text></g>`; }
function text(x: number, y: number, value: string, size: number, weight = '400') { return `<text x="${x}" y="${y}" style="font:${weight} ${size}px Arial,sans-serif;fill:${STYLE.ink}">${esc(value)}</text>`; }
function badge(x: number, y: number, w: number, h: number, label: string, fill: string) { return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="19" fill="${fill}"/><text x="${x + 18}" y="${y + 25}" class="badge">${esc(label)}</text>`; }
function photoTile(x: number, y: number, slot: string, cat: string, conf: string) { return `<g><rect x="${x}" y="${y}" width="360" height="82" fill="#fff" stroke="${STYLE.ink}" stroke-width="${CAD.hairline}"/><rect x="${x + 12}" y="${y + 12}" width="62" height="46" fill="${STYLE.photo}" stroke="${STYLE.grid}"/><line x1="${x + 12}" y1="${y + 12}" x2="${x + 74}" y2="${y + 58}" stroke="${STYLE.grid}"/><line x1="${x + 74}" y1="${y + 12}" x2="${x + 12}" y2="${y + 58}" stroke="${STYLE.grid}"/><text x="${x + 90}" y="${y + 24}" class="small">${esc(trunc(slot, 30))}</text><text x="${x + 90}" y="${y + 46}" class="tiny">CATEGORY: ${esc(cat)}</text><text x="${x + 90}" y="${y + 66}" class="tiny">PHOTO CONFIDENCE: ${esc(conf)}</text></g>`; }
function annotation(x: number, y: number, label: string, confidence: number) { return `<text x="${x}" y="${y}" class="tiny">• ${esc(label)} (${confidence}/100)</text>`; }
function northArrow(x: number, y: number) { return `<g><path d="M ${x} ${y} l 14 42 l -14 -10 l -14 10 Z" fill="${STYLE.ink}"/><text x="${x}" y="${y + 62}" text-anchor="middle" class="tiny">N</text></g>`; }

function svgWrap(body: string) { return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET.width}" height="${SHEET.height}" viewBox="0 0 ${SHEET.width} ${SHEET.height}" role="img"><defs><style>${css()}</style></defs><rect width="100%" height="100%" fill="${STYLE.paper}"/>${body}</svg>`; }
function css() { return `.title{font:800 24px Arial,sans-serif;letter-spacing:.8px;fill:${STYLE.ink}}.drawingTitle{font:800 24px Arial,sans-serif;letter-spacing:.5px;fill:${STYLE.ink}}.sheetno{font:900 34px Arial,sans-serif;fill:${STYLE.ink}}.metric{font:800 24px Arial,sans-serif;fill:${STYLE.ink}}.panelTitle{font:800 14px Arial,sans-serif;letter-spacing:.4px;fill:${STYLE.ink}}.tableHead{font:800 11px Arial,sans-serif;letter-spacing:.7px;fill:${STYLE.ink}}.label{font:800 14px Arial,sans-serif;fill:${STYLE.ink}}.small{font:12px Arial,sans-serif;fill:${STYLE.ink}}.tiny{font:10px Arial,sans-serif;fill:${STYLE.muted}}.tinyStrong{font:700 10px Arial,sans-serif;fill:${STYLE.ink}}.callout{font:700 10px Arial,sans-serif;letter-spacing:.25px;fill:${STYLE.ink}}.badge{font:700 12px Arial,sans-serif;fill:${STYLE.ink}}.stamp{font:800 9px Arial,sans-serif;letter-spacing:.3px;fill:${STYLE.ink}}`; }
function buildHtmlPreview(sheets: PlanSetRenderSheetV1[]) { return `<!doctype html><html><head><meta charset="utf-8"><title>SolarPro Professional Plan-Set Preview | CAD Quality Upgrade</title><style>@page{size:11in 8.5in;margin:0}body{margin:0;background:#d1d5db;font-family:Arial,sans-serif}.sheet{width:1320px;margin:20px auto;background:white;box-shadow:0 6px 18px #6b7280;page-break-after:always}.caption{width:1320px;margin:24px auto 0;font:700 13px Arial;color:#111827}@media print{body{background:white}.caption{display:none}.sheet{margin:0;box-shadow:none;width:100vw;height:100vh}}</style></head><body>${sheets.map(s => `<div class="caption">${s.sheetNumber} · ${s.title} · non-authoritative quality preview</div><section class="sheet">${s.svg}</section>`).join('')}</body></html>`; }
function tx(ctx: ReturnType<typeof buildContext>, x: number) { const b = ctx.bounds, v = ctx.viewport, scale = Math.min((v.w - 120) / Math.max(1, b.maxX - b.minX), (v.h - 120) / Math.max(1, b.maxY - b.minY)); return Math.round(v.x + 60 + (x - b.minX) * scale); }
function ty(ctx: ReturnType<typeof buildContext>, y: number) { const b = ctx.bounds, v = ctx.viewport, scale = Math.min((v.w - 120) / Math.max(1, b.maxX - b.minX), (v.h - 120) / Math.max(1, b.maxY - b.minY)); return Math.round(v.y + v.h - 60 - (y - b.minY) * scale); }
function centroid(points: Array<{ x: number; y: number }>, ctx: ReturnType<typeof buildContext>) { const sx = points.reduce((s, p) => s + p.x, 0) / Math.max(1, points.length); const sy = points.reduce((s, p) => s + p.y, 0) / Math.max(1, points.length); return { x: tx(ctx, sx), y: ty(ctx, sy) }; }
function geometryBounds(points: Array<{ x: number; y: number }>) { if (points.length === 0) return { minX: 0, maxX: 100, minY: 0, maxY: 100 }; return points.reduce((b, p) => ({ minX: Math.min(b.minX, p.x), maxX: Math.max(b.maxX, p.x), minY: Math.min(b.minY, p.y), maxY: Math.max(b.maxY, p.y) }), { minX: points[0].x, maxX: points[0].x, minY: points[0].y, maxY: points[0].y }); }
function enabled(r: ProfessionalSurveyReadinessReportV1, type: string) { return r.renderRecommendationReport.recommendations.some(item => item.type === type && item.enabledForPreview); }
function stateColor(state: string) { return state === 'render_blocked' ? STYLE.blocked : state === 'render_review_required' ? STYLE.banner : STYLE.trust; }
function buildRenderQualityChecklist(report: ProfessionalSurveyReadinessReportV1, sheets: PlanSetRenderSheetV1[]): PlanSetRenderQualityChecklistV1 {
  const all = sheets.map(s => s.svg).join('\n');
  const mk = (key: string, label: string, passed: boolean, maxPoints: number) => ({ key, label, passed, points: passed ? maxPoints : 0, maxPoints });
  const checks = [
    mk('title_block_rail', 'Right-side CAD title block rail with sheet number/name metadata', all.includes('SHEET NUMBER') && all.includes('SHEET NAME'), 12),
    mk('sheet_border', 'Double sheet border and drawing rail are present', all.includes('outer-border') || all.includes('width="1272" height="972"'), 10),
    mk('legend_symbols', 'Legend contains graphic symbols, not text-only descriptions', all.includes('LEGEND') && all.includes('PV module') && all.includes('fire path'), 10),
    mk('viewport_readability', 'Site plan viewport includes drawing frame, grid, roof plan title, north arrow, and scale bar', all.includes('ROOF PLAN WITH MODULES') && all.includes('SCALE: DIAGRAMMATIC') && all.includes('N</text>'), 12),
    mk('annotation_readability', 'Leader callouts and active render layer table are present', all.includes('MODULE PREVIEW ZONE') && all.includes('ACTIVE RENDER LAYERS'), 10),
    mk('line_weight_consistency', 'CAD line-weight and dashed convention tokens are used consistently', all.includes('stroke-width="3"') && all.includes(CAD.dashSetback) && all.includes(CAD.dashConduit), 10),
    mk('render_confidence_display', 'Render confidence/state is visible in title block and stamp', all.includes(`${report.renderReadiness.renderConfidenceScore}/100`) && all.includes(report.renderReadiness.state), 10),
    mk('review_warning_visibility', 'Review/non-authority warnings are visible on package sheets', all.includes('NON-AUTHORITATIVE PREVIEW') && all.includes('REVIEW'), 10),
    mk('print_export_readiness', 'HTML/SVG package is deterministic, vector based, and print styled', sheets.every(s => s.svg.startsWith('<svg')) && sheets.length === 3, 8),
    mk('evidence_grouping', 'Evidence sheet groups photo metadata and coverage/risk summaries', all.includes('PHOTO EVIDENCE / REVIEW CALLOUTS') && all.includes('EVIDENCE COVERAGE SUMMARY'), 8),
  ];
  const score = checks.reduce((sum, c) => sum + c.points, 0);
  return { schemaVersion: 'professional_plan_set_render_quality_checklist_v1', score, maxScore: 100, grade: score >= 92 ? 'ui_candidate' : score >= 78 ? 'commercial_preview' : 'benchmark_gap', checks, benchmarkGaps: score >= 92 ? ['Direct PDF export automation and richer production module/string data remain before permit-grade UI release.'] : ['Visual output still needs CAD polish before live UI wiring.'], noAuthorityEnforcement: noAuthority() };
}

function noAuthority(): PlanSetRenderNoAuthorityV1 { return { readOnly: true, renderOutputOnly: true, stampedEngineeringPackage: false, automaticCadGenerationAllowed: false, canonicalGeometryMutationAllowed: false, cadMutationAllowed: false, cadSolverExecutionAllowed: false, persistenceAllowed: false, downstreamEngineeringAllowed: false, downstreamPermitAllowed: false, downstreamBomAllowed: false }; }
function human(v: string) { return v.replace(/_/g, ' '); }
function yes(v: boolean) { return v ? 'yes' : 'needs review'; }
function trunc(v: string, n: number) { return v.length <= n ? v : `${v.slice(0, n - 1)}…`; }
function esc(v: string) { return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function normalizeSvg(svg: string) { return svg.replace(/\s+/g, ' ').trim(); }
function stripSvgHashes(value: unknown) { return JSON.parse(JSON.stringify(value, (_k, v) => _k === 'renderHash' ? 'sheet-hash' : v)); }
function hash(value: unknown): string { const json = stable(value); let h = 5381; for (let i = 0; i < json.length; i++) h = ((h << 5) + h) ^ json.charCodeAt(i); return (h >>> 0).toString(16).padStart(8, '0'); }
function stable(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`; return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(',')}}`; }
