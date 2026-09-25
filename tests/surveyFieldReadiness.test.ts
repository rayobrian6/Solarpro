// ============================================================================
// Survey field readiness — "can the crew leave yet?"
//
// The engineering requirement registry (lib/survey/evidence/engineeringRequirements.ts)
// is the ONE authority for what engineering needs. Before this suite existed the
// registry was reachable only from an office page, so a crew could satisfy all
// five REQUIRED_PHOTO_CATEGORIES and drive away while `structural_access` was
// already flagged review_required.
//
// These tests pin the field-side delivery of that same engine:
//   - the verdict must be NOT ready when a review_required requirement is unmet,
//     and it must NAME the requirement;
//   - a requirement the field app cannot capture must render UNKNOWN, never
//     satisfied and never silently all-clear;
//   - the PhotoCategory -> SurveyEvidenceCategory mapping must be complete, and
//     its gaps must be reported rather than swallowed.
//
// Pure ASCII, no Unicode.
// ============================================================================

import { describe, it, expect } from 'vitest';

import {
  ALL_PHOTO_CATEGORIES,
  buildFieldPhotoCategoryMappings,
  buildFieldSurveyReadiness,
  FIELD_READINESS_ENGINE_SOURCE,
} from '../lib/survey/v2/fieldReadiness';
import { REQUIRED_PHOTO_CATEGORIES } from '../lib/survey/v2/types';
import type { PhotoCategory, SurveyPhoto } from '../lib/survey/v2/types';
import { ACTIVE_ENGINEERING_REQUIREMENT_DEFINITIONS } from '../lib/survey/evidence/engineeringRequirements';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function photo(category: PhotoCategory, index: number): SurveyPhoto {
  return {
    id: `photo-${category}-${index}`,
    category,
    tag: '',
    url: `https://blob.example/surveys/proj/survey-1/${category}/${index}.jpg`,
    uploadKey: `surveys/proj/survey-1/${category}/${index}.jpg`,
    capturedAt: `2026-09-25T1${index}:00:00.000Z`,
    gps: null,
  };
}

function allRequiredPhotos(): SurveyPhoto[] {
  return REQUIRED_PHOTO_CATEGORIES.map((category, index) => photo(category, index));
}

function readinessFor(photos: SurveyPhoto[]) {
  return buildFieldSurveyReadiness({
    surveyId: 'survey-1',
    projectId: 'proj',
    inspectorName: 'Field Tech',
    photos,
  });
}

// ---------------------------------------------------------------------------
// THE FAILING TEST THIS WORK EXISTS FOR
// ---------------------------------------------------------------------------
describe('field readiness — all required photos present is not the same as ready', () => {
  it('reports NOT ready and names structural_access when 5/5 required photos are captured', () => {
    const readiness = readinessFor(allRequiredPhotos());

    // The field app's own gate is satisfied ...
    expect(readiness.requiredPhotosComplete).toBe(true);
    expect(readiness.missingRequiredPhotoCategories).toEqual([]);

    // ... and the crew still must not leave.
    expect(readiness.readyToLeave).toBe(false);
    expect(readiness.readiness).toBe('needs_review');

    const outstanding = readiness.items.filter(
      item => item.band === 'review_required' && item.status !== 'satisfied',
    );
    const outstandingIds = outstanding.map(item => item.requirementId);
    expect(outstandingIds).toContain('structural_access');

    const structural = readiness.items.find(item => item.requirementId === 'structural_access');
    expect(structural).toBeDefined();
    expect(structural?.status).not.toBe('satisfied');
    expect(structural?.humanLabel).toBe('Structural Access');
    // The crew must be told WHERE to walk back to.
    expect(structural?.movementZone).toBe('attic_structural_area');
    expect(structural?.technicianInstruction ?? '').toContain('attic');

    expect(readiness.outstandingCounts.review_required).toBeGreaterThan(0);
    expect(readiness.outstandingCounts.blocking).toBe(0);
  });

  it('clears the review_required band once the attic access photo is captured', () => {
    const readiness = readinessFor([...allRequiredPhotos(), photo('attic_access', 9)]);

    expect(readiness.requiredPhotosComplete).toBe(true);
    expect(readiness.outstandingCounts.blocking).toBe(0);
    expect(readiness.outstandingCounts.review_required).toBe(0);
    expect(readiness.readiness).toBe('ready_for_engineering');
    expect(readiness.readyToLeave).toBe(true);

    const structural = readiness.items.find(item => item.requirementId === 'structural_access');
    expect(structural?.status).toBe('satisfied');
  });
});

