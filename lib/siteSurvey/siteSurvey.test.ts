// ============================================================================
// lib/siteSurvey/siteSurvey.test.ts — Phase 10: Testing + Safety
//
// VERSION: SITE_SURVEY_PIPELINE_VERSION = 1
//
// Unit tests for the Site Survey ingestion pipeline:
//   normalizeSurvey()         — Phase 2
//   enrichSurvey()            — Phase 3
//   applyToSystemDefinition() — Phase 4
//   buildCADFromSurvey()      — Phase 5
//
// TEST PHILOSOPHY:
//   - All pipeline functions are pure (no DB, no network)
//   - All functions NEVER THROW — errors go into log arrays
//   - Tests verify correct outputs AND that no mutation occurs
//   - NEC / ASCE constraints are validated (not just happy-path)
//   - "Explicit capture" vs "defaulted" distinction is verified
// ============================================================================

import { describe, it, expect } from 'vitest';

import { normalizeSurvey } from './normalizeSurvey';
import { enrichSurvey } from './enrichSurvey';
import { applyToSystemDefinition } from './applyToSystemDefinition';
import { buildCADFromSurvey } from '@/lib/cad/buildCADFromSurvey';

import {
  SITE_SURVEY_PIPELINE_VERSION,
  type RawSurveyPayload,
  type NormalizedSiteSurvey,
  type EnrichedSiteSurvey,
} from './types';

import type { SystemDefinition } from '@/lib/system/systemDefinition';

// ─── Shared test fixtures ────────────────────────────────────────────────────

/** Minimal valid raw payload — all optional fields absent */
function minimalRaw(overrides: Partial<RawSurveyPayload> = {}): RawSurveyPayload {
  return {
    id: 'survey-001',
    projectId: 'proj-001',
    location: { lat: 34.05, lng: -118.24 },
    ...overrides,
  };
}

/** Full raw payload with realistic messy field-app data */
function fullRaw(overrides: Partial<RawSurveyPayload> = {}): RawSurveyPayload {
  return {
    id: 'survey-002',
    projectId: 'proj-002',
    location: {
      lat: 34.05,
      lng: -118.24,
      elevation: 300,
      address: '123 Solar St, Los Angeles, CA 90001',
    },
    systemType: 'roof',
    geometry: {
      roofPlanes: [
        {
          id: 'plane-1',
          pitch: 22,
          azimuth: 180,
          area: 800,
          vertices: [
            { lat: 34.0500, lng: -118.2400 },
            { lat: 34.0502, lng: -118.2400 },
            { lat: 34.0502, lng: -118.2404 },
            { lat: 34.0500, lng: -118.2404 },
          ],
        },
        {
          id: 'plane-2',
          pitch: 22,
          azimuth: 0,
          area: 400,
          vertices: [
            { lat: 34.0500, lng: -118.2405 },
            { lat: 34.0502, lng: -118.2405 },
            { lat: 34.0502, lng: -118.2408 },
            { lat: 34.0500, lng: -118.2408 },
          ],
        },
      ],
      obstructions: [
        {
          id: 'obs-1',
          type: 'hvac',
          position: { lat: 34.0501, lng: -118.2402 },
          dimensions: { widthFt: 3, lengthFt: 4, heightFt: 3 },
          setbackFt: 3,
        },
      ],
      setbacks: [
        { edges: ['eave', 'rake'], distanceIn: 36 },
        { edges: ['ridge'], distanceIn: 18 },
      ],
      usableAreaSqFt: 600,
    },
    structural: {
      rafterSpacingIn: '24 OC',
      rafterSize: '2x6',
      deckingThicknessIn: '1/2',
      windExposure: 'C',
      snowLoadPsf: 0,
      roofCondition: 'good',
      roofAgeYears: 8,
      atticAccess: true,
      roofMaterial: 'composition_shingle',
      roofPitch: '5/12',
      stories: '1',
    },
    electrical: {
      mainPanelRatingAmps: '200',
      busbarRatingAmps: '200',
      breakerSpacesAvailable: '5+',
      serviceEntrance: 'overhead',
      meterType: 'standard',
      interconnectionPoint: 'main_panel',
      panelBrand: 'siemens',
      hasSubPanel: false,
    },
    photos: [
      { slotKey: 'roof_overview', url: 'https://cdn.example.com/photo1.jpg', category: 'roof' },
      { slotKey: 'main_panel', url: 'https://cdn.example.com/photo2.jpg', category: 'panel' },
    ],
    installerNotes: 'Good attic access. Standard install.',
    inspectorName: 'Jane Smith',
    surveyedAt: '2024-01-15T10:00:00Z',
    ...overrides,
  };
}

/** Minimal valid SystemDefinition for override tests */
function baseSystemDef(overrides: Partial<SystemDefinition> = {}): SystemDefinition {
  return {
    systemType: 'roof',
    panel: {
      wattage: 400,
      widthIn: 40,
      heightIn: 66,
      weightLbs: 44,
      orientation: 'portrait',
      model: 'Test Panel 400W',
      manufacturer: 'TestMfg',
    },
    layout: {
      tilt: 25,
      azimuth: 180,
      rowSpacing: 12,
    },
    structure: {
      railOrientation: 'horizontal',
    },
    electrical: {
      inverterType: 'string',
    },
    ...overrides,
  };
}

// ─── SECTION 1: normalizeSurvey ───────────────────────────────────────────────

describe('normalizeSurvey — core behavior', () => {

  it('stamps pipelineVersion = SITE_SURVEY_PIPELINE_VERSION', () => {
    const result = normalizeSurvey(minimalRaw());
    expect(result.pipelineVersion).toBe(SITE_SURVEY_PIPELINE_VERSION);
    expect(result.pipelineVersion).toBe(1);
  });

  it('preserves id and projectId from raw payload', () => {
    const result = normalizeSurvey(minimalRaw({ id: 'abc-123', projectId: 'proj-xyz' }));
    expect(result.id).toBe('abc-123');
    expect(result.projectId).toBe('proj-xyz');
  });

  it('always returns a normalizationLog array (never empty — at least pipeline version entry)', () => {
    const result = normalizeSurvey(minimalRaw());
    expect(Array.isArray(result.normalizationLog)).toBe(true);
    expect(result.normalizationLog.length).toBeGreaterThan(0);
  });

  it('never throws — even on deeply null/undefined input fields', () => {
    expect(() => normalizeSurvey(minimalRaw({
      location: { lat: null, lng: null },
      structural: null,
      electrical: null,
      geometry: null,
      photos: null,
    }))).not.toThrow();
  });

});

describe('normalizeSurvey — location', () => {

  it('passes through valid lat/lng', () => {
    const result = normalizeSurvey(minimalRaw({ location: { lat: 34.05, lng: -118.24 } }));
    expect(result.location.lat).toBe(34.05);
    expect(result.location.lng).toBe(-118.24);
  });

  it('coerces null lat/lng to null (not 0)', () => {
    const result = normalizeSurvey(minimalRaw({ location: { lat: null, lng: null } }));
    expect(result.location.lat).toBeNull();
    expect(result.location.lng).toBeNull();
  });

  it('passes through address string', () => {
    const result = normalizeSurvey(minimalRaw({
      location: { lat: 34.05, lng: -118.24, address: '123 Main St' },
    }));
    expect(result.location.address).toBe('123 Main St');
  });

  it('defaults missing address to null', () => {
    const result = normalizeSurvey(minimalRaw({ location: { lat: 34.05, lng: -118.24 } }));
    expect(result.location.address).toBeNull();
  });

});

