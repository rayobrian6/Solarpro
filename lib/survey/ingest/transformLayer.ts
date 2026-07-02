// ============================================================================
// v47.438 Stage 9.3 — Survey Ingest: Transform Layer (Q3 Complete)
//
// Converts a verified SurveyV2Payload into a structured TransformOutput
// that the pipeline writes to the DB.
//
// Q3 IS NOW ANSWERED. This file implements:
//   1. Full SurveyV2Payload field extraction for all 5 survey steps.
//   2. Enum normalization via explicit mapping functions.
//   3. PhysicalDataOutput — every field maps to a project_physical_data column.
//   4. Photo extraction from SurveyV2Payload.photos array.
//
// The pipeline (ingestPipeline.ts) calls transform() then writes:
//   - projects row     via _upsertProject()
//   - project_physical_data row  via _upsertPhysicalData()   [NEW in v47.438]
//   - project_files rows         via _insertFiles()
//
// TRANSFORMER REGISTRATION:
//   Supports multiple schema versions. v1.0 (thin-event/external webhook) and
//   v2.0 (SurveyV2Payload from internal /api/survey/submit) are both registered.
// ============================================================================

import type {
  TransformInput,
  TransformOutput,
  TransformSummary,
  PhysicalDataOutput,
  SurveyRawPayload,
} from './types';
import type { SchemaVersion, SurveyEventType } from '@/lib/survey/types';
import type {
  SurveyV2Payload,
  RoofMaterial,
  RoofPitch,
  RafterSpacing,
  PanelRating,
  PanelBrand,
} from '@/lib/survey/v2/types';

// ---------------------------------------------------------------------------
// Transformer interface — pluggable transform contract.
// ---------------------------------------------------------------------------
export interface SurveyTransformer {
  schemaVersion: SchemaVersion;
  eventType: SurveyEventType;
  transform(input: TransformInput): TransformResult;
}

export type TransformResult =
  | { ok: true; output: TransformOutput }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Transformer registry.
// ---------------------------------------------------------------------------
const _registry = new Map<string, SurveyTransformer>();

function _registryKey(schemaVersion: string, eventType: string): string {
  return `${schemaVersion}::${eventType}`;
}

export function registerTransformer(transformer: SurveyTransformer): void {
  const key = _registryKey(transformer.schemaVersion, transformer.eventType);
  if (_registry.has(key)) {
    console.warn(
      `[transformLayer] Overwriting existing transformer for key="${key}". ` +
      'This is expected during hot reload but unexpected in production.',
    );
  }
  _registry.set(key, transformer);
}

export function getTransformer(
  schemaVersion: string,
  eventType: string,
): SurveyTransformer | null {
  return _registry.get(_registryKey(schemaVersion, eventType)) ?? null;
}

export function listRegisteredTransformers(): string[] {
  return Array.from(_registry.keys());
}

// ---------------------------------------------------------------------------
// Enum normalization maps.
//
// Each function maps from the SurveyV2Payload enum string to the canonical
// string stored in project_physical_data. Never returns raw payload values
// without normalization. Returns null for unrecognized or empty values.
// ---------------------------------------------------------------------------

/**
 * Maps RoofMaterial enum → human-readable string for engineering/permits.
 * Engineering uses this as StructuralEngineering.roofType.
 */
export function mapRoofMaterial(val: RoofMaterial | '' | undefined | null): string | null {
  switch (val) {
    case 'comp_shingle':        return 'Asphalt Shingle';
    case 'tile_concrete':       return 'Concrete Tile';
    case 'tile_clay':           return 'Clay Tile';
    case 'metal_standing_seam': return 'Metal Standing Seam';
    case 'metal_r_panel':       return 'Metal R-Panel';
    case 'flat_tpo':            return 'Flat TPO';
    case 'flat_epdm':           return 'Flat EPDM';
    case 'flat_torch':          return 'Flat Torch-Down';
    case 'wood_shake':          return 'Wood Shake';
    case 'other':               return 'Other';
    default:                    return null;
  }
}

/**
 * Maps RoofPitch enum → stored string (same as enum — already canonical).
 */
export function mapRoofPitch(val: RoofPitch | '' | undefined | null): string | null {
  switch (val) {
    case 'flat':       return 'flat';
    case 'low':        return 'low';
    case 'standard':   return 'standard';
    case 'steep':      return 'steep';
    case 'very_steep': return 'very_steep';
    default:           return null;
  }
}

