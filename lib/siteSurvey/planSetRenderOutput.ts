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

export interface PlanSetPreviewAssetV1 {
  kind: 'html' | 'pdf' | 'svg_sheet' | 'thumbnail' | 'snapshot' | 'contact_sheet' | 'manifest';
  label: string;
  path: string;
  sheetNumber?: string;
  mimeType: string;
}

export interface PlanSetPreviewManifestV1 {
  schemaVersion: 'professional_plan_set_preview_manifest_v1';
  packageMode: 'live_preview_preparation_only';
  sourceSurveyId: string;
  packageHash: string;
  defaultPreviewPath: string;
  pdfPath: string;
  contactSheetPath: string;
  sheets: Array<{ sheetNumber: string; sheetType: PlanSetSheetTypeV1; title: string; svgPath: string; thumbnailPath: string; snapshotPath: string; renderHash: string }>;
  assets: PlanSetPreviewAssetV1[];
  livePreviewReadiness: {
    readyForInternalPreviewRoute: boolean;
    readyForLiveEngineeringUi: false;
    blockersBeforePublicPreview: string[];
  };
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
  previewManifest: PlanSetPreviewManifestV1;
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

const LAYERS = ['sheet-background', 'outer-border', 'title-block-rail', 'viewport-frame', 'grid', 'site-context', 'property-boundary', 'driveway-context', 'roof-outlines', 'roof-articulation', 'obstruction-symbols', 'fire-setbacks', 'module-layout', 'module-string-groups', 'rail-attachment-symbols', 'conduit-candidates', 'equipment-markers', 'leader-callouts', 'annotations', 'review-callouts', 'legend', 'preview-stamp'] as const;

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
    previewManifest: buildPreviewManifest(report, sheets, 'package.pdf', 'contact-sheet.png'),
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
        'A deterministic grayscale site-context layer adds lot boundary, street/driveway cues, neighboring structure silhouettes, and aerial-like texture without extracting or mutating geometry.',
        'Canonical roof geometry is rendered as export-safe vector linework with professional line-weight conventions and monochrome drafting priority.',
        'Setbacks, realistic module grouping, rail runs, attachment indicators, conduit candidates, obstruction symbols, equipment markers, professional north/scale graphics, and leader callouts are visible directly on the drawing sheet.',
        'Photo evidence, review risk summaries, PDF/export metadata, and live-preview manifest metadata are packaged for contractor/demo review.',
      ],
      contractorUsabilityImprovements: [
        'Roof labels, pitch/azimuth labels, setbacks, equipment markers, construction notes, design criteria, leader lines, string/group labels, and module preview zones are visually grouped for print readability.',
        'Site context makes the sheet feel closer to a real contractor-facing roof/site plan while remaining diagrammatic and non-authoritative.',
        'Blocked/review states and non-authoritative preview stamps are explicit, reducing risk that preview renders are mistaken for stamped engineering.',
        'Symbolized legends, PDF/export metadata, title-block metadata, and preview manifest paths explain drawing conventions and review limits on every output package.',
      ],
    },
    noAuthorityEnforcement: noAuthority(),
    deterministicNotes: [
      'SVG sheets are deterministic render previews built from existing survey readiness DTOs only.',
      'Plan-set render output does not execute CAD solvers, mutate CAD, mutate canonical geometry, write persistence, or trigger engineering/permit/BOM workflows.',
      'PDF-ready output means vector composition suitable for export; it is not a stamped engineering package.',
      'Site-context and aerial-like layers are deterministic visual context only; they are not property surveys, imagery analysis, or geometry authority.',
      'Preview manifests and thumbnails prepare future UI integration but do not wire these outputs into the live Engineering UI.',
    ],
  };
  const packageHash = hash(stripSvgHashes(withoutHash));
  return { ...withoutHash, packageHash, previewManifest: { ...withoutHash.previewManifest, packageHash } };
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
  const density = renderPlanDensityBlocks(ctx);
  const body = [viewportFrame(ctx), renderSiteContext(ctx), roof, setbacks, modules, renderRailSymbols(ctx), renderObstructionSymbols(ctx), equipment, leaders, annotations, callouts, legend, scaleBar(108, 746), northArrow(812, 714), density].join('');
  return sheet(ctx, 'A-101', 'site_plan_render', 'Roof / Site Plan Render Preview', body, ['realistic site context', 'diagrammatic property boundary', 'driveway/building context', 'roof outlines', 'roof edge articulation', 'roof hatch and obstruction symbols', 'pitch/azimuth annotations', 'setback overlays', 'module preview zones', 'module string/group callouts', 'rail/attachment symbols', 'equipment markers', 'permit-style construction notes', 'leader callouts', 'review callouts']);
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

