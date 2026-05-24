import { describe, expect, it } from 'vitest';

import type { SiteSurvey } from '@/lib/db/surveys';
import { enrichSurvey } from './enrichSurvey';
import { normalizeSurvey } from './normalizeSurvey';
import {
  buildCanonicalSurveyGeometry,
  buildSurveyCADReadiness,
  parseProfessionalSiteSurvey,
  type ProfessionalSurveyAuthorityFlagsV1,
} from './professionalSurveyParser';
import {
  professionalExpandedSurveyFixtures,
  type ProfessionalExpandedSurveyFixture,
} from './professionalSurveyExpandedFixtures';
import { buildProfessionalSurveyReadinessReport } from './professionalSurveyReadinessReport';

function expectNoAuthority(flags: ProfessionalSurveyAuthorityFlagsV1): void {
  expect(flags).toEqual({
    persistenceAllowed: false,
    solverExecutionAllowed: false,
    cadMutationAllowed: false,
    canonicalGeometryMutationAllowed: false,
    engineeringAuthorityAllowed: false,
    necAuthorityAllowed: false,
    bomAuthorityAllowed: false,
    permitAuthorityAllowed: false,
    downstreamAuthority: false,
  });
}

function expectIncludes(haystack: string[], expected: string[] | undefined): void {
  for (const needle of expected ?? []) {
    expect(haystack.join('\n')).toContain(needle);
  }
}

function surveyFromFixture(fixture: ProfessionalExpandedSurveyFixture): SiteSurvey {
  return {
    id: `survey-${fixture.id}`,
    clientId: 'expanded-fixture-client',
    projectId: fixture.raw.projectId ?? 'expanded-fixture-project',
    createdBy: 'expanded-fixture-user',
    createdAt: '2026-05-20T10:00:00Z',
    updatedAt: '2026-05-20T10:00:00Z',
    status: 'completed',
    source: 'standalone',
    addressSnapshot: fixture.raw.location?.address ?? null,
    surveyData: fixture.raw as unknown as Record<string, unknown>,
    inspectorName: fixture.raw.inspectorName ?? null,
    notes: fixture.raw.installerNotes ?? null,
    externalSurveyId: fixture.raw.id ?? fixture.id,
    deliveryId: null,
  };
}

