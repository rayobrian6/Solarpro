import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import sharp from 'sharp';

import type { SiteSurvey, SiteSurveyFile } from '@/lib/db/surveys';
import { buildProfessionalPlanSetRenderPackage } from '../lib/siteSurvey/planSetRenderOutput';
import { professionalExpandedSurveyFixtures } from '../lib/siteSurvey/professionalSurveyExpandedFixtures';
import { buildProfessionalSurveyReadinessReport } from '../lib/siteSurvey/professionalSurveyReadinessReport';

async function main() {
  const OUT = join(process.cwd(), 'outputs', 'professional-plan-set-render-v1');
  mkdirSync(OUT, { recursive: true });

  const selectedIds = ['clean_roof', 'ground_mount_survey', 'solar_fence_survey', 'document_derived_partial_evidence'] as const;
  const packages = await Promise.all(selectedIds.map(async id => {
    const fixture = professionalExpandedSurveyFixtures.find(item => item.id === id);
    if (!fixture) throw new Error(`Missing fixture ${id}`);
    const report = buildProfessionalSurveyReadinessReport(siteSurveyFromFixture(fixture), filesFromFixture(fixture));
    const pkg = buildProfessionalPlanSetRenderPackage(report);
    const dir = join(OUT, id);
    mkdirSync(dir, { recursive: true });
    for (const sheet of pkg.sheets) writeFileSync(join(dir, `${sheet.sheetNumber}-${sheet.sheetType}.svg`), sheet.svg);
    writeFileSync(join(dir, 'index.html'), pkg.htmlPreview);
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
    const previewAssets = await generatePreviewAssets(dir, pkg);
    writeFileSync(join(dir, 'preview-manifest.json'), `${JSON.stringify({ ...pkg.previewManifest, generatedAssets: previewAssets }, null, 2)}\n`);
    return { id, fixture, report, pkg, previewAssets };
  }));

  const indexHtml = `<!doctype html><html><head><meta charset="utf-8"><title>SolarPro Demo Plan-Set Render Package</title><style>body{font-family:Arial,sans-serif;background:#f1f5f9;margin:0;padding:32px}a{display:block;margin:10px 0;color:#1d4ed8}.card{background:#fff;border:1px solid #cbd5e1;border-radius:12px;padding:18px;margin:16px 0;max-width:980px}.asset{display:inline-block;margin-right:14px}</style></head><body><h1>SolarPro Professional Plan-Set Render Output V1</h1><p>Deterministic, non-authoritative, realistic SVG/PDF-ready preview package for contractor-facing demos.</p>${packages.map(item => `<div class="card"><h2>${item.id}</h2><p>State: <b>${item.pkg.summary.renderReadinessState}</b> · Confidence: <b>${item.pkg.summary.renderConfidenceScore}/100</b> · Quality: <b>${item.pkg.summary.renderQualityScore}/100</b> · Sheets: ${item.pkg.summary.sheetCount}</p><p><a class="asset" href="./${item.id}/index.html">Open multi-sheet preview</a><a class="asset" href="./${item.id}/package.pdf">Download PDF package</a><a class="asset" href="./${item.id}/contact-sheet.png">Open contact sheet</a><a class="asset" href="./${item.id}/preview-manifest.json">Preview manifest</a></p>${item.pkg.sheets.map(s => `<a href="./${item.id}/${s.sheetNumber}-${s.sheetType}.svg">${s.sheetNumber} ${s.title}</a>`).join('')}</div>`).join('')}</body></html>`;
  writeFileSync(join(OUT, 'index.html'), indexHtml);

  const summary = {
    schemaVersion: 'professional_plan_set_render_output_summary_v1',
    packageCount: packages.length,
    totalSheetCount: packages.reduce((sum, item) => sum + item.pkg.sheets.length, 0),
    renderedSheetTypes: Array.from(new Set(packages.flatMap(item => item.pkg.sheets.map(sheet => sheet.sheetType)))).sort(),
    packageHashes: packages.map(item => ({ fixtureId: item.id, packageHash: item.pkg.packageHash, state: item.pkg.summary.renderReadinessState, confidence: item.pkg.summary.renderConfidenceScore, renderQualityScore: item.pkg.summary.renderQualityScore, renderQualityGrade: item.pkg.summary.renderQualityGrade, pdfExported: item.previewAssets.pdfExported, thumbnailCount: item.previewAssets.thumbnailCount, snapshotCount: item.previewAssets.snapshotCount, contactSheetGenerated: item.previewAssets.contactSheetGenerated })),
    averageRenderQualityScore: Math.round(packages.reduce((sum, item) => sum + item.pkg.summary.renderQualityScore, 0) / packages.length),
    pdfExport: { stack: 'wkhtmltopdf from deterministic HTML/SVG composition; sharp for PNG thumbnails/snapshots/contact sheets', packagePdfCount: packages.filter(item => item.previewAssets.pdfExported).length, expectedPackagePdfCount: packages.length },
    previewAssets: { thumbnailCount: packages.reduce((sum, item) => sum + item.previewAssets.thumbnailCount, 0), snapshotCount: packages.reduce((sum, item) => sum + item.previewAssets.snapshotCount, 0), contactSheetCount: packages.filter(item => item.previewAssets.contactSheetGenerated).length, manifestCount: packages.length },
    renderQualityChecklistKeys: packages[0].pkg.summary.renderQualityChecklist.checks.map(check => check.key),
    visibleQualityImprovements: packages[0].pkg.summary.visibleQualityImprovements,
    contractorUsabilityImprovements: packages[0].pkg.summary.contractorUsabilityImprovements,
    noAuthorityEnforcement: packages[0].pkg.noAuthorityEnforcement,
  };
  writeFileSync(join(OUT, 'professional-plan-set-render-summary-v1.json'), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(OUT, 'commercial-render-quality-report-v1.md'), commercialReport(summary));
  writeFileSync(join(OUT, 'professional-cad-benchmark-gap-report-v1.md'), benchmarkGapReport(summary));
  writeFileSync(join(OUT, 'render-quality-checklist-report-v1.md'), qualityChecklistReport(summary));
  writeFileSync(join(OUT, 'export-render-validation-report-v1.md'), validationReport(summary));
  writeFileSync(join(OUT, 'visual-oss-leverage-report-v1.md'), ossReport());
  writeFileSync(join(OUT, 'professional-cad-roadmap-update-v1.md'), roadmapReport(summary));
  writeFileSync(join(OUT, 'realistic-site-context-export-readiness-v1.md'), realismExportReport(summary));

  console.log(JSON.stringify(summary, null, 2));

}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