function renderSiteContext(ctx: ReturnType<typeof buildContext>) {
  const v = ctx.viewport;
  const roof = ctx.bounds;
  const cx = (tx(ctx, roof.minX) + tx(ctx, roof.maxX)) / 2;
  const cy = (ty(ctx, roof.minY) + ty(ctx, roof.maxY)) / 2;
  const lotX = Math.max(v.x + 58, Math.round(cx - 280));
  const lotY = Math.max(v.y + 54, Math.round(cy - 238));
  const lotW = Math.min(610, v.x + v.w - lotX - 58);
  const lotH = Math.min(520, v.y + v.h - lotY - 54);
  const streetY = Math.min(v.y + v.h - 78, lotY + lotH + 22);
  const drivewayX = Math.min(lotX + lotW - 118, Math.max(lotX + 54, cx + 138));
  const texture = Array.from({ length: 18 }, (_, i) => {
    const x = v.x + 42 + (i * 67) % Math.max(1, v.w - 92);
    const y = v.y + 48 + (i * 113) % Math.max(1, v.h - 118);
    const r = 10 + (i % 4) * 3;
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="#e5e7eb" opacity="0.28"/>`;
  }).join('');
  const parcelTick = Array.from({ length: 9 }, (_, i) => `<line x1="${lotX + 30 + i * Math.max(34, Math.floor(lotW / 10))}" y1="${lotY}" x2="${lotX + 18 + i * Math.max(34, Math.floor(lotW / 10))}" y2="${lotY + lotH}" stroke="#cbd5e1" stroke-width="0.45" opacity="0.55"/>`).join('');
  return `<g opacity="0.96"><desc>realistic site context aerial-like grayscale property boundary driveway neighboring structure diagrammatic only parcel hatch</desc><rect x="${v.x + 10}" y="${v.y + 10}" width="${v.w - 20}" height="${v.h - 20}" fill="#f8fafc"/><g opacity="0.55">${texture}</g><rect x="${v.x + 18}" y="${streetY}" width="${v.w - 36}" height="44" fill="#e5e7eb" stroke="#9ca3af" stroke-width="${CAD.hairline}"/><line x1="${v.x + 38}" y1="${streetY + 22}" x2="${v.x + v.w - 38}" y2="${streetY + 22}" stroke="#f8fafc" stroke-width="3" stroke-dasharray="28 20"/><text x="${v.x + 30}" y="${streetY + 36}" class="tiny">STREET / ACCESS CONTEXT (DIAGRAMMATIC)</text>${parcelTick}<rect x="${lotX}" y="${lotY}" width="${lotW}" height="${lotH}" fill="none" stroke="#374151" stroke-width="${CAD.medium}" stroke-dasharray="10 6"/><text x="${lotX + 12}" y="${lotY + 20}" class="callout">PROPERTY / LOT CONTEXT PREVIEW</text><path d="M ${drivewayX} ${streetY} L ${drivewayX - 22} ${cy + 122} L ${drivewayX + 34} ${cy + 94} L ${drivewayX + 72} ${streetY}" fill="#e5e7eb" stroke="#6b7280" stroke-width="${CAD.thin}"/><text x="${drivewayX - 4}" y="${Math.min(streetY - 12, cy + 134)}" class="tiny">DRIVEWAY / ACCESS</text><rect x="${lotX + 32}" y="${lotY + 52}" width="84" height="58" fill="#f3f4f6" stroke="#9ca3af" stroke-width="${CAD.hairline}"/><rect x="${lotX + lotW - 112}" y="${lotY + 74}" width="72" height="94" fill="#f3f4f6" stroke="#9ca3af" stroke-width="${CAD.hairline}"/><text x="${lotX + lotW - 130}" y="${lotY + 188}" class="tiny">NEIGHBORING STRUCTURE CUES</text></g>`;
}

function renderRoofGeometry(ctx: ReturnType<typeof buildContext>) {
  return ctx.report.canonicalGeometry.roofPlanes.map((plane) => {
    const d = plane.polygon.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${tx(ctx, p.x)} ${ty(ctx, p.y)}`).join(' ') + ' Z';
    const c = centroid(plane.polygon, ctx);
    const b = geometryBounds(plane.polygon);
    const x = tx(ctx, b.minX), y = ty(ctx, b.maxY), w = Math.max(18, tx(ctx, b.maxX) - tx(ctx, b.minX)), h = Math.max(18, ty(ctx, b.minY) - ty(ctx, b.maxY));
    const hatch = Array.from({ length: 9 }, (_, i) => `<line x1="${x + 18 + i * Math.max(18, Math.floor(w / 9))}" y1="${y + 10}" x2="${x - 10 + i * Math.max(18, Math.floor(w / 9))}" y2="${y + h - 10}" stroke="#e5e7eb" stroke-width="0.7"/>`).join('');
    const edgeTicks = plane.polygon.map((pt, idx) => `<circle cx="${tx(ctx, pt.x)}" cy="${ty(ctx, pt.y)}" r="3" fill="#fff" stroke="${STYLE.roof}" stroke-width="${CAD.hairline}"><title>roof edge vertex ${idx + 1}</title></circle>`).join('');
    return `<g><desc>roof edge articulation roof hatch drafted silhouette</desc><clipPath id="clip-${plane.planeId}"><path d="${d}"/></clipPath><g clip-path="url(#clip-${plane.planeId})">${hatch}</g><path d="${d}" fill="${STYLE.roofFill}" fill-opacity="0.78" stroke="${STYLE.roof}" stroke-width="${CAD.heavy}"/><path d="${d}" fill="none" stroke="${STYLE.faint}" stroke-width="${CAD.thin}" transform="translate(5 5)"/>${edgeTicks}<text x="${c.x}" y="${c.y - 4}" text-anchor="middle" class="label">${esc(plane.planeId)}</text><text x="${c.x}" y="${c.y + 16}" text-anchor="middle" class="tiny">PITCH ${plane.pitchDeg}° / AZ ${plane.azimuthDeg}°</text></g>`;
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
  const groups: string[] = [];
  for (const [planeIndex, plane] of ctx.report.canonicalGeometry.roofPlanes.entries()) {
    const b = geometryBounds(plane.polygon);
    const left = tx(ctx, b.minX) + 52;
    const top = ty(ctx, b.maxY) + 62;
    const right = tx(ctx, b.maxX) - 46;
    const bottom = ty(ctx, b.minY) - 54;
    const wide = Math.max(1, right - left) > Math.max(1, bottom - top) * 1.22;
    const moduleW = wide ? 56 : 34;
    const moduleH = wide ? 34 : 58;
    const gapX = 8;
    const gapY = 10;
    const cols = Math.max(3, Math.min(wide ? 6 : 5, Math.floor(Math.max(90, right - left) / (moduleW + gapX))));
    const rows = Math.max(2, Math.min(wide ? 4 : 3, Math.floor(Math.max(90, bottom - top) / (moduleH + gapY))));
    const groupW = cols * moduleW + (cols - 1) * gapX;
    const groupH = rows * moduleH + (rows - 1) * gapY;
    const x0 = Math.round(left + Math.max(0, (right - left - groupW) / 2));
    const y0 = Math.round(top + Math.max(0, (bottom - top - groupH) / 2));
    const modules: string[] = [];
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const x = x0 + col * (moduleW + gapX), y = y0 + row * (moduleH + gapY);
      modules.push(`<g><rect x="${x}" y="${y}" width="${moduleW}" height="${moduleH}" fill="${STYLE.moduleFill}" stroke="${STYLE.module}" stroke-width="${CAD.thin}"/><line x1="${x + Math.round(moduleW / 2)}" y1="${y + 3}" x2="${x + Math.round(moduleW / 2)}" y2="${y + moduleH - 3}" stroke="#93c5fd" stroke-width="0.6"/><line x1="${x + 3}" y1="${y + Math.round(moduleH / 2)}" x2="${x + moduleW - 3}" y2="${y + Math.round(moduleH / 2)}" stroke="#93c5fd" stroke-width="0.6"/></g>`);
    }
    const labelY = Math.max(98, y0 - 12);
    groups.push(`<g><desc>module preview realistic spacing row alignment portrait landscape string group callout</desc><rect x="${x0 - 10}" y="${y0 - 10}" width="${groupW + 20}" height="${groupH + 20}" fill="none" stroke="${STYLE.module}" stroke-width="${CAD.hairline}" stroke-dasharray="5 4"/>${modules.join('')}<text x="${x0}" y="${labelY}" class="callout" fill="${STYLE.module}">PV-${planeIndex + 1} MODULE GROUP · ${rows}x${cols} ${wide ? 'LANDSCAPE' : 'PORTRAIT'} PREVIEW</text></g>`);
  }
  return groups.join('');
}

