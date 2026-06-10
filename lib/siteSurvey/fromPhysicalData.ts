// ============================================================================
// lib/siteSurvey/fromPhysicalData.ts — DB → RawSurveyPayload Bridge (Read-Only)
//
// VERSION: SITE_SURVEY_PIPELINE_VERSION = 1
//
// PURPOSE:
//   Constructs a RawSurveyPayload from project_physical_data + project_files
//   rows already in the database. This is the entry point for the SiteSurvey
//   pipeline when triggered from SolarPro's own DB (as opposed to the live
//   webhook ingest path which uses normalizeSurvey directly).
//
// PIPELINE POSITION:
//   project_physical_data (DB)  ┐
//   project_files (DB)          ┘→ fromPhysicalData()  ← YOU ARE HERE
//     → normalizeSurvey()
//     → enrichSurvey()
//     → applyToSystemDefinition()
//
// CONTRACTS:
//   - NEVER throws — all errors caught; returns null on failure
//   - NEVER writes to DB — read-only (SELECT only via getProjectFiles)
//   - NEVER modifies CAD, proposal, permit, or engineering paths
//   - All photo attachment is optional and safe — missing photos → empty array
//   - Returns null if projectId is missing or DB read fails
//   - The returned RawSurveyPayload is suitable for normalizeSurvey() input
//
// PHOTO ATTACHMENT (Phase 1–2 integration):
//   Calls getProjectFiles(projectId) to fetch Photo[] from project_files.
//   Maps Photo → Partial<SurveyPhotoRef> and attaches to payload.photos.
//   Dev logging: [SURVEY PHOTOS ATTACHED] with total + per-category counts.
// ============================================================================

// PIPELINE STATUS: WIRED — imported by app/api/engineering/generate, permit, preliminary
//   Reads: project_physical_data + project_files (NOT project_site_surveys — that table does not exist)
import { getProjectFiles, type Photo } from '@/lib/files/getProjectFiles';
import type { RawSurveyPayload, SurveyPhotoRef } from './types';

// ── ProjectPhysicalDataRow — shape of a project_physical_data DB row ──────────
// (Mirrors the fields written by ingestPipeline._upsertPhysicalData)

export interface ProjectPhysicalDataRow {
  id?:                      string;
  project_id?:              string;
  // ── Structure / Roof (migration 013 base columns) ──
  roof_material?:           string | null;
  roof_age_years?:          number | null;
  roof_condition?:          string | null;
  roof_pitch?:              string | null;    // TEXT enum: flat|low|standard|steep|very_steep
  rafter_spacing_in?:       number | null;
  obstructions?:            unknown[] | null;  // JSONB array
  usable_roof_pct?:         number | null;     // 0-100 percent
  structure_type?:          string | null;
  stories?:                 string | null;
  attic_access?:            boolean | null;
  // ── Structure / Roof (migration 050 engineering additions) ──
  roof_pitch_degrees?:      number | null;    // numeric degrees, added by 050
  decking_thickness_in?:    number | null;
  structural_notes?:        string | null;
  total_roof_area_sqft?:    number | null;
  usable_area_sqft?:        number | null;
  // ── Electrical (migration 013 base columns) ──
  panel_rating_amps?:       number | null;    // INTEGER (mapped from PanelRating enum)
  available_breaker_slots?: string | null;    // TEXT ('0','1-2','3-4','5+')
  interconnection_point?:   string | null;
  panel_brand?:             string | null;
  has_sub_panel?:           boolean | null;
  sub_panel_rating_amps?:   number | null;
  meter_socket_type?:       string | null;
  service_entrance_type?:   string | null;
  // ── Electrical (migration 050 engineering additions) ──
  main_panel_rating_amps?:  number | null;    // INTEGER, added by 050
  busbar_rating_amps?:      number | null;
  breaker_spaces_available?: number | null;   // INTEGER, added by 050
  has_existing_solar?:      boolean | null;
  electrical_notes?:        string | null;
  // ── Site / Location (migration 050 additions) ──
  site_address?:            string | null;
  lat?:                     number | null;
  lng?:                     number | null;
  // ── Survey metadata (migration 013 base) ──
  inspector_name?:          string | null;
  surveyed_at?:             string | null;
  access_notes?:            string | null;
  mounting_notes?:          string | null;
  // ── Migration 017 additions ──
  setback_notes?:           string | null;
  source_survey_id?:        string | null;
  // ── Timestamps ──
  updated_at?:              string | null;
}

