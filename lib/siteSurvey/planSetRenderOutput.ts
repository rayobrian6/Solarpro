import type { ProfessionalSurveyReadinessReportV1 } from './professionalSurveyReadinessReport';
import { buildEvidenceDerivedCadReconstruction, type EvidenceDerivedCandidateV1 } from './evidenceDerivedCadReconstruction';
import { buildSourceOfTruthCadRenderContext, type SourceOfTruthDesignHandoffV1, type SourceTruthLayerProvenanceV1, type DesignTruthModuleGroupV1 } from './sourceOfTruthCadRender';
import type { OpenSourcePhotoVisionStoredBundle, StoredOpenSourcePhotoVisionCandidate } from '@/lib/db/openSourcePhotoVision';

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

export interface PlanSetRenderOptionsV1 {
  openSourcePhotoVision?: OpenSourcePhotoVisionStoredBundle | null;
}

export function buildProfessionalPlanSetRenderPackage(report: ProfessionalSurveyReadinessReportV1, designHandoff: SourceOfTruthDesignHandoffV1 | null = null, options: PlanSetRenderOptionsV1 = {}): PlanSetRenderPackageV1 {
  const context = buildContext(report, designHandoff, options);
  const sheets = [renderCoverSheet(context), renderSitePlanSheet(context), renderEvidenceSheet(context)];
  const quality = buildRenderQualityChecklist(context, sheets);
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
        'A source-of-truth provenance layer now classifies A-101 render layers as survey photo truth, survey metadata truth, design/layout truth, equipment truth, review inference, or explicit fallback.',
        'Design handoff data, when supplied, drives visible panel count, module orientation, array grouping, and equipment intent before any fallback layout is shown.',
        'Survey photo evidence remains the primary review truth for roof/equipment/obstruction/conduit candidates without mutating CAD or canonical geometry.',
        'CAD-style double borders, right-side title-block rail, sheet index regions, and drawing-number hierarchy create a permit-set visual language.',
        'A deterministic grayscale site-context layer is explicitly diagrammatic and cannot inflate evidence-alignment quality.',
        'Canonical roof geometry is rendered as export-safe vector linework only after real survey evidence and derived evidence cues are considered.',
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
      'Evidence-derived reconstruction candidates are review-only overlays and cannot mutate canonical geometry, CAD, permit, BOM, or engineering workflows.',
      'Preview manifests and thumbnails prepare future UI integration but do not wire these outputs into the live Engineering UI.',
    ],
  };
  const packageHash = hash(stripSvgHashes(withoutHash));
  return { ...withoutHash, packageHash, previewManifest: { ...withoutHash.previewManifest, packageHash } };
}

function buildContext(report: ProfessionalSurveyReadinessReportV1, designHandoff: SourceOfTruthDesignHandoffV1 | null = null, options: PlanSetRenderOptionsV1 = {}) {
  const bounds = geometryBounds(report.canonicalGeometry.roofPlanes.flatMap(p => p.polygon));
  const viewport = { x: 62, y: 94, w: 812, h: 690 };
  const sourceTruth = buildSourceOfTruthCadRenderContext(report, designHandoff);
  const reconstruction = sourceTruth.photoReconstruction;
  return { report, bounds, viewport, reconstruction, sourceTruth, openSourcePhotoVision: options.openSourcePhotoVision ?? null, projectTitle: `Survey ${report.source.surveyId}`, date: new Date(0).toISOString().slice(0, 10) };
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
  const system = r.summaries.systemType;
  const fixture = system === 'ground' ? renderGroundMountFixture(ctx) : system === 'fence' ? renderSolarFenceFixture(ctx) : '';
  const evidenceOverlays = renderEvidenceDerivedOverlays(ctx);
  const roof = fixture ? '' : renderRoofGeometry(ctx);
  const modules = enabled(r, 'module_layout_previews') ? renderSourceTruthModulePreview(ctx, Boolean(fixture)) : '';
  const setbacks = !fixture && enabled(r, 'fire_setback_overlays') ? renderSetbacks(ctx) : '';
  const rails = fixture ? renderFixtureRailSymbols(ctx) : renderRailSymbols(ctx);
  const obstructions = fixture ? renderFixtureDraftingCues(ctx) : renderObstructionSymbols(ctx);
  const equipment = renderEquipment(ctx);
  const leaders = fixture ? renderFixtureLeaderCallouts(ctx) : renderLeaderCallouts(ctx);
  const annotations = renderPlanAnnotations(ctx);
  const callouts = renderReviewCallouts(ctx, 894, 118, 122, 300);
  const legend = renderSourceTruthLegend(ctx, 894, 456);
  const density = renderPlanDensityBlocks(ctx);
  const provenance = renderSourceTruthProvenance(ctx);
  const body = [viewportFrame(ctx), renderSiteContext(ctx), fixture, roof, evidenceOverlays, setbacks, modules, rails, obstructions, equipment, leaders, annotations, callouts, legend, provenance, scaleBar(108, 746), northArrow(812, 714), density].join('');
  return sheet(ctx, 'A-101', 'site_plan_render', 'Roof / Site Plan Render Preview', body, ['source-of-truth driven A-101', 'survey photos are primary evidence truth', 'design/layout handoff is secondary placement truth', 'photo-derived evidence cues', 'explicit fallback disclosure', 'source provenance legend', 'design-vs-survey reconciliation warnings', 'authenticity score', 'diagrammatic property boundary fallback', 'roof outlines from survey metadata', 'pitch/azimuth annotations', 'setback overlays review required', 'module preview zones from design layout when supplied', 'module string/group callouts', 'rail/attachment symbols fallback unless design-supported', 'equipment markers with evidence/design provenance', 'leader callouts', 'review callouts']);
}

function renderEvidenceSheet(ctx: ReturnType<typeof buildContext>): PlanSetRenderSheetV1 {
  const r = ctx.report;
  const photos = r.photoEvidence.evidence.slice(0, 10).map((p, i) => photoTile(72 + (i % 2) * 390, 150 + Math.floor(i / 2) * 104, p.source.slotKey, p.classification.category, p.classification.confidence, photoThumbnailForEvidence(ctx, p.source.url))).join('');
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
  return `<g opacity="0.96"><desc>${provenanceDesc(ctx, 'site-context')} realistic site context aerial-like grayscale property boundary driveway neighboring structure diagrammatic only parcel hatch FALLBACK PLACEHOLDER</desc><rect x="${v.x + 10}" y="${v.y + 10}" width="${v.w - 20}" height="${v.h - 20}" fill="#f8fafc"/><g opacity="0.55">${texture}</g><rect x="${v.x + 18}" y="${streetY}" width="${v.w - 36}" height="44" fill="#e5e7eb" stroke="#9ca3af" stroke-width="${CAD.hairline}"/><line x1="${v.x + 38}" y1="${streetY + 22}" x2="${v.x + v.w - 38}" y2="${streetY + 22}" stroke="#f8fafc" stroke-width="3" stroke-dasharray="28 20"/><text x="${v.x + 30}" y="${streetY + 36}" class="tiny">STREET / ACCESS CONTEXT (DIAGRAMMATIC)</text>${parcelTick}<rect x="${lotX}" y="${lotY}" width="${lotW}" height="${lotH}" fill="none" stroke="#374151" stroke-width="${CAD.medium}" stroke-dasharray="10 6"/><text x="${lotX + 12}" y="${lotY + 20}" class="callout">PROPERTY / LOT CONTEXT PREVIEW</text><path d="M ${drivewayX} ${streetY} L ${drivewayX - 22} ${cy + 122} L ${drivewayX + 34} ${cy + 94} L ${drivewayX + 72} ${streetY}" fill="#e5e7eb" stroke="#6b7280" stroke-width="${CAD.thin}"/><text x="${drivewayX - 4}" y="${Math.min(streetY - 12, cy + 134)}" class="tiny">DRIVEWAY / ACCESS</text><rect x="${lotX + 32}" y="${lotY + 52}" width="84" height="58" fill="#f3f4f6" stroke="#9ca3af" stroke-width="${CAD.hairline}"/><rect x="${lotX + lotW - 112}" y="${lotY + 74}" width="72" height="94" fill="#f3f4f6" stroke="#9ca3af" stroke-width="${CAD.hairline}"/><text x="${lotX + lotW - 130}" y="${lotY + 188}" class="tiny">NEIGHBORING STRUCTURE CUES</text></g>`;
}