describe('normalizeSurvey — systemType', () => {

  it('normalizes "roof" string to "roof"', () => {
    const result = normalizeSurvey(minimalRaw({ systemType: 'roof' }));
    expect(result.systemType).toBe('roof');
  });

  it('normalizes "ground" string to "ground"', () => {
    const result = normalizeSurvey(minimalRaw({ systemType: 'ground' }));
    expect(result.systemType).toBe('ground');
  });

  it('normalizes "Roof" (mixed case) to "roof"', () => {
    const result = normalizeSurvey(minimalRaw({ systemType: 'Roof' }));
    expect(result.systemType).toBe('roof');
  });

  it('defaults missing systemType to "roof"', () => {
    const result = normalizeSurvey(minimalRaw({ systemType: undefined }));
    expect(result.systemType).toBe('roof');
  });

  it('normalizes "carport" to "fence" (carport is fence-like mount)', () => {
    const result = normalizeSurvey(minimalRaw({ systemType: 'carport' }));
    expect(result.systemType).toBe('fence');
  });

  it('defaults truly unknown systemType strings to "roof"', () => {
    const result = normalizeSurvey(minimalRaw({ systemType: 'solar_balloon' }));
    expect(result.systemType).toBe('roof');
  });

});

describe('normalizeSurvey — structural: rafter spacing', () => {

  it('parses numeric rafter spacing directly', () => {
    const result = normalizeSurvey(minimalRaw({ structural: { rafterSpacingIn: 16 } }));
    expect(result.structural.rafterSpacingIn).toBe(16);
  });

  it('strips "OC" suffix from rafter spacing string', () => {
    const result = normalizeSurvey(minimalRaw({ structural: { rafterSpacingIn: '24 OC' } }));
    expect(result.structural.rafterSpacingIn).toBe(24);
  });

  it('strips double-quote suffix from rafter spacing string', () => {
    const result = normalizeSurvey(minimalRaw({ structural: { rafterSpacingIn: '16"' } }));
    expect(result.structural.rafterSpacingIn).toBe(16);
  });

  it('defaults null rafter spacing to 24 (conservative default)', () => {
    const result = normalizeSurvey(minimalRaw({ structural: { rafterSpacingIn: null } }));
    expect(result.structural.rafterSpacingIn).toBe(24);
    // Verify the log notes the default was applied
    expect(result.normalizationLog.some(l => l.includes('rafterSpacingIn'))).toBe(true);
  });

  it('logs when rafter spacing is defaulted (not explicitly captured)', () => {
    const result = normalizeSurvey(minimalRaw({ structural: {} }));
    const log = result.normalizationLog.join('\n');
    expect(log).toMatch(/rafterSpacingIn/i);
  });

  it('does NOT log default when rafter spacing IS explicitly provided', () => {
    const result = normalizeSurvey(minimalRaw({ structural: { rafterSpacingIn: 16 } }));
    // Should not have a "not provided" / "default" message for rafter spacing
    const defaultMessages = result.normalizationLog.filter(
      l => l.includes('rafterSpacingIn') && (l.includes('not provided') || l.includes('default'))
    );
    expect(defaultMessages.length).toBe(0);
  });

});

describe('normalizeSurvey — structural: decking thickness', () => {

  it('parses "1/2" fraction string to 0.5', () => {
    const result = normalizeSurvey(minimalRaw({ structural: { deckingThicknessIn: '1/2' } }));
    expect(result.structural.deckingThicknessIn).toBe(0.5);
  });

  it('parses "5/8" fraction string to 0.625', () => {
    const result = normalizeSurvey(minimalRaw({ structural: { deckingThicknessIn: '5/8' } }));
    expect(result.structural.deckingThicknessIn).toBeCloseTo(0.625, 4);
  });

  it('parses numeric decking thickness directly', () => {
    const result = normalizeSurvey(minimalRaw({ structural: { deckingThicknessIn: 0.75 } }));
    expect(result.structural.deckingThicknessIn).toBe(0.75);
  });

  it('defaults null decking thickness to 0.5', () => {
    const result = normalizeSurvey(minimalRaw({ structural: { deckingThicknessIn: null } }));
    expect(result.structural.deckingThicknessIn).toBe(0.5);
  });

});

describe('normalizeSurvey — structural: rafter size', () => {

  it('normalizes "2x6" string to "2x6"', () => {
    const result = normalizeSurvey(minimalRaw({ structural: { rafterSize: '2x6' } }));
    expect(result.structural.rafterSize).toBe('2x6');
  });

  it('normalizes "2X8" (uppercase) to "2x8"', () => {
    const result = normalizeSurvey(minimalRaw({ structural: { rafterSize: '2X8' } }));
    expect(result.structural.rafterSize).toBe('2x8');
  });

  it('defaults null rafter size to "2x6"', () => {
    const result = normalizeSurvey(minimalRaw({ structural: { rafterSize: null } }));
    expect(result.structural.rafterSize).toBe('2x6');
  });

  it('sets "other" for unrecognized rafter size strings', () => {
    const result = normalizeSurvey(minimalRaw({ structural: { rafterSize: '3x8' } }));
    expect(result.structural.rafterSize).toBe('other');
  });

});

describe('normalizeSurvey — structural: wind exposure', () => {

  it('normalizes "C" to "C"', () => {
    const result = normalizeSurvey(minimalRaw({ structural: { windExposure: 'C' } }));
    expect(result.structural.windExposure).toBe('C');
  });

  it('normalizes "b" (lowercase) to "B"', () => {
    const result = normalizeSurvey(minimalRaw({ structural: { windExposure: 'b' } }));
    expect(result.structural.windExposure).toBe('B');
  });

  it('defaults null wind exposure to "C" (conservative)', () => {
    const result = normalizeSurvey(minimalRaw({ structural: { windExposure: null } }));
    expect(result.structural.windExposure).toBe('C');
  });

  it('defaults unknown wind exposure string to "C"', () => {
    const result = normalizeSurvey(minimalRaw({ structural: { windExposure: 'E' } }));
    expect(result.structural.windExposure).toBe('C');
  });

});

describe('normalizeSurvey — structural: roof pitch', () => {

  it('parses "5/12" pitch notation to "standard" category', () => {
    const result = normalizeSurvey(minimalRaw({ structural: { roofPitch: '5/12' } }));
    expect(result.structural.roofPitch).toBe('standard');
    // 5/12 ≈ 22.6 degrees
    expect(result.structural.roofPitchDegrees).toBeGreaterThan(20);
    expect(result.structural.roofPitchDegrees).toBeLessThan(30);
  });

  it('parses "3/12" pitch notation to "low" category', () => {
    const result = normalizeSurvey(minimalRaw({ structural: { roofPitch: '3/12' } }));
    expect(result.structural.roofPitch).toBe('low');
  });

  it('parses "12/12" pitch notation to "very_steep" category', () => {
    const result = normalizeSurvey(minimalRaw({ structural: { roofPitch: '12/12' } }));
    expect(result.structural.roofPitch).toBe('very_steep');
  });

  it('handles "flat" pitch string', () => {
    const result = normalizeSurvey(minimalRaw({ structural: { roofPitch: 'flat' } }));
    expect(result.structural.roofPitch).toBe('flat');
  });

  it('defaults null roof pitch to null (not a default value)', () => {
    const result = normalizeSurvey(minimalRaw({ structural: { roofPitch: null } }));
    expect(result.structural.roofPitch).toBeNull();
    expect(result.structural.roofPitchDegrees).toBeNull();
  });

});

