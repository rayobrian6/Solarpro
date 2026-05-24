import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { enrichSurvey } from '../lib/siteSurvey/enrichSurvey';
import { buildGeometryIntelligenceReport } from '../lib/siteSurvey/geometryIntelligence';
import { normalizeSurvey } from '../lib/siteSurvey/normalizeSurvey';
import { professionalExpandedSurveyFixtures } from '../lib/siteSurvey/professionalSurveyExpandedFixtures';
import { buildCanonicalSurveyGeometry, buildSurveyCADReadiness, parseProfessionalSiteSurvey } from '../lib/siteSurvey/professionalSurveyParser';
import { buildSurveyPhotoEvidenceBundle } from '../lib/siteSurvey/surveyPhotoEvidence';
import { buildProfessionalRenderRecommendationReport, buildRenderReadiness, type RenderReadinessStateV1 } from '../lib/siteSurvey/surveyRenderIntelligence';

type FixtureRenderResult = ReturnType<typeof buildFixtureRenderResult>;

const OUTPUT_DIR = join(process.cwd(), 'outputs', 'real-survey-data-validation');
mkdirSync(OUTPUT_DIR, { recursive: true });

const results = professionalExpandedSurveyFixtures.map(buildFixtureRenderResult);
const stateCounts = countBy(results.map(result => result.renderReadiness.state), ['render_blocked', 'render_review_required', 'render_preview_ready', 'render_demo_ready'] as const);
const categoryCounts = aggregateCategoryCounts(results);
const topLayers = topCounts(results.flatMap(result => result.renderRecommendationReport.summary.topCommercialRenderLayers));
const strongestEvidenceCategories = Object.entries(categoryCounts)
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .slice(0, 8)
  .map(([category, count]) => ({ category, count }));
const blockers = topCounts(results.flatMap(result => result.renderReadiness.blockers));
const reviewItems = topCounts(results.flatMap(result => result.renderReadiness.reviewItems));
const missingPhotoWarnings = topCounts(results.flatMap(result => result.photoEvidence.missingPhotoCategoryWarnings));
const averageConfidence = round(results.reduce((sum, item) => sum + item.renderReadiness.renderConfidenceScore, 0) / Math.max(1, results.length));

const report = {
  schemaVersion: 'survey_render_intelligence_corpus_report_v1' as const,
  corpusId: 'expanded-professional-survey-fixtures-v1',
  fixtureCount: results.length,
  summary: {
    renderReadinessDistribution: stateCounts,
    averageRenderConfidence: averageConfidence,
    previewOrDemoReadyCount: stateCounts.render_preview_ready + stateCounts.render_demo_ready,
    blockedCount: stateCounts.render_blocked,
    reviewRequiredCount: stateCounts.render_review_required,
    strongestEvidenceCategories,
    topCommercialRenderLayers: topLayers.slice(0, 8),
    topRenderBlockers: blockers.slice(0, 8),
    topReviewItems: reviewItems.slice(0, 8),
    missingPhotoWarnings: missingPhotoWarnings.slice(0, 8),
  },
  fixtureResults: results.map(result => ({
    fixtureId: result.fixtureId,
    systemType: result.systemType,
    readinessState: result.renderReadiness.state,
    renderConfidenceScore: result.renderReadiness.renderConfidenceScore,
    renderBlockers: result.renderReadiness.blockers,
    reviewItems: result.renderReadiness.reviewItems,
    photoCoverage: result.photoEvidence.coverage,
    missingPhotoCategoryWarnings: result.photoEvidence.missingPhotoCategoryWarnings,
    topCommercialRenderLayers: result.renderRecommendationReport.summary.topCommercialRenderLayers,
    enabledLayerCount: result.renderRecommendationReport.summary.previewEnabledLayerCount,
    noAuthorityEnforcement: result.renderReadiness.noAuthorityEnforcement,
  })),
  deterministicNotes: [
    'Report was generated from deterministic metadata/photo-reference heuristics over the existing expanded professional survey fixture corpus.',
    'No image pixels were inspected, no computer vision model was executed, and no CAD solver or persistence workflow was invoked.',
    'Render readiness states are commercial/operator review states only and do not promote survey photos to canonical geometry authority.',
  ],
};

writeJson('survey-render-intelligence-corpus-report-v1.json', report);
writeMarkdown('commercial-render-readiness-report-v1.md', commercialMarkdown(report));
writeMarkdown('visual-oss-evaluation-report-v1.md', ossMarkdown(report));
writeMarkdown('cad-render-roadmap-update-v1.md', roadmapMarkdown(report));