async function generatePreviewAssets(dir: string, pkg: ReturnType<typeof buildProfessionalPlanSetRenderPackage>) {
  const thumbnailDir = join(dir, 'thumbnails');
  const snapshotDir = join(dir, 'snapshots');
  mkdirSync(thumbnailDir, { recursive: true });
  mkdirSync(snapshotDir, { recursive: true });
  const sheetCards: Buffer[] = [];
  for (const sheet of pkg.sheets) {
    const svgPath = join(dir, `${sheet.sheetNumber}-${sheet.sheetType}.svg`);
    const thumbPath = join(thumbnailDir, `${sheet.sheetNumber}-${sheet.sheetType}.png`);
    const snapPath = join(snapshotDir, `${sheet.sheetNumber}-${sheet.sheetType}.png`);
    await sharp(svgPath, { density: 96 }).resize({ width: 330 }).png().toFile(thumbPath);
    await sharp(svgPath, { density: 144 }).resize({ width: 990 }).png().toFile(snapPath);
    const thumbBase64 = (await sharp(thumbPath).png().toBuffer()).toString('base64');
    const cardSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="380" height="354"><rect x="0" y="0" width="380" height="354" rx="16" fill="#ffffff" stroke="#111827" stroke-width="1.4"/><rect x="14" y="14" width="352" height="270" fill="#f8fafc" stroke="#cbd5e1"/><image href="data:image/png;base64,${thumbBase64}" x="25" y="24" width="330"/><rect x="14" y="292" width="352" height="48" fill="#f3f4f6" stroke="#cbd5e1"/><text x="26" y="313" font-family="Arial" font-size="18" font-weight="800" fill="#111827">${sheet.sheetNumber}</text><text x="86" y="313" font-family="Arial" font-size="12" font-weight="700" fill="#334155">${sheet.title}</text><text x="26" y="333" font-family="Arial" font-size="10" font-weight="700" fill="#92400e">NON-AUTHORITATIVE COMMERCIAL PREVIEW</text></svg>`;
    sheetCards.push(await sharp(Buffer.from(cardSvg)).png().toBuffer());
  }
  const contactHeader = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="118"><rect width="1200" height="118" fill="#111827"/><text x="32" y="46" font-family="Arial" font-size="28" font-weight="900" fill="#ffffff">SolarPro Commercial Plan-Set Preview</text><text x="32" y="76" font-family="Arial" font-size="14" font-weight="700" fill="#d1d5db">A-101 flagship roof/site plan refinement · PDF-ready SVG sheets · deterministic preview-only package</text><text x="930" y="46" font-family="Arial" font-size="16" font-weight="900" fill="#fbbf24">QUALITY ${pkg.summary.renderQualityScore}/100</text><text x="930" y="74" font-family="Arial" font-size="12" font-weight="700" fill="#e5e7eb">${pkg.summary.renderQualityGrade}</text></svg>`);
  const contactFooter = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="56"><rect width="1200" height="56" fill="#f8fafc"/><line x1="32" y1="1" x2="1168" y2="1" stroke="#cbd5e1"/><text x="32" y="34" font-family="Arial" font-size="12" font-weight="700" fill="#475569">Preview-only render package. Not stamped engineering, not construction documents, no CAD solver execution, no geometry mutation.</text></svg>`);
  await sharp({ create: { width: 1200, height: 530, channels: 4, background: '#e5e7eb' } })
    .composite([
      { input: contactHeader, left: 0, top: 0 },
      ...sheetCards.map((input, index) => ({ input, left: 20 + index * 390, top: 130 })),
      { input: contactFooter, left: 0, top: 474 },
    ])
    .png()
    .toFile(join(dir, 'contact-sheet.png'));
  const pdfPath = join(dir, 'package.pdf');
  const pdfExported = exportPdf(join(dir, 'index.html'), pdfPath);
  return {
    schemaVersion: 'professional_plan_set_preview_assets_v1',
    pdfExported,
    pdfPath: 'package.pdf',
    thumbnailCount: pkg.sheets.length,
    snapshotCount: pkg.sheets.length,
    contactSheetGenerated: existsSync(join(dir, 'contact-sheet.png')),
    exportStack: 'wkhtmltopdf + deterministic HTML/SVG; sharp thumbnails/snapshots/contact sheet',
    noAuthorityEnforcement: pkg.noAuthorityEnforcement,
  };
}

function exportPdf(htmlPath: string, pdfPath: string) {
  try {
    execFileSync('wkhtmltopdf', ['--quiet', '--enable-local-file-access', '--page-size', 'Letter', '--orientation', 'Landscape', '--margin-top', '0', '--margin-right', '0', '--margin-bottom', '0', '--margin-left', '0', htmlPath, pdfPath], { stdio: 'pipe' });
    return existsSync(pdfPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeFileSync(`${pdfPath}.error.txt`, message);
    return false;
  }
}

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
- Realistic but diagrammatic site-context layer with lot boundary, street/access cue, driveway cue, neighboring structure silhouettes, and aerial-like grayscale texture.
- Flagship A-101 roof/site plan now carries stronger roof edge articulation, roof hatch, obstruction reference symbols, parcel hatch cues, rail/attachment indicators, professional true-north/scale graphics, and balanced bottom-table density.
- Roof plan viewport with line-weight hierarchy, roof outlines, setback previews, realistic module grouping, conduit candidates, equipment markers, richer legends, construction notes, revision/QA table, and annotation lists.
- Evidence/review sheets with photo evidence tiles, confidence notes, missing coverage visibility, and render-readiness callouts.
- Print-friendly HTML plus direct PDF packages, thumbnails, snapshots, contact sheets, and live-preview manifests.

## Commercial Impact

The output is now visibly contractor-facing rather than backend-only. It can support demos, marketplace trust, RE+ conversations, and partner/investor presentations while preserving non-authoritative boundaries.`;
}