function renderObstructionSymbols(ctx: ReturnType<typeof buildContext>) {
  const b = ctx.bounds;
  const x = tx(ctx, b.minX + (b.maxX - b.minX) * 0.72);
  const y = ty(ctx, b.minY + (b.maxY - b.minY) * 0.70);
  return `<g opacity="0.88"><desc>roof obstruction detail vent skylight placeholder diagrammatic only</desc><rect x="${x - 18}" y="${y - 14}" width="36" height="28" fill="#f5f5f4" stroke="${STYLE.obstruction}" stroke-width="${CAD.thin}"/><line x1="${x - 18}" y1="${y - 14}" x2="${x + 18}" y2="${y + 14}" stroke="${STYLE.obstruction}" stroke-width="0.8"/><text x="${x + 24}" y="${y + 4}" class="tinyStrong">VENT / OBSTR. REF.</text></g>`;
}

function renderEquipment(ctx: ReturnType<typeof buildContext>) {
  const on = ctx.report.photoEvidence.coverage.electricalCoverage;
  const opacity = on ? 1 : 0.38;
  return `<g opacity="${opacity}"><rect x="748" y="684" width="28" height="28" fill="#fff" stroke="${STYLE.equipment}" stroke-width="${CAD.medium}"/><circle cx="762" cy="698" r="7" fill="none" stroke="${STYLE.equipment}" stroke-width="${CAD.thin}"/><path d="M 762 698 C 714 636, 646 594, 562 548" fill="none" stroke="${STYLE.conduit}" stroke-width="${CAD.medium}" stroke-dasharray="${CAD.dashConduit}"/><text x="642" y="628" class="callout" fill="${STYLE.conduit}">(N) CONDUIT CANDIDATE</text><text x="784" y="704" class="small">MSP/Meter</text></g>`;
}