// ---------------------------------------------------------------------------
// Blocking band
// ---------------------------------------------------------------------------
describe('field readiness — blocking requirements', () => {
  it('reports blocked with no photos at all, and never reports readyToLeave', () => {
    const readiness = readinessFor([]);

    expect(readiness.readiness).toBe('blocked');
    expect(readiness.readyToLeave).toBe(false);
    expect(readiness.requiredPhotosComplete).toBe(false);
    expect(readiness.missingRequiredPhotoCategories).toEqual([...REQUIRED_PHOTO_CATEGORIES]);

    const blockingOutstanding = readiness.items
      .filter(item => item.band === 'blocking' && item.status !== 'satisfied')
      .map(item => item.requirementId)
      .sort();
    expect(blockingOutstanding).toEqual(['main_service_panel', 'roof_overview', 'utility_meter']);
    expect(readiness.outstandingCounts.blocking).toBe(3);
  });

  it('a photo in a category that satisfies no requirement cannot clear a blocking band', () => {
    // 'additional' is the field app's catch-all slot. It maps to the
    // uncategorized bucket and must satisfy nothing.
    const readiness = readinessFor([photo('additional', 0), photo('additional', 1)]);

    expect(readiness.readiness).toBe('blocked');
    expect(readiness.readyToLeave).toBe(false);
    expect(readiness.outstandingCounts.blocking).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Mapping honesty — the silent-all-clear guard
// ---------------------------------------------------------------------------
describe('field readiness — mapping coverage is reported, never assumed', () => {
  it('maps every PhotoCategory through the evidence category alias table', () => {
    const mappings = buildFieldPhotoCategoryMappings();
    expect(mappings).toHaveLength(ALL_PHOTO_CATEGORIES.length);
    expect(mappings.map(m => m.photoCategory).sort()).toEqual([...ALL_PHOTO_CATEGORIES].sort());
    for (const mapping of mappings) {
      expect(mapping.mappingAuthority).toBe('survey_evidence_category_alias_table');
    }
  });

  it('pins the exact PhotoCategory -> SurveyEvidenceCategory resolution', () => {
    const byCategory = new Map(
      buildFieldPhotoCategoryMappings().map(m => [m.photoCategory, m.evidenceCategory]),
    );
    expect(byCategory.get('main_panel_open')).toBe('main_service_panel');
    expect(byCategory.get('main_panel_closed')).toBe('main_service_panel');
    expect(byCategory.get('meter')).toBe('meter');
    expect(byCategory.get('roof_overview')).toBe('roof_plane');
    expect(byCategory.get('roof_detail')).toBe('roof_surface');
    expect(byCategory.get('service_entrance')).toBe('utility_connection');
    expect(byCategory.get('attic_access')).toBe('attic_access');
    expect(byCategory.get('obstruction')).toBe('obstructions');
    expect(byCategory.get('additional')).toBe('uncategorized');
  });

  it('declares the one PhotoCategory that satisfies no requirement', () => {
    const unmapped = buildFieldPhotoCategoryMappings()
      .filter(m => m.mappingStatus === 'unmapped')
      .map(m => m.photoCategory);
    expect(unmapped).toEqual(['additional']);
  });

  it('names every active requirement the field app cannot capture, and renders them UNKNOWN', () => {
    const readiness = readinessFor(allRequiredPhotos());

    expect(readiness.coverage.uncapturableRequirementIds.sort()).toEqual([
      'battery_location',
      'main_disconnect',
      'subpanel',
    ]);

    for (const requirementId of readiness.coverage.uncapturableRequirementIds) {
      const item = readiness.items.find(entry => entry.requirementId === requirementId);
      expect(item, `expected an item for ${requirementId}`).toBeDefined();
      expect(item?.capturableInField).toBe(false);
      // A status a crew cannot determine must read UNKNOWN, never satisfied.
      expect(item?.status).toBe('unknown');
    }
  });

  it('never counts an UNKNOWN requirement as satisfied or as outstanding-clear', () => {
    const readiness = readinessFor(allRequiredPhotos());
    const unknowns = readiness.items.filter(item => item.status === 'unknown');
    expect(unknowns.length).toBeGreaterThan(0);
    for (const item of unknowns) {
      expect(item.capturableInField).toBe(false);
      expect(item.band).toBe('informational');
    }
    // Nothing in the blocking or review_required bands may be UNKNOWN: if it
    // were, readyToLeave would be an unanswerable question.
    const gatingUnknown = readiness.items.filter(
      item => item.status === 'unknown' && item.band !== 'informational',
    );
    expect(gatingUnknown).toEqual([]);

    // An UNKNOWN must still be COUNTED as outstanding in its band. Dropping it
    // from the count would print "Info 0" over three undetermined requirements.
    expect(readiness.outstandingCounts.informational).toBe(unknowns.length);
    expect(readiness.outstandingCounts.informational).toBe(3);
  });

  it('covers every active requirement in the registry — no requirement is dropped', () => {
    const readiness = readinessFor(allRequiredPhotos());
    const reported = readiness.items.map(item => item.requirementId).sort();
    const active = ACTIVE_ENGINEERING_REQUIREMENT_DEFINITIONS.map(def => def.requirementId).sort();
    expect(reported).toEqual(active);
    expect(readiness.engineSource).toBe(FIELD_READINESS_ENGINE_SOURCE);
  });
});

// ---------------------------------------------------------------------------
// The counts a crew acts on
// ---------------------------------------------------------------------------
describe('field readiness — the outstanding count is the leave-site instrument', () => {
  it('outstanding blocking + review_required reaches zero exactly when readyToLeave is true', () => {
    const cases: SurveyPhoto[][] = [
      [],
      [photo('meter', 0)],
      allRequiredPhotos(),
      [...allRequiredPhotos(), photo('roof_detail', 8)],
      [...allRequiredPhotos(), photo('attic_access', 9)],
    ];

    for (const photos of cases) {
      const readiness = readinessFor(photos);
      const gatingOutstanding =
        readiness.outstandingCounts.blocking + readiness.outstandingCounts.review_required;
      expect(readiness.readyToLeave).toBe(gatingOutstanding === 0 && readiness.requiredPhotosComplete);
    }
  });

  it('dropping one required photo moves exactly one blocking count from 0 to 1', () => {
    const complete = [...allRequiredPhotos(), photo('attic_access', 9)];
    expect(readinessFor(complete).outstandingCounts.blocking).toBe(0);

    const withoutMeter = complete.filter(p => p.category !== 'meter');
    const readiness = readinessFor(withoutMeter);
    expect(readiness.outstandingCounts.blocking).toBe(1);
    expect(readiness.readyToLeave).toBe(false);
    expect(
      readiness.items.find(item => item.requirementId === 'utility_meter')?.status,
    ).toBe('missing');
  });
});