function validationReport(summaryValue: typeof summary) {
  return `# Export / Render Validation Report V1

## Generated Artifacts

- Demo package index: \`outputs/professional-plan-set-render-v1/index.html\`
- Per-fixture SVG sheets and HTML previews for ${summaryValue.packageCount} fixtures.
- Per-fixture PDF packages: ${summaryValue.pdfExport.packagePdfCount}/${summaryValue.pdfExport.expectedPackagePdfCount} generated.
- Per-fixture preview manifests, thumbnails, snapshots, and contact sheets.
- Summary JSON with deterministic package hashes.

## Validation Assertions

- SVG/render export tests verify deterministic package hashes, professional sheet numbers, visual hierarchy, title blocks, legends, annotations, evidence tiles, review stamps, realism cues, preview manifests, and no-authority flags.
- Renderer consumes existing readiness/report DTOs only.
- Renderer does not mutate canonical geometry or CAD readiness objects.
- Renderer writes artifacts only through the explicit generation script; library functions perform no persistence.
- Direct PDF exports are generated from deterministic HTML/SVG packages using wkhtmltopdf with local-file access only.
- Thumbnail, snapshot, contact-sheet, and preview-manifest assets are generated for live-preview preparation.
- Outputs are PDF-ready vector/HTML compositions, not stamped engineering packages.

## Safety Boundary Verified

${Object.entries(summaryValue.noAuthorityEnforcement).map(([key, value]) => `- ${key}: ${value}`).join('\n')}`;
}