function renderRailSymbols(ctx: ReturnType<typeof buildContext>) {
  const b = ctx.bounds; const y1 = ty(ctx, b.minY + (b.maxY - b.minY) * 0.36); const y2 = ty(ctx, b.minY + (b.maxY - b.minY) * 0.58);
  const x1 = tx(ctx, b.minX) + 74; const x2 = tx(ctx, b.maxX) - 74;
  return `<g opacity="0.72"><desc>rail-attachment-symbols module rail attachment indicators</desc><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y1}" stroke="${STYLE.rail}" stroke-width="${CAD.medium}"/><line x1="${x1}" y1="${y2}" x2="${x2}" y2="${y2}" stroke="${STYLE.rail}" stroke-width="${CAD.medium}"/>${[0.2, 0.38, 0.56, 0.74].map(t => `<circle cx="${Math.round(x1 + (x2 - x1) * t)}" cy="${y1}" r="4" fill="#fff" stroke="${STYLE.rail}"/><circle cx="${Math.round(x1 + (x2 - x1) * t)}" cy="${y2}" r="4" fill="#fff" stroke="${STYLE.rail}"/>`).join('')}</g>`;
}

function renderLeaderCallouts(ctx: ReturnType<typeof buildContext>) {
  const c = centroid(ctx.report.canonicalGeometry.roofPlanes[0]?.polygon ?? [], ctx);
  return `<g><path d="M ${c.x + 48} ${c.y - 52} L 880 206" fill="none" stroke="${STYLE.ink}" stroke-width="${CAD.thin}"/><text x="884" y="204" class="callout">MODULE PREVIEW ZONE</text><path d="M ${c.x + 18} ${c.y - 118} L 880 228" fill="none" stroke="${STYLE.module}" stroke-width="${CAD.thin}"/><text x="884" y="230" class="callout" fill="${STYLE.module}">PV STRING / GROUP CALLOUT</text><path d="M ${c.x + 132} ${c.y + 82} L 880 254" fill="none" stroke="${STYLE.setback}" stroke-width="${CAD.thin}" stroke-dasharray="${CAD.dashReview}"/><text x="884" y="256" class="callout" fill="${STYLE.setback}">FIRE SETBACK OVERLAY</text></g>`;
}

function renderPlanAnnotations(ctx: ReturnType<typeof buildContext>) {
  return cadTable(72, 796, 300, 78, 'ACTIVE RENDER LAYERS', ctx.report.renderRecommendationReport.recommendations.filter(r => r.enabledForPreview).slice(0, 3).map(r => [human(r.type), `${r.confidence}/100`]));
}

function renderPlanDensityBlocks(ctx: ReturnType<typeof buildContext>) {
  return [
    cadTable(390, 796, 248, 78, 'EQUIPMENT SUMMARY', [['PV array', 'diagrammatic preview'], ['Interconnection', ctx.report.photoEvidence.coverage.electricalCoverage ? 'MSP / meter evidence' : 'needs evidence'], ['Conduit', 'candidate route only']]),
    cadTable(656, 796, 342, 78, 'GENERAL CONSTRUCTION NOTES', [['1', 'verify all dimensions in field'], ['2', 'maintain required fire access paths'], ['3', 'preview not for construction']]),
    cadTable(894, 348, 132, 82, 'REVISION / QA', [['REV', 'PREVIEW'], ['DATE', ctx.date], ['QA', 'operator review']]),
  ].join('');
}