function renderEvidenceDerivedOverlays(ctx: ReturnType<typeof buildContext>) {
  const oss = renderOpenSourcePhotoVisionOverlays(ctx);
  if (oss) return oss;
  const r = ctx.reconstruction;
  const visible = r.candidates.filter(candidate => candidate.reviewStatus !== 'fallback_only').slice(0, 8);
  const fallback = r.candidates.filter(candidate => candidate.reviewStatus === 'fallback_only').slice(0, 3);
  const overlays = visible.map(candidate => renderEvidenceCandidate(candidate)).join('');
  const fallbackNotes = fallback.map((candidate, i) => `<text x="${candidate.drawingRegion.x}" y="${candidate.drawingRegion.y + i * 4}" class="tinyStrong" fill="${STYLE.review}">FALLBACK: ${esc(trunc(candidate.label, 60))}</text>`).join('');
  const photoSlots = r.photoFrames.slice(0, 4).map(frame => frame.sourceSlotKey).join(', ') || 'none';
  const noPhotoNotice = r.alignmentSummary.acceptedPhotoFrameCount === 0 ? `<text x="86" y="154" class="tinyStrong" fill="${STYLE.review}">No accepted survey photos available</text>` : '';
  const summary = cadTable(390, 690, 248, 78, 'EVIDENCE ALIGNMENT', [
    ['Photo frames', String(r.alignmentSummary.acceptedPhotoFrameCount)],
    ['Aligned cues', String(r.alignmentSummary.evidenceAlignedCandidateCount)],
    ['Fallbacks', String(r.alignmentSummary.fallbackCandidateCount)],
    ['Authenticity', `${r.alignmentSummary.authenticityScore}/100`],
  ]);
  return `<g><desc>evidence-derived reconstruction photo-aligned review candidates sharp exif-reader tesseract adapter boundaries no CAD mutation</desc><text x="86" y="118" class="callout" fill="${STYLE.ok}">EVIDENCE-DERIVED CAD RECONSTRUCTION · REVIEW-ONLY PHOTO ALIGNMENT</text><text x="86" y="136" class="tiny">PHOTO SLOTS: ${esc(trunc(photoSlots, 94))}</text>${noPhotoNotice}${overlays}${fallbackNotes}${summary}</g>`;
}

function renderEvidenceCandidate(candidate: EvidenceDerivedCandidateV1) {
  const d = candidate.drawingRegion;
  const color = evidenceColor(candidate.layerType);
  const dash = candidate.reviewStatus === 'operator_review_required' ? CAD.dashReview : '9 4';
  const opacity = candidate.reviewStatus === 'operator_review_required' ? 0.66 : 0.88;
  const cx = d.x + d.width / 2;
  const cy = d.y + d.height / 2;
  const label = `${candidate.label} · ${candidate.confidence}/100`;
  const title = `${candidate.layerType} from ${candidate.sourcePhotoSlotKeys.join(', ') || 'fallback'}; ${candidate.limitations[0]}`;
  return `<g opacity="${opacity}" transform="rotate(${d.rotationDeg} ${cx} ${cy})"><title>${esc(title)}</title><rect x="${d.x}" y="${d.y}" width="${d.width}" height="${d.height}" fill="none" stroke="${color}" stroke-width="${CAD.medium}" stroke-dasharray="${dash}"/><circle cx="${d.x}" cy="${d.y}" r="4" fill="#fff" stroke="${color}" stroke-width="${CAD.thin}"/><circle cx="${d.x + d.width}" cy="${d.y + d.height}" r="4" fill="#fff" stroke="${color}" stroke-width="${CAD.thin}"/><text x="${d.x + 6}" y="${Math.max(108, d.y - 8)}" class="callout" fill="${color}">${esc(trunc(label, 64))}</text><text x="${d.x + 6}" y="${d.y + d.height + 14}" class="tiny">PHOTO-ALIGNED CANDIDATE · NO GEOMETRY AUTHORITY</text></g>`;
}

function evidenceColor(layer: EvidenceDerivedCandidateV1['layerType']) {
  if (layer === 'roof_edge_candidates' || layer === 'install_area_candidates') return STYLE.ok;
  if (layer === 'obstruction_candidates') return STYLE.review;
  if (layer === 'equipment_anchor_candidates' || layer === 'conduit_anchor_candidates') return STYLE.equipment;
  if (layer === 'module_alignment_cues') return STYLE.module;
  if (layer === 'orientation_depth_cues') return STYLE.conduit;
  return STYLE.muted;
}