// ── Photo → SurveyPhotoRef mapping ───────────────────────────────────────────

/**
 * mapPhotoToPhotoRef — converts a Photo from getProjectFiles into a
 * Partial<SurveyPhotoRef> suitable for RawSurveyPayload.photos.
 *
 * The SurveyPhotoRef shape (from types.ts):
 *   slotKey:    string          ← generated from category + index
 *   url:        string          ← from Photo.url
 *   category:   SurveyPhotoRef['category'] ← from Photo.category
 *   capturedAt: string?         ← from Photo.createdAt
 *   notes:      string?         ← from Photo.metadata.notes
 */
function mapPhotoToPhotoRef(
  photo: Photo,
  index: number,
): Partial<SurveyPhotoRef> {
  const notes = typeof photo.metadata?.notes === 'string'
    ? photo.metadata.notes
    : undefined;

  return {
    slotKey:    `${photo.category}-${index + 1}`,
    url:        photo.url,
    category:   photo.category as SurveyPhotoRef['category'],
    capturedAt: photo.createdAt ?? undefined,
    notes:      notes || undefined,
  };
}

// ── Dev logging ───────────────────────────────────────────────────────────────

function logPhotoAttachment(
  projectId: string,
  photos: Photo[],
): void {
  if (process.env.NODE_ENV !== 'development') return;

  const counts = photos.reduce<Record<string, number>>((acc, p) => {
    acc[p.category] = (acc[p.category] ?? 0) + 1;
    return acc;
  }, {});

  const breakdown = Object.entries(counts)
    .map(([cat, n]) => `${cat}=${n}`)
    .join(', ');

  console.log(
    `[SURVEY PHOTOS ATTACHED] project=${projectId} total=${photos.length} (${breakdown})`,
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * fromPhysicalData — constructs a RawSurveyPayload from DB rows.
 *
 * Takes a project_physical_data row (already fetched by the caller) and
 * a projectId, fetches project_files photos, and returns a RawSurveyPayload
 * ready for normalizeSurvey().
 *
 * @param projectId   UUID of the project
 * @param physData    Row from project_physical_data (or null if not yet ingested)
 * @param surveyId    Optional: survey UUID for the payload id field
 * @returns           RawSurveyPayload | null (null on error or missing projectId)
 */
export async function fromPhysicalData(
  projectId: string,
  physData: ProjectPhysicalDataRow | null,
  surveyId?: string,
): Promise<RawSurveyPayload | null> {
  if (!projectId) {
    console.warn('[fromPhysicalData] Called with empty projectId — returning null');
    return null;
  }

  // ── Step 1: Fetch photos from project_files (read-only, never throws) ──────
  let photos: Photo[] = [];
  try {
    photos = await getProjectFiles(projectId);
  } catch {
    // getProjectFiles never throws, but belt-and-suspenders
    photos = [];
  }

  // ── Step 2: Dev log ──────────────────────────────────────────────────────
  if (photos.length > 0) {
    logPhotoAttachment(projectId, photos);
  }

  // ── Step 3: Map Photo[] → Partial<SurveyPhotoRef>[] ─────────────────────
  const photoRefs: Array<Partial<SurveyPhotoRef>> = photos.map(
    (p, i) => mapPhotoToPhotoRef(p, i),
  );

  // ── Step 4: Build RawSurveyPayload from physData fields ──────────────────
  // RawSurveyPayload uses nested objects: location, structural, electrical, geometry.
  // All nested objects are optional — null/undefined is safe throughout.
  const pd = physData ?? {};

  // ── Roof pitch enum → degrees conversion ──────────────────────────────────
  // The DB stores roof_pitch as a TEXT enum (flat|low|standard|steep|very_steep).
  // The engineering pipeline needs numeric degrees. Use roof_pitch_degrees
  // (added by migration 050) if available, otherwise convert from the enum.
  const ROOF_PITCH_ENUM_TO_DEGREES: Record<string, number> = {
    flat: 0, low: 10, standard: 20, steep: 35, very_steep: 45,
  };
  const roofPitchDegrees: number | null =
    pd.roof_pitch_degrees ??                                      // preferred: numeric column from 050
    (pd.roof_pitch ? ROOF_PITCH_ENUM_TO_DEGREES[pd.roof_pitch] : null) ??  // fallback: enum → degrees
    null;

  // ── Panel rating: prefer main_panel_rating_amps (050), fall back to panel_rating_amps (013) ──
  const panelRatingAmps: number | null =
    pd.main_panel_rating_amps ?? pd.panel_rating_amps ?? null;

  // ── Breaker spaces: prefer breaker_spaces_available (050 INTEGER), fall back to available_breaker_slots (013 TEXT) ──
  const breakerSpaces: number | null =
    pd.breaker_spaces_available ??
    (pd.available_breaker_slots ? parseInt(pd.available_breaker_slots, 10) : null) ??
    null;

  // ── Usable area: prefer usable_area_sqft (050), derive from usable_roof_pct (013) ──
  // Note: usable_roof_pct is a percentage, not sqft — only use if no sqft available
  const usableAreaSqFt: number | null = pd.usable_area_sqft ?? null;

  const payload: RawSurveyPayload = {
    id:        surveyId ?? `fromPhysicalData-${projectId}`,
    projectId,

    // ── Location (nested) ──────────────────────────────────────────────────
    location: {
      lat:     pd.lat          ?? null,
      lng:     pd.lng          ?? null,
      address: pd.site_address ?? null,
    },

    // ── Structural (nested) ─────────────────────────────────────────────────
    structural: {
      roofMaterial:       pd.roof_material        ?? null,
      roofAgeYears:       pd.roof_age_years        ?? null,
      roofCondition:      pd.roof_condition        ?? null,
      roofPitch:          pd.roof_pitch            ?? null,   // TEXT enum: flat|low|standard|steep|very_steep
      rafterSpacingIn:    pd.rafter_spacing_in     ?? null,
      deckingThicknessIn: pd.decking_thickness_in  ?? null,
    },

    // ── Electrical (nested) ──────────────────────────────────────────────────
    electrical: {
      mainPanelRatingAmps:    panelRatingAmps,              // merged from 050 + 013
      busbarRatingAmps:       pd.busbar_rating_amps        ?? null,
      breakerSpacesAvailable: breakerSpaces,                 // merged from 050 + 013
      interconnectionPoint:   pd.interconnection_point     ?? null,
      panelBrand:             pd.panel_brand               ?? null,
      hasSubPanel:            pd.has_sub_panel             ?? null,
    },

    // ── Geometry (nested) ────────────────────────────────────────────────────
    geometry: {
      usableAreaSqFt: usableAreaSqFt,
      roofPlanes:     null,
      obstructions:   Array.isArray(pd.obstructions) ? pd.obstructions : null,
      setbacks:       null,
    },

    // ── Photos: attached from project_files ─────────────────────────────────
    // normalizeSurvey() handles Array<Partial<SurveyPhotoRef>> via normalizePhotos()
    photos: photoRefs.length > 0 ? photoRefs : null,

    // ── Notes ────────────────────────────────────────────────────────────────
    installerNotes: [
      pd.structural_notes,
      pd.electrical_notes,
      pd.access_notes,
      pd.mounting_notes,
      pd.setback_notes,
    ]
      .filter(Boolean)
      .join(' | ') || null,
  };

  return payload;
}