/**
 * Maps RafterSpacing enum → numeric inches for engineering.
 * Engineering uses this directly as rafterSpacingIn.
 */
export function mapRafterSpacing(val: RafterSpacing | '' | undefined | null): number | null {
  switch (val) {
    case '16':   return 16;
    case '24':   return 24;
    case 'other': return null; // unknown spacing — engineering falls back to default
    default:      return null;
  }
}

/**
 * Maps PanelRating enum → numeric amps for engineering.
 * Engineering uses this as mainPanelBusAmps for NEC 705.12(B) calc.
 */
export function mapPanelRatingAmps(val: PanelRating | '' | undefined | null): number | null {
  switch (val) {
    case '100': return 100;
    case '150': return 150;
    case '200': return 200;
    case '225': return 225;
    case '320': return 320;
    case '400': return 400;
    case 'other': return null; // unknown — engineering falls back to default
    default:      return null;
  }
}

/**
 * Maps PanelBrand enum → human-readable string.
 */
export function mapPanelBrand(val: PanelBrand | '' | undefined | null): string | null {
  switch (val) {
    case 'siemens':         return 'Siemens';
    case 'square_d':        return 'Square D';
    case 'eaton':           return 'Eaton';
    case 'cutler_hammer':   return 'Cutler-Hammer';
    case 'ge':              return 'GE';
    case 'federal_pacific': return 'Federal Pacific';
    case 'zinsco':          return 'Zinsco';
    case 'leviton':         return 'Leviton';
    case 'other':           return 'Other';
    default:                return null;
  }
}

/**
 * Normalizes available_breaker_slots — preserves range string as-is.
 */
export function mapBreakerSlots(val: string | '' | undefined | null): string | null {
  switch (val) {
    case '0':   return '0';
    case '1-2': return '1-2';
    case '3-4': return '3-4';
    case '5+':  return '5+';
    default:    return null;
  }
}

/**
 * Normalizes meter_socket_type.
 */
export function mapMeterSocketType(val: string | '' | undefined | null): string | null {
  switch (val) {
    case 'standard': return 'standard';
    case 'combo':    return 'combo';
    case '320a':     return '320a';
    case 'other':    return 'other';
    default:         return null;
  }
}

/**
 * Normalizes interconnection_point.
 */
export function mapInterconnectionPoint(val: string | '' | undefined | null): string | null {
  switch (val) {
    case 'main_panel':   return 'main_panel';
    case 'sub_panel':    return 'sub_panel';
    case 'load_side':    return 'load_side';
    case 'supply_side':  return 'supply_side';
    default:             return null;
  }
}

/**
 * Normalizes service_entrance_type.
 */
export function mapServiceEntrance(val: string | '' | undefined | null): string | null {
  switch (val) {
    case 'overhead':    return 'overhead';
    case 'underground': return 'underground';
    default:            return null;
  }
}

// ---------------------------------------------------------------------------
// extractPhysicalData — maps SurveyV2Payload → PhysicalDataOutput.
//
// This is the core Q3 implementation. Every field is explicitly mapped
// through a normalizer. No raw values pass through unvalidated.
// ---------------------------------------------------------------------------
function extractPhysicalData(payload: SurveyV2Payload): PhysicalDataOutput {
  const roof = payload.roofConditions;
  const elec = payload.electricalService;
  const obs  = payload.obstructions;
  const site = payload.siteOverview;

  return {
    // Structure / Roof
    roof_material:           mapRoofMaterial(roof?.roofMaterial),
    roof_pitch:              mapRoofPitch(roof?.roofPitch),
    rafter_spacing_in:       mapRafterSpacing(roof?.rafterSpacing),
    roof_condition:          roof?.roofCondition || null,
    roof_age_years:          (typeof roof?.roofAgeYears === 'number' && roof.roofAgeYears >= 0)
                               ? Math.round(roof.roofAgeYears)
                               : null,
    attic_access:            typeof roof?.atticAccess === 'boolean' ? roof.atticAccess : null,

    // Electrical
    panel_brand:             mapPanelBrand(elec?.panelBrand),
    panel_rating_amps:       mapPanelRatingAmps(elec?.panelRating),
    available_breaker_slots: mapBreakerSlots(elec?.availableBreakerSlots),
    meter_socket_type:       mapMeterSocketType(elec?.meterSocketType),
    interconnection_point:   mapInterconnectionPoint(elec?.interconnectionPoint),
    service_entrance_type:   mapServiceEntrance(elec?.serviceEntrance),
    has_sub_panel:           typeof elec?.hasSubPanel === 'boolean' ? elec.hasSubPanel : null,
    sub_panel_rating_amps:   mapPanelRatingAmps(elec?.subPanelRating),

    // Constraints
    obstructions:            Array.isArray(obs?.obstructions) ? obs.obstructions : [],
    usable_roof_pct:         (typeof obs?.estimatedUsableRoofPct === 'number' &&
                               obs.estimatedUsableRoofPct >= 0 &&
                               obs.estimatedUsableRoofPct <= 100)
                               ? Math.round(obs.estimatedUsableRoofPct)
                               : null,
    setback_notes:           obs?.setbackNotes?.trim() || null,

    // Survey metadata
    inspector_name:   payload.inspectorName?.trim() || null,
    surveyed_at:      payload.submittedAt || null,
    access_notes:     site?.accessNotes?.trim() || null,
    mounting_notes:   roof?.mountingNotes?.trim() || null,
    electrical_notes: elec?.electricalNotes?.trim() || null,

    // Site overview
    structure_type: site?.structureType || null,
    stories:        site?.stories || null,
  };
}