function realismExportReport(summaryValue: typeof summary) {
  return `# Realistic Site Context / Export Readiness Report V1

## Realism Upgrades

- A deterministic grayscale site-context layer adds lot/property boundary, street/access cue, driveway/access shape, neighboring structure silhouettes, and aerial-like texture.
- Site plan composition remains diagrammatic and preview-only; it does not extract authoritative parcel geometry or mutate canonical roof geometry.
- Module layout visuals now include aligned rows, orientation labels, group outlines, consistent spacing, string/group callouts, rail/attachment symbols, and A-101 note/table density.
- Roof plan realism now includes roof hatch, edge vertices, obstruction reference symbols, parcel hatch cues, and stronger true-north/scale presentation while remaining explicitly diagrammatic.

## PDF / Preview Export

- PDF stack: ${summaryValue.pdfExport.stack}.
- PDF packages generated: ${summaryValue.pdfExport.packagePdfCount}/${summaryValue.pdfExport.expectedPackagePdfCount}.
- Preview assets generated: ${summaryValue.previewAssets.thumbnailCount} thumbnails, ${summaryValue.previewAssets.snapshotCount} snapshots, ${summaryValue.previewAssets.contactSheetCount} contact sheets, ${summaryValue.previewAssets.manifestCount} manifests.

## Live Preview Readiness

The generated manifests define HTML, PDF, SVG sheet, thumbnail, snapshot, and contact-sheet access patterns. This prepares a lightweight future UI integration while intentionally leaving live Engineering UI wiring disabled.

## Remaining Public Preview Blockers

- Product approval of preview-only warning UX.
- Browser/download QA for PDFs and thumbnails.
- Final stakeholder acceptance of visual quality thresholds.
- Optional contractor/dealer branding and richer project metadata.

## Safety Boundary

${Object.entries(summaryValue.noAuthorityEnforcement).map(([key, value]) => `- ${key}: ${value}`).join('\n')}`;
}