describe('professional expanded survey fixtures', () => {
  it('covers every required messy real-world scenario exactly once', () => {
    expect(professionalExpandedSurveyFixtures.map(fixture => fixture.id)).toEqual([
      'clean_roof',
      'missing_roof_pitch',
      'missing_azimuth',
      'duplicate_roof_planes',
      'bad_self_intersecting_polygon',
      'obstruction_only_survey',
      'ground_mount_survey',
      'solar_fence_survey',
      'conflicting_panel_count',
      'wrong_mixed_units',
      'incomplete_electrical_service',
      'meter_location_present_msp_missing',
      'msp_present_utility_missing',
      'roof_geometry_no_usable_cad_preview',
      'document_derived_partial_evidence',
      'geometry_ready_without_cad_preview',
    ]);
  });

  it.each(professionalExpandedSurveyFixtures)('$id parser/readiness expectations remain deterministic and non-authoritative', fixture => {
    const rawBefore = JSON.stringify(fixture.raw);
    const normalized = normalizeSurvey(fixture.raw);
    const surveyInput = fixture.expected.normalizedOnly ? normalized : enrichSurvey(normalized);

    const bundle = parseProfessionalSiteSurvey(surveyInput);
    const geometry = buildCanonicalSurveyGeometry(surveyInput, bundle);
    const readiness = buildSurveyCADReadiness(surveyInput, bundle, geometry);

    const repeatedBundle = parseProfessionalSiteSurvey(surveyInput);
    const repeatedGeometry = buildCanonicalSurveyGeometry(surveyInput, repeatedBundle);
    const repeatedReadiness = buildSurveyCADReadiness(surveyInput, repeatedBundle, repeatedGeometry);

    expect(bundle.readinessStatus).toBe(fixture.expected.parserReadiness);
    expect(geometry.readyForCADInput).toBe(fixture.expected.canonicalGeometryReady);
    expect(readiness.cadInputPreview !== null).toBe(fixture.expected.cadPreviewBuilt);
    expect(readiness.readinessStatus).toBe(fixture.expected.parserReadiness);

    expect(bundle.bundleHash).toBe(repeatedBundle.bundleHash);
    expect(bundle.sourceHash).toBe(repeatedBundle.sourceHash);
    expect(geometry.geometryHash).toBe(repeatedGeometry.geometryHash);
    expect(readiness.readinessHash).toBe(repeatedReadiness.readinessHash);

    expectNoAuthority(bundle.authorityFlags);
    expectNoAuthority(geometry.authorityFlags);
    expectNoAuthority(readiness.authorityFlags);
    if (fixture.expected.parserReadiness === 'blocked') {
      expect(readiness.canBuildCADInput).toBe(false);
    } else if (fixture.expected.normalizedOnly) {
      expect(readiness.canBuildCADInput).toBe(false);
    } else {
      expect(readiness.canBuildCADInput).toBe(true);
    }

    expectIncludes(bundle.blockingIssues, fixture.expected.expectedBlockingIncludes);
    expectIncludes(geometry.blockingIssues, fixture.expected.expectedBlockingIncludes);
    expectIncludes(readiness.blockingIssues, fixture.expected.expectedBlockingIncludes);
    expectIncludes(bundle.missingRequiredFields, fixture.expected.expectedMissingIncludes);
    expectIncludes(readiness.requiredReviewItems, fixture.expected.expectedMissingIncludes);
    expectIncludes([...geometry.warnings, ...readiness.warnings], fixture.expected.expectedWarningIncludes);
    expectIncludes(bundle.electricalServiceCandidates.filter(candidate => candidate.confidence === 'low').map(candidate => candidate.field), fixture.expected.expectedConfidenceGapIncludes);

    expect(JSON.stringify(fixture.raw)).toBe(rawBefore);
  });

  it.each(professionalExpandedSurveyFixtures.filter(fixture => fixture.expected.reportReadiness))('$id operator report readiness matches endpoint service behavior', fixture => {
    const report = buildProfessionalSurveyReadinessReport(surveyFromFixture(fixture), []);
    const repeated = buildProfessionalSurveyReadinessReport(surveyFromFixture(fixture), []);

    expect(report.readinessState).toBe(fixture.expected.reportReadiness);
    expect(report.summaries.cadPreviewBuilt).toBe(fixture.expected.cadPreviewBuilt);
    expect(report.summaries.cadPreviewEligible).toBe(fixture.expected.reportReadiness === 'cad_preview_ready');
    expect(report.canonicalGeometry.readyForCADInput).toBe(fixture.expected.canonicalGeometryReady);
    expect(report.evidence.bundleHash).toBe(repeated.evidence.bundleHash);
    expect(report.canonicalGeometry.geometryHash).toBe(repeated.canonicalGeometry.geometryHash);
    expect(report.cadReadiness.readinessHash).toBe(repeated.cadReadiness.readinessHash);

    expect(report.noAuthorityEnforcement).toEqual({
      dbWritesAllowed: false,
      cadSolverExecutionAllowed: false,
      productionCADMutationAllowed: false,
      downstreamEngineeringAllowed: false,
      downstreamPermitAllowed: false,
      downstreamBOMAllowed: false,
    });
    expect(report.evidence.authorityFlags.persistenceAllowed).toBe(false);
    expect(report.evidence.authorityFlags.solverExecutionAllowed).toBe(false);
    expect(report.evidence.authorityFlags.cadMutationAllowed).toBe(false);
    expect(report.canonicalGeometry.authorityFlags.canonicalGeometryMutationAllowed).toBe(false);
    expect(report.cadReadiness.authorityFlags.downstreamAuthority).toBe(false);

    expectIncludes(report.summaries.blockingIssues, fixture.expected.expectedBlockingIncludes);
    expectIncludes(report.summaries.missingRequiredFields, fixture.expected.expectedMissingIncludes);
    expectIncludes(report.summaries.warnings, fixture.expected.expectedWarningIncludes);
    expectIncludes(report.summaries.confidenceGaps, fixture.expected.expectedConfidenceGapIncludes);
  });

  it('keeps geometry_ready_without_cad_preview at parser level without false cad_preview_ready promotion', () => {
    const fixture = professionalExpandedSurveyFixtures.find(item => item.id === 'geometry_ready_without_cad_preview');
    expect(fixture).toBeDefined();
    if (!fixture) return;

    const normalized = normalizeSurvey(fixture.raw);
    const bundle = parseProfessionalSiteSurvey(normalized);
    const geometry = buildCanonicalSurveyGeometry(normalized, bundle);
    const readiness = buildSurveyCADReadiness(normalized, bundle, geometry);

    expect(bundle.sourceKind).toBe('normalized_site_survey');
    expect(geometry.readyForCADInput).toBe(true);
    expect(readiness.cadInputPreview).toBeNull();
    expect(readiness.canBuildCADInput).toBe(false);
    expect(readiness.readinessStatus).toBe('review_required');
    expect(readiness.requiredReviewItems).toContain('EnrichedSiteSurvey required before CAD input preview can be built.');
  });

  it('preserves roof, ground, and fence classification in parser and CAD preview outputs', () => {
    const expectedPreviewTypes = new Map([
      ['clean_roof', 'roof'],
      ['ground_mount_survey', 'ground_mount'],
      ['solar_fence_survey', 'solar_fence'],
    ]);

    for (const fixture of professionalExpandedSurveyFixtures.filter(item => expectedPreviewTypes.has(item.id))) {
      const enriched = enrichSurvey(normalizeSurvey(fixture.raw));
      const bundle = parseProfessionalSiteSurvey(enriched);
      const geometry = buildCanonicalSurveyGeometry(enriched, bundle);
      const readiness = buildSurveyCADReadiness(enriched, bundle, geometry);

      expect(bundle.systemType).toBe(fixture.raw.systemType);
      expect(readiness.cadInputPreview?.systemType).toBe(expectedPreviewTypes.get(fixture.id));
    }
  });
});
