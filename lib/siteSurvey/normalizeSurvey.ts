// ============================================================================
// lib/siteSurvey/normalizeSurvey.ts — Site Survey Normalization Layer
//
// VERSION: SITE_SURVEY_PIPELINE_VERSION = 1
//
// PIPELINE POSITION:
//   RawSurveyPayload (field app)
//     → normalizeSurvey()  ← YOU ARE HERE
//     → enrichSurvey()     → EnrichedSiteSurvey
//     → applyToSystemDefinition() → SystemDefinition (override layer only)
//
// RESPONSIBILITIES:
//   1. Unit normalization  — ft/in strings → numeric inches, string amps → number
//   2. Default handling    — missing structural fields get safe fallbacks
//   3. Type coercion       — string values → canonical union types
//   4. Geometry cleanup    — invalid roof planes filtered, degenerate vertices removed
//   5. Enum normalization  — loose strings → canonical union values
//   6. ID generation       — missing obstruction/plane IDs auto-assigned
//
// CONTRACTS:
//   - NEVER throws — all errors are pushed to normalizationLog
//   - NEVER calls DB, network, or filesystem
//   - Input: RawSurveyPayload (loose, partial, may have string numbers)
//   - Output: NormalizedSiteSurvey (tight, fully typed, all required fields present)
//   - Mirrors the billEnrichment step-by-step + log pattern exactly
// ============================================================================

// PIPELINE STATUS: WIRED — imported by app/api/engineering/generate, permit, preliminary
import {
  SITE_SURVEY_PIPELINE_VERSION,
  type RawSurveyPayload,
  type NormalizedSiteSurvey,
  type SurveySystemType,
  type SurveyRoofPlane,
  type SurveyObstruction,
  type SurveySetback,
  type SurveyPhotoRef,
  type RafterSize,
  type WindExposureCategory,
  type ServiceEntrance,
  type MeterSocketType,
  type InterconnectionPoint,
  type PanelBrand,
  type GeoPoint,
} from './types';

// ─── Structural defaults ──────────────────────────────────────────────────────
// These are the conservative safe-fallback values used when the field app
// did not capture a structural measurement. They represent typical residential
// construction in the US and will generate a "warn" flag in the enrichment layer.

const DEFAULT_RAFTER_SPACING_IN = 24;   // inches OC — most common residential
const DEFAULT_RAFTER_SIZE: RafterSize = '2x6';
const DEFAULT_DECKING_THICKNESS_IN = 0.5; // 1/2" OSB — most common
const DEFAULT_WIND_EXPOSURE: WindExposureCategory = 'C'; // conservative default

// ─── Electrical defaults ──────────────────────────────────────────────────────

const DEFAULT_SERVICE_ENTRANCE: ServiceEntrance = 'unknown';
const DEFAULT_METER_TYPE: MeterSocketType = 'unknown';
const DEFAULT_INTERCONNECTION: InterconnectionPoint = 'unknown';
const DEFAULT_PANEL_BRAND: PanelBrand = 'unknown';

// ─── Geometry constants ───────────────────────────────────────────────────────

/** Minimum vertices for a valid polygon roof plane */
const MIN_POLYGON_VERTICES = 3;

/** Maximum plausible roof plane area (sq ft) — above this is likely a data error */
const MAX_ROOF_PLANE_AREA_SQFT = 25000;

/** Minimum plausible roof plane area (sq ft) — below this is too small to matter */
const MIN_ROOF_PLANE_AREA_SQFT = 10;

// ─── Main normalization function ──────────────────────────────────────────────

/**
 * normalizeSurvey — transforms RawSurveyPayload into NormalizedSiteSurvey.
 *
 * Pure synchronous function. Never throws. All warnings and errors are
 * captured in the returned normalizationLog array.
 *
 * @param raw  Loose payload from field app or API ingest route
 * @returns    NormalizedSiteSurvey with all required fields guaranteed
 */
export function normalizeSurvey(raw: RawSurveyPayload): NormalizedSiteSurvey {
  const log: string[] = [];

  log.push(`[normalize] Starting normalization for survey=${raw.id} project=${raw.projectId}`);

  // ── Step 1: Validate required identity fields ────────────────────────────────

  const id = normalizeString(raw.id) ?? `survey_${Date.now()}`;
  const projectId = normalizeString(raw.projectId) ?? 'unknown';

  if (!raw.id || raw.id.trim().length === 0) {
    log.push(`[normalize] WARN: Missing survey ID — generated fallback id=${id}`);
  }
  if (!raw.projectId || raw.projectId.trim().length === 0) {
    log.push(`[normalize] WARN: Missing projectId`);
  }

  // ── Step 2: Normalize location ────────────────────────────────────────────────

  const location = normalizeLocation(raw.location, log);

  // ── Step 3: Normalize system type ────────────────────────────────────────────

  const systemType = normalizeSystemType(raw.systemType, log);

  // ── Step 4: Normalize geometry ────────────────────────────────────────────────

  const geometry = normalizeGeometry(raw.geometry, log);

  // ── Step 5: Normalize structural data ────────────────────────────────────────

  const structural = normalizeStructural(raw.structural, log);

  // ── Step 6: Normalize electrical data ────────────────────────────────────────

  const electrical = normalizeElectrical(raw.electrical, log);

  // ── Step 7: Normalize photos ──────────────────────────────────────────────────

  const photos = normalizePhotos(raw.photos, log);

  // ── Step 8: Normalize metadata ────────────────────────────────────────────────

  const installerNotes = normalizeString(raw.installerNotes) ?? null;
  const inspectorName = normalizeString(raw.inspectorName) ?? null;
  const surveyedAt = normalizeTimestamp(raw.surveyedAt, log);

  log.push(`[normalize] Completed: ${log.filter(l => l.includes('WARN')).length} warnings`);
  log.push(`[normalize] Geometry: ${geometry.roofPlanes.length} planes, ${geometry.obstructions.length} obstructions, ${geometry.setbacks.length} setbacks`);

  return {
    id,
    projectId,
    pipelineVersion: SITE_SURVEY_PIPELINE_VERSION,
    location,
    systemType,
    geometry,
    structural,
    electrical,
    photos,
    installerNotes,
    inspectorName,
    surveyedAt,
    normalizationLog: log,
  };
}

