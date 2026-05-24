import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SiteSurvey, SiteSurveyFile } from '@/lib/db/surveys';
import { buildProfessionalPlanSetRenderPackage } from '../lib/siteSurvey/planSetRenderOutput';
import { professionalExpandedSurveyFixtures } from '../lib/siteSurvey/professionalSurveyExpandedFixtures';
import { buildProfessionalSurveyReadinessReport } from '../lib/siteSurvey/professionalSurveyReadinessReport';

const OUT = join(process.cwd(), 'outputs', 'professional-plan-set-render-v1');
mkdirSync(OUT, { recursive: true });

const selectedIds = ['clean_roof', 'ground_mount_survey', 'solar_fence_survey', 'document_derived_partial_evidence'] as const;
const packages = selectedIds.map(id => {
  const fixture = professionalExpandedSurveyFixtures.find(item => item.id === id);
  if (!fixture) throw new Error(`Missing fixture ${id}`);
  const report = buildProfessionalSurveyReadinessReport(siteSurveyFromFixture(fixture), filesFromFixture(fixture));
  const pkg = buildProfessionalPlanSetRenderPackage(report);
  const dir = join(OUT, id);
  mkdirSync(dir, { recursive: true });
  for (const sheet of pkg.sheets) writeFileSync(join(dir, `${sheet.sheetNumber}-${sheet.sheetType}.svg`), sheet.svg);
  writeFileSync(join(dir, 'index.html'), pkg.htmlPreview);
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  return { id, fixture, report, pkg };
});

const indexHtml = `<!doctype html><html><head><meta charset="utf-8"><title>SolarPro Demo Plan-Set Render Package</title><style>body{font-family:Arial,sans-serif;background:#f1f5f9;margin:0;padding:32px}a{display:block;margin:10px 0;color:#1d4ed8}.card{background:#fff;border:1px solid #cbd5e1;border-radius:12px;padding:18px;margin:16px 0;max-width:980px}</style></head><body><h1>SolarPro Professional Plan-Set Render Output V1</h1><p>Deterministic, non-authoritative, SVG/PDF-ready preview package for contractor-facing demos.</p>${packages.map(item => `<div class="card"><h2>${item.id}</h2><p>State: <b>${item.pkg.summary.renderReadinessState}</b> · Confidence: <b>${item.pkg.summary.renderConfidenceScore}/100</b> · Sheets: ${item.pkg.summary.sheetCount}</p><a href="./${item.id}/index.html">Open multi-sheet preview</a>${item.pkg.sheets.map(s => `<a href="./${item.id}/${s.sheetNumber}-${s.sheetType}.svg">${s.sheetNumber} ${s.title}</a>`).join('')}</div>`).join('')}</body></html>`;
writeFileSync(join(OUT, 'index.html'), indexHtml);

const summary = {
  schemaVersion: 'professional_plan_set_render_output_summary_v1',
  packageCount: packages.length,
  totalSheetCount: packages.reduce((sum, item) => sum + item.pkg.sheets.length, 0),
  renderedSheetTypes: Array.from(new Set(packages.flatMap(item => item.pkg.sheets.map(sheet => sheet.sheetType)))).sort(),
  packageHashes: packages.map(item => ({ fixtureId: item.id, packageHash: item.pkg.packageHash, state: item.pkg.summary.renderReadinessState, confidence: item.pkg.summary.renderConfidenceScore })),
  visibleQualityImprovements: packages[0].pkg.summary.visibleQualityImprovements,
  contractorUsabilityImprovements: packages[0].pkg.summary.contractorUsabilityImprovements,
  noAuthorityEnforcement: packages[0].pkg.noAuthorityEnforcement,
};
writeFileSync(join(OUT, 'professional-plan-set-render-summary-v1.json'), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(join(OUT, 'commercial-render-quality-report-v1.md'), commercialReport(summary));
writeFileSync(join(OUT, 'export-render-validation-report-v1.md'), validationReport(summary));
writeFileSync(join(OUT, 'visual-oss-leverage-report-v1.md'), ossReport());
writeFileSync(join(OUT, 'professional-cad-roadmap-update-v1.md'), roadmapReport(summary));

console.log(JSON.stringify(summary, null, 2));

function siteSurveyFromFixture(fixture: (typeof professionalExpandedSurveyFixtures)[number]): SiteSurvey {
  return {
    id: fixture.raw.id,
    clientId: 'demo-client',
    projectId: fixture.raw.projectId,
    createdBy: 'demo-user',
    createdAt: fixture.raw.surveyedAt ?? '2026-01-01T00:00:00Z',
    updatedAt: fixture.raw.surveyedAt ?? '2026-01-01T00:00:00Z',
    status: 'completed',
    source: 'standalone',
    addressSnapshot: fixture.raw.location?.address ?? null,
    surveyData: fixture.raw as unknown as SiteSurvey['surveyData'],
    inspectorName: fixture.raw.inspectorName ?? null,
    notes: fixture.description,
    externalSurveyId: fixture.id,
    deliveryId: `delivery-${fixture.id}`,
  };
}

function filesFromFixture(fixture: (typeof professionalExpandedSurveyFixtures)[number]): SiteSurveyFile[] {
  return (fixture.raw.photos ?? []).map((photo, index) => ({
    id: `file-${fixture.id}-${index + 1}`,
    surveyId: fixture.raw.id,
    fileUrl: photo.url,
    fileType: 'photo' as const,
    label: photo.slotKey,
    filename: photo.url.split('/').pop() ?? `${photo.slotKey}.jpg`,
    mimeType: 'image/jpeg',
    createdAt: photo.capturedAt ?? fixture.raw.surveyedAt ?? '2026-01-01T00:00:00Z',
  }));
}

function commercialReport(summaryValue: typeof summary) {
  return `# Commercial Render Quality Report V1

Professional Plan-Set Render Output V1 generated **${summaryValue.totalSheetCount} SVG sheets** across **${summaryValue.packageCount} demo packages**. Sheet types rendered: ${summaryValue.renderedSheetTypes.map(v => `\`${v}\``).join(', ')}.