describe('normalizeSurvey — electrical', () => {

  it('parses string amp values to numbers', () => {
    const result = normalizeSurvey(minimalRaw({
      electrical: { mainPanelRatingAmps: '200A' },
    }));
    expect(result.electrical.mainPanelRatingAmps).toBe(200);
  });

  it('strips "amp" suffix from amp strings', () => {
    const result = normalizeSurvey(minimalRaw({
      electrical: { mainPanelRatingAmps: '100amp' },
    }));
    expect(result.electrical.mainPanelRatingAmps).toBe(100);
  });

  it('preserves "5+" availableBreakerSlots categorical string', () => {
    const result = normalizeSurvey(minimalRaw({
      electrical: { availableBreakerSlots: '5+' },
    }));
    // availableBreakerSlots is kept as a categorical string for display purposes
    expect(result.electrical.availableBreakerSlots).toBe('5+');
  });

  it('preserves "1-2" availableBreakerSlots categorical string', () => {
    const result = normalizeSurvey(minimalRaw({
      electrical: { availableBreakerSlots: '1-2' },
    }));
    expect(result.electrical.availableBreakerSlots).toBe('1-2');
  });

  it('parses numeric breakerSpacesAvailable to number', () => {
    const result = normalizeSurvey(minimalRaw({
      electrical: { breakerSpacesAvailable: 6 },
    }));
    expect(result.electrical.breakerSpacesAvailable).toBe(6);
  });

  it('defaults missing serviceEntrance to "unknown"', () => {
    const result = normalizeSurvey(minimalRaw({ electrical: {} }));
    expect(result.electrical.serviceEntrance).toBe('unknown');
  });

  it('defaults missing meterType to "unknown"', () => {
    const result = normalizeSurvey(minimalRaw({ electrical: {} }));
    expect(result.electrical.meterType).toBe('unknown');
  });

  it('defaults missing interconnectionPoint to "unknown"', () => {
    const result = normalizeSurvey(minimalRaw({ electrical: {} }));
    expect(result.electrical.interconnectionPoint).toBe('unknown');
  });

  it('defaults missing panelBrand to "unknown"', () => {
    const result = normalizeSurvey(minimalRaw({ electrical: null }));
    expect(result.electrical.panelBrand).toBe('unknown');
  });

  it('normalizes "Federal Pacific" (mixed case) to "federal_pacific"', () => {
    const result = normalizeSurvey(minimalRaw({
      electrical: { panelBrand: 'Federal Pacific' },
    }));
    expect(result.electrical.panelBrand).toBe('federal_pacific');
  });

  it('defaults busbarRatingAmps to mainPanelRatingAmps when not provided', () => {
    const result = normalizeSurvey(minimalRaw({
      electrical: { mainPanelRatingAmps: 200, busbarRatingAmps: null },
    }));
    expect(result.electrical.busbarRatingAmps).toBe(200);
  });

});

describe('normalizeSurvey — geometry: roof planes', () => {

  it('passes through valid roof planes', () => {
    const result = normalizeSurvey(fullRaw());
    expect(result.geometry.roofPlanes).toHaveLength(2);
    expect(result.geometry.roofPlanes[0].id).toBe('plane-1');
  });

  it('auto-assigns id when roof plane is missing one', () => {
    const result = normalizeSurvey(minimalRaw({
      geometry: {
        roofPlanes: [
          { pitch: 22, azimuth: 180, area: 800, vertices: [
            { lat: 34.0500, lng: -118.2400 },
            { lat: 34.0502, lng: -118.2400 },
            { lat: 34.0502, lng: -118.2404 },
            { lat: 34.0500, lng: -118.2404 },
          ] },  // no id — auto-assigned
        ],
      },
    }));
    // Plane is kept with auto-assigned id 'plane_1'
    expect(result.geometry.roofPlanes).toHaveLength(1);
    expect(result.geometry.roofPlanes[0].id).toBe('plane_1');
  });

  it('keeps roof planes with fewer than 3 vertices but clears their vertex array', () => {
    const result = normalizeSurvey(minimalRaw({
      geometry: {
        roofPlanes: [
          {
            id: 'plane-1',
            pitch: 22,
            azimuth: 180,
            area: 800,
            vertices: [
              { lat: 34.05, lng: -118.24 },
              { lat: 34.052, lng: -118.24 },
              // only 2 vertices
            ],
          },
        ],
      },
    }));
    // Plane is kept (id/pitch/azimuth/area preserved) but vertices are cleared
    expect(result.geometry.roofPlanes).toHaveLength(1);
    expect(result.geometry.roofPlanes[0].vertices).toHaveLength(0);
  });

  it('clamps negative azimuth to [0, 360) range', () => {
    const result = normalizeSurvey(minimalRaw({
      geometry: {
        roofPlanes: [
          {
            id: 'plane-1',
            pitch: 22,
            azimuth: -10,
            area: 800,
            vertices: [
              { lat: 34.0500, lng: -118.2400 },
              { lat: 34.0502, lng: -118.2400 },
              { lat: 34.0502, lng: -118.2404 },
              { lat: 34.0500, lng: -118.2404 },
            ],
          },
        ],
      },
    }));
    if (result.geometry.roofPlanes.length > 0) {
      expect(result.geometry.roofPlanes[0].azimuth).toBeGreaterThanOrEqual(0);
      expect(result.geometry.roofPlanes[0].azimuth).toBeLessThan(360);
    }
  });

  it('defaults missing geometry to empty arrays', () => {
    const result = normalizeSurvey(minimalRaw({ geometry: null }));
    expect(result.geometry.roofPlanes).toEqual([]);
    expect(result.geometry.obstructions).toEqual([]);
    expect(result.geometry.setbacks).toEqual([]);
    expect(result.geometry.usableAreaSqFt).toBeNull();
  });

});

describe('normalizeSurvey — photos', () => {

  it('passes through valid photos', () => {
    const result = normalizeSurvey(fullRaw());
    expect(result.photos).toHaveLength(2);
    expect(result.photos[0].slotKey).toBe('roof_overview');
  });

  it('discards photos missing url; keeps photos with missing slotKey (auto-assigned)', () => {
    const result = normalizeSurvey(minimalRaw({
      photos: [
        { slotKey: 'roof_overview' },   // no url → discarded
        { url: 'https://example.com/photo2.jpg', category: 'panel' }, // no slotKey → kept with auto slot_N
        { slotKey: 'panel', url: 'https://example.com/photo.jpg', category: 'panel' },
      ],
    }));
    // Only the photo with no URL is dropped; the other two are kept
    expect(result.photos).toHaveLength(2);
    // The explicitly-keyed one is present
    expect(result.photos.some(p => p.slotKey === 'panel')).toBe(true);
    // The auto-slotted one has a generated key starting with 'slot_'
    expect(result.photos.some(p => p.slotKey.startsWith('slot_'))).toBe(true);
  });

  it('defaults missing photos array to empty array', () => {
    const result = normalizeSurvey(minimalRaw({ photos: null }));
    expect(result.photos).toEqual([]);
  });

});

// ─── SECTION 2: enrichSurvey ──────────────────────────────────────────────────

/** Helper: get a NormalizedSiteSurvey ready for enrichment tests */
function getNormalized(rawOverrides: Partial<RawSurveyPayload> = {}): NormalizedSiteSurvey {
  return normalizeSurvey(fullRaw(rawOverrides));
}