function renderRoofGeometry(ctx: ReturnType<typeof buildContext>) {
  return ctx.report.canonicalGeometry.roofPlanes.map((plane) => {
    const d = plane.polygon.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${tx(ctx, p.x)} ${ty(ctx, p.y)}`).join(' ') + ' Z';
    const c = centroid(plane.polygon, ctx);
    const b = geometryBounds(plane.polygon);
    const x = tx(ctx, b.minX), y = ty(ctx, b.maxY), w = Math.max(18, tx(ctx, b.maxX) - tx(ctx, b.minX)), h = Math.max(18, ty(ctx, b.minY) - ty(ctx, b.maxY));
    const hatch = Array.from({ length: 9 }, (_, i) => `<line x1="${x + 18 + i * Math.max(18, Math.floor(w / 9))}" y1="${y + 10}" x2="${x - 10 + i * Math.max(18, Math.floor(w / 9))}" y2="${y + h - 10}" stroke="#e5e7eb" stroke-width="0.7"/>`).join('');
    const edgeTicks = plane.polygon.map((pt, idx) => `<circle cx="${tx(ctx, pt.x)}" cy="${ty(ctx, pt.y)}" r="3" fill="#fff" stroke="${STYLE.roof}" stroke-width="${CAD.hairline}"><title>roof edge vertex ${idx + 1}</title></circle>`).join('');
    return `<g><desc>${provenanceDesc(ctx, 'roof-outlines')} roof edge articulation roof hatch drafted silhouette</desc><clipPath id="clip-${plane.planeId}"><path d="${d}"/></clipPath><g clip-path="url(#clip-${plane.planeId})">${hatch}</g><path d="${d}" fill="${STYLE.roofFill}" fill-opacity="0.78" stroke="${STYLE.roof}" stroke-width="${CAD.heavy}"/><path d="${d}" fill="none" stroke="${STYLE.faint}" stroke-width="${CAD.thin}" transform="translate(5 5)"/>${edgeTicks}<text x="${c.x}" y="${c.y - 4}" text-anchor="middle" class="label">${esc(plane.planeId)}</text><text x="${c.x}" y="${c.y + 16}" text-anchor="middle" class="tiny">PITCH ${plane.pitchDeg}° / AZ ${plane.azimuthDeg}°</text></g>`;
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


function renderSourceTruthModulePreview(ctx: ReturnType<typeof buildContext>, fixture: boolean) {
  const groups = ctx.sourceTruth.moduleGroups;
  if (groups.length === 0) return `<g><desc>module-layout source fallback_placeholder no module groups available</desc><text x="108" y="238" class="callout" fill="${STYLE.review}">FALLBACK PLACEHOLDER · NO DESIGN MODULE LAYOUT AVAILABLE</text></g>`;
  return groups.map((group, index) => fixture ? renderFixtureSourceTruthModuleGroup(ctx, group, index) : renderRoofSourceTruthModuleGroup(ctx, group, index)).join('');
}

function renderRoofSourceTruthModuleGroup(ctx: ReturnType<typeof buildContext>, group: DesignTruthModuleGroupV1, index: number) {
  const plane = ctx.report.canonicalGeometry.roofPlanes.find(item => item.planeId === group.planeId) ?? ctx.report.canonicalGeometry.roofPlanes[index % Math.max(1, ctx.report.canonicalGeometry.roofPlanes.length)];
  const b = geometryBounds(plane?.polygon ?? []);
  const left = tx(ctx, b.minX) + 52;
  const top = ty(ctx, b.maxY) + 62;
  const right = tx(ctx, b.maxX) - 46;
  const bottom = ty(ctx, b.minY) - 54;
  const portrait = group.orientation === 'portrait';
  const moduleW = portrait ? 34 : 56;
  const moduleH = portrait ? 58 : 34;
  const gapX = 8;
  const gapY = 10;
  const cols = Math.max(1, group.columnCount);
  const rows = Math.max(1, Math.ceil(group.panelCount / cols));
  const groupW = cols * moduleW + (cols - 1) * gapX;
  const groupH = rows * moduleH + (rows - 1) * gapY;
  const x0 = Math.round(left + Math.max(0, (right - left - groupW) / 2));
  const y0 = Math.round(top + Math.max(0, (bottom - top - groupH) / 2));
  const modules: string[] = [];
  for (let i = 0; i < group.panelCount; i++) {
    const row = Math.floor(i / cols), col = i % cols;
    const x = x0 + col * (moduleW + gapX), y = y0 + row * (moduleH + gapY);
    modules.push(`<g><title>PV module ${i + 1} from ${esc(group.sourceReferences.join(', '))}</title><rect x="${x}" y="${y}" width="${moduleW}" height="${moduleH}" fill="${STYLE.moduleFill}" stroke="${STYLE.module}" stroke-width="${CAD.thin}"/><line x1="${x + Math.round(moduleW / 2)}" y1="${y + 3}" x2="${x + Math.round(moduleW / 2)}" y2="${y + moduleH - 3}" stroke="#93c5fd" stroke-width="0.6"/><line x1="${x + 3}" y1="${y + Math.round(moduleH / 2)}" x2="${x + moduleW - 3}" y2="${y + Math.round(moduleH / 2)}" stroke="#93c5fd" stroke-width="0.6"/></g>`);
  }
  const cls = group.fallback ? 'fallback_placeholder' : 'design_layout_truth';
  const sourceLabel = group.fallback ? 'FALLBACK PLACEHOLDER' : 'DESIGN LAYOUT TRUTH';
  const specs = group.panelWidthIn && group.panelHeightIn ? ` · ${group.panelWidthIn}x${group.panelHeightIn}IN` : '';
  const labelY = Math.max(98, y0 - 12);
  const fallbackText = group.fallback ? `<text x="${x0}" y="${y0 + groupH + 30}" class="tinyStrong" fill="${STYLE.review}">FALLBACK: MODULE COUNT/PLACEMENT NOT FROM DESIGN LAYOUT · REVIEW REQUIRED</text>` : '';
  return `<g><desc>module-layout SOURCE ${cls} PANEL_COUNT ${group.panelCount} ORIENTATION ${group.orientation} REVIEW ${group.reviewRequired}</desc><rect x="${x0 - 10}" y="${y0 - 10}" width="${groupW + 20}" height="${groupH + 20}" fill="none" stroke="${group.fallback ? STYLE.review : STYLE.module}" stroke-width="${CAD.hairline}" stroke-dasharray="5 4"/>${modules.join('')}<text x="${x0}" y="${labelY}" class="callout" fill="${group.fallback ? STYLE.review : STYLE.module}">PV-${index + 1} · ${sourceLabel} · ${group.panelCount} MOD · ${group.orientation.toUpperCase()}${specs}</text><text x="${x0}" y="${labelY + 14}" class="tiny">PLANE ${esc(group.planeId ?? 'unmapped')} · SOURCE ${esc(trunc(group.sourceReferences.join(', '), 80))}</text>${fallbackText}</g>`;
}

function renderFixtureSourceTruthModuleGroup(ctx: ReturnType<typeof buildContext>, group: DesignTruthModuleGroupV1, index: number) {
  const ground = ctx.report.summaries.systemType === 'ground';
  const x0 = ground ? 194 : 190, y0 = ground ? 238 : 246;
  const moduleW = group.orientation === 'landscape' ? 66 : 42;
  const moduleH = group.orientation === 'landscape' ? 36 : 68;
  const gapX = ground ? 10 : 8, gapY = ground ? 12 : 6;
  const cols = Math.max(1, group.columnCount);
  const mods: string[] = [];
  for (let i = 0; i < group.panelCount; i++) {
    const row = Math.floor(i / cols), col = i % cols;
    const stagger = ground ? 0 : Math.round(col * -5 + row * 34);
    const x = x0 + col * (moduleW + gapX), y = y0 + row * (moduleH + gapY) + stagger;
    mods.push(`<rect x="${x}" y="${y}" width="${moduleW}" height="${moduleH}" fill="${STYLE.moduleFill}" stroke="${STYLE.module}" stroke-width="${CAD.thin}"/>`);
  }
  const sourceLabel = group.fallback ? 'FALLBACK PLACEHOLDER' : 'DESIGN LAYOUT TRUTH';
  const conductor = ground ? `M ${x0} ${y0 + 170} C 388 474, 548 480, 710 572` : `M ${x0 + 36} ${y0 + 238} C 362 492, 540 566, 724 642`;
  return `<g><desc>module-layout SOURCE ${group.fallback ? 'fallback_placeholder' : 'design_layout_truth'} fixture-specific panel count ${group.panelCount}</desc>${mods.join('')}<path d="${conductor}" fill="none" stroke="${group.fallback ? STYLE.review : STYLE.module}" stroke-width="${CAD.medium}" stroke-dasharray="6 5"/><text x="${x0}" y="${ground ? y0 - 22 : y0 - 26}" class="callout" fill="${group.fallback ? STYLE.review : STYLE.module}">PV-${index + 1} · ${sourceLabel} · ${group.panelCount} MOD · ${group.orientation.toUpperCase()}</text><text x="${x0}" y="${ground ? y0 - 8 : y0 - 12}" class="tiny">SOURCE ${esc(trunc(group.sourceReferences.join(', '), 82))}</text>${group.fallback ? `<text x="${x0}" y="${y0 + 260}" class="tinyStrong" fill="${STYLE.review}">FALLBACK: FIXTURE MODULE LAYOUT NOT DESIGN-DERIVED</text>` : ''}</g>`;
}

function renderSourceTruthLegend(ctx: ReturnType<typeof buildContext>, x: number, y: number) {
  const st = ctx.sourceTruth;
  const rows = [
    ['survey_photo_truth', String(st.layerProvenance.filter(p => p.classification === 'survey_photo_truth').length)],
    ['survey_metadata_truth', String(st.layerProvenance.filter(p => p.classification === 'survey_metadata_truth').length)],
    ['design_layout_truth', String(st.layerProvenance.filter(p => p.classification === 'design_layout_truth').length)],
    ['equipment_truth', String(st.layerProvenance.filter(p => p.classification === 'equipment_truth').length)],
    ['inferred_review_required', String(st.layerProvenance.filter(p => p.classification === 'inferred_review_required').length)],
    ['fallback_placeholder', String(st.layerProvenance.filter(p => p.classification === 'fallback_placeholder').length)],
    ['AUTHENTICITY', `${st.authenticity.score}/100`],
    ['RECONCILIATION', st.reconciliation.status],
  ];
  return cadTable(x, y, 132, 314, 'SOURCE OF TRUTH', rows);
}

function renderSourceTruthProvenance(ctx: ReturnType<typeof buildContext>) {
  const st = ctx.sourceTruth;
  const layerRows = st.layerProvenance.slice(0, 7).map(layer => [layer.layerId, `${layer.classification}${layer.fallback ? ' FALLBACK PLACEHOLDER' : ''}`]);
  const warnings = st.reconciliation.warnings.slice(0, 4);
  const warningRows = warnings.length ? warnings.map((warning, i) => [`W${i + 1}`, warning]) : [['STATUS', st.reconciliation.status]];
  return `<g><desc>source-of-truth provenance layer classifications fallback disclosure reconciliation authenticity score review-only</desc>${cadTable(656, 690, 342, 96, 'LAYER PROVENANCE', layerRows)}${cadTable(894, 118, 122, 214, 'RECONCILIATION', warningRows)}<text x="86" y="154" class="callout" fill="${STYLE.review}">SOURCE-OF-TRUTH A-101 · PRIMARY SURVEY PHOTO TRUTH + SECONDARY DESIGN LAYOUT TRUTH · PREVIEW ONLY</text><text x="86" y="170" class="tinyStrong" fill="${STYLE.review}">AUTHENTICITY ${st.authenticity.score}/100 · FALLBACK PENALTY ${st.authenticity.fallbackPenalty} · ${esc(st.reconciliation.status)}</text></g>`;
}

function provenanceFor(ctx: ReturnType<typeof buildContext>, layerId: string): SourceTruthLayerProvenanceV1 | undefined {
  return ctx.sourceTruth.layerProvenance.find(layer => layer.layerId === layerId);
}

function provenanceDesc(ctx: ReturnType<typeof buildContext>, layerId: string) {
  const p = provenanceFor(ctx, layerId);
  if (!p) return `SOURCE fallback_placeholder layer ${layerId}`;
  return `SOURCE ${p.classification} layer ${p.layerId} confidence ${p.confidence} fallback ${p.fallback} review ${p.reviewRequired} refs ${p.sourceReferences.join('|')}`;
}

function renderGroundMountFixture(ctx: ReturnType<typeof buildContext>) {
  const v = ctx.viewport;
  const padX = v.x + 118, padY = v.y + 166, padW = 560, padH = 286;
  const grade = `<path d="M ${padX - 52} ${padY + padH + 56} C ${padX + 88} ${padY + padH + 30}, ${padX + 366} ${padY + padH + 84}, ${padX + padW + 88} ${padY + padH + 42}" fill="none" stroke="#78716c" stroke-width="${CAD.medium}"/><text x="${padX - 42}" y="${padY + padH + 78}" class="tinyStrong">GROUND-MOUNT GRADE LINE / SLOPE CUE</text>`;
  const racks = [0, 1, 2].map((row) => {
    const y = padY + row * 82;
    const posts = [0, 1, 2, 3, 4].map(i => `<line x1="${padX + 38 + i * 118}" y1="${y + 52}" x2="${padX + 26 + i * 118}" y2="${padY + padH + 48}" stroke="${STYLE.rail}" stroke-width="${CAD.medium}"/><circle cx="${padX + 26 + i * 118}" cy="${padY + padH + 50}" r="5" fill="#fff" stroke="${STYLE.rail}"/>`).join('');
    return `<g><line x1="${padX}" y1="${y + 22}" x2="${padX + padW}" y2="${y + 22}" stroke="${STYLE.rail}" stroke-width="${CAD.heavy}"/><line x1="${padX + 8}" y1="${y + 58}" x2="${padX + padW - 8}" y2="${y + 58}" stroke="${STYLE.rail}" stroke-width="${CAD.medium}"/>${posts}</g>`;
  }).join('');
  return `<g><desc>GROUND-MOUNT FIXTURE PLAN drafted support posts racking rows foundation pads trench corridor intentionally drafted fixture-specific preview</desc><rect x="${padX - 34}" y="${padY - 38}" width="${padW + 68}" height="${padH + 118}" fill="none" stroke="#57534e" stroke-width="${CAD.medium}" stroke-dasharray="10 5"/><text x="${padX - 20}" y="${padY - 16}" class="callout">GROUND-MOUNT FIXTURE PLAN · SUPPORT POST GRID</text>${racks}${grade}<path d="M ${padX + padW + 30} ${padY + 250} C ${padX + padW + 104} ${padY + 318}, 708 614, 762 698" fill="none" stroke="${STYLE.conduit}" stroke-width="${CAD.medium}" stroke-dasharray="${CAD.dashConduit}"/><text x="${padX + padW - 6}" y="${padY + 318}" class="callout" fill="${STYLE.conduit}">TRENCH / CONDUIT CORRIDOR CANDIDATE</text></g>`;
}

function renderSolarFenceFixture(ctx: ReturnType<typeof buildContext>) {
  const v = ctx.viewport;
  const x0 = v.x + 118, y0 = v.y + 190, span = 604;
  const path = `M ${x0} ${y0 + 132} L ${x0 + 174} ${y0 + 82} L ${x0 + 366} ${y0 + 104} L ${x0 + span} ${y0 + 48}`;
  const stations = [0, 0.16, 0.32, 0.50, 0.68, 0.84, 1].map((t, i) => {
    const x = Math.round(x0 + span * t);
    const y = Math.round(y0 + 132 - 84 * t + (i % 2) * 34);
    return `<g><line x1="${x}" y1="${y - 48}" x2="${x}" y2="${y + 72}" stroke="${STYLE.rail}" stroke-width="${CAD.heavy}"/><rect x="${x - 7}" y="${y + 68}" width="14" height="10" fill="#fff" stroke="${STYLE.rail}"/><text x="${x - 12}" y="${y + 92}" class="tiny">P${i + 1}</text></g>`;
  }).join('');
  return `<g><desc>SOLAR-FENCE FIXTURE PLAN drafted fence run posts rails panel bays gate clearance intentionally drafted fixture-specific preview</desc><path d="${path}" fill="none" stroke="#57534e" stroke-width="${CAD.medium}" stroke-dasharray="12 6"/><path d="${path}" fill="none" stroke="${STYLE.rail}" stroke-width="${CAD.heavy}"/><path d="M ${x0} ${y0 + 92} L ${x0 + span} ${y0 + 18}" fill="none" stroke="${STYLE.rail}" stroke-width="${CAD.medium}"/><path d="M ${x0} ${y0 + 172} L ${x0 + span} ${y0 + 98}" fill="none" stroke="${STYLE.rail}" stroke-width="${CAD.medium}"/>${stations}<rect x="${x0 + 430}" y="${y0 + 128}" width="88" height="54" fill="none" stroke="${STYLE.review}" stroke-width="${CAD.thin}" stroke-dasharray="${CAD.dashReview}"/><text x="${x0 + 424}" y="${y0 + 204}" class="callout" fill="${STYLE.review}">GATE / CLEARANCE REVIEW ZONE</text><text x="${x0 - 14}" y="${y0 - 10}" class="callout">SOLAR-FENCE FIXTURE PLAN · POST/RAIL BAY LAYOUT</text></g>`;
}

function renderFixtureModulePreview(ctx: ReturnType<typeof buildContext>) {
  const system = ctx.report.summaries.systemType;
  const ground = system === 'ground';
  const x0 = ground ? 194 : 190, y0 = ground ? 238 : 246;
  const moduleW = ground ? 66 : 42, moduleH = ground ? 36 : 68, gapX = ground ? 10 : 8, gapY = ground ? 12 : 4;
  const rows = ground ? 3 : 2, cols = ground ? 7 : 10;
  const mods: string[] = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const stagger = ground ? 0 : Math.round(col * -5 + row * 76);
    const x = x0 + col * (moduleW + gapX), y = y0 + row * (moduleH + gapY) + stagger;
    mods.push(`<g><rect x="${x}" y="${y}" width="${moduleW}" height="${moduleH}" fill="${STYLE.moduleFill}" stroke="${STYLE.module}" stroke-width="${CAD.thin}"/><line x1="${x + Math.round(moduleW / 2)}" y1="${y + 3}" x2="${x + Math.round(moduleW / 2)}" y2="${y + moduleH - 3}" stroke="#93c5fd" stroke-width="0.6"/><line x1="${x + 4}" y1="${y + Math.round(moduleH / 2)}" x2="${x + moduleW - 4}" y2="${y + Math.round(moduleH / 2)}" stroke="#93c5fd" stroke-width="0.6"/></g>`);
  }
  const conductor = ground ? `M ${x0} ${y0 + 170} C 388 474, 548 480, 710 572` : `M ${x0 + 36} ${y0 + 238} C 362 492, 540 566, 724 642`;
  const label = ground ? 'PV-GM-1 MODULE GROUP · 3x7 LANDSCAPE PREVIEW' : 'PV-FENCE-1 MODULE GROUP · LINEAR BAY STRING PREVIEW';
  return `<g><desc>module preview realistic spacing row alignment portrait landscape string group callout conductor homerun array grouping readability fixture-specific</desc>${mods.join('')}<path d="${conductor}" fill="none" stroke="${STYLE.module}" stroke-width="${CAD.medium}" stroke-dasharray="6 5"/><text x="${x0}" y="${ground ? y0 - 22 : y0 - 26}" class="callout" fill="${STYLE.module}">${label}</text><text x="${ground ? 474 : 456}" y="${ground ? 502 : 560}" class="callout" fill="${STYLE.module}">STRING A/B HOMERUN · NON-AUTHORITATIVE</text></g>`;
}

function renderFixtureRailSymbols(ctx: ReturnType<typeof buildContext>) {
  const ground = ctx.report.summaries.systemType === 'ground';
  const xs = ground ? [214, 332, 450, 568, 686] : [190, 292, 394, 496, 598, 700];
  const y = ground ? 518 : 468;
  return `<g opacity="0.82"><desc>rail-attachment-symbols fixture rail attachment spacing torque points post clamps</desc>${xs.map((x, i) => `<circle cx="${x}" cy="${y + (i % 2) * 16}" r="5" fill="#fff" stroke="${STYLE.rail}"/><text x="${x - 12}" y="${y + 26 + (i % 2) * 16}" class="tiny">CL${i + 1}</text>`).join('')}<text x="${ground ? 210 : 188}" y="${y - 24}" class="callout">ATTACHMENT / CLAMP SPACING PREVIEW</text></g>`;
}

function renderFixtureDraftingCues(ctx: ReturnType<typeof buildContext>) {
  const ground = ctx.report.summaries.systemType === 'ground';
  return `<g opacity="0.9"><desc>fixture drafting cues shade setback access aisle obstruction review service clearance</desc><rect x="${ground ? 132 : 682}" y="${ground ? 606 : 202}" width="${ground ? 190 : 118}" height="${ground ? 46 : 214}" fill="#fff7ed" stroke="${STYLE.review}" stroke-width="${CAD.thin}" stroke-dasharray="${CAD.dashReview}"/><text x="${ground ? 142 : 692}" y="${ground ? 634 : 228}" class="tinyStrong">${ground ? 'ACCESS AISLE / MOW STRIP REF.' : 'SHADE / PROPERTY LINE REVIEW'}</text></g>`;
}

function renderFixtureLeaderCallouts(ctx: ReturnType<typeof buildContext>) {
  const ground = ctx.report.summaries.systemType === 'ground';
  return `<g><path d="M ${ground ? 438 : 500} ${ground ? 274 : 278} L 880 206" fill="none" stroke="${STYLE.ink}" stroke-width="${CAD.thin}"/><text x="884" y="204" class="callout">MODULE PREVIEW ZONE</text><path d="M ${ground ? 612 : 574} ${ground ? 424 : 442} L 880 228" fill="none" stroke="${STYLE.module}" stroke-width="${CAD.thin}"/><text x="884" y="230" class="callout" fill="${STYLE.module}">PV STRING / GROUP CALLOUT</text><path d="M ${ground ? 312 : 706} ${ground ? 558 : 320} L 880 254" fill="none" stroke="${STYLE.rail}" stroke-width="${CAD.thin}" stroke-dasharray="${CAD.dashReview}"/><text x="884" y="256" class="callout">${ground ? 'POST / FOUNDATION CUE' : 'FENCE POST / RAIL CUE'}</text></g>`;
}

function renderFixtureLegend(ctx: ReturnType<typeof buildContext>, x: number, y: number) {
  const ground = ctx.report.summaries.systemType === 'ground';
  return `<g><desc>Legend fixture-specific module preview conduit candidate support post rail attachment trench fence bay clearance</desc><rect x="${x}" y="${y}" width="132" height="314" fill="#fff" stroke="${STYLE.ink}" stroke-width="${CAD.thin}"/><rect x="${x}" y="${y}" width="132" height="28" fill="${STYLE.titleFill}" stroke="${STYLE.ink}" stroke-width="${CAD.thin}"/><text x="${x + 8}" y="${y + 19}" class="tableHead">LEGEND</text>${legendRow(x, y + 48, ground ? 'rack row' : 'fence rail', `<line x1="0" y1="0" x2="34" y2="0" stroke="${STYLE.rail}" stroke-width="${CAD.heavy}"/>`)}${legendRow(x, y + 82, 'PV module', `<rect x="0" y="-10" width="28" height="18" fill="${STYLE.moduleFill}" stroke="${STYLE.module}"/>`)}${legendRow(x, y + 116, ground ? 'grade/access' : 'clearance', `<line x1="0" y1="0" x2="34" y2="0" stroke="${STYLE.review}" stroke-width="${CAD.medium}" stroke-dasharray="${CAD.dashReview}"/>`)}${legendRow(x, y + 150, 'conduit', `<line x1="0" y1="0" x2="34" y2="0" stroke="${STYLE.conduit}" stroke-width="${CAD.medium}" stroke-dasharray="${CAD.dashConduit}"/>`)}${legendRow(x, y + 184, 'equipment', `<rect x="0" y="-10" width="20" height="20" fill="#fff" stroke="${STYLE.equipment}" stroke-width="${CAD.medium}"/>`)}${legendRow(x, y + 218, 'attachment', `<circle cx="10" cy="0" r="4" fill="#fff" stroke="${STYLE.rail}"/>`)}${legendRow(x, y + 252, ground ? 'support post' : 'fence post', `<line x1="10" y1="-12" x2="10" y2="12" stroke="${STYLE.rail}" stroke-width="${CAD.heavy}"/>`)}${legendRow(x, y + 286, ground ? 'trench' : 'bay string', `<path d="M 0 0 C 10 -8, 22 8, 34 0" fill="none" stroke="${STYLE.module}"/>`)}</g>`;
}

function renderObstructionSymbols(ctx: ReturnType<typeof buildContext>) {
  const b = ctx.bounds;
  const x = tx(ctx, b.minX + (b.maxX - b.minX) * 0.72);
  const y = ty(ctx, b.minY + (b.maxY - b.minY) * 0.70);
  return `<g opacity="0.88"><desc>${provenanceDesc(ctx, 'obstruction-symbols')} roof obstruction detail vent skylight placeholder diagrammatic only FALLBACK PLACEHOLDER</desc><rect x="${x - 18}" y="${y - 14}" width="36" height="28" fill="#f5f5f4" stroke="${STYLE.obstruction}" stroke-width="${CAD.thin}"/><line x1="${x - 18}" y1="${y - 14}" x2="${x + 18}" y2="${y + 14}" stroke="${STYLE.obstruction}" stroke-width="0.8"/><text x="${x + 24}" y="${y + 4}" class="tinyStrong">VENT / OBSTR. REF.</text></g>`;
}

function renderEquipment(ctx: ReturnType<typeof buildContext>) {
  const on = ctx.report.photoEvidence.coverage.electricalCoverage;
  const opacity = on ? 1 : 0.38;
  return `<g opacity="${opacity}"><desc>${provenanceDesc(ctx, 'equipment-markers')} equipment marker MSP meter conduit candidate</desc><rect x="748" y="684" width="28" height="28" fill="#fff" stroke="${STYLE.equipment}" stroke-width="${CAD.medium}"/><circle cx="762" cy="698" r="7" fill="none" stroke="${STYLE.equipment}" stroke-width="${CAD.thin}"/><path d="M 762 698 C 714 636, 646 594, 562 548" fill="none" stroke="${STYLE.conduit}" stroke-width="${CAD.medium}" stroke-dasharray="${CAD.dashConduit}"/><text x="642" y="628" class="callout" fill="${STYLE.conduit}">(N) CONDUIT CANDIDATE</text><text x="784" y="704" class="small">MSP/Meter</text></g>`;
}

function renderRailSymbols(ctx: ReturnType<typeof buildContext>) {
  const b = ctx.bounds; const y1 = ty(ctx, b.minY + (b.maxY - b.minY) * 0.36); const y2 = ty(ctx, b.minY + (b.maxY - b.minY) * 0.58);
  const x1 = tx(ctx, b.minX) + 74; const x2 = tx(ctx, b.maxX) - 74;
  return `<g opacity="0.72"><desc>${provenanceDesc(ctx, 'rail-attachment-symbols')} rail-attachment-symbols module rail attachment indicators FALLBACK PLACEHOLDER</desc><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y1}" stroke="${STYLE.rail}" stroke-width="${CAD.medium}"/><line x1="${x1}" y1="${y2}" x2="${x2}" y2="${y2}" stroke="${STYLE.rail}" stroke-width="${CAD.medium}"/>${[0.2, 0.38, 0.56, 0.74].map(t => `<circle cx="${Math.round(x1 + (x2 - x1) * t)}" cy="${y1}" r="4" fill="#fff" stroke="${STYLE.rail}"/><circle cx="${Math.round(x1 + (x2 - x1) * t)}" cy="${y2}" r="4" fill="#fff" stroke="${STYLE.rail}"/>`).join('')}</g>`;
}

function renderLeaderCallouts(ctx: ReturnType<typeof buildContext>) {
  const c = centroid(ctx.report.canonicalGeometry.roofPlanes[0]?.polygon ?? [], ctx);
  return `<g><path d="M ${c.x + 48} ${c.y - 52} L 880 206" fill="none" stroke="${STYLE.ink}" stroke-width="${CAD.thin}"/><text x="884" y="204" class="callout">MODULE PREVIEW ZONE</text><path d="M ${c.x + 18} ${c.y - 118} L 880 228" fill="none" stroke="${STYLE.module}" stroke-width="${CAD.thin}"/><text x="884" y="230" class="callout" fill="${STYLE.module}">PV STRING / GROUP CALLOUT</text><path d="M ${c.x + 132} ${c.y + 82} L 880 254" fill="none" stroke="${STYLE.setback}" stroke-width="${CAD.thin}" stroke-dasharray="${CAD.dashReview}"/><text x="884" y="256" class="callout" fill="${STYLE.setback}">FIRE SETBACK OVERLAY</text></g>`;
}

function renderPlanAnnotations(ctx: ReturnType<typeof buildContext>) {
  return cadTable(72, 796, 300, 78, 'ACTIVE RENDER LAYERS', ctx.report.renderRecommendationReport.recommendations.filter(r => r.enabledForPreview).slice(0, 3).map(r => [human(r.type), `${r.confidence}/100`]));
}

function renderPlanDensityBlocks(ctx: ReturnType<typeof buildContext>) {
  const fixture = ctx.report.summaries.systemType === 'ground' ? 'ground-mount rack' : ctx.report.summaries.systemType === 'fence' ? 'solar-fence bays' : 'roof array';
  const note2 = ctx.report.summaries.systemType === 'ground' ? 'verify post layout / trench path' : ctx.report.summaries.systemType === 'fence' ? 'verify post spacing / gate clearance' : 'maintain required fire access paths';
  return [
    cadTable(390, 796, 248, 78, 'EQUIPMENT SUMMARY', [['PV array', fixture], ['Interconnection', ctx.report.photoEvidence.coverage.electricalCoverage ? 'MSP / meter evidence' : 'needs evidence'], ['Conduit', 'candidate route only']]),
    cadTable(656, 796, 342, 78, 'GENERAL CONSTRUCTION NOTES', [['1', 'verify all dimensions in field'], ['2', note2], ['3', 'preview not for construction']]),
    cadTable(894, 348, 132, 82, 'REVISION / QA', [['REV', 'PREVIEW'], ['DATE', ctx.date], ['QA', 'operator review']]),
    cadTable(72, 690, 300, 78, 'CONTRACTOR / DEALER META', [['Installer', 'SolarPro dealer preview'], ['Client', ctx.report.source.clientId], ['Logo zone', 'reserved / print safe']]),
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
function titleRows(x: number, ctx: ReturnType<typeof buildContext>) { const rows = [['PROJECT', ctx.report.source.projectId ?? 'PROJECT PENDING'], ['CLIENT / INSTALLER', `${ctx.report.source.clientId} / SolarPro dealer`], ['SURVEY', ctx.report.source.surveyId], ['SYSTEM', human(ctx.report.summaries.systemType)], ['DATE', ctx.date], ['SCALE', 'AS NOTED'], ['DRAWN / CHECKED', 'SOLARPRO / OPERATOR'], ['STATUS / CONF', `${ctx.report.renderReadiness.state} · ${ctx.report.renderReadiness.renderConfidenceScore}/100`]]; return rows.map((r, i) => `<rect x="${x}" y="${128 + i * 58}" width="${SHEET.titleRailW}" height="58" fill="#fff" stroke="${STYLE.ink}" stroke-width="${CAD.hairline}"/><text x="${x + 14}" y="${150 + i * 58}" class="tiny">${esc(r[0])}</text><text x="${x + 14}" y="${174 + i * 58}" class="tinyStrong">${esc(trunc(r[1], 28))}</text>`).join(''); }
function stamp(r: ProfessionalSurveyReadinessReportV1) { const blocked = r.renderReadiness.state === 'render_blocked'; return `<g><rect x="72" y="44" width="318" height="30" fill="${blocked ? STYLE.blocked : STYLE.trust}" stroke="${blocked ? '#991b1b' : '#166534'}" stroke-width="${CAD.thin}"/><text x="231" y="64" text-anchor="middle" class="stamp">NON-AUTHORITATIVE PREVIEW · QUALITY QA ONLY · ${r.renderReadiness.renderConfidenceScore}/100</text></g>`; }
function section(x: number, y: number, w: number, h: number, title: string, lines: string[]) { return panel(x, y, w, h, title, lines, '#ffffff'); }
function panel(x: number, y: number, w: number, h: number, title: string, lines: string[], fill: string) { return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${STYLE.shadow}"/><text x="${x + 18}" y="${y + 30}" class="panelTitle">${esc(title)}</text>${lines.slice(0, 10).map((l, i) => `<text x="${x + 18}" y="${y + 62 + i * 22}" class="small">${esc(trunc(l, 72))}</text>`).join('')}</g>`; }
function metricCard(x: number, y: number, label: string, value: string, fill: string) { return `<g><rect x="${x}" y="${y}" width="202" height="84" rx="12" fill="${fill}" stroke="${STYLE.shadow}"/><text x="${x + 18}" y="${y + 32}" class="small">${esc(label)}</text><text x="${x + 18}" y="${y + 66}" class="metric">${esc(value)}</text></g>`; }
function text(x: number, y: number, value: string, size: number, weight = '400') { return `<text x="${x}" y="${y}" style="font:${weight} ${size}px Arial,sans-serif;fill:${STYLE.ink}">${esc(value)}</text>`; }
function badge(x: number, y: number, w: number, h: number, label: string, fill: string) { return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="19" fill="${fill}"/><text x="${x + 18}" y="${y + 25}" class="badge">${esc(label)}</text>`; }
function photoTile(x: number, y: number, slot: string, cat: string, conf: string, thumbnailDataUrl: string | null = null) { const thumb = thumbnailDataUrl ? `<image href="${esc(thumbnailDataUrl)}" x="${x + 12}" y="${y + 12}" width="62" height="46" preserveAspectRatio="xMidYMid meet"/><rect x="${x + 12}" y="${y + 12}" width="62" height="46" fill="none" stroke="${STYLE.grid}"/>` : `<rect x="${x + 12}" y="${y + 12}" width="62" height="46" fill="${STYLE.photo}" stroke="${STYLE.grid}"/><line x1="${x + 12}" y1="${y + 12}" x2="${x + 74}" y2="${y + 58}" stroke="${STYLE.grid}"/><line x1="${x + 74}" y1="${y + 12}" x2="${x + 12}" y2="${y + 58}" stroke="${STYLE.grid}"/>`; return `<g><rect x="${x}" y="${y}" width="360" height="82" fill="#fff" stroke="${STYLE.ink}" stroke-width="${CAD.hairline}"/>${thumb}<text x="${x + 90}" y="${y + 24}" class="small">${esc(trunc(slot, 30))}</text><text x="${x + 90}" y="${y + 46}" class="tiny">CATEGORY: ${esc(cat)}</text><text x="${x + 90}" y="${y + 66}" class="tiny">PHOTO CONFIDENCE: ${esc(conf)} · ${thumbnailDataUrl ? 'SOURCE THUMBNAIL' : 'SAFE PLACEHOLDER'}</text></g>`; }
function photoThumbnailForEvidence(ctx: ReturnType<typeof buildContext>, url: string): string | null { const match = ctx.openSourcePhotoVision?.candidates.find(candidate => typeof candidate.thumbnailDataUrl === 'string' && candidate.thumbnailDataUrl && ((candidate.payload.sourceFileUrl as string | undefined) === url || (candidate.payload.sourcePhotoUrl as string | undefined) === url)); if (match?.thumbnailDataUrl) return match.thumbnailDataUrl; return null; }
function renderOpenSourcePhotoVisionOverlays(ctx: ReturnType<typeof buildContext>) { const bundle = ctx.openSourcePhotoVision; const candidates = bundle?.candidates.filter(candidate => candidate.reviewStatus !== 'rejected' && (candidate.payload.region || candidate.payload.line)).slice(0, 10) ?? []; if (!bundle || candidates.length === 0) return ''; const overlays = candidates.map((candidate, index) => renderOpenSourcePhotoVisionCandidate(ctx, candidate, index)).join(''); const counts = cadTable(390, 690, 248, 78, 'OSS PHOTO VISION', [['Candidates', String(bundle.candidateCount)], ['Run hash', bundle.latestRunHash ? bundle.latestRunHash.slice(0, 10) : 'none'], ['Authority', 'review-only'], ['CAD mutation', 'forbidden']]); return `<g><desc>open-source photo vision worker review-only non-authoritative not CAD geometry actual image bytes sharp edge map line region candidates no CAD mutation</desc><text x="86" y="118" class="callout" fill="${STYLE.ok}">OPEN-SOURCE PHOTO VISION PASS · REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY</text><text x="86" y="136" class="tiny">TOOL ${esc(bundle.toolName)} ${esc(bundle.toolVersion)} · RUN ${esc(bundle.latestRunHash ?? 'pending')}</text>${overlays}${counts}</g>`; }
function renderOpenSourcePhotoVisionCandidate(ctx: ReturnType<typeof buildContext>, candidate: StoredOpenSourcePhotoVisionCandidate, index: number) { const region = candidate.payload.region as { x?: number; y?: number; width?: number; height?: number } | null; const line = candidate.payload.line as { x1?: number; y1?: number; x2?: number; y2?: number; orientation?: string } | null; const color = candidate.candidateType.includes('roof') ? STYLE.ok : candidate.candidateType.includes('equipment') ? STYLE.equipment : candidate.candidateType.includes('obstruction') ? STYLE.review : STYLE.conduit; const label = `${candidate.candidateType.replace(/_/g, ' ')} · ${Math.round(candidate.confidence)}/100`; const sx = ctx.viewport.x + 30 + (index % 3) * 238; const sy = ctx.viewport.y + 70 + Math.floor(index / 3) * 116; const source = `${candidate.toolName}/${candidate.toolVersion} ${candidate.runHash.slice(0, 10)}`; if (line && typeof line.x1 === 'number' && typeof line.y1 === 'number' && typeof line.x2 === 'number' && typeof line.y2 === 'number') { const x1 = sx + line.x1 / 1000 * 196, y1 = sy + line.y1 / 1000 * 72, x2 = sx + line.x2 / 1000 * 196, y2 = sy + line.y2 / 1000 * 72; return `<g opacity="0.82"><title>${esc(source)} REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY</title><rect x="${sx}" y="${sy}" width="208" height="92" fill="#fff" fill-opacity="0.62" stroke="${color}" stroke-dasharray="${CAD.dashReview}"/><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${CAD.heavy}"/><text x="${sx + 6}" y="${sy - 6}" class="callout" fill="${color}">${esc(trunc(label, 52))}</text><text x="${sx + 6}" y="${sy + 108}" class="tinyStrong" fill="${STYLE.review}">REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY</text><text x="${sx + 6}" y="${sy + 121}" class="tiny">PHOTO ${esc(candidate.fileId.slice(0, 8))} · ${esc(source)}</text></g>`; } if (region && typeof region.x === 'number' && typeof region.y === 'number' && typeof region.width === 'number' && typeof region.height === 'number') { const x = sx + region.x / 1000 * 196, y = sy + region.y / 1000 * 72, w = Math.max(16, region.width / 1000 * 196), h = Math.max(12, region.height / 1000 * 72); return `<g opacity="0.82"><title>${esc(source)} REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY</title><rect x="${sx}" y="${sy}" width="208" height="92" fill="#fff" fill-opacity="0.58" stroke="${STYLE.grid}"/><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="${CAD.heavy}" stroke-dasharray="${CAD.dashReview}"/><text x="${sx + 6}" y="${sy - 6}" class="callout" fill="${color}">${esc(trunc(label, 52))}</text><text x="${sx + 6}" y="${sy + 108}" class="tinyStrong" fill="${STYLE.review}">REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY</text><text x="${sx + 6}" y="${sy + 121}" class="tiny">PHOTO ${esc(candidate.fileId.slice(0, 8))} · ${esc(source)}</text></g>`; } return ''; }
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

function buildRenderQualityChecklist(ctx: ReturnType<typeof buildContext>, sheets: PlanSetRenderSheetV1[]): PlanSetRenderQualityChecklistV1 {
  const report = ctx.report;
  const all = sheets.map(s => s.svg).join('\n');
  const reconstruction = ctx.reconstruction;
  const summary = reconstruction.alignmentSummary;
  const sourceTruth = ctx.sourceTruth;
  const hasOssVisionOverlay = all.includes('OPEN-SOURCE PHOTO VISION PASS') && all.includes('REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY');
  const hasLegacyFallbackOverlay = all.includes('EVIDENCE-DERIVED CAD RECONSTRUCTION') && all.includes('LEGACY SYNTHETIC FALLBACK');
  const hasEvidenceOverlay = hasOssVisionOverlay || hasLegacyFallbackOverlay;
  const hasFallbackDisclosure = summary.fallbackCandidateCount === 0 || all.includes('FALLBACK:') || all.includes('LEGACY SYNTHETIC FALLBACK');
  const hasPhotoFrameSupport = summary.acceptedPhotoFrameCount > 0 && reconstruction.photoFrames.length > 0;
  const hasReviewOnlyPhotoSupport = hasEvidenceOverlay && hasPhotoFrameSupport && summary.photoConsistencyScore >= 58;
  const hasAuthenticity = sourceTruth.authenticity.score >= 40 || summary.authenticityScore >= 70;
  const noMutation = reconstruction.noAuthorityEnforcement.canonicalGeometryMutationAllowed === false
    && reconstruction.noAuthorityEnforcement.cadMutationAllowed === false
    && reconstruction.noAuthorityEnforcement.persistenceAllowed === false
    && reconstruction.noAuthorityEnforcement.downstreamPermitAllowed === false;
  const hasSourceTruthLegend = all.includes('SOURCE OF TRUTH') && all.includes('AUTHENTICITY');
  const hasDesignTruth = sourceTruth.authenticity.designTruthScore > 0 && sourceTruth.moduleGroups.some(group => !group.fallback);
  const hasProvenanceCompleteness = sourceTruth.authenticity.provenanceCompletenessScore >= 95;
  const hasFallbackVisibility = sourceTruth.layerProvenance.filter(layer => layer.fallback).every(layer => all.includes(layer.layerId) || all.includes('FALLBACK'));
  const hasReconciliation = all.includes('RECONCILIATION') && sourceTruth.reconciliation.reviewRequiredFlags.length >= 0;
  const missingPhotoEvidenceOverlay = !hasEvidenceOverlay || !hasPhotoFrameSupport;
  const mk = (key: string, label: string, passed: boolean, maxPoints: number) => ({ key, label, passed, points: passed ? maxPoints : 0, maxPoints });
  const checks = [
    mk('survey_photo_truth_usage', 'A-101 surfaces accepted survey photos through real OSS review overlays when available, otherwise explicitly labeled legacy fallback cues', hasReviewOnlyPhotoSupport, 14),
    mk('survey_metadata_truth_usage', 'Canonical survey metadata drives roof outline/pitch/azimuth preview without mutation', all.includes('survey_metadata_truth') && all.includes('roof-outlines') && report.canonicalGeometry.roofPlanes.length > 0, 9),
    mk('design_layout_truth_usage', 'Design/layout handoff drives panel count, orientation, and grouping when supplied', hasDesignTruth || !ctx.sourceTruth.designHandoff, ctx.sourceTruth.designHandoff ? 14 : 0),
    mk('layer_provenance_completeness', 'Every A-101 visible render layer has source classification, references, limitations, fallback, and review status', hasSourceTruthLegend && hasProvenanceCompleteness, 13),
    mk('fallback_disclosure', 'Fallback placeholders and legacy synthetic cues are visible and cannot masquerade as source-derived CAD', hasFallbackDisclosure && hasFallbackVisibility && all.includes('FALLBACK PLACEHOLDER'), 12),
    mk('design_survey_reconciliation', 'Design/layout, survey metadata, photo evidence, and fallback status are reconciled with warnings', hasReconciliation && all.includes(sourceTruth.reconciliation.status), 10),
    mk('authenticity_score', 'Authenticity score rewards survey evidence, design truth, provenance completeness, and explicit low-authority fallback disclosure', hasAuthenticity && sourceTruth.authenticity.score >= 40 && all.includes('AUTHENTICITY'), 8),
    mk('oss_adapter_boundaries', 'OSS utilities are named as bounded non-authoritative adapters, not trusted CAD authorities', all.includes('sharp exif-reader tesseract adapter boundaries') && reconstruction.ossAdapters.every(adapter => adapter.authoritative === false), 6),
    mk('no_authority_boundaries', 'Render package enforces no CAD mutation, no design mutation, no persistence, and no downstream authority', noMutation && sourceTruth.noAuthorityEnforcement.designMutationAllowed === false, 8),
    mk('review_warning_visibility', 'Review/non-authority warnings are visible on package sheets', all.includes('NON-AUTHORITATIVE PREVIEW') && all.includes('REVIEW'), 4),
    mk('export_presentation_readiness', 'HTML/SVG package is deterministic, vector based, print styled, and supported by preview manifest assets', sheets.every(s => s.svg.startsWith('<svg')) && sheets.length === 3 && all.includes('NON-AUTHORITATIVE PREVIEW'), 2),
  ];
  const rawScore = checks.reduce((sum, c) => sum + c.points, 0);
  const photoOverlayPenalty = missingPhotoEvidenceOverlay ? 24 : 0;
  const fallbackPenalty = ctx.sourceTruth.designHandoff ? 0 : Math.min(18, Math.max(0, summary.fallbackCandidateCount - 1) * 2 + sourceTruth.layerProvenance.filter(layer => layer.fallback).length * 2);
  const designPenalty = ctx.sourceTruth.designHandoff ? (hasDesignTruth ? 0 : 16) : 10;
  const reconciliationPenalty = Math.min(18, sourceTruth.reconciliation.mismatchCount * 3);
  const uncappedScore = Math.max(0, rawScore - photoOverlayPenalty - fallbackPenalty - designPenalty - reconciliationPenalty);
  const sourceCap = hasOssVisionOverlay ? (sourceTruth.layerProvenance.some(layer => layer.fallback) ? 92 : 100) : (sourceTruth.layerProvenance.some(layer => layer.fallback) ? 84 : 88);
  const score = Math.min(uncappedScore, sourceCap);
  const benchmarkGaps = [
    ...(missingPhotoEvidenceOverlay ? ['Render still lacks real OSS photo vision overlays or accepted survey photo support; synthetic drafting density and fallback cues remain review-only.'] : []),
    ...(!hasOssVisionOverlay && hasLegacyFallbackOverlay ? ['Legacy synthetic fallback cues are disclosed and bounded; run the Open-Source Photo Vision Pass for image-byte candidates.'] : []),
    ...(summary.fallbackCandidateCount > 0 ? [`${summary.fallbackCandidateCount} explicit fallback area(s) remain; collect/align more site-survey photos before demo-grade trust.`] : []),
    ...(sourceTruth.reconciliation.warnings.length ? sourceTruth.reconciliation.warnings.slice(0, 4) : []),
    ...(!ctx.sourceTruth.designHandoff ? ['No design/layout handoff supplied; A-101 cannot prove design-derived panel count or placement planes.'] : []),
    ...(score >= 92 ? ['Pixel-level CV extraction remains adapter-bounded and review-only before any future production UI promotion.'] : []),
  ];
  return { schemaVersion: 'professional_plan_set_render_quality_checklist_v1', score, maxScore: 100, grade: score >= 92 ? 'ui_candidate' : score >= 76 ? 'commercial_preview' : 'benchmark_gap', checks, benchmarkGaps: benchmarkGaps.length ? benchmarkGaps : ['Evidence alignment is visible; continue operator review before release.'], noAuthorityEnforcement: noAuthority() };
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