// ─── Step 2: Location normalization ──────────────────────────────────────────

function normalizeLocation(
  raw: RawSurveyPayload['location'],
  log: string[],
): NormalizedSiteSurvey['location'] {
  if (!raw) {
    log.push(`[normalize] WARN: Missing location block`);
    return { lat: null, lng: null, elevation: null, azimuthReference: null, address: null };
  }

  const lat = normalizeLatLng(raw.lat, 'lat', -90, 90, log);
  const lng = normalizeLatLng(raw.lng, 'lng', -180, 180, log);

  const elevation = typeof raw.elevation === 'number' && isFinite(raw.elevation)
    ? raw.elevation
    : null;
  if (raw.elevation !== null && raw.elevation !== undefined && elevation === null) {
    log.push(`[normalize] WARN: Invalid elevation value: ${raw.elevation}`);
  }

  // Azimuth reference correction: clamp to [-360, 360], null if invalid
  let azimuthReference: number | null = null;
  if (raw.azimuthReference !== null && raw.azimuthReference !== undefined) {
    const ref = Number(raw.azimuthReference);
    if (isFinite(ref) && ref >= -360 && ref <= 360) {
      azimuthReference = ref;
    } else {
      log.push(`[normalize] WARN: Invalid azimuthReference: ${raw.azimuthReference} — ignored`);
    }
  }

  const address = normalizeString(raw.address) ?? null;

  return { lat, lng, elevation, azimuthReference, address };
}

// ─── Step 3: System type normalization ───────────────────────────────────────

function normalizeSystemType(
  raw: RawSurveyPayload['systemType'],
  log: string[],
): SurveySystemType {
  if (!raw) {
    log.push(`[normalize] WARN: Missing systemType — defaulting to 'roof'`);
    return 'roof';
  }
  const cleaned = String(raw).toLowerCase().trim();
  if (cleaned === 'roof' || cleaned === 'rooftop' || cleaned === 'roof-mount') return 'roof';
  if (cleaned === 'ground' || cleaned === 'ground-mount' || cleaned === 'ground_mount') return 'ground';
  if (cleaned === 'fence' || cleaned === 'fence-mount' || cleaned === 'carport') return 'fence';
  log.push(`[normalize] WARN: Unrecognized systemType="${raw}" — defaulting to 'roof'`);
  return 'roof';
}

// ─── Step 4: Geometry normalization ──────────────────────────────────────────

function normalizeGeometry(
  raw: RawSurveyPayload['geometry'],
  log: string[],
): NormalizedSiteSurvey['geometry'] {
  if (!raw) {
    log.push(`[normalize] WARN: Missing geometry block — all geometry fields empty`);
    return { roofPlanes: [], obstructions: [], setbacks: [], usableAreaSqFt: null };
  }

  const roofPlanes = normalizeRoofPlanes(raw.roofPlanes, log);
  const obstructions = normalizeObstructions(raw.obstructions, log);
  const setbacks = normalizeSetbacks(raw.setbacks, log);

  let usableAreaSqFt: number | null = null;
  if (raw.usableAreaSqFt !== null && raw.usableAreaSqFt !== undefined) {
    const v = Number(raw.usableAreaSqFt);
    if (isFinite(v) && v > 0) {
      usableAreaSqFt = v;
      log.push(`[normalize] Field-measured usable area: ${v} sqft`);
    } else {
      log.push(`[normalize] WARN: Invalid usableAreaSqFt=${raw.usableAreaSqFt} — ignored`);
    }
  }

  return { roofPlanes, obstructions, setbacks, usableAreaSqFt };
}