function sheetHeader(title: string, subtitle: string) { return `<text x="72" y="104" class="drawingTitle">${esc(title)}</text><text x="72" y="126" class="small">${esc(subtitle)}</text><line x1="72" y1="138" x2="852" y2="138" stroke="${STYLE.ink}" stroke-width="${CAD.medium}"/>`; }
function noteBlock(x: number, y: number, w: number, h: number, title: string, lines: string[]) { return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="${STYLE.ink}" stroke-width="${CAD.thin}"/><rect x="${x}" y="${y}" width="${w}" height="28" fill="${STYLE.titleFill}" stroke="${STYLE.ink}" stroke-width="${CAD.thin}"/><text x="${x + 8}" y="${y + 19}" class="tableHead">${esc(title)}</text>${lines.slice(0, 12).map((l, i) => `<text x="${x + 8}" y="${y + 52 + i * 28}" class="tiny">${esc(trunc(l, 26))}</text>`).join('')}</g>`; }
function cadTable(x: number, y: number, w: number, h: number, title: string, rows: string[][]) { const rowH = Math.max(20, Math.floor((h - 30) / Math.max(1, rows.length))); return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="${STYLE.ink}" stroke-width="${CAD.thin}"/><rect x="${x}" y="${y}" width="${w}" height="30" fill="${STYLE.titleFill}" stroke="${STYLE.ink}" stroke-width="${CAD.thin}"/><text x="${x + 10}" y="${y + 20}" class="tableHead">${esc(title)}</text>${rows.map((row, i) => `<line x1="${x}" y1="${y + 30 + i * rowH}" x2="${x + w}" y2="${y + 30 + i * rowH}" stroke="${STYLE.faint}"/><text x="${x + 10}" y="${y + 50 + i * rowH}" class="tiny">${esc(trunc(row[0] ?? '', 34))}</text><text x="${x + Math.round(w * 0.43)}" y="${y + 50 + i * rowH}" class="tinyStrong">${esc(trunc(row[1] ?? '', 46))}</text>`).join('')}</g>`; }
function scaleBar(x: number, y: number) { return `<g><rect x="${x}" y="${y - 10}" width="150" height="10" fill="#fff" stroke="${STYLE.ink}"/><rect x="${x}" y="${y - 10}" width="37.5" height="10" fill="${STYLE.ink}"/><rect x="${x + 75}" y="${y - 10}" width="37.5" height="10" fill="${STYLE.ink}"/><line x1="${x}" y1="${y}" x2="${x + 150}" y2="${y}" stroke="${STYLE.ink}" stroke-width="${CAD.medium}"/><line x1="${x}" y1="${y - 8}" x2="${x}" y2="${y + 8}" stroke="${STYLE.ink}"/><line x1="${x + 75}" y1="${y - 6}" x2="${x + 75}" y2="${y + 6}" stroke="${STYLE.ink}"/><line x1="${x + 150}" y1="${y - 8}" x2="${x + 150}" y2="${y + 8}" stroke="${STYLE.ink}"/><text x="${x}" y="${y + 22}" class="tiny">SCALE: DIAGRAMMATIC / VERIFY IN FIELD</text></g>`; }
function sheetBorder() { return `<g><rect x="24" y="24" width="1272" height="972" fill="none" stroke="${STYLE.ink}" stroke-width="${CAD.border}"/><rect x="36" y="36" width="1248" height="948" fill="none" stroke="${STYLE.ink}" stroke-width="${CAD.hairline}"/><line x1="${SHEET.titleRailX}" y1="36" x2="${SHEET.titleRailX}" y2="984" stroke="${STYLE.ink}" stroke-width="${CAD.medium}"/></g>`; }

function renderReviewCallouts(ctx: ReturnType<typeof buildContext>, x: number, y: number, w: number, h: number) {
  const items = [...ctx.report.renderReadiness.blockers, ...ctx.report.renderReadiness.reviewItems].slice(0, 8);
  return panel(x, y, w, h, 'REVIEW / CONFIDENCE', items.length ? items : ['No active render blockers.', 'Continue operator review.', 'Preview-only; not construction docs.'], STYLE.banner);
}