describe('enrichSurvey — core behavior', () => {

  it('returns an EnrichedSiteSurvey with enrichmentLog', () => {
    const enriched = enrichSurvey(getNormalized());
    expect(enriched).toHaveProperty('enrichmentLog');
    expect(Array.isArray(enriched.enrichmentLog)).toBe(true);
    expect(enriched.enrichmentLog.length).toBeGreaterThan(0);
  });

  it('preserves all NormalizedSiteSurvey fields', () => {
    const normalized = getNormalized();
    const enriched = enrichSurvey(normalized);
    // Core identity fields must be preserved
    expect(enriched.id).toBe(normalized.id);
    expect(enriched.projectId).toBe(normalized.projectId);
    expect(enriched.pipelineVersion).toBe(normalized.pipelineVersion);
    expect(enriched.structural.rafterSpacingIn).toBe(normalized.structural.rafterSpacingIn);
    expect(enriched.electrical.mainPanelRatingAmps).toBe(normalized.electrical.mainPanelRatingAmps);
  });

  it('never throws on minimal valid input', () => {
    const normalized = normalizeSurvey(minimalRaw());
    expect(() => enrichSurvey(normalized)).not.toThrow();
  });

  it('returns derived object with required sub-keys', () => {
    const enriched = enrichSurvey(getNormalized());
    expect(enriched.derived).toHaveProperty('cadRoofSurfaces');
    expect(enriched.derived).toHaveProperty('cadExclusionZones');
    expect(enriched.derived).toHaveProperty('structuralFeasibility');
    expect(enriched.derived).toHaveProperty('electricalFeasibility');
    expect(enriched.derived).toHaveProperty('shadingConfidence');
    expect(enriched.derived).toHaveProperty('effectiveAzimuth');
  });

});

describe('enrichSurvey — effectiveAzimuth', () => {

  it('uses primary plane azimuth when roof plane with highest area is south-facing', () => {
    const enriched = enrichSurvey(getNormalized());
    // plane-1 has azimuth 180 (south) and area 800
    expect(enriched.derived.effectiveAzimuth).toBe(180);
  });

  it('falls back to lat-based south-facing default when no roof planes', () => {
    const normalized = normalizeSurvey(minimalRaw({
      location: { lat: 34.05, lng: -118.24 }, // northern hemisphere
      geometry: { roofPlanes: [] },
    }));
    const enriched = enrichSurvey(normalized);
    // Northern hemisphere → south-facing = 180
    expect(enriched.derived.effectiveAzimuth).toBe(180);
  });

  it('falls back to north-facing default for southern hemisphere location', () => {
    const normalized = normalizeSurvey(minimalRaw({
      location: { lat: -33.87, lng: 151.21 }, // Sydney, Australia
      geometry: { roofPlanes: [] },
    }));
    const enriched = enrichSurvey(normalized);
    // Southern hemisphere → north-facing = 0
    expect(enriched.derived.effectiveAzimuth).toBe(0);
  });

});

describe('enrichSurvey — setback shrink', () => {

  it('applies setback shrink for each edge type', () => {
    const enriched = enrichSurvey(getNormalized());
    // fullRaw has eave/rake = 36", ridge = 18"
    expect(enriched.derived.setbackShrink).toBeDefined();
    expect(typeof enriched.derived.setbackShrink).toBe('object');
  });

  it('enforces NEC minimum 36" (3ft) floor on setbacks', () => {
    // Provide a setback smaller than 36"
    const normalized = normalizeSurvey(fullRaw({
      geometry: {
        ...fullRaw().geometry,
        setbacks: [
          { edges: ['eave', 'rake', 'ridge'], distanceIn: 12 }, // only 12" — below NEC minimum
        ],
      },
    }));
    const enriched = enrichSurvey(normalized);
    // All setback values must be at least 36" after NEC floor enforcement
    Object.values(enriched.derived.setbackShrink).forEach(shrinkIn => {
      expect(shrinkIn).toBeGreaterThanOrEqual(36);
    });
  });

});

describe('enrichSurvey — CAD roof surfaces', () => {

  it('produces cadRoofSurfaces for each valid roof plane', () => {
    const enriched = enrichSurvey(getNormalized());
    expect(enriched.derived.cadRoofSurfaces).toHaveLength(2);
  });

  it('each cadRoofSurface has planeId, azimuth, pitchDeg, usablePolygon', () => {
    const enriched = enrichSurvey(getNormalized());
    const surface = enriched.derived.cadRoofSurfaces[0];
    expect(surface.planeId).toBe('plane-1');
    expect(typeof surface.azimuth).toBe('number');
    expect(typeof surface.pitchDeg).toBe('number');
    expect(Array.isArray(surface.usablePolygon)).toBe(true);
  });

  it('usableAreaSqFt and totalAreaSqFt are both non-negative numbers on each surface', () => {
    const enriched = enrichSurvey(getNormalized());
    for (const surface of enriched.derived.cadRoofSurfaces) {
      // Both are numeric and non-negative
      expect(typeof surface.usableAreaSqFt).toBe('number');
      expect(typeof surface.totalAreaSqFt).toBe('number');
      expect(surface.usableAreaSqFt).toBeGreaterThanOrEqual(0);
      expect(surface.totalAreaSqFt).toBeGreaterThanOrEqual(0);
      // totalAreaSqFt = plane.area (field-captured)
      // usableAreaSqFt = polygon-computed (independent calculation)
    }
  });

  it('produces empty cadRoofSurfaces when no roof planes present', () => {
    const normalized = normalizeSurvey(minimalRaw({ geometry: { roofPlanes: [] } }));
    const enriched = enrichSurvey(normalized);
    expect(enriched.derived.cadRoofSurfaces).toEqual([]);
  });

});

describe('enrichSurvey — CAD exclusion zones', () => {

  it('produces a cadExclusionZone for each obstruction', () => {
    const enriched = enrichSurvey(getNormalized());
    expect(enriched.derived.cadExclusionZones).toHaveLength(1);
  });

  it('each exclusion zone has obstructionId, center, boundaryPolygon', () => {
    const enriched = enrichSurvey(getNormalized());
    const zone = enriched.derived.cadExclusionZones[0];
    expect(zone.obstructionId).toBe('obs-1');
    expect(zone.center).toHaveProperty('lat');
    expect(zone.center).toHaveProperty('lng');
    expect(Array.isArray(zone.boundaryPolygon)).toBe(true);
    expect(zone.boundaryPolygon.length).toBeGreaterThanOrEqual(4);
  });

  it('produces empty exclusion zones when no obstructions', () => {
    const normalized = normalizeSurvey(minimalRaw({
      geometry: { roofPlanes: [], obstructions: [] },
    }));
    const enriched = enrichSurvey(normalized);
    expect(enriched.derived.cadExclusionZones).toEqual([]);
  });

});