function normalizeRoofPlanes(
  raw: Array<Partial<SurveyRoofPlane>> | null | undefined,
  log: string[],
): SurveyRoofPlane[] {
  if (!raw || raw.length === 0) {
    log.push(`[normalize] WARN: No roof planes provided`);
    return [];
  }

  const planes: SurveyRoofPlane[] = [];

  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    const planeLabel = `plane[${i}]`;

    // Require at least a polygon OR an area
    if (!p) {
      log.push(`[normalize] WARN: ${planeLabel} is null/undefined — skipped`);
      continue;
    }

    // Auto-assign ID if missing
    const id = normalizeString(p.id) ?? `plane_${i + 1}`;

    // Pitch: must be 0–90 degrees
    let pitch: number = 0;
    if (p.pitch !== null && p.pitch !== undefined) {
      const v = Number(p.pitch);
      if (isFinite(v) && v >= 0 && v <= 90) {
        pitch = v;
      } else {
        log.push(`[normalize] WARN: ${planeLabel} invalid pitch=${p.pitch} — defaulting to 0`);
      }
    } else {
      log.push(`[normalize] WARN: ${planeLabel} missing pitch — defaulting to 0 (flat)`);
    }

    // Azimuth: normalize to 0–359
    let azimuth: number = 180; // south-facing default
    if (p.azimuth !== null && p.azimuth !== undefined) {
      const v = Number(p.azimuth);
      if (isFinite(v)) {
        azimuth = ((v % 360) + 360) % 360; // normalize to [0, 360)
      } else {
        log.push(`[normalize] WARN: ${planeLabel} invalid azimuth=${p.azimuth} — defaulting to 180°S`);
      }
    } else {
      log.push(`[normalize] WARN: ${planeLabel} missing azimuth — defaulting to 180°S`);
    }

    // Area: must be positive, within plausible range
    let area: number = 0;
    if (p.area !== null && p.area !== undefined) {
      const v = Number(p.area);
      if (isFinite(v) && v >= MIN_ROOF_PLANE_AREA_SQFT && v <= MAX_ROOF_PLANE_AREA_SQFT) {
        area = v;
      } else if (isFinite(v) && v > 0 && v < MIN_ROOF_PLANE_AREA_SQFT) {
        log.push(`[normalize] WARN: ${planeLabel} area=${v} sqft below minimum ${MIN_ROOF_PLANE_AREA_SQFT} sqft — kept but flagged`);
        area = v;
      } else {
        log.push(`[normalize] WARN: ${planeLabel} invalid area=${p.area} — defaulting to 0`);
      }
    } else {
      log.push(`[normalize] WARN: ${planeLabel} missing area`);
    }

    // Vertices: must have at least MIN_POLYGON_VERTICES valid GeoPoints
    const vertices = normalizeGeoPolygon(p.vertices, planeLabel, log);
    if (vertices.length > 0 && vertices.length < MIN_POLYGON_VERTICES) {
      log.push(`[normalize] WARN: ${planeLabel} polygon has only ${vertices.length} vertices (min ${MIN_POLYGON_VERTICES}) — cleared`);
      planes.push({ id, pitch, azimuth, area, vertices: [] });
      continue;
    }

    planes.push({ id, pitch, azimuth, area, vertices });
    log.push(`[normalize] ${planeLabel} id=${id} pitch=${pitch}° az=${azimuth}° area=${area}sqft vertices=${vertices.length}`);
  }

  log.push(`[normalize] Roof planes: ${planes.length}/${raw.length} valid`);
  return planes;
}

function normalizeObstructions(
  raw: Array<Partial<SurveyObstruction>> | null | undefined,
  log: string[],
): SurveyObstruction[] {
  if (!raw || raw.length === 0) return [];

  const obstructions: SurveyObstruction[] = [];
  const VALID_TYPES: SurveyObstruction['type'][] = [
    'skylight', 'vent_pipe', 'hvac', 'chimney', 'antenna',
    'dormer', 'solar_tube', 'other',
  ];

  for (let i = 0; i < raw.length; i++) {
    const o = raw[i];
    if (!o) continue;

    const id = normalizeString(o.id) ?? `obs_${i + 1}`;
    const label = `obstruction[${i}] id=${id}`;

    // Type coercion
    const rawType = o.type ? String(o.type).toLowerCase().trim() : null;
    const type: SurveyObstruction['type'] = VALID_TYPES.includes(rawType as SurveyObstruction['type'])
      ? (rawType as SurveyObstruction['type'])
      : 'other';
    if (rawType && !VALID_TYPES.includes(rawType as SurveyObstruction['type'])) {
      log.push(`[normalize] WARN: ${label} unrecognized type="${o.type}" — mapped to 'other'`);
    }

    // Position
    if (!o.position || typeof o.position.lat !== 'number' || typeof o.position.lng !== 'number') {
      log.push(`[normalize] WARN: ${label} missing/invalid position — skipped`);
      continue;
    }
    const position: GeoPoint = {
      lat: o.position.lat,
      lng: o.position.lng,
    };

    // Dimensions — normalize each to a finite positive number, default 0
    const dims = o.dimensions;
    const widthFt = (dims?.widthFt !== undefined && isFinite(Number(dims.widthFt)) && Number(dims.widthFt) > 0)
      ? Number(dims.widthFt) : 0;
    const lengthFt = (dims?.lengthFt !== undefined && isFinite(Number(dims.lengthFt)) && Number(dims.lengthFt) > 0)
      ? Number(dims.lengthFt) : 0;
    const heightFt = (dims?.heightFt !== undefined && isFinite(Number(dims.heightFt)) && Number(dims.heightFt) >= 0)
      ? Number(dims.heightFt) : 0;

    if (!dims || widthFt === 0 || lengthFt === 0) {
      log.push(`[normalize] WARN: ${label} missing dimensions — defaulted to 0`);
    }

    // Setback: NEC requires 3ft from most obstructions
    const setbackFt = (o.setbackFt !== undefined && isFinite(Number(o.setbackFt)) && Number(o.setbackFt) >= 0)
      ? Number(o.setbackFt)
      : 3; // NEC 690.12 default 3ft setback

    obstructions.push({
      id,
      type,
      position,
      dimensions: { widthFt, lengthFt, heightFt },
      setbackFt,
      notes: normalizeString(o.notes) ?? undefined,
    });
  }

  log.push(`[normalize] Obstructions: ${obstructions.length}/${raw.length} valid`);
  return obstructions;
}