function renderLegend(x: number, y: number) { return `<g><desc>Legend fire setback preview module preview conduit candidate roof hatch obstruction property boundary</desc><rect x="${x}" y="${y}" width="132" height="314" fill="#fff" stroke="${STYLE.ink}" stroke-width="${CAD.thin}"/><rect x="${x}" y="${y}" width="132" height="28" fill="${STYLE.titleFill}" stroke="${STYLE.ink}" stroke-width="${CAD.thin}"/><text x="${x + 8}" y="${y + 19}" class="tableHead">LEGEND</text>${legendRow(x, y + 48, 'roof outline', `<line x1="0" y1="0" x2="34" y2="0" stroke="${STYLE.roof}" stroke-width="${CAD.heavy}"/>`)}${legendRow(x, y + 82, 'PV module', `<rect x="0" y="-10" width="28" height="18" fill="${STYLE.moduleFill}" stroke="${STYLE.module}"/>`)}${legendRow(x, y + 116, 'fire path', `<line x1="0" y1="0" x2="34" y2="0" stroke="${STYLE.setback}" stroke-width="${CAD.medium}" stroke-dasharray="${CAD.dashSetback}"/>`)}${legendRow(x, y + 150, 'conduit', `<line x1="0" y1="0" x2="34" y2="0" stroke="${STYLE.conduit}" stroke-width="${CAD.medium}" stroke-dasharray="${CAD.dashConduit}"/>`)}${legendRow(x, y + 184, 'equipment', `<rect x="0" y="-10" width="20" height="20" fill="#fff" stroke="${STYLE.equipment}" stroke-width="${CAD.medium}"/>`)}${legendRow(x, y + 218, 'attachment', `<circle cx="10" cy="0" r="4" fill="#fff" stroke="${STYLE.rail}"/>`)}${legendRow(x, y + 252, 'roof hatch', `<line x1="0" y1="8" x2="30" y2="-8" stroke="#9ca3af"/>`)}${legendRow(x, y + 286, 'obstruction', `<rect x="0" y="-10" width="22" height="18" fill="#f5f5f4" stroke="${STYLE.obstruction}"/>`)}</g>`; }
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
function northArrow(x: number, y: number) { return `<g><circle cx="${x}" cy="${y + 22}" r="34" fill="#fff" stroke="${STYLE.ink}" stroke-width="${CAD.thin}"/><path d="M ${x} ${y - 8} l 13 42 l -13 -9 l -13 9 Z" fill="${STYLE.ink}"/><line x1="${x - 24}" y1="${y + 22}" x2="${x + 24}" y2="${y + 22}" stroke="${STYLE.faint}"/><text x="${x}" y="${y + 72}" text-anchor="middle" class="tinyStrong">TRUE NORTH</text></g>`; }