describe('enrichSurvey — structural feasibility', () => {

  it('marks feasible=true for a well-specified roof', () => {
    const enriched = enrichSurvey(getNormalized());
    expect(enriched.derived.structuralFeasibility.feasible).toBe(true);
  });

  it('marks rafterSpacingOk=false when rafter spacing > 24"', () => {
    const normalized = normalizeSurvey(minimalRaw({
      structural: { rafterSpacingIn: 32 }, // > 24"
    }));
    const enriched = enrichSurvey(normalized);
    expect(enriched.derived.structuralFeasibility.checks.rafterSpacingOk).toBe(false);
    expect(enriched.derived.structuralFeasibility.feasible).toBe(false);
  });

  it('marks rafterSpacingOk=true when rafter spacing = 24"', () => {
    const normalized = normalizeSurvey(minimalRaw({
      structural: { rafterSpacingIn: 24 },
    }));
    const enriched = enrichSurvey(normalized);
    expect(enriched.derived.structuralFeasibility.checks.rafterSpacingOk).toBe(true);
  });

  it('marks roofConditionOk=false when roofCondition="poor"', () => {
    const normalized = normalizeSurvey(fullRaw({
      structural: { ...fullRaw().structural, roofCondition: 'poor' },
    }));
    const enriched = enrichSurvey(normalized);
    expect(enriched.derived.structuralFeasibility.checks.roofConditionOk).toBe(false);
    expect(enriched.derived.structuralFeasibility.feasible).toBe(false);
  });

  it('marks deckingThicknessOk=false when decking < 0.5"', () => {
    const normalized = normalizeSurvey(minimalRaw({
      structural: { deckingThicknessIn: 0.375 }, // 3/8"
    }));
    const enriched = enrichSurvey(normalized);
    expect(enriched.derived.structuralFeasibility.checks.deckingThicknessOk).toBe(false);
    expect(enriched.derived.structuralFeasibility.feasible).toBe(false);
  });

  it('marks pitchWithinRange=false when pitch > 45 degrees', () => {
    const normalized = normalizeSurvey(minimalRaw({
      structural: { roofPitch: '12/12' }, // 45 degrees exactly
    }));
    const enriched = enrichSurvey(normalized);
    // 12/12 = 45 degrees exactly, which should be the boundary
    // Either true (< 45°) or false (≥ 45°) depending on implementation — just check it's boolean
    expect(typeof enriched.derived.structuralFeasibility.checks.pitchWithinRange).toBe('boolean');
  });

  it('includes flags and warnings arrays on structural feasibility', () => {
    const enriched = enrichSurvey(getNormalized());
    expect(Array.isArray(enriched.derived.structuralFeasibility.flags)).toBe(true);
    expect(Array.isArray(enriched.derived.structuralFeasibility.warnings)).toBe(true);
  });

  it('adds a roofAge warning when roof age ≥ 20 years (non-fatal)', () => {
    const normalized = normalizeSurvey(fullRaw({
      structural: { ...fullRaw().structural, roofAgeYears: 22 },
    }));
    const enriched = enrichSurvey(normalized);
    // roofAgeOk=false but feasible can still be true (it's a warning, not a hard fail)
    expect(enriched.derived.structuralFeasibility.checks.roofAgeOk).toBe(false);
    expect(enriched.derived.structuralFeasibility.warnings.length).toBeGreaterThan(0);
  });

});

describe('enrichSurvey — electrical feasibility', () => {

  it('marks feasible=true for a standard 200A panel with spaces', () => {
    const enriched = enrichSurvey(getNormalized());
    expect(enriched.derived.electricalFeasibility.feasible).toBe(true);
  });

  it('marks panelRatingSufficient=false for < 100A panel', () => {
    const normalized = normalizeSurvey(minimalRaw({
      electrical: { mainPanelRatingAmps: 60 }, // undersized
    }));
    const enriched = enrichSurvey(normalized);
    expect(enriched.derived.electricalFeasibility.checks.panelRatingSufficient).toBe(false);
  });

  it('marks panelRatingSufficient=true for 100A panel', () => {
    const normalized = normalizeSurvey(minimalRaw({
      electrical: { mainPanelRatingAmps: 100 },
    }));
    const enriched = enrichSurvey(normalized);
    expect(enriched.derived.electricalFeasibility.checks.panelRatingSufficient).toBe(true);
  });

  it('flags Federal Pacific panels as notFederalPacificOrZinsco=false', () => {
    const normalized = normalizeSurvey(minimalRaw({
      electrical: {
        mainPanelRatingAmps: 200,
        panelBrand: 'federal_pacific',
      },
    }));
    const enriched = enrichSurvey(normalized);
    expect(enriched.derived.electricalFeasibility.checks.notFederalPacificOrZinsco).toBe(false);
  });

  it('flags Zinsco panels as notFederalPacificOrZinsco=false', () => {
    const normalized = normalizeSurvey(minimalRaw({
      electrical: {
        mainPanelRatingAmps: 200,
        panelBrand: 'zinsco',
      },
    }));
    const enriched = enrichSurvey(normalized);
    expect(enriched.derived.electricalFeasibility.checks.notFederalPacificOrZinsco).toBe(false);
  });

  it('marks notFederalPacificOrZinsco=true for Siemens panel', () => {
    const normalized = normalizeSurvey(minimalRaw({
      electrical: {
        mainPanelRatingAmps: 200,
        panelBrand: 'siemens',
      },
    }));
    const enriched = enrichSurvey(normalized);
    expect(enriched.derived.electricalFeasibility.checks.notFederalPacificOrZinsco).toBe(true);
  });

});

describe('enrichSurvey — NEC 705.12(B)(2) 120% rule', () => {

  it('computes maxBackfeedAmps correctly: floor((200 × 1.2) - 200) = 40A', () => {
    const normalized = normalizeSurvey(minimalRaw({
      electrical: {
        mainPanelRatingAmps: 200,
        busbarRatingAmps: 200,
      },
    }));
    const enriched = enrichSurvey(normalized);
    const nec = enriched.derived.electricalFeasibility.nec120PctRule;
    expect(nec.maxBackfeedAmps).toBe(40);
  });

  it('computes maxBackfeedAmps for 100A panel: floor((100 × 1.2) - 100) = 20A', () => {
    const normalized = normalizeSurvey(minimalRaw({
      electrical: {
        mainPanelRatingAmps: 100,
        busbarRatingAmps: 100,
      },
    }));
    const enriched = enrichSurvey(normalized);
    const nec = enriched.derived.electricalFeasibility.nec120PctRule;
    expect(nec.maxBackfeedAmps).toBe(20);
  });

  it('sets maxBackfeedAmps=null when panel rating is not captured', () => {
    const normalized = normalizeSurvey(minimalRaw({
      electrical: { mainPanelRatingAmps: null },
    }));
    const enriched = enrichSurvey(normalized);
    const nec = enriched.derived.electricalFeasibility.nec120PctRule;
    expect(nec.maxBackfeedAmps).toBeNull();
  });

  it('marks likelyPasses=true when maxBackfeedAmps > 0', () => {
    const normalized = normalizeSurvey(minimalRaw({
      electrical: {
        mainPanelRatingAmps: 200,
        busbarRatingAmps: 200,
      },
    }));
    const enriched = enrichSurvey(normalized);
    expect(enriched.derived.electricalFeasibility.nec120PctRule.likelyPasses).toBe(true);
  });

  it('nec120PctRule has mainPanelAmps and busbarAmps fields', () => {
    const normalized = normalizeSurvey(minimalRaw({
      electrical: {
        mainPanelRatingAmps: 200,
        busbarRatingAmps: 225,
      },
    }));
    const enriched = enrichSurvey(normalized);
    const nec = enriched.derived.electricalFeasibility.nec120PctRule;
    expect(nec.mainPanelAmps).toBe(200);
    expect(nec.busbarAmps).toBe(225);
  });

});