function normalizeSetbacks(
  raw: Array<Partial<SurveySetback>> | null | undefined,
  log: string[],
): SurveySetback[] {
  if (!raw || raw.length === 0) return [];

  const VALID_EDGES: SurveySetback['edges'][number][] = ['eave', 'rake', 'ridge', 'valley', 'hip'];
  const setbacks: SurveySetback[] = [];

  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    if (!s) continue;

    // Normalize edges — filter to valid values
    const rawEdges = Array.isArray(s.edges) ? s.edges : [];
    const edges = rawEdges.filter((e): e is SurveySetback['edges'][number] =>
      VALID_EDGES.includes(e as SurveySetback['edges'][number])
    );
    if (edges.length === 0) {
      log.push(`[normalize] WARN: setback[${i}] has no valid edges — skipped`);
      continue;
    }

    // Normalize distance — must be a positive number in inches
    let distanceIn: number = 36; // NEC default 36" (3ft) setback
    if (s.distanceIn !== null && s.distanceIn !== undefined) {
      const v = Number(s.distanceIn);
      if (isFinite(v) && v >= 0) {
        distanceIn = v;
      } else {
        log.push(`[normalize] WARN: setback[${i}] invalid distanceIn=${s.distanceIn} — defaulting to 36"`);
      }
    } else {
      log.push(`[normalize] WARN: setback[${i}] missing distanceIn — defaulting to 36"`);
    }

    setbacks.push({
      edges,
      distanceIn,
      reference: normalizeString(s.reference) ?? undefined,
    });
  }

  return setbacks;
}

// ─── Step 5: Structural normalization ────────────────────────────────────────

function normalizeStructural(
  raw: RawSurveyPayload['structural'],
  log: string[],
): NormalizedSiteSurvey['structural'] {
  if (!raw) {
    log.push(`[normalize] WARN: Missing structural block — all defaults applied`);
    return {
      rafterSpacingIn: DEFAULT_RAFTER_SPACING_IN,
      rafterSize: DEFAULT_RAFTER_SIZE,
      deckingThicknessIn: DEFAULT_DECKING_THICKNESS_IN,
      windExposure: DEFAULT_WIND_EXPOSURE,
      snowLoadPsf: null,
      roofCondition: null,
      roofAgeYears: null,
      atticAccess: null,
      roofMaterial: null,
      roofPitch: null,
      roofPitchDegrees: null,
      stories: null,
      structureType: null,
    };
  }

  // ── Rafter spacing ────────────────────────────────────────────────────────────
  // May arrive as number (24) or string ("24" or "24 OC" or "24\"")
  const rafterSpacingIn = parseRafterSpacing(raw.rafterSpacingIn, log);

  // ── Rafter size ───────────────────────────────────────────────────────────────
  const rafterSize = normalizeRafterSize(raw.rafterSize, log);

  // ── Decking thickness ─────────────────────────────────────────────────────────
  const deckingThicknessIn = parseDeckingThickness(raw.deckingThicknessIn, log);

  // ── Wind exposure ─────────────────────────────────────────────────────────────
  const windExposure = normalizeWindExposure(raw.windExposure, log);

  // ── Snow load ─────────────────────────────────────────────────────────────────
  let snowLoadPsf: number | null = null;
  if (raw.snowLoadPsf !== null && raw.snowLoadPsf !== undefined) {
    const v = Number(raw.snowLoadPsf);
    if (isFinite(v) && v >= 0) {
      snowLoadPsf = v;
    } else {
      log.push(`[normalize] WARN: Invalid snowLoadPsf=${raw.snowLoadPsf} — ignored`);
    }
  }

  // ── Roof condition ────────────────────────────────────────────────────────────
  let roofCondition: 'good' | 'fair' | 'poor' | null = null;
  if (raw.roofCondition) {
    const c = String(raw.roofCondition).toLowerCase().trim();
    if (c === 'good' || c === 'excellent' || c === 'new') roofCondition = 'good';
    else if (c === 'fair' || c === 'average' || c === 'moderate') roofCondition = 'fair';
    else if (c === 'poor' || c === 'bad' || c === 'damaged') roofCondition = 'poor';
    else {
      log.push(`[normalize] WARN: Unrecognized roofCondition="${raw.roofCondition}" — ignored`);
    }
  }

  // ── Roof age ──────────────────────────────────────────────────────────────────
  let roofAgeYears: number | null = null;
  if (raw.roofAgeYears !== null && raw.roofAgeYears !== undefined) {
    const v = Number(raw.roofAgeYears);
    if (isFinite(v) && v >= 0 && v <= 100) {
      roofAgeYears = Math.round(v);
    } else {
      log.push(`[normalize] WARN: Invalid roofAgeYears=${raw.roofAgeYears} — ignored`);
    }
  }

  // ── Attic access ──────────────────────────────────────────────────────────────
  const atticAccess = raw.atticAccess === true ? true
    : raw.atticAccess === false ? false
    : null;

  // ── Roof material ─────────────────────────────────────────────────────────────
  const roofMaterial = normalizeString(raw.roofMaterial) ?? null;

  // ── Roof pitch ────────────────────────────────────────────────────────────────
  const { roofPitch, roofPitchDegrees } = normalizeRoofPitch(raw.roofPitch, log);

  // ── Stories ───────────────────────────────────────────────────────────────────
  const stories = normalizeString(raw.stories) ?? null;

  // ── Structure type ────────────────────────────────────────────────────────────
  const structureType = normalizeString(raw.structureType) ?? null;

  return {
    rafterSpacingIn,
    rafterSize,
    deckingThicknessIn,
    windExposure,
    snowLoadPsf,
    roofCondition,
    roofAgeYears,
    atticAccess,
    roofMaterial,
    roofPitch,
    roofPitchDegrees,
    stories,
    structureType,
  };
}