function ossReport() {
  return `# Visual OSS Leverage Report V1

## Selected Approach

The first professional output engine intentionally uses native deterministic SVG string composition and print-ready HTML packaging. This provides immediate visual value with zero new dependency risk and minimal integration complexity.

## Existing OSS Utilities Considered

- \`wkhtmltopdf\`: selected for direct multi-sheet PDF export from deterministic HTML/SVG composition because no additional browser runtime was required in this environment.
- \`jspdf\`: available for future client-side or pure-JS PDF flows, but not selected here because HTML/SVG-to-PDF preserved the existing composition with less churn.
- \`puppeteer-core\`: available for a future controlled Chromium export adapter when a browser binary is guaranteed.
- \`sharp\`: used for deterministic PNG thumbnails, larger preview snapshots, and contact-sheet package previews.
- \`exif-reader\`: valuable for future metadata confidence scoring, not needed for SVG composition.

## Leverage Gained

Native SVG provided the strongest quality-per-credit leverage: export-safe vectors, precise line weights, title blocks, legends, annotations, and print CSS without adopting a heavy framework. The integration remains isolated and deterministic.

## Performance / Complexity

Performance impact is low for fixture-sized plan sets because rendering is string composition over existing DTOs, with explicit artifact generation confined to the generation script. Integration complexity remains low: one library module plus one generation script and focused tests.`;
}

function roadmapReport(summaryValue: typeof summary) {
  return `# Professional CAD Roadmap Update V1

## Completed This Phase

- Professional SVG sheet output engine.
- Reusable sheet composition primitives: title block, legend, viewport, review stamp, metric cards, evidence tiles, notes panels.
- Deterministic annotation engine for roof labels, pitch/azimuth labels, setback preview labels, conduit labels, equipment labels, render confidence notes, and review callouts.
- Realistic site-context composition and richer module layout preview treatment.
- Exportable SVG, print/PDF-ready HTML, direct PDF package generation, thumbnails, snapshots, contact sheets, and preview manifests.
- Visual OSS leverage assessment.

## Remaining Blockers Before Commercially Competitive Public Preview Quality

- Need production module/string layout data when available under explicit authority controls.
- Need real contractor branding/title-block customization and sheet index controls.
- Need final browser/download QA for generated PDFs and preview images.
- Need AHJ-specific plan notes only after engineering authority boundaries are intentionally designed.

## Next Highest-Leverage Step

Build a static preview UI route or downloadable artifact endpoint around the generated \`PlanSetRenderPackageV1\` and \`professional_plan_set_preview_manifest_v1\`; direct PDF export and preview asset generation now exist and should be QA-reviewed before public UI wiring. Current generated sheet types: ${summaryValue.renderedSheetTypes.join(', ')}.`;
}