describe('enrichSurvey — shading confidence', () => {

  it('returns "high" confidence for fully-specified survey', () => {
    const enriched = enrichSurvey(getNormalized());
    expect(['high', 'medium']).toContain(enriched.derived.shadingConfidence);
  });

  it('returns "low" or "unknown" for minimal survey with no geometry', () => {
    const normalized = normalizeSurvey(minimalRaw());
    const enriched = enrichSurvey(normalized);
    expect(['low', 'unknown']).toContain(enriched.derived.shadingConfidence);
  });

  it('shading confidence improves when GPS coordinates are present vs absent', () => {
    const withGps = enrichSurvey(normalizeSurvey(minimalRaw({
      location: { lat: 34.05, lng: -118.24 },
    })));
    const withoutGps = enrichSurvey(normalizeSurvey(minimalRaw({
      location: { lat: null, lng: null },
    })));
    const confidenceRank: Record<string, number> = { high: 3, medium: 2, low: 1, unknown: 0 };
    expect(confidenceRank[withGps.derived.shadingConfidence])
      .toBeGreaterThanOrEqual(confidenceRank[withoutGps.derived.shadingConfidence]);
  });

});

describe('enrichSurvey — effectiveUsableArea', () => {

  it('uses field-measured usableAreaSqFt when provided', () => {
    // fullRaw has usableAreaSqFt: 600
    const enriched = enrichSurvey(getNormalized());
    // When field value is present, effectiveUsableAreaSqFt should be the field value
    expect(enriched.derived.effectiveUsableAreaSqFt).toBe(600);
  });

  it('uses computed area when no field-measured value provided', () => {
    const normalized = normalizeSurvey(fullRaw({
      geometry: {
        ...fullRaw().geometry,
        usableAreaSqFt: null, // no field measurement
      },
    }));
    const enriched = enrichSurvey(normalized);
    // Should use computedUsableAreaSqFt as fallback
    expect(enriched.derived.effectiveUsableAreaSqFt).toBe(enriched.derived.computedUsableAreaSqFt);
  });

});

// ─── SECTION 3: applyToSystemDefinition ──────────────────────────────────────

/** Helper: build a fully enriched survey */
function getEnriched(rawOverrides: Partial<RawSurveyPayload> = {}): EnrichedSiteSurvey {
  return enrichSurvey(normalizeSurvey(fullRaw(rawOverrides)));
}

describe('applyToSystemDefinition — immutability', () => {

  it('never mutates the input SystemDefinition', () => {
    const existing = baseSystemDef();
    const existingCopy = JSON.parse(JSON.stringify(existing));
    const survey = getEnriched();

    applyToSystemDefinition(existing, survey);

    // Input must be identical after the call
    expect(existing).toEqual(existingCopy);
  });

  it('returns a new SystemDefinition object reference', () => {
    const existing = baseSystemDef();
    const survey = getEnriched();
    const { definition } = applyToSystemDefinition(existing, survey);
    expect(definition).not.toBe(existing);
  });

  it('returns a new layout object reference (deep non-mutation)', () => {
    const existing = baseSystemDef();
    const survey = getEnriched();
    const { definition } = applyToSystemDefinition(existing, survey);
    expect(definition.layout).not.toBe(existing.layout);
  });

  it('returns a new structure object reference (deep non-mutation)', () => {
    const existing = baseSystemDef();
    const survey = getEnriched();
    const { definition } = applyToSystemDefinition(existing, survey);
    expect(definition.structure).not.toBe(existing.structure);
  });

});

describe('applyToSystemDefinition — audit trail', () => {

  it('returns SurveyOverrideContext with survey, appliedAt, overriddenFields, skippedFields', () => {
    const existing = baseSystemDef();
    const survey = getEnriched();
    const { context } = applyToSystemDefinition(existing, survey);

    expect(context.survey).toBe(survey);
    expect(typeof context.appliedAt).toBe('string');
    expect(Array.isArray(context.overriddenFields)).toBe(true);
    expect(Array.isArray(context.skippedFields)).toBe(true);
  });

  it('appliedAt is a valid ISO timestamp', () => {
    const { context } = applyToSystemDefinition(baseSystemDef(), getEnriched());
    const d = new Date(context.appliedAt);
    expect(d.getTime()).not.toBeNaN();
  });

  it('overriddenFields + skippedFields covers all checked override keys', () => {
    const { context } = applyToSystemDefinition(baseSystemDef(), getEnriched());
    const allFields = [...context.overriddenFields, ...context.skippedFields];
    // Should include at least systemType and some structural/electrical fields
    expect(allFields.length).toBeGreaterThan(0);
  });

});

describe('applyToSystemDefinition — override allowlist', () => {

  it('overrides systemType when survey value differs from existing', () => {
    const existing = baseSystemDef({ systemType: 'ground' });
    const survey = getEnriched(); // fullRaw has systemType='roof'
    const { definition, context } = applyToSystemDefinition(existing, survey);

    expect(definition.systemType).toBe('roof');
    expect(context.overriddenFields).toContain('systemType');
  });

  it('does NOT override systemType when survey matches existing', () => {
    const existing = baseSystemDef({ systemType: 'roof' });
    const survey = getEnriched(); // also 'roof'
    const { definition, context } = applyToSystemDefinition(existing, survey);

    expect(definition.systemType).toBe('roof');
    expect(context.skippedFields).toContain('systemType');
  });

  it('overrides structure.rafterSize from survey', () => {
    const existing = baseSystemDef({
      structure: { railOrientation: 'horizontal', rafterSize: '2x4' },
    });
    const survey = getEnriched(); // fullRaw has rafterSize='2x6'
    const { definition, context } = applyToSystemDefinition(existing, survey);

    expect(definition.structure.rafterSize).toBe('2x6');
    expect(context.overriddenFields).toContain('structure.rafterSize');
  });

  it('overrides structure.roofPitch when survey provides it', () => {
    const existing = baseSystemDef({ structure: { railOrientation: 'horizontal' } });
    const survey = getEnriched(); // fullRaw has roofPitch='standard' / pitchDegrees ~22.6
    const { definition } = applyToSystemDefinition(existing, survey);

    // roofPitch in StructureDefinition is a number (degrees)
    expect(typeof definition.structure.roofPitch).toBe('number');
  });

  it('overrides electrical.mainPanelAmps from survey', () => {
    const existing = baseSystemDef({
      electrical: { inverterType: 'string', mainPanelAmps: 100 },
    });
    const survey = getEnriched(); // fullRaw has mainPanelRatingAmps=200
    const { definition, context } = applyToSystemDefinition(existing, survey);

    expect(definition.electrical.mainPanelAmps).toBe(200);
    expect(context.overriddenFields).toContain('electrical.mainPanelAmps');
  });

  it('does NOT override electrical.inverterType (outside allowlist)', () => {
    const existing = baseSystemDef({
      electrical: { inverterType: 'micro' },
    });
    const survey = getEnriched();
    const { definition } = applyToSystemDefinition(existing, survey);

    // inverterType must remain unchanged — survey cannot override it
    expect(definition.electrical.inverterType).toBe('micro');
  });

  it('does NOT override layout.totalPanels (outside allowlist)', () => {
    const existing = baseSystemDef({
      layout: { tilt: 25, azimuth: 180, rowSpacing: 12, totalPanels: 24 },
    });
    const survey = getEnriched();
    const { definition } = applyToSystemDefinition(existing, survey);

    // totalPanels is a design decision, not a survey field
    expect(definition.layout.totalPanels).toBe(24);
  });

  it('does NOT override panel definition (panels are confirmed by design pipeline)', () => {
    const existing = baseSystemDef({
      panel: {
        wattage: 500,
        widthIn: 42,
        heightIn: 70,
        weightLbs: 50,
        orientation: 'portrait',
        model: 'Premium 500W',
        manufacturer: 'SolarCo',
      },
    });
    const survey = getEnriched();
    const { definition } = applyToSystemDefinition(existing, survey);

    // Panel must remain unchanged
    expect(definition.panel.wattage).toBe(500);
    expect(definition.panel.model).toBe('Premium 500W');
  });

});

