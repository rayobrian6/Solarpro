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
  roof_material?:           string | null;
  roof_age_years?:          number | null;
  roof_condition?:          string | null;
  roof_pitch_degrees?:      number | null;
  rafter_spacing_in?:       number | null;
  decking_thickness_in?:    number | null;
  structural_notes?:        string | null;
  main_panel_rating_amps?:  number | null;
  busbar_rating_amps?:      number | null;
  breaker_spaces_available?: number | null;
  interconnection_point?:   string | null;
  panel_brand?:             string | null;
  has_existing_solar?:      boolean | null;
  electrical_notes?:        string | null;
  total_roof_area_sqft?:    number | null;
  usable_area_sqft?:        number | null;
  access_notes?:            string | null;
  mounting_notes?:          string | null;
  site_address?:            string | null;
  lat?:                     number | null;
  lng?:                     number | null;
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

  const payload: RawSurveyPayload = {
    id:        surveyId ?? `fromPhysicalData-${projectId}`,
    projectId,

    // ── Location (nested) ─────────────────────────────────────────────────
    location: {
      lat:     pd.lat          ?? null,
      lng:     pd.lng          ?? null,
      address: pd.site_address ?? null,
    },

    // ── Structural (nested) ───────────────────────────────────────────────
    structural: {
      roofMaterial:       pd.roof_material        ?? null,
      roofAgeYears:       pd.roof_age_years        ?? null,
      roofCondition:      pd.roof_condition        ?? null,
      rafterSpacingIn:    pd.rafter_spacing_in     ?? null,
      deckingThicknessIn: pd.decking_thickness_in  ?? null,
    },

    // ── Electrical (nested) ───────────────────────────────────────────────
    electrical: {
      mainPanelRatingAmps:    pd.main_panel_rating_amps    ?? null,
      busbarRatingAmps:       pd.busbar_rating_amps        ?? null,
      breakerSpacesAvailable: pd.breaker_spaces_available  ?? null,
      interconnectionPoint:   pd.interconnection_point     ?? null,
      panelBrand:             pd.panel_brand               ?? null,
    },

    // ── Geometry (nested) ─────────────────────────────────────────────────
    geometry: {
      usableAreaSqFt: pd.usable_area_sqft ?? null,
      roofPlanes:     null,
      obstructions:   null,
      setbacks:       null,
    },

    // ── Photos: attached from project_files ───────────────────────────────
    // normalizeSurvey() handles Array<Partial<SurveyPhotoRef>> via normalizePhotos()
    photos: photoRefs.length > 0 ? photoRefs : null,

    // ── Notes ─────────────────────────────────────────────────────────────
    installerNotes: [
      pd.structural_notes,
      pd.electrical_notes,
      pd.access_notes,
      pd.mounting_notes,
    ]
      .filter(Boolean)
      .join(' | ') || null,
  };

  return payload;
}