function benchmarkGapReport(summaryValue: typeof summary) {
  return `# Professional CAD Benchmark Gap Report V1

## Benchmark Used

The uploaded sealed residential solar permit package was reviewed as a visual benchmark for sheet structure, title block treatment, drafting hierarchy, legends, roof/module readability, fire setback annotations, equipment callouts, and print/export credibility. The benchmark uses ANSI/letter plan-sheet conventions: strong borders, right-side title block rail, sheet index, system summary tables, dense but organized notes, clear legends, roof/module plan framing, scale/north references, and professional callout hierarchy.

## Gaps Found In V1 Output

- V1 looked more like a dashboard/report than a permit drawing because rounded metric cards, soft colors, and bottom title blocks dominated the sheets.
- Title block identity was present but not permit-like; it lacked a right-side rail, drawing metadata rows, and strong sheet-number hierarchy.
- Legend content was text-heavy and did not use graphic symbols matching the linework.
- Site plan callouts lacked professional leader-line hierarchy and did not clearly group module, setback, conduit, and equipment annotations.
- Evidence sheets used UI-style tiles instead of report-sheet evidence records.
- Print/export styling existed but did not yet express ANSI/permit drawing conventions strongly enough for live Engineering UI trust.

## Highest-Impact Improvements Applied

- CAD-style double border and right-side title block rail added to every sheet.
- Monochrome drafting hierarchy with controlled module, setback, conduit, and equipment accents.
- Deterministic grayscale site-context composition added for lot/property, access, driveway, neighboring structure, and aerial-like realism cues.
- Symbolized legend with matching roof/module/fire path/conduit/equipment/attachment symbols.
- Leader-line callouts for module preview zones, PV group/string callouts, and fire setback overlays.
- A-000 rebalanced into system summary, sheet index, render layer summary, trust indicators, and review notes.
- A-101 reworked as the flagship commercial sheet with roof edge articulation, hatch linework, obstruction symbols, parcel/access realism cues, professional true-north/scale graphics, rail/attachment symbols, equipment summary, construction notes, revision/QA table, and active render layer table.
- A-201 converted into evidence records plus evidence coverage and review/risk regions.
- Deterministic render quality checklist, direct PDF export, preview thumbnails/snapshots, contact sheets, and live-preview manifests added for visual QA only.

## Lowest-Cost Polish Wins Remaining

- Real brand/title-block customization per contractor or dealer.
- Better project/address/client metadata where survey fixtures provide it.
- Production module/string layout data when available, replacing deterministic preview modules.
- Public preview QA for PDF/download/browser behavior.

## Blockers To Public-Facing Professional Standard

The upgraded output is closer to commercial preview quality, but it is still not a stamped permit package. Remaining blockers before public-facing release are production-grade module/string placement when authoritative design data exists, AHJ-specific note libraries under explicit authority controls, branding/custom metadata, and product-approved preview-only warning UX. Live UI wiring should wait until product stakeholders accept the quality checklist threshold and preview warnings in the UI experience.

## Quality Result

Average deterministic render quality score: **${summaryValue.averageRenderQualityScore}/100**. Checklist keys: ${summaryValue.renderQualityChecklistKeys.join(', ')}.`;
}

function qualityChecklistReport(summaryValue: typeof summary) {
  return `# Render Quality Checklist Report V1

## Purpose

This checklist is visual quality assurance only. It does not promote engineering authority, does not stamp drawings, does not mutate canonical geometry, and does not trigger CAD solver, permit, BOM, or engineering workflows.

## Deterministic Checklist Areas

The scoring threshold is intentionally stricter than earlier package-existence checks. It now rewards drafting resemblance, composition balance, annotation density, legend professionalism, contractor trust, and export presentation readiness instead of merely counting sheets and metadata.

${summaryValue.renderQualityChecklistKeys.map(key => `- ${key}`).join('\n')}

## Demo Package Scores

${summaryValue.packageHashes.map(item => `- ${item.fixtureId}: ${item.renderQualityScore}/100 (${item.renderQualityGrade}) · state ${item.state} · confidence ${item.confidence}/100 · PDF ${item.pdfExported ? 'generated' : 'not generated'} · thumbnails ${item.thumbnailCount} · snapshots ${item.snapshotCount} · contact sheet ${item.contactSheetGenerated ? 'yes' : 'no'} · hash ${item.packageHash}`).join('\n')}

## UI Wiring Recommendation

The outputs are upgraded enough for internal live-preview preparation and stakeholder demo evaluation. They should not be wired into the live Engineering UI until direct PDF download behavior, preview-only warnings, and quality-score thresholds are product-approved. Current recommendation: **ready for lightweight internal preview route preparation; hold public/live Engineering UI wiring**.

## No-Authority Boundary

${Object.entries(summaryValue.noAuthorityEnforcement).map(([key, value]) => `- ${key}: ${value}`).join('\n')}`;
}