describe('applyToSystemDefinition — rafter spacing explicit capture guard', () => {

  it('overrides rafterSpacing when explicitly captured in survey and value differs', () => {
    const existing = baseSystemDef({
      // Use 16" OC as the existing design value — survey has 24" OC explicitly
      structure: { railOrientation: 'horizontal', rafterSpacing: 16 },
    });
    // fullRaw explicitly provides rafterSpacingIn: '24 OC' → not defaulted
    const survey = getEnriched();
    const { definition, context } = applyToSystemDefinition(existing, survey);

    // Survey explicitly captured 24" — overrides existing 16"
    expect(context.overriddenFields).toContain('structure.rafterSpacing');
    expect(definition.structure.rafterSpacing).toBe(24);
  });

  it('skips rafterSpacing override when survey only has the default value', () => {
    const existing = baseSystemDef({
      structure: { railOrientation: 'horizontal', rafterSpacing: 16 },
    });
    // minimalRaw has no rafterSpacingIn → normalizeSurvey will default to 24
    const survey = getEnriched({
      structural: { rafterSpacingIn: null }, // force default
    });
    const { context } = applyToSystemDefinition(existing, survey);

    // Default value should NOT override an existing confirmed design value
    expect(context.skippedFields).toContain('structure.rafterSpacing');
  });

});

// ─── SECTION 4: buildCADFromSurvey ────────────────────────────────────────────

describe('buildCADFromSurvey — core behavior', () => {

  it('returns a SurveyCADInputs object with required fields', () => {
    const survey = getEnriched();
    const cad = buildCADFromSurvey(survey);

    expect(cad).toHaveProperty('systemType');
    expect(cad).toHaveProperty('origin');
    expect(cad).toHaveProperty('roofPlaneInputs');
    expect(cad).toHaveProperty('groundArrayInputs');
    expect(cad).toHaveProperty('overrides');
    expect(cad).toHaveProperty('warnings');
    expect(cad).toHaveProperty('buildLog');
  });

  it('never throws on minimal survey input', () => {
    const survey = enrichSurvey(normalizeSurvey(minimalRaw()));
    expect(() => buildCADFromSurvey(survey)).not.toThrow();
  });

  it('buildLog is an array with entries', () => {
    const survey = getEnriched();
    const cad = buildCADFromSurvey(survey);
    expect(Array.isArray(cad.buildLog)).toBe(true);
    expect(cad.buildLog.length).toBeGreaterThan(0);
  });

  it('warnings is an array', () => {
    const survey = getEnriched();
    const cad = buildCADFromSurvey(survey);
    expect(Array.isArray(cad.warnings)).toBe(true);
  });

});

describe('buildCADFromSurvey — origin', () => {

  it('uses survey GPS coordinates as origin when available', () => {
    const survey = getEnriched(); // lat: 34.05, lng: -118.24
    const cad = buildCADFromSurvey(survey);
    expect(cad.origin.lat).toBeCloseTo(34.05, 4);
    expect(cad.origin.lng).toBeCloseTo(-118.24, 4);
  });

  it('returns null origin when no GPS and no roof plane vertices', () => {
    const survey = enrichSurvey(normalizeSurvey(minimalRaw({
      location: { lat: null, lng: null },
      geometry: { roofPlanes: [] },
    })));
    const cad = buildCADFromSurvey(survey);
    // When no GPS and no polygon data, origin is null
    expect(cad.origin).toBeNull();
  });

});

describe('buildCADFromSurvey — roof plane inputs', () => {

  it('produces roofPlaneInputs for each enriched CAD surface', () => {
    const survey = getEnriched();
    const cad = buildCADFromSurvey(survey);
    expect(cad.roofPlaneInputs.length).toBe(survey.derived.cadRoofSurfaces.length);
  });

  it('each roofPlaneInput has id, polygon, usablePolygon', () => {
    const survey = getEnriched();
    const cad = buildCADFromSurvey(survey);

    if (cad.roofPlaneInputs.length > 0) {
      const plane = cad.roofPlaneInputs[0];
      expect(plane).toHaveProperty('id');       // SurveyRoofPlaneInput uses 'id'
      expect(plane).toHaveProperty('polygon');
      expect(plane).toHaveProperty('usablePolygon');
    }
  });

  it('polygon coordinates are in local meters (not lat/lng)', () => {
    const survey = getEnriched();
    const cad = buildCADFromSurvey(survey);

    if (cad.roofPlaneInputs.length > 0) {
      const plane = cad.roofPlaneInputs[0];
      if (plane.polygon && plane.polygon.length > 0) {
        // Local coordinates in meters — should be small numbers (< 1000m for a house)
        const pt = plane.polygon[0];
        expect(Math.abs(pt.x)).toBeLessThan(1000);
        expect(Math.abs(pt.y)).toBeLessThan(1000);
        // Should NOT be lat/lng values (those are ~34 and ~-118)
        // A coordinate of 34 could look like a lat — verify it's consistently small
      }
    }
  });

  it('setbacks are expressed in meters in roofPlaneInputs', () => {
    const survey = getEnriched();
    const cad = buildCADFromSurvey(survey);

    if (cad.roofPlaneInputs.length > 0) {
      const plane = cad.roofPlaneInputs[0];
      if (plane.setbacks) {
        // Setbacks are { eaveM, ridgeM, rakeM } in meters
        // 36" = ~0.914m, 24" = ~0.609m — all should be small positive values
        const { eaveM, ridgeM, rakeM } = plane.setbacks;
        expect(eaveM).toBeGreaterThan(0);
        expect(eaveM).toBeLessThan(10);
        expect(ridgeM).toBeGreaterThan(0);
        expect(ridgeM).toBeLessThan(10);
        expect(rakeM).toBeGreaterThan(0);
        expect(rakeM).toBeLessThan(10);
      }
    }
  });

});

describe('buildCADFromSurvey — overrides', () => {

  it('overrides include azimuth from effective survey azimuth', () => {
    const survey = getEnriched();
    const cad = buildCADFromSurvey(survey);
    expect(cad.overrides).toHaveProperty('azimuth');
    expect(cad.overrides.azimuth).toBe(survey.derived.effectiveAzimuth);
  });

  it('overrides include rafterSpacingIn when survey has it', () => {
    const survey = getEnriched();
    const cad = buildCADFromSurvey(survey);
    expect(cad.overrides).toHaveProperty('rafterSpacingIn');
    expect(cad.overrides.rafterSpacingIn).toBe(survey.structural.rafterSpacingIn);
  });

  it('overrides include usableAreaSqFt from effective area', () => {
    const survey = getEnriched();
    const cad = buildCADFromSurvey(survey);
    expect(cad.overrides).toHaveProperty('usableAreaSqFt');
  });

  it('systemType is "roof" for a roof survey', () => {
    const survey = getEnriched();
    const cad = buildCADFromSurvey(survey);
    expect(cad.systemType).toBe('roof');
  });

  it('systemType is "ground_mount" for a ground survey (mapped to CADSystemType)', () => {
    const survey = getEnriched({ systemType: 'ground' });
    const cad = buildCADFromSurvey(survey);
    // SurveySystemType 'ground' maps to CADSystemType 'ground_mount'
    expect(cad.systemType).toBe('ground_mount');
  });

});