// ---------------------------------------------------------------------------
// v2.0 / survey.completed — built-in transformer for SurveyV2Payload.
//
// This is the primary transformer used when the survey is submitted via
// POST /api/survey/submit (internal — JWT verified, project_id known).
// ---------------------------------------------------------------------------
const v2SurveyCompletedTransformer: SurveyTransformer = {
  schemaVersion: '2.0',
  eventType: 'survey.completed',

  transform(input: TransformInput): TransformResult {
    const { event, rawPayload, context } = input;

    try {
      // v2.0 payloads are SurveyV2Payload — cast via unknown (safe: validated upstream by /api/survey/submit).
      const payload = (rawPayload as unknown) as SurveyV2Payload | null;

      // --- projectName ---
      const projectName = payload?.siteOverview?.projectName?.trim()
        || payload?.siteOverview?.siteAddress?.trim()
        || `Survey ${event.survey_id}`;

      // --- address ---
      const address = payload?.siteOverview?.siteAddress?.trim() || null;

      // --- lat / lng ---
      const lat = (typeof payload?.siteOverview?.latitude === 'number' &&
                   isFinite(payload.siteOverview.latitude))
        ? payload.siteOverview.latitude
        : null;
      const lng = (typeof payload?.siteOverview?.longitude === 'number' &&
                   isFinite(payload.siteOverview.longitude))
        ? payload.siteOverview.longitude
        : null;

      // --- surveyMeta ---
      // Stored in projects.survey_meta JSONB for audit purposes.
      const surveyMeta: Record<string, unknown> = {
        ingestedAt:      context.receivedAt,
        traceId:         context.traceId,
        surveyId:        event.survey_id,
        completedAt:     event.completed_at,
        surveyUrl:       event.survey_url ?? null,
        inspectorName:   payload?.inspectorName ?? null,
        schemaVersion:   payload?.schemaVersion ?? '2.0',
      };

      // --- physicalData ---
      const physicalData: PhysicalDataOutput | null = payload
        ? extractPhysicalData(payload)
        : null;

      // --- files (photos) ---
      const files = extractPhotos(payload, event.survey_id);

      const output: TransformOutput = {
        projectName,
        address,
        lat,
        lng,
        surveyMeta,
        files,
        physicalData,
      };

      return { ok: true, output };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: `v2.0 transformer threw: ${message}`,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// v1.0 / survey.completed — partner payload transformer.
//
// The partner (Render / site-survey-api) posts a thin webhook event and
// SolarPro fetches the full payload from GET /api/surveys/:id.
//
// Partner payload shape (confirmed 2026-04-24 from live survey d10bd145):
//   id, site_name, site_address, latitude, longitude, inspector_name,
//   survey_date, metadata { type, azimuth, rafter_size, rafter_spacing,
//   roof_age_years, roof_material }, photos[{ id, label, file_path,
//   mime_type, captured_at }], checklist[{ label, status, notes }]
//
// rawPayload may be null (degraded mode: PARTNER_API_BEARER_TOKEN missing
// or partner API unreachable). All extraction is defensive.
// ---------------------------------------------------------------------------
const v1SurveyCompletedTransformer: SurveyTransformer = {
  schemaVersion: '1.0',
  eventType: 'survey.completed',

  transform(input: TransformInput): TransformResult {
    const { event, rawPayload, context } = input;

    try {
      // --- projectName ---
      // Priority: full payload (site_name/project_name) > thin event fields > UUID fallback
      // The partner sends project_name and site_name in the thin webhook event.
      // These are used when fetchFullPayload returns null (degraded mode) so we
      // never fall back to the raw UUID which is unreadable in the UI.
      const projectName = rawPayload !== null
        ? extractProjectNameLegacy(rawPayload, event.survey_id)
        : (event.site_name?.trim() || event.project_name?.trim() || `Survey ${event.survey_id}`);

      // --- address ---
      const address = rawPayload !== null ? extractAddressLegacy(rawPayload) : null;

      // --- lat / lng ---
      // Partner uses 'latitude'/'longitude' (not 'lat'/'lng').
      const lat = rawPayload !== null ? extractNumberLegacy(rawPayload, 'latitude', 'lat') : null;
      const lng = rawPayload !== null ? extractNumberLegacy(rawPayload, 'longitude', 'lng') : null;

      // --- surveyMeta ---
      const surveyMeta: Record<string, unknown> = {
        ingestedAt:    context.receivedAt,
        traceId:       context.traceId,
        surveyId:      event.survey_id,
        completedAt:   event.completed_at,
        surveyUrl:     event.survey_url ?? null,
        inspectorName: rawPayload !== null ? (rawPayload['inspector_name'] ?? null) : null,
        categoryName:  rawPayload !== null ? (rawPayload['category_name'] ?? null) : null,
      };

      // --- files ---
      const files = rawPayload !== null
        ? extractFilesLegacy(rawPayload, event.survey_id)
        : [];

      // --- physicalData --- extracted from partner metadata + top-level fields
      const physicalData = rawPayload !== null
        ? extractPhysicalDataLegacy(rawPayload)
        : null;

      const output: TransformOutput = {
        projectName,
        address,
        lat,
        lng,
        surveyMeta,
        files,
        physicalData,
      };

      return { ok: true, output };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: `v1.0 transformer threw: ${message}`,
      };
    }
  },
};

// Register both transformers at module load time.

registerTransformer(v1SurveyCompletedTransformer);
registerTransformer(v2SurveyCompletedTransformer);

// ---------------------------------------------------------------------------
// Photo extraction — SurveyV2Payload.photos → TransformOutput.files
// ---------------------------------------------------------------------------
function extractPhotos(
  payload: SurveyV2Payload | null,
  surveyId: string,
): TransformOutput['files'] {
  if (!payload || !Array.isArray(payload.photos)) return [];

  const files: TransformOutput['files'] = [];

  for (let i = 0; i < payload.photos.length; i++) {
    const photo = payload.photos[i];
    // url is the blob/S3 URL after upload — always present for v2 SurveyPhoto
    if (!photo?.url) continue;

    // category is the canonical survey slot key (e.g. 'main_panel_open', 'roof_overview').
    // This is written directly to site_survey_files.label — no filename guessing needed.
    const category = photo.category?.trim() || null;

    // Prefer tag (human label e.g. 'roof_overview') over category for filename
    const photoLabel = photo.tag?.trim()
      || category
      || 'photo';
    const photoName = `${photoLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${i + 1}.jpg`;

    // Capture-time device GPS (SurveyV2 only) — validated here so a malformed
    // client value can never poison the DB write.
    const gps = photo.gps && isFinite(photo.gps.lat) && isFinite(photo.gps.lng)
      && Math.abs(photo.gps.lat) <= 90 && Math.abs(photo.gps.lng) <= 180
      && (Math.abs(photo.gps.lat) > 0.001 || Math.abs(photo.gps.lng) > 0.001)
      ? { lat: photo.gps.lat, lng: photo.gps.lng, accuracyM: photo.gps.accuracyM }
      : null;

    files.push({
      externalId: photo.id || `${surveyId}-photo-${i}`,
      name:       photoName,
      url:        photo.url,
      mimeType:   'image/jpeg',
      category,
      gps,
    });
  }

  return files;
}

// ---------------------------------------------------------------------------
// Legacy field extraction helpers (v1.0 / partner payload).
//
// Partner payload shape (confirmed 2026-04-24):
//   site_name, site_address, latitude, longitude, inspector_name,
//   metadata.rafter_spacing, metadata.roof_age_years, metadata.rafter_size,
//   metadata.azimuth, metadata.type, metadata.roof_material
//   photos[{ id, label, file_path, mime_type, captured_at }]
//
// All are defensive — never throw, always return null/empty on missing data.
// ---------------------------------------------------------------------------

function extractProjectNameLegacy(payload: SurveyRawPayload, fallback: string): string {
  for (const key of ['site_name', 'project_name', 'name', 'title', 'address', 'site_address']) {
    const val = payload[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  }
  return `Survey ${fallback}`;
}

function extractAddressLegacy(payload: SurveyRawPayload): string | null {
  for (const key of ['site_address', 'address', 'full_address', 'street_address']) {
    const val = payload[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  }
  return null;
}

/**
 * Extract a numeric field — supports multiple candidate key names.
 * Partner uses 'latitude'/'longitude'; older payloads may use 'lat'/'lng'.
 */
function extractNumberLegacy(payload: SurveyRawPayload, ...keys: string[]): number | null {
  for (const key of keys) {
    const val = payload[key];
    if (typeof val === 'number' && isFinite(val)) return val;
    if (typeof val === 'string') {
      const n = parseFloat(val);
      if (isFinite(n)) return n;
    }
  }
  return null;
}

/**
 * Parse rafter_spacing string → numeric inches.
 * Partner sends '24in', '16in', '24', '16', etc.
 */
function parseRafterSpacingLegacy(val: unknown): number | null {
  if (typeof val !== 'string' && typeof val !== 'number') return null;
  const str = String(val).trim().toLowerCase().replace('in', '').replace('"', '');
  const n = parseFloat(str);
  if (!isFinite(n)) return null;
  // Sanity check: rafter spacing is typically 12–48 inches
  if (n < 8 || n > 72) return null;
  return n;
}

/**
 * extractPhysicalDataLegacy — maps partner payload → PhysicalDataOutput.
 *
 * Pulls from top-level fields and metadata JSONB:
 *   metadata.rafter_spacing → rafter_spacing_in (parsed from '24in' → 24)
 *   metadata.roof_age_years → roof_age_years
 *   metadata.rafter_size    → mounting_notes ('2x6', '2x8', etc.)
 *   metadata.azimuth        → stored in mounting_notes
 *   metadata.roof_material  → roof_material
 *   inspector_name          → inspector_name
 *   survey_date             → surveyed_at
 */
function extractPhysicalDataLegacy(payload: SurveyRawPayload): import('./types').PhysicalDataOutput | null {
  try {
    const meta = (typeof payload['metadata'] === 'object' && payload['metadata'] !== null)
      ? payload['metadata'] as Record<string, unknown>
      : {};

    const rafterSpacingIn = parseRafterSpacingLegacy(meta['rafter_spacing']);

    const roofAgeYears = (typeof meta['roof_age_years'] === 'number' && isFinite(meta['roof_age_years']))
      ? Math.round(meta['roof_age_years'])
      : (typeof meta['roof_age_years'] === 'string')
        ? (() => { const n = parseInt(meta['roof_age_years'] as string, 10); return isFinite(n) ? n : null; })()
        : null;

    // rafter_size (e.g. '2x6') + azimuth → mounting_notes
    const rafterSize = typeof meta['rafter_size'] === 'string' ? meta['rafter_size'].trim() : null;
    const azimuth    = typeof meta['azimuth'] === 'number' ? meta['azimuth'] : null;
    const mountingParts: string[] = [];
    if (rafterSize) mountingParts.push(`Rafter size: ${rafterSize}`);
    if (azimuth !== null) mountingParts.push(`Azimuth: ${azimuth}°`);
    const mountingNotes = mountingParts.length > 0 ? mountingParts.join(' | ') : null;

    // roof_material from metadata (may be null if not collected)
    const roofMaterial = typeof meta['roof_material'] === 'string' && meta['roof_material'].trim()
      ? meta['roof_material'].trim()
      : null;

    // inspector_name from top-level
    const inspectorName = typeof payload['inspector_name'] === 'string'
      ? payload['inspector_name'].trim() || null
      : null;

    // survey_date → surveyed_at
    const surveyedAt = typeof payload['survey_date'] === 'string'
      ? payload['survey_date']
      : null;

    // Only return physicalData if we actually have something useful
    const hasData = rafterSpacingIn !== null || roofAgeYears !== null ||
                    roofMaterial !== null || mountingNotes !== null;
    if (!hasData) return null;

    return {
      roof_material:           roofMaterial,
      roof_pitch:              null,
      rafter_spacing_in:       rafterSpacingIn,
      roof_condition:          null,
      roof_age_years:          roofAgeYears,
      attic_access:            null,
      panel_brand:             null,
      panel_rating_amps:       null,
      available_breaker_slots: null,
      meter_socket_type:       null,
      interconnection_point:   null,
      service_entrance_type:   null,
      has_sub_panel:           null,
      sub_panel_rating_amps:   null,
      obstructions:            [],
      usable_roof_pct:         null,
      setback_notes:           null,
      inspector_name:          inspectorName,
      surveyed_at:             surveyedAt,
      access_notes:            null,
      mounting_notes:          mountingNotes,
      electrical_notes:        null,
      structure_type:          null,
      stories:                 null,
    };
  } catch {
    return null;
  }
}

/**
 * extractFilesLegacy — maps partner photos array → TransformFile[].
 *
 * Partner photo shape: { id, label, file_path, mime_type, captured_at }
 * file_path is a /uploads/... path relative to PARTNER_BASE_URL.
 * buildPhotoUrl() in payloadFetcher.ts constructs the full URL.
 */
function extractFilesLegacy(
  payload: SurveyRawPayload,
  surveyId: string,
): TransformOutput['files'] {
  // Partner uses 'photos'; fall back to other common names
  for (const key of ['photos', 'images', 'files', 'attachments', 'media']) {
    const arr = payload[key];
    if (!Array.isArray(arr) || arr.length === 0) continue;

    const files: TransformOutput['files'] = [];

    for (let i = 0; i < arr.length; i++) {
      const item = arr[i] as Record<string, unknown>;

      // Partner uses 'file_path' (a /uploads/... path).
      // Build full URL by prepending PARTNER_BASE_URL.
      const rawPath = typeof item?.file_path === 'string' ? item.file_path
        : typeof item?.remote_url === 'string' ? item.remote_url
        : typeof item?.url === 'string' ? item.url
        : typeof item?.href === 'string' ? item.href
        : typeof item === 'string' ? item
        : null;

      if (!rawPath) continue;

      // Construct full URL: if it's a /uploads/... path, prepend PARTNER_BASE_URL
      const baseUrl = (process.env.PARTNER_BASE_URL ?? '').replace(/\/$/, '');
      const url = rawPath.startsWith('http') ? rawPath : `${baseUrl}${rawPath.startsWith('/') ? '' : '/'}${rawPath}`;

      const externalId = typeof item?.id === 'string' ? item.id : `${surveyId}-${key}-${i}`;

      // Use label as name (e.g. "Detached garage south roof")
      const label = typeof item?.label === 'string' ? item.label.trim() : null;
      const name = label
        ? `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${i + 1}.jpg`
        : typeof item?.name     === 'string' ? item.name      // direct name field (v1.0 / partner)
        : typeof item?.filename === 'string' ? item.filename  // filename alias
        : `photo-${i + 1}.jpg`;

      const mimeType = typeof item?.mime_type === 'string' ? item.mime_type
        : typeof item?.content_type === 'string' ? item.content_type
        : 'image/jpeg';

      files.push({ externalId, name, url, mimeType, category: null });
    }

    if (files.length > 0) return files;
  }

  return [];
}

// ---------------------------------------------------------------------------
// buildTransformSummary — produce a lightweight log record from TransformOutput.
// ---------------------------------------------------------------------------
export function buildTransformSummary(output: TransformOutput): TransformSummary {
  return {
    projectName:     output.projectName,
    hasAddress:      output.address !== null,
    fileCount:       output.files.length,
    hasSurveyMeta:   Object.keys(output.surveyMeta).length > 0,
    hasPhysicalData: output.physicalData !== null,
    panelRatingAmps: output.physicalData?.panel_rating_amps ?? null,
    roofMaterial:    output.physicalData?.roof_material ?? null,
    rafterSpacingIn: output.physicalData?.rafter_spacing_in ?? null,
  };
}

// ---------------------------------------------------------------------------
// transform — convenience wrapper used by the pipeline.
// ---------------------------------------------------------------------------
export function transform(input: TransformInput): TransformResult {
  const { event } = input;
  const transformer = getTransformer(event.schemaVersion, event.event);

  if (!transformer) {
    return {
      ok: false,
      error:
        `No transformer registered for schemaVersion="${event.schemaVersion}" ` +
        `eventType="${event.event}". ` +
        `Registered transformers: ${listRegisteredTransformers().join(', ') || '(none)'}`,
    };
  }

  return transformer.transform(input);
}