console.log(JSON.stringify({
  corpusId: report.corpusId,
  fixtureCount: report.fixtureCount,
  renderReadinessDistribution: report.summary.renderReadinessDistribution,
  averageRenderConfidence: report.summary.averageRenderConfidence,
  previewOrDemoReadyCount: report.summary.previewOrDemoReadyCount,
  topCommercialRenderLayers: report.summary.topCommercialRenderLayers.slice(0, 5),
}, null, 2));

function buildFixtureRenderResult(fixture: (typeof professionalExpandedSurveyFixtures)[number]) {
  const normalized = normalizeSurvey(fixture.raw);
  const enriched = enrichSurvey(normalized);
  const evidence = parseProfessionalSiteSurvey(enriched);
  const canonicalGeometry = buildCanonicalSurveyGeometry(enriched, evidence);
  const cadReadiness = buildSurveyCADReadiness(enriched, evidence, canonicalGeometry);
  const geometryIntelligence = buildGeometryIntelligenceReport({ evidence, canonicalGeometry, cadReadiness });
  const photoEvidence = buildSurveyPhotoEvidenceBundle(enriched, canonicalGeometry);
  const renderReadiness = buildRenderReadiness({ canonicalGeometry, cadReadiness, geometryIntelligence, photoEvidence });
  const renderRecommendationReport = buildProfessionalRenderRecommendationReport({ canonicalGeometry, cadReadiness, geometryIntelligence, photoEvidence, renderReadiness });
  return {
    fixtureId: fixture.id,
    systemType: enriched.systemType,
    photoEvidence,
    renderReadiness,
    renderRecommendationReport,
  };
}

function countBy<T extends string>(values: T[], keys: readonly T[]): Record<T, number> {
  const counts = Object.fromEntries(keys.map(key => [key, 0])) as Record<T, number>;
  for (const value of values) counts[value] += 1;
  return counts;
}

function aggregateCategoryCounts(items: FixtureRenderResult[]) {
  const counts: Record<string, number> = {};
  for (const item of items) {
    for (const [category, count] of Object.entries(item.photoEvidence.coverage.categoryCounts)) {
      counts[category] = (counts[category] ?? 0) + count;
    }
  }
  return counts;
}

function topCounts(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, count }));
}

function writeJson(filename: string, value: unknown) {
  writeFileSync(join(OUTPUT_DIR, filename), `${JSON.stringify(value, null, 2)}\n`);
}