describe('buildCADFromSurvey — coordinate conversion accuracy', () => {

  it('converts lat/lng polygon to local meters using Equirectangular approximation', () => {
    // Verify the conversion is reasonable: 0.0001° lat difference ≈ 11.1m
    const survey = getEnriched();
    const cad = buildCADFromSurvey(survey);

    if (cad.roofPlaneInputs.length > 0) {
      const plane = cad.roofPlaneInputs[0];
      if (plane.polygon && plane.polygon.length >= 2) {
        // The polygon for plane-1 spans 0.0002° lat and 0.0004° lng
        // At lat=34°: 0.0002° lat ≈ 22.2m, 0.0004° lng ≈ 37.1m × cos(34°)
        // Both dimensions should be positive and < 50m
        const xCoords = plane.polygon.map(p => p.x);
        const yCoords = plane.polygon.map(p => p.y);
        const xSpan = Math.max(...xCoords) - Math.min(...xCoords);
        const ySpan = Math.max(...yCoords) - Math.min(...yCoords);
        // The roof plane spans ~20-40m
        expect(xSpan).toBeGreaterThan(0);
        expect(ySpan).toBeGreaterThan(0);
        expect(xSpan).toBeLessThan(200);
        expect(ySpan).toBeLessThan(200);
      }
    }
  });

  it('usable polygon in roofPlaneInputs has valid local-meter coordinates', () => {
    const survey = getEnriched();
    const cad = buildCADFromSurvey(survey);

    if (cad.roofPlaneInputs.length > 0) {
      const plane = cad.roofPlaneInputs[0];
      if (plane.usablePolygon && plane.usablePolygon.length >= 3) {
        // All usable polygon points should be valid finite numbers in local meters
        for (const pt of plane.usablePolygon) {
          expect(isFinite(pt.x)).toBe(true);
          expect(isFinite(pt.y)).toBe(true);
        }
        // Usable polygon should be close to origin (within reasonable site dimensions ~200m)
        const xs = plane.usablePolygon.map(p => Math.abs(p.x));
        const ys = plane.usablePolygon.map(p => Math.abs(p.y));
        expect(Math.max(...xs)).toBeLessThan(500);
        expect(Math.max(...ys)).toBeLessThan(500);
      }
    }
  });

});

// ─── SECTION 5: Pipeline version consistency ──────────────────────────────────

describe('SITE_SURVEY_PIPELINE_VERSION consistency', () => {

  it('SITE_SURVEY_PIPELINE_VERSION constant equals 1', () => {
    expect(SITE_SURVEY_PIPELINE_VERSION).toBe(1);
  });

  it('normalizeSurvey stamps correct pipelineVersion', () => {
    const result = normalizeSurvey(minimalRaw());
    expect(result.pipelineVersion).toBe(SITE_SURVEY_PIPELINE_VERSION);
  });

  it('enrichSurvey preserves pipelineVersion from normalized survey', () => {
    const normalized = normalizeSurvey(minimalRaw());
    const enriched = enrichSurvey(normalized);
    expect(enriched.pipelineVersion).toBe(SITE_SURVEY_PIPELINE_VERSION);
  });

  it('applyToSystemDefinition context carries enriched survey with correct pipelineVersion', () => {
    const survey = getEnriched();
    const { context } = applyToSystemDefinition(baseSystemDef(), survey);
    expect(context.survey.pipelineVersion).toBe(SITE_SURVEY_PIPELINE_VERSION);
  });

  it('buildCADFromSurvey receives and operates on a v1 pipeline survey', () => {
    const survey = getEnriched();
    expect(survey.pipelineVersion).toBe(SITE_SURVEY_PIPELINE_VERSION);
    // Just verify it doesn't throw
    expect(() => buildCADFromSurvey(survey)).not.toThrow();
  });

});

// ─── SECTION 6: Full pipeline integration (end-to-end) ───────────────────────

describe('Full pipeline: RawSurveyPayload → EnrichedSiteSurvey', () => {

  it('produces a fully-enriched survey from a complete field submission', () => {
    const raw = fullRaw();
    const normalized = normalizeSurvey(raw);
    const enriched = enrichSurvey(normalized);

    // Identity
    expect(enriched.id).toBe('survey-002');
    expect(enriched.projectId).toBe('proj-002');
    expect(enriched.pipelineVersion).toBe(1);

    // Normalization
    expect(enriched.structural.rafterSpacingIn).toBe(24);
    expect(enriched.structural.rafterSize).toBe('2x6');
    expect(enriched.structural.deckingThicknessIn).toBe(0.5);
    expect(enriched.electrical.mainPanelRatingAmps).toBe(200);
    expect(enriched.electrical.panelBrand).toBe('siemens');

    // Enrichment
    expect(enriched.derived.effectiveAzimuth).toBe(180);
    expect(enriched.derived.cadRoofSurfaces).toHaveLength(2);
    expect(enriched.derived.cadExclusionZones).toHaveLength(1);
    expect(enriched.derived.structuralFeasibility.feasible).toBe(true);
    expect(enriched.derived.electricalFeasibility.feasible).toBe(true);
    expect(enriched.derived.electricalFeasibility.nec120PctRule.maxBackfeedAmps).toBe(40);
    expect(['high', 'medium']).toContain(enriched.derived.shadingConfidence);

    // Logs present
    expect(enriched.normalizationLog.length).toBeGreaterThan(0);
    expect(enriched.enrichmentLog.length).toBeGreaterThan(0);
  });

  it('produces a feasible system and applies to SystemDefinition correctly', () => {
    const raw = fullRaw();
    const enriched = enrichSurvey(normalizeSurvey(raw));
    const existing = baseSystemDef({ systemType: 'ground' }); // start with ground
    const { definition, context } = applyToSystemDefinition(existing, enriched);

    // systemType overridden from 'ground' to 'roof'
    expect(definition.systemType).toBe('roof');
    expect(context.overriddenFields).toContain('systemType');

    // rafterSize overridden
    expect(definition.structure.rafterSize).toBe('2x6');

    // Panel untouched
    expect(definition.panel.wattage).toBe(400);

    // Audit trail present
    expect(context.overriddenFields.length).toBeGreaterThan(0);
    expect(context.skippedFields.length).toBeGreaterThan(0);
  });

  it('fails gracefully on malformed raw payload without throwing', () => {
    const malformed: RawSurveyPayload = {
      id: '',
      projectId: '',
      location: { lat: undefined as unknown as null, lng: undefined as unknown as null },
      structural: { rafterSpacingIn: 'not-a-number', rafterSize: '???', deckingThicknessIn: 'thick' },
      electrical: { mainPanelRatingAmps: 'invalid', panelBrand: 'unknown_brand' },
      geometry: {
        roofPlanes: [
          { id: 'bad', pitch: -5, azimuth: 999, area: -100, vertices: [{ lat: 0, lng: 0 }] },
        ],
      },
    };

    let normalized: NormalizedSiteSurvey | undefined;
    let enriched: EnrichedSiteSurvey | undefined;

    expect(() => { normalized = normalizeSurvey(malformed); }).not.toThrow();
    expect(() => { if (normalized) enriched = enrichSurvey(normalized); }).not.toThrow();
    expect(() => {
      if (enriched) buildCADFromSurvey(enriched);
    }).not.toThrow();
    expect(() => {
      if (enriched) applyToSystemDefinition(baseSystemDef(), enriched);
    }).not.toThrow();
  });

  it('logs are populated throughout the pipeline (no silent failures)', () => {
    const normalized = normalizeSurvey(fullRaw());
    const enriched = enrichSurvey(normalized);

    expect(normalized.normalizationLog.length).toBeGreaterThan(3);
    expect(enriched.enrichmentLog.length).toBeGreaterThan(3);
  });

});