// ─── Step 6: Electrical normalization ────────────────────────────────────────

function normalizeElectrical(
  raw: RawSurveyPayload['electrical'],
  log: string[],
): NormalizedSiteSurvey['electrical'] {
  if (!raw) {
    log.push(`[normalize] WARN: Missing electrical block — all defaults applied`);
    return {
      mainPanelRatingAmps: null,
      busbarRatingAmps: null,
      breakerSpacesAvailable: null,
      serviceEntrance: DEFAULT_SERVICE_ENTRANCE,
      meterType: DEFAULT_METER_TYPE,
      interconnectionPoint: DEFAULT_INTERCONNECTION,
      panelBrand: DEFAULT_PANEL_BRAND,
      hasSubPanel: null,
      subPanelRatingAmps: null,
      availableBreakerSlots: null,
    };
  }

  // ── Main panel rating ─────────────────────────────────────────────────────────
  // May arrive as string "200A", "200 amp", "200", or number 200
  const mainPanelRatingAmps = parseAmps(raw.mainPanelRatingAmps, 'mainPanelRatingAmps', log);

  // ── Busbar rating ─────────────────────────────────────────────────────────────
  // If not captured, default to main panel rating (common configuration)
  const busbarRaw = parseAmps(raw.busbarRatingAmps, 'busbarRatingAmps', log);
  const busbarRatingAmps = busbarRaw !== null
    ? busbarRaw
    : mainPanelRatingAmps; // busbar ≤ main panel — use main as proxy
  if (busbarRaw === null && mainPanelRatingAmps !== null) {
    log.push(`[normalize] busbarRatingAmps not captured — defaulting to mainPanelRatingAmps (${mainPanelRatingAmps}A)`);
  }

  // ── Breaker spaces ────────────────────────────────────────────────────────────
  // May arrive as string "3-4" (categorical) or numeric "3" or number 3
  const breakerSpacesAvailable = parseBreakerSpaces(raw.breakerSpacesAvailable, log);

  // ── Service entrance ──────────────────────────────────────────────────────────
  const serviceEntrance = normalizeServiceEntrance(raw.serviceEntrance, log);

  // ── Meter type ────────────────────────────────────────────────────────────────
  const meterType = normalizeMeterType(raw.meterType, log);

  // ── Interconnection point ─────────────────────────────────────────────────────
  const interconnectionPoint = normalizeInterconnectionPoint(raw.interconnectionPoint, log);

  // ── Panel brand ───────────────────────────────────────────────────────────────
  const panelBrand = normalizePanelBrand(raw.panelBrand, log);

  // ── Sub-panel ─────────────────────────────────────────────────────────────────
  const hasSubPanel = raw.hasSubPanel === true ? true
    : raw.hasSubPanel === false ? false
    : null;
  const subPanelRatingAmps = hasSubPanel
    ? parseAmps(raw.subPanelRatingAmps, 'subPanelRatingAmps', log)
    : null;

  // ── Available breaker slots (categorical) ─────────────────────────────────────
  const availableBreakerSlots = normalizeAvailableBreakerSlots(raw.availableBreakerSlots, log);

  return {
    mainPanelRatingAmps,
    busbarRatingAmps,
    breakerSpacesAvailable,
    serviceEntrance,
    meterType,
    interconnectionPoint,
    panelBrand,
    hasSubPanel,
    subPanelRatingAmps,
    availableBreakerSlots,
  };
}

// ─── Step 7: Photo normalization ─────────────────────────────────────────────

function normalizePhotos(
  raw: RawSurveyPayload['photos'],
  log: string[],
): SurveyPhotoRef[] {
  if (!raw || raw.length === 0) {
    log.push(`[normalize] No photos provided`);
    return [];
  }

  const VALID_CATEGORIES: SurveyPhotoRef['category'][] = [
    'roof', 'panel', 'meter', 'obstruction', 'site', 'other',
  ];

  const photos: SurveyPhotoRef[] = [];

  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    if (!p) continue;

    const slotKey = normalizeString(p.slotKey) ?? `slot_${i + 1}`;
    const url = normalizeString(p.url);

    if (!url) {
      log.push(`[normalize] WARN: photo[${i}] slotKey="${slotKey}" has no URL — skipped`);
      continue;
    }

    const rawCat = p.category ? String(p.category).toLowerCase().trim() : null;
    const category: SurveyPhotoRef['category'] = VALID_CATEGORIES.includes(rawCat as SurveyPhotoRef['category'])
      ? (rawCat as SurveyPhotoRef['category'])
      : 'other';

    photos.push({
      slotKey,
      url,
      category,
      capturedAt: normalizeTimestamp(p.capturedAt, log) ?? undefined,
      notes: normalizeString(p.notes) ?? undefined,
    });
  }

  log.push(`[normalize] Photos: ${photos.length}/${raw.length} valid`);
  return photos;
}