function writeMarkdown(filename: string, value: string) {
  writeFileSync(join(OUTPUT_DIR, filename), `${value.trim()}\n`);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function pct(count: number, total: number) {
  return `${Math.round((count / Math.max(1, total)) * 100)}%`;
}

function readinessRows(distribution: Record<RenderReadinessStateV1, number>, total: number) {
  return Object.entries(distribution).map(([state, count]) => `| ${state} | ${count} | ${pct(count, total)} |`).join('\n');
}

function commercialMarkdown(value: typeof report) {
  return `# Commercial Render Readiness Report V1

Generated from corpus: \`${value.corpusId}\`  
Fixture count: **${value.fixtureCount}**

## Executive Summary

Survey Photo Render Intelligence V1 connects deterministic survey photo metadata to the existing geometry trust backbone so operators can understand whether a survey is ready for a professional commercial render, a review-assisted preview, or a blocked state. The pipeline adds no CAD authority: it reads survey photo references, canonical geometry, CAD readiness, and geometry intelligence, then emits photo coverage, render readiness, blockers, review-needed photos, and recommended render layers.

Average render confidence across the corpus is **${value.summary.averageRenderConfidence}**. **${value.summary.previewOrDemoReadyCount}/${value.fixtureCount}** fixture(s) are preview/demo ready, while **${value.summary.blockedCount}** are blocked and **${value.summary.reviewRequiredCount}** require render review before commercial use.

## Render Readiness Distribution

| State | Count | Share |
|---|---:|---:|
${readinessRows(value.summary.renderReadinessDistribution, value.fixtureCount)}

## Strongest Render-Supporting Evidence Categories

${value.summary.strongestEvidenceCategories.map(item => `- **${item.category}**: ${item.count}`).join('\n') || '- No photo evidence categories were detected.'}

## Top Commercial Render Layers

${value.summary.topCommercialRenderLayers.map(item => `- **${item.value}**: recommended in ${item.count} fixture(s)`).join('\n') || '- No preview layers were enabled.'}

## Remaining Commercialization Blockers

${value.summary.topRenderBlockers.map(item => `- ${item.value} (${item.count})`).join('\n') || '- No recurring render blockers were found.'}

## Missing Photo Category Warnings

${value.summary.missingPhotoWarnings.map(item => `- ${item.value} (${item.count})`).join('\n') || '- No recurring missing-photo warnings were found.'}

## Safety Boundary

This report is render-assist and review-first only. It does not inspect image pixels, execute OpenCV/CV inference, generate authoritative CAD, mutate canonical geometry, run CAD solvers, write persistence, trigger permit engineering, or promote survey photos into source-of-truth geometry.`;
}

function ossMarkdown(value: typeof report) {
  return `# Lightweight Visual OSS Evaluation Report V1

## Evaluation Context

Survey Photo Render Intelligence V1 intentionally avoids broad CV adoption. The immediate commercial need is credible render and plan-set acceleration, so the most valuable OSS utilities are those that help display, annotate, validate, or package existing trusted geometry and photo references without claiming geometry authority.

## Most Promising OSS Utility Categories

1. **SVG/Canvas overlay composition utilities** appear most promising for near-term demo value because roof outlines, pitch/azimuth labels, MSP/meter markers, evidence callouts, and confidence notes can be rendered from existing DTOs without solver execution.
2. **EXIF and metadata parsers** are useful if uploads include camera timestamps, GPS, orientation, or operator-entered tags. They should feed deterministic confidence and sorting signals only, never automatic geometry extraction.
3. **Image dimension/probe utilities** can support layout quality checks such as aspect ratio, missing image dimensions, and file validity. These checks are safe because they do not infer roof geometry.
4. **PDF/SVG annotation libraries** are commercially valuable for permit-plan demos because they can package render overlays, evidence callouts, and readiness notes into review-first plan-set artifacts.
5. **Lightweight thumbnail/contact-sheet generation** can improve operator review throughput by grouping roof, electrical, obstruction, and unknown photos beside render readiness warnings.

## Deferred or Avoided OSS Areas

Heavy OpenCV pipelines, segmentation models, aerial imagery inference stacks, automatic obstruction detection, module placement optimizers, and conduit routers remain deferred. They could create false authority, credit drain, and commercial risk before the deterministic trust workflow is proven.

## Recommended Next OSS Experiments

- Prototype SVG overlay export from \`ProfessionalRenderRecommendationReportV1\` using existing roof plane polygons and layer recommendations.
- Add metadata probing for dimensions/timestamps/orientation where available, feeding only photo evidence confidence and review notes.
- Generate a review contact sheet that groups photos by \`SurveyPhotoEvidenceCategoryV1\` and shows missing category warnings.
- Package render readiness, layer recommendations, and evidence callouts into a static HTML/PDF demo artifact for contractor-facing review.

## Current Corpus Signals

Preview/demo-ready fixtures: **${value.summary.previewOrDemoReadyCount}/${value.fixtureCount}**. Average render confidence: **${value.summary.averageRenderConfidence}**. Top render layers were ${value.summary.topCommercialRenderLayers.slice(0, 5).map(item => `\`${item.value}\``).join(', ') || 'not enabled'}.`;
}

function roadmapMarkdown(value: typeof report) {
  return `# CAD / Render Enhancement Roadmap Update V1

## Phase Added

Survey Photo Render Intelligence V1 adds the first commercial render bridge on top of the geometry trust backbone. The platform can now classify survey photo references deterministically, evaluate render readiness, recommend professional render layers, and expose operator summaries in the professional survey readiness report.

## Immediate Commercial Value

The highest-value render layers are ${value.summary.topCommercialRenderLayers.slice(0, 6).map(item => `\`${item.value}\``).join(', ') || 'pending more photo coverage'}. These layers convert trusted survey geometry into visible contractor-facing proof: roof outlines, pitch/azimuth overlays, module preview eligibility, equipment markers, MSP/meter markers, evidence callouts, and render confidence notes.

## Next Build Sequence

1. Add a static SVG/HTML render preview DTO consumer that reads \`renderRecommendationReport\` and displays enabled layers with callouts.
2. Add photo contact-sheet grouping by evidence category and review status.
3. Add metadata probing for image dimensions, timestamps, orientation, and optional GPS when present.
4. Add a contractor-facing render readiness panel with blockers, missing categories, and confidence notes.
5. Add export packaging for review-first permit-plan/demo PDFs without solver execution or authority promotion.

## Blockers Before Professional CAD Render Commercialization

${value.summary.topRenderBlockers.map(item => `- ${item.value} (${item.count})`).join('\n') || '- Main blocker is now UI/render packaging rather than core trust DTO availability.'}

## Guardrails To Preserve

No automatic CAD generation from photos. No canonical geometry mutation. No CAD preview mutation. No CAD solver execution. No persistence side effects. No downstream engineering, permit, BOM, or approval triggers. Render readiness must remain an operator/commercial review signal, not an engineering authority signal.`;
}