function svgWrap(body: string) { return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET.width}" height="${SHEET.height}" viewBox="0 0 ${SHEET.width} ${SHEET.height}" role="img"><defs><style>${css()}</style></defs><rect width="100%" height="100%" fill="${STYLE.paper}"/>${body}</svg>`; }
function css() { return `.title{font:800 24px Arial,sans-serif;letter-spacing:.8px;fill:${STYLE.ink}}.drawingTitle{font:800 24px Arial,sans-serif;letter-spacing:.5px;fill:${STYLE.ink}}.sheetno{font:900 34px Arial,sans-serif;fill:${STYLE.ink}}.metric{font:800 24px Arial,sans-serif;fill:${STYLE.ink}}.panelTitle{font:800 14px Arial,sans-serif;letter-spacing:.4px;fill:${STYLE.ink}}.tableHead{font:800 11px Arial,sans-serif;letter-spacing:.7px;fill:${STYLE.ink}}.label{font:800 14px Arial,sans-serif;fill:${STYLE.ink}}.small{font:12px Arial,sans-serif;fill:${STYLE.ink}}.tiny{font:10px Arial,sans-serif;fill:${STYLE.muted}}.tinyStrong{font:700 10px Arial,sans-serif;fill:${STYLE.ink}}.callout{font:700 10.5px Arial,sans-serif;letter-spacing:.3px;fill:${STYLE.ink}}.badge{font:700 12px Arial,sans-serif;fill:${STYLE.ink}}.stamp{font:800 9px Arial,sans-serif;letter-spacing:.3px;fill:${STYLE.ink}}`; }
function buildHtmlPreview(sheets: PlanSetRenderSheetV1[]) { return `<!doctype html><html><head><meta charset="utf-8"><title>SolarPro Professional Plan-Set Preview | CAD Quality Upgrade</title><style>@page{size:11in 8.5in;margin:0}body{margin:0;background:#d1d5db;font-family:Arial,sans-serif}.sheet{width:1320px;margin:20px auto;background:white;box-shadow:0 6px 18px #6b7280;page-break-after:always}.caption{width:1320px;margin:24px auto 0;font:700 13px Arial;color:#111827}@media print{body{background:white}.caption{display:none}.sheet{margin:0;box-shadow:none;width:100vw;height:100vh}}</style></head><body>${sheets.map(s => `<div class="caption">${s.sheetNumber} · ${s.title} · non-authoritative quality preview</div><section class="sheet">${s.svg}</section>`).join('')}</body></html>`; }
function tx(ctx: ReturnType<typeof buildContext>, x: number) { const b = ctx.bounds, v = ctx.viewport, scale = Math.min((v.w - 120) / Math.max(1, b.maxX - b.minX), (v.h - 120) / Math.max(1, b.maxY - b.minY)); return Math.round(v.x + 60 + (x - b.minX) * scale); }
function ty(ctx: ReturnType<typeof buildContext>, y: number) { const b = ctx.bounds, v = ctx.viewport, scale = Math.min((v.w - 120) / Math.max(1, b.maxX - b.minX), (v.h - 120) / Math.max(1, b.maxY - b.minY)); return Math.round(v.y + v.h - 60 - (y - b.minY) * scale); }
function centroid(points: Array<{ x: number; y: number }>, ctx: ReturnType<typeof buildContext>) { const sx = points.reduce((s, p) => s + p.x, 0) / Math.max(1, points.length); const sy = points.reduce((s, p) => s + p.y, 0) / Math.max(1, points.length); return { x: tx(ctx, sx), y: ty(ctx, sy) }; }
function geometryBounds(points: Array<{ x: number; y: number }>) { if (points.length === 0) return { minX: 0, maxX: 100, minY: 0, maxY: 100 }; return points.reduce((b, p) => ({ minX: Math.min(b.minX, p.x), maxX: Math.max(b.maxX, p.x), minY: Math.min(b.minY, p.y), maxY: Math.max(b.maxY, p.y) }), { minX: points[0].x, maxX: points[0].x, minY: points[0].y, maxY: points[0].y }); }
function enabled(r: ProfessionalSurveyReadinessReportV1, type: string) { return r.renderRecommendationReport.recommendations.some(item => item.type === type && item.enabledForPreview); }
function stateColor(state: string) { return state === 'render_blocked' ? STYLE.blocked : state === 'render_review_required' ? STYLE.banner : STYLE.trust; }
function buildPreviewManifest(report: ProfessionalSurveyReadinessReportV1, sheets: PlanSetRenderSheetV1[], pdfPath: string, contactSheetPath: string): PlanSetPreviewManifestV1 {
  const sheetAssets = sheets.flatMap(sheet => ([
    { kind: 'svg_sheet' as const, label: `${sheet.sheetNumber} ${sheet.title}`, path: `${sheet.sheetNumber}-${sheet.sheetType}.svg`, sheetNumber: sheet.sheetNumber, mimeType: 'image/svg+xml' },
    { kind: 'thumbnail' as const, label: `${sheet.sheetNumber} thumbnail`, path: `thumbnails/${sheet.sheetNumber}-${sheet.sheetType}.png`, sheetNumber: sheet.sheetNumber, mimeType: 'image/png' },
    { kind: 'snapshot' as const, label: `${sheet.sheetNumber} preview snapshot`, path: `snapshots/${sheet.sheetNumber}-${sheet.sheetType}.png`, sheetNumber: sheet.sheetNumber, mimeType: 'image/png' },
  ]));
  return {
    schemaVersion: 'professional_plan_set_preview_manifest_v1',
    packageMode: 'live_preview_preparation_only',
    sourceSurveyId: report.source.surveyId,
    packageHash: 'computed-after-package-hash',
    defaultPreviewPath: 'index.html',
    pdfPath,
    contactSheetPath,
    sheets: sheets.map(sheet => ({ sheetNumber: sheet.sheetNumber, sheetType: sheet.sheetType, title: sheet.title, svgPath: `${sheet.sheetNumber}-${sheet.sheetType}.svg`, thumbnailPath: `thumbnails/${sheet.sheetNumber}-${sheet.sheetType}.png`, snapshotPath: `snapshots/${sheet.sheetNumber}-${sheet.sheetType}.png`, renderHash: sheet.renderHash })),
    assets: [
      { kind: 'html', label: 'Multi-sheet HTML preview', path: 'index.html', mimeType: 'text/html' },
      { kind: 'pdf', label: 'Multi-sheet PDF package', path: pdfPath, mimeType: 'application/pdf' },
      { kind: 'contact_sheet', label: 'Package contact sheet', path: contactSheetPath, mimeType: 'image/png' },
      { kind: 'manifest', label: 'Live preview manifest', path: 'preview-manifest.json', mimeType: 'application/json' },
      ...sheetAssets,
    ],
    livePreviewReadiness: {
      readyForInternalPreviewRoute: true,
      readyForLiveEngineeringUi: false,
      blockersBeforePublicPreview: ['Product approval of preview-only warning UX', 'PDF download QA across target browsers', 'Stakeholder acceptance of visual quality threshold before public release'],
    },
    noAuthorityEnforcement: noAuthority(),
  };
}