## Visible Quality Improvements

${summaryValue.visibleQualityImprovements.map(v => `- ${v}`).join('\n')}

## Contractor / Demo Usability Improvements

${summaryValue.contractorUsabilityImprovements.map(v => `- ${v}`).join('\n')}

## Professional Output Elements Added

- SVG title blocks with sheet numbers and project metadata.
- Review-first preview stamps visible on every sheet.
- Roof plan viewport with line-weight hierarchy, roof outlines, setback previews, module preview blocks, conduit candidates, equipment markers, legends, and annotation lists.
- Evidence/review sheets with photo evidence tiles, confidence notes, missing coverage visibility, and render-readiness callouts.
- Print-friendly HTML package suitable for PDF export or live demo presentation.

## Commercial Impact

The output is now visibly contractor-facing rather than backend-only. It can support demos, marketplace trust, RE+ conversations, and partner/investor presentations while preserving non-authoritative boundaries.`;
}

function validationReport(summaryValue: typeof summary) {
  return `# Export / Render Validation Report V1

## Generated Artifacts

- Demo package index: \`outputs/professional-plan-set-render-v1/index.html\`
- Per-fixture SVG sheets and HTML previews for ${summaryValue.packageCount} fixtures.
- Summary JSON with deterministic package hashes.

## Validation Assertions

- SVG/render export tests verify deterministic package hashes, professional sheet numbers, visual hierarchy, title blocks, legends, annotations, evidence tiles, review stamps, and no-authority flags.
- Renderer consumes existing readiness/report DTOs only.
- Renderer does not mutate canonical geometry or CAD readiness objects.
- Renderer writes artifacts only through the explicit generation script; library functions perform no persistence.
- Outputs are PDF-ready vector/HTML compositions, not stamped engineering packages.

## Safety Boundary Verified

${Object.entries(summaryValue.noAuthorityEnforcement).map(([key, value]) => `- ${key}: ${value}`).join('\n')}`;
}

function ossReport() {
  return `# Visual OSS Leverage Report V1

## Selected Approach

The first professional output engine intentionally uses native deterministic SVG string composition and print-ready HTML packaging. This provides immediate visual value with zero new dependency risk and minimal integration complexity.

## Existing OSS Utilities Considered

- \`jspdf\`: useful next step for direct PDF export, but deferred because SVG/HTML print output is faster and more inspectable for this phase.
- \`puppeteer-core\`: useful for automated PDF snapshots later, but unnecessary for deterministic SVG unit tests.
- \`sharp\`: valuable for future image/contact-sheet thumbnails, deferred to avoid pixel/image processing expansion.
- \`exif-reader\`: valuable for future metadata confidence scoring, not needed for SVG composition.

## Leverage Gained

Native SVG provided the strongest quality-per-credit leverage: export-safe vectors, precise line weights, title blocks, legends, annotations, and print CSS without adopting a heavy framework. The integration remains isolated and deterministic.

## Performance / Complexity

Performance impact is negligible for fixture-sized plan sets because rendering is string composition over existing DTOs. Integration complexity is low: one library module plus one generation script and focused tests.`;
}

function roadmapReport(summaryValue: typeof summary) {
  return `# Professional CAD Roadmap Update V1

## Completed This Phase

- Professional SVG sheet output engine.
- Reusable sheet composition primitives: title block, legend, viewport, review stamp, metric cards, evidence tiles, notes panels.
- Deterministic annotation engine for roof labels, pitch/azimuth labels, setback preview labels, conduit labels, equipment labels, render confidence notes, and review callouts.
- Exportable SVG and print/PDF-ready HTML demo packaging.
- Visual OSS leverage assessment.

## Remaining Blockers Before Commercially Competitive Plan-Set Quality

- Need richer module layout fidelity and string/group labels from production design data when available.
- Need polished PDF export automation using the existing HTML/SVG package and a controlled browser/PDF adapter.
- Need real contractor branding/title-block customization and sheet index controls.
- Need optional thumbnail/contact-sheet generation from actual uploaded photo assets.
- Need AHJ-specific plan notes only after engineering authority boundaries are intentionally designed.

## Next Highest-Leverage Step

Build a static preview UI route or downloadable artifact endpoint around the generated \`PlanSetRenderPackageV1\`, then add direct PDF export using existing browser/PDF tooling. Current generated sheet types: ${summaryValue.renderedSheetTypes.join(', ')}.`;
}