// ─── Structural sub-normalizers ───────────────────────────────────────────────

function parseRafterSpacing(
  raw: number | string | null | undefined,
  log: string[],
): number {
  if (raw === null || raw === undefined) {
    log.push(`[normalize] WARN: rafterSpacingIn not provided — defaulting to ${DEFAULT_RAFTER_SPACING_IN}"`);
    return DEFAULT_RAFTER_SPACING_IN;
  }
  // Strip common suffixes: "24 OC", '24"', "24 o.c.", "24in"
  const stripped = String(raw).replace(/["'°]|oc|o\.c\.|in(ch(es)?)?/gi, '').trim();
  const v = Number(stripped);
  if (isFinite(v) && v >= 12 && v <= 48) {
    return v;
  }
  log.push(`[normalize] WARN: Invalid rafterSpacingIn="${raw}" — defaulting to ${DEFAULT_RAFTER_SPACING_IN}"`);
  return DEFAULT_RAFTER_SPACING_IN;
}

function normalizeRafterSize(
  raw: RafterSize | string | null | undefined,
  log: string[],
): RafterSize {
  const VALID: RafterSize[] = ['2x4', '2x6', '2x8', '2x10', '2x12', 'other'];
  if (!raw) {
    log.push(`[normalize] WARN: rafterSize not provided — defaulting to ${DEFAULT_RAFTER_SIZE}`);
    return DEFAULT_RAFTER_SIZE;
  }
  // Normalize format: "2 x 6" or "2X6" or "2x6"
  const cleaned = String(raw).replace(/\s/g, '').toLowerCase();
  if (cleaned === '2x4') return '2x4';
  if (cleaned === '2x6') return '2x6';
  if (cleaned === '2x8') return '2x8';
  if (cleaned === '2x10') return '2x10';
  if (cleaned === '2x12') return '2x12';
  if (VALID.includes(raw as RafterSize)) return raw as RafterSize;
  log.push(`[normalize] WARN: Unrecognized rafterSize="${raw}" — mapped to 'other'`);
  return 'other';
}

function parseDeckingThickness(
  raw: number | string | null | undefined,
  log: string[],
): number {
  if (raw === null || raw === undefined) {
    log.push(`[normalize] WARN: deckingThicknessIn not provided — defaulting to ${DEFAULT_DECKING_THICKNESS_IN}"`);
    return DEFAULT_DECKING_THICKNESS_IN;
  }
  // Strip inch markers: '0.5"', '1/2"', '0.75"', '3/4"'
  const stripped = String(raw).replace(/["']/g, '').trim();
  // Handle fractions (1/2, 3/4, 7/16)
  if (stripped.includes('/')) {
    const parts = stripped.split('/');
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    if (isFinite(num) && isFinite(den) && den !== 0) {
      const v = num / den;
      if (v > 0 && v <= 2) return v;
    }
  }
  const v = Number(stripped);
  if (isFinite(v) && v > 0 && v <= 2) {
    return v;
  }
  log.push(`[normalize] WARN: Invalid deckingThicknessIn="${raw}" — defaulting to ${DEFAULT_DECKING_THICKNESS_IN}"`);
  return DEFAULT_DECKING_THICKNESS_IN;
}

function normalizeWindExposure(
  raw: WindExposureCategory | string | null | undefined,
  log: string[],
): WindExposureCategory {
  if (!raw) {
    log.push(`[normalize] WARN: windExposure not provided — defaulting to '${DEFAULT_WIND_EXPOSURE}'`);
    return DEFAULT_WIND_EXPOSURE;
  }
  const cleaned = String(raw).toUpperCase().trim();
  if (cleaned === 'B') return 'B';
  if (cleaned === 'C') return 'C';
  if (cleaned === 'D') return 'D';
  log.push(`[normalize] WARN: Unrecognized windExposure="${raw}" — defaulting to '${DEFAULT_WIND_EXPOSURE}'`);
  return DEFAULT_WIND_EXPOSURE;
}

function normalizeRoofPitch(
  raw: string | null | undefined,
  log: string[],
): { roofPitch: NormalizedSiteSurvey['structural']['roofPitch']; roofPitchDegrees: number | null } {
  if (!raw) {
    return { roofPitch: null, roofPitchDegrees: null };
  }

  const cleaned = String(raw).toLowerCase().trim();

  // Categorical values from field form
  if (cleaned === 'flat' || cleaned === '0/12' || cleaned === '1/12' || cleaned === '2/12') {
    return { roofPitch: 'flat', roofPitchDegrees: pitchToDegrees(cleaned) };
  }
  if (cleaned === 'low' || cleaned === '3/12' || cleaned === '4/12' || cleaned === '3:12' || cleaned === '4:12') {
    return { roofPitch: 'low', roofPitchDegrees: pitchToDegrees(cleaned) };
  }
  if (cleaned === 'standard' || cleaned === '5/12' || cleaned === '6/12' || cleaned === '7/12'
    || cleaned === '5:12' || cleaned === '6:12' || cleaned === '7:12') {
    return { roofPitch: 'standard', roofPitchDegrees: pitchToDegrees(cleaned) };
  }
  if (cleaned === 'steep' || cleaned === '8/12' || cleaned === '9/12' || cleaned === '10/12' || cleaned === '11/12'
    || cleaned === '8:12' || cleaned === '9:12' || cleaned === '10:12' || cleaned === '11:12') {
    return { roofPitch: 'steep', roofPitchDegrees: pitchToDegrees(cleaned) };
  }
  if (cleaned === 'very_steep' || cleaned === 'very steep' || cleaned === '12/12' || cleaned.startsWith('13/')
    || cleaned === '12:12') {
    return { roofPitch: 'very_steep', roofPitchDegrees: pitchToDegrees(cleaned) };
  }

  // Try to parse X/12 or X:12 format
  const pitchMatch = cleaned.match(/^(\d+(?:\.\d+)?)[/:]12$/);
  if (pitchMatch) {
    const rise = Number(pitchMatch[1]);
    const degrees = Math.atan(rise / 12) * (180 / Math.PI);
    const category: NormalizedSiteSurvey['structural']['roofPitch'] =
      rise <= 2 ? 'flat' :
      rise <= 4 ? 'low' :
      rise <= 7 ? 'standard' :
      rise <= 11 ? 'steep' : 'very_steep';
    log.push(`[normalize] Parsed roofPitch="${raw}" → ${category} (${degrees.toFixed(1)}°)`);
    return { roofPitch: category, roofPitchDegrees: Math.round(degrees * 10) / 10 };
  }

  log.push(`[normalize] WARN: Unrecognized roofPitch="${raw}" — ignored`);
  return { roofPitch: null, roofPitchDegrees: null };
}

/** Converts pitch notation to approximate degrees */
function pitchToDegrees(pitch: string): number | null {
  const m = pitch.match(/^(\d+(?:\.\d+)?)[/:]12$/);
  if (m) {
    const rise = Number(m[1]);
    return Math.round(Math.atan(rise / 12) * (180 / Math.PI) * 10) / 10;
  }
  // Categorical fallbacks
  if (pitch === 'flat') return 5;
  if (pitch === 'low') return 14;
  if (pitch === 'standard') return 22;
  if (pitch === 'steep') return 34;
  if (pitch === 'very_steep') return 45;
  return null;
}

// ─── Electrical sub-normalizers ───────────────────────────────────────────────

function parseAmps(
  raw: number | string | null | undefined,
  fieldName: string,
  log: string[],
): number | null {
  if (raw === null || raw === undefined) return null;
  // Strip common suffixes: "200A", "200 amp", "200 amps", "200a"
  const stripped = String(raw).replace(/\s*(amp(s)?|a)\s*$/i, '').trim();
  const v = Number(stripped);
  if (isFinite(v) && v > 0 && v <= 1600) { // max residential service 1600A
    return Math.round(v); // always integer amps
  }
  log.push(`[normalize] WARN: Invalid ${fieldName}="${raw}" — ignored`);
  return null;
}

function parseBreakerSpaces(
  raw: number | string | null | undefined,
  log: string[],
): number | null {
  if (raw === null || raw === undefined) return null;
  const v = Number(String(raw).trim());
  if (isFinite(v) && v >= 0 && v <= 100) {
    return Math.floor(v);
  }
  // Handle categorical string values like "5+" → use lower bound
  if (typeof raw === 'string') {
    const catMatch = raw.match(/^(\d+)\+?$/);
    if (catMatch) return parseInt(catMatch[1], 10);
    // "1-2" → use lower bound
    const rangeMatch = raw.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) return parseInt(rangeMatch[1], 10);
  }
  log.push(`[normalize] WARN: Invalid breakerSpacesAvailable="${raw}" — ignored`);
  return null;
}

function normalizeServiceEntrance(
  raw: ServiceEntrance | string | null | undefined,
  log: string[],
): ServiceEntrance {
  if (!raw) return DEFAULT_SERVICE_ENTRANCE;
  const cleaned = String(raw).toLowerCase().trim();
  if (cleaned === 'overhead' || cleaned === 'aerial' || cleaned === 'above') return 'overhead';
  if (cleaned === 'underground' || cleaned === 'underground conduit' || cleaned === 'below' || cleaned === 'buried') return 'underground';
  if (cleaned === 'unknown' || cleaned === 'not sure' || cleaned === 'unsure') return 'unknown';
  log.push(`[normalize] WARN: Unrecognized serviceEntrance="${raw}" — defaulting to 'unknown'`);
  return 'unknown';
}

function normalizeMeterType(
  raw: MeterSocketType | string | null | undefined,
  log: string[],
): MeterSocketType {
  if (!raw) return DEFAULT_METER_TYPE;
  const cleaned = String(raw).toLowerCase().trim().replace(/\s/g, '_');
  if (cleaned === 'standard') return 'standard';
  if (cleaned === 'combo' || cleaned === 'combination') return 'combo';
  if (cleaned === '320a' || cleaned === '320_amp' || cleaned === '320') return '320a';
  if (cleaned === 'other') return 'other';
  if (cleaned === 'unknown') return 'unknown';
  log.push(`[normalize] WARN: Unrecognized meterType="${raw}" — defaulting to 'unknown'`);
  return 'unknown';
}

function normalizeInterconnectionPoint(
  raw: InterconnectionPoint | string | null | undefined,
  log: string[],
): InterconnectionPoint {
  if (!raw) return DEFAULT_INTERCONNECTION;
  const cleaned = String(raw).toLowerCase().trim().replace(/[\s-]/g, '_');
  if (cleaned === 'main_panel' || cleaned === 'main') return 'main_panel';
  if (cleaned === 'sub_panel' || cleaned === 'subpanel' || cleaned === 'sub') return 'sub_panel';
  if (cleaned === 'load_side' || cleaned === 'load') return 'load_side';
  if (cleaned === 'supply_side' || cleaned === 'supply' || cleaned === 'line_side') return 'supply_side';
  if (cleaned === 'unknown') return 'unknown';
  log.push(`[normalize] WARN: Unrecognized interconnectionPoint="${raw}" — defaulting to 'unknown'`);
  return 'unknown';
}

function normalizePanelBrand(
  raw: PanelBrand | string | null | undefined,
  log: string[],
): PanelBrand {
  if (!raw) return DEFAULT_PANEL_BRAND;
  const cleaned = String(raw).toLowerCase().trim().replace(/[\s-_]/g, '');
  if (cleaned === 'siemens') return 'siemens';
  if (cleaned === 'squared' || cleaned === 'squaread' || cleaned === 'squaredmfg' || cleaned === 'schneider') return 'square_d';
  if (cleaned === 'eaton' || cleaned === 'cutlerhammer' || cleaned === 'ch') return 'eaton';
  if (cleaned === 'cuttlerhammer' || cleaned.includes('cutler')) return 'cutler_hammer';
  if (cleaned === 'ge' || cleaned === 'generalelectric') return 'ge';
  if (cleaned === 'federalpacific' || cleaned === 'fpe' || cleaned === 'stabloc') return 'federal_pacific';
  if (cleaned === 'zinsco' || cleaned === 'sylvania') return 'zinsco';
  if (cleaned === 'leviton') return 'leviton';
  if (cleaned === 'other') return 'other';
  if (cleaned === 'unknown' || cleaned === '') return 'unknown';
  log.push(`[normalize] WARN: Unrecognized panelBrand="${raw}" — mapped to 'other'`);
  return 'other';
}

function normalizeAvailableBreakerSlots(
  raw: string | null | undefined,
  log: string[],
): string | null {
  if (!raw) return null;
  const cleaned = String(raw).trim();
  // Canonical categorical values: '0' | '1-2' | '3-4' | '5+'
  if (cleaned === '0' || cleaned === '1-2' || cleaned === '3-4' || cleaned === '5+') return cleaned;
  // Map numeric to categorical
  const n = Number(cleaned);
  if (isFinite(n)) {
    if (n === 0) return '0';
    if (n <= 2) return '1-2';
    if (n <= 4) return '3-4';
    return '5+';
  }
  log.push(`[normalize] WARN: Unrecognized availableBreakerSlots="${raw}" — ignored`);
  return null;
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function normalizeGeoPolygon(
  raw: Array<Partial<GeoPoint>> | GeoPoint[] | null | undefined,
  label: string,
  log: string[],
): GeoPoint[] {
  if (!raw || raw.length === 0) return [];

  const points: GeoPoint[] = [];
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    if (!p) continue;
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (!isFinite(lat) || !isFinite(lng)) {
      log.push(`[normalize] WARN: ${label} vertex[${i}] invalid lat/lng (${p.lat},${p.lng}) — skipped`);
      continue;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      log.push(`[normalize] WARN: ${label} vertex[${i}] out-of-range lat/lng (${lat},${lng}) — skipped`);
      continue;
    }
    points.push({ lat, lng });
  }

  // Remove duplicate consecutive points
  const deduped: GeoPoint[] = [];
  for (const pt of points) {
    const last = deduped[deduped.length - 1];
    if (!last || last.lat !== pt.lat || last.lng !== pt.lng) {
      deduped.push(pt);
    }
  }

  if (deduped.length < points.length) {
    log.push(`[normalize] ${label} removed ${points.length - deduped.length} duplicate vertices`);
  }

  return deduped;
}

// ─── General utility helpers ──────────────────────────────────────────────────

function normalizeLatLng(
  raw: number | null | undefined,
  field: 'lat' | 'lng',
  min: number,
  max: number,
  log: string[],
): number | null {
  if (raw === null || raw === undefined) {
    log.push(`[normalize] WARN: Missing location.${field}`);
    return null;
  }
  const v = Number(raw);
  if (!isFinite(v)) {
    log.push(`[normalize] WARN: Invalid location.${field}=${raw} — not a number`);
    return null;
  }
  if (v < min || v > max) {
    log.push(`[normalize] WARN: location.${field}=${v} out of range [${min},${max}] — ignored`);
    return null;
  }
  return v;
}

function normalizeString(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}

function normalizeTimestamp(
  raw: string | null | undefined,
  log: string[],
): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  // Accept ISO 8601 format or parseable date strings
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return d.toISOString();
  }
  log.push(`[normalize] WARN: Invalid timestamp="${raw}" — ignored`);
  return null;
}