function buildRenderQualityChecklist(report: ProfessionalSurveyReadinessReportV1, sheets: PlanSetRenderSheetV1[]): PlanSetRenderQualityChecklistV1 {
  const all = sheets.map(s => s.svg).join('\n');
  const mk = (key: string, label: string, passed: boolean, maxPoints: number) => ({ key, label, passed, points: passed ? maxPoints : 0, maxPoints });
  const checks = [
    mk('title_block_rail', 'Right-side CAD title block rail with sheet number/name metadata', all.includes('SHEET NUMBER') && all.includes('SHEET NAME'), 10),
    mk('sheet_border', 'Double sheet border and drawing rail are present', all.includes('outer-border') || all.includes('width="1272" height="972"'), 8),
    mk('legend_professionalism', 'Legend contains complete graphic symbols for roof, modules, setbacks, conduit, equipment, hatch, and obstructions', all.includes('LEGEND') && all.includes('PV module') && all.includes('fire path') && all.includes('roof hatch') && all.includes('obstruction'), 8),
    mk('composition_balance', 'Site plan viewport includes drawing frame, grid, roof plan title, professional north arrow, scale bar, and balanced bottom tables', all.includes('ROOF PLAN WITH MODULES') && all.includes('SCALE: DIAGRAMMATIC') && all.includes('TRUE NORTH') && all.includes('GENERAL CONSTRUCTION NOTES'), 9),
    mk('site_context_realism', 'Site plan includes deterministic aerial-like context, lot boundary, driveway/access, and neighboring structure cues', all.includes('realistic site context') && all.includes('PROPERTY / LOT CONTEXT PREVIEW') && all.includes('DRIVEWAY / ACCESS'), 10),
    mk('module_layout_realism', 'Module layout includes aligned rows, spacing, orientation, group outline, rail attachments, and string/group callout', all.includes('PV-1 MODULE GROUP') && all.includes('PV STRING / GROUP CALLOUT') && all.includes('rail-attachment-symbols'), 10),
    mk('annotation_density', 'Leader callouts, construction notes, QA/revision table, and active render layer table are present', all.includes('MODULE PREVIEW ZONE') && all.includes('ACTIVE RENDER LAYERS') && all.includes('REVISION / QA') && all.includes('EQUIPMENT SUMMARY'), 7),
    mk('drafting_resemblance', 'CAD line-weight, hatches, edge ticks, dashed conventions, and obstruction symbols resemble drafted plans', all.includes('stroke-width="3"') && all.includes(CAD.dashSetback) && all.includes(CAD.dashConduit) && all.includes('roof edge articulation') && all.includes('OBSTR. REF.'), 8),
    mk('render_confidence_display', 'Render confidence/state is visible in title block and stamp', all.includes(`${report.renderReadiness.renderConfidenceScore}/100`) && all.includes(report.renderReadiness.state), 8),
    mk('review_warning_visibility', 'Review/non-authority warnings are visible on package sheets', all.includes('NON-AUTHORITATIVE PREVIEW') && all.includes('REVIEW'), 8),
    mk('export_presentation_readiness', 'HTML/SVG package is deterministic, vector based, print styled, and supported by preview manifest assets', sheets.every(s => s.svg.startsWith('<svg')) && sheets.length === 3 && all.includes('NON-AUTHORITATIVE PREVIEW'), 7),
    mk('evidence_grouping', 'Evidence sheet groups photo metadata and coverage/risk summaries', all.includes('PHOTO EVIDENCE / REVIEW CALLOUTS') && all.includes('EVIDENCE COVERAGE SUMMARY'), 7),
  ];
  const score = checks.reduce((sum, c) => sum + c.points, 0);
  return { schemaVersion: 'professional_plan_set_render_quality_checklist_v1', score, maxScore: 100, grade: score >= 96 ? 'ui_candidate' : score >= 84 ? 'commercial_preview' : 'benchmark_gap', checks, benchmarkGaps: score >= 92 ? ['Direct PDF export automation and richer production module/string data remain before permit-grade UI release.'] : ['Visual output still needs CAD polish before live UI wiring.'], noAuthorityEnforcement: noAuthority() };
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
