// ============================================================
// Aerial-vision obstruction sweep (Ray, 2026-07-03: "find that
// missing pipe through the data sets").
//
// Nearmap's AI feature layer misses small roof penetrations —
// a 4" pipe is ~3px at 7.5cm ortho, and anything under partial
// shade often doesn't make the feature layer at all. But the
// PIXELS are already in our hands: the same stitched HD aerial
// PV-1 embeds. This module crops the subject roof out of that
// image, upscales it, and asks Claude vision to mark every
// roof-mounted obstruction. Detections are mapped back through
// the Web-Mercator projection to real lat/lng, kept only when
// they land on a DESIGN roof plane, deduped against Nearmap's
// own detections, and emitted in the NearmapObstruction shape
// with an "aerial vision" description so every sheet renders
// them with FIELD VERIFY honesty.
//
// Fail-safe: no key / no aerial / API error / bad JSON → [].
// Generic by construction — runs for every property, no
// per-site hand-placing.
// ============================================================

import sharp from 'sharp';
import { lngToGlobalPx, latToGlobalPx, mapObstructionDescription, type NearmapObstruction } from './nearmap';

const VISION_MODEL = 'claude-opus-4-8';
const TIMEOUT_MS = 45_000;
const UPSCALE = 3;              // 7.5cm/px → 2.5cm/px effective; a 4" pipe ~9px
                                // (Opus 4.8 accepts up to 2576px long edge —
                                // a ~260px roof crop upscales well within that)
const MAX_DETECTIONS = 24;      // sanity cap — a residential roof has < 24 penetrations
const DEDUPE_M = 1.2;           // within 1.2m of a Nearmap detection = same object

/** Inverse Web-Mercator: global pixel X → longitude. */
function globalPxToLng(px: number, z: number): number {
  return (px / (256 * 2 ** z)) * 360 - 180;
}
/** Inverse Web-Mercator: global pixel Y → latitude. */
function globalPxToLat(py: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * py) / (256 * 2 ** z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function pipRing(lat: number, lng: number, ring: Array<{ lat: number; lng: number }>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i].lat, xi = ring[i].lng, yj = ring[j].lat, xj = ring[j].lng;
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const DETECTION_SCHEMA = {
  type: 'object',
  properties: {
    detections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['vent_pipe', 'exhaust_vent', 'attic_fan', 'chimney', 'skylight', 'satellite_dish', 'hvac_unit', 'other'] },
          x: { type: 'integer' },
          y: { type: 'integer' },
          confidence: { type: 'number' },
          note: { type: 'string' },
        },
        required: ['kind', 'x', 'y', 'confidence', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['detections'],
  additionalProperties: false,
} as const;

export interface AerialVisionInput {
  /** data URI of the stitched aerial (the one PV-1 embeds) */
  imageBase64: string;
  imageWidth: number;
  imageHeight: number;
  /** image center + zoom (Web-Mercator, same frame as the tiles) */
  lat: number;
  lng: number;
  zoom: number;
  /** DESIGN roof planes (real GPS) — detections must land on one */
  roofPlanes: Array<{ vertices?: Array<{ lat: number; lng: number }> }>;
  /** Nearmap AI obstructions already found — used for dedupe */
  existing: Array<{ polygon: Array<{ lat: number; lng: number }> }>;
}

/** Result cache — one vision call per location per generate burst. */
const visionCache = new Map<string, { result: NearmapObstruction[]; ts: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * Detect roof obstructions the Nearmap AI layer missed, from the aerial
 * pixels themselves. Returns NearmapObstruction-shaped entries (small square
 * polygons around each point) with description marked "aerial vision".
 */
export async function detectAerialVisionObstructions(input: AerialVisionInput): Promise<NearmapObstruction[]> {
  // LOUD skip reasons — the #1 field question is "did the sweep even run?"
  // One look at the function logs must answer it.
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { console.log('[aerialVision] SKIPPED — ANTHROPIC_API_KEY not set in this environment'); return []; }
  if (!input.imageBase64?.startsWith('data:image/')) { console.log('[aerialVision] SKIPPED — no aerial image data'); return []; }

  const rings = (input.roofPlanes ?? [])
    .map(rp => (rp.vertices ?? []).filter(v => isFinite(v?.lat) && isFinite(v?.lng)))
    .filter(r => r.length >= 3);
  if (!rings.length) { console.log('[aerialVision] SKIPPED — no design roof planes'); return []; }

  const cacheKey = `${input.lat.toFixed(7)},${input.lng.toFixed(7)},${input.zoom}`;
  const cached = visionCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.result;

  try {
    // ── 1. Crop the subject roof (design bbox + margin) from the aerial ──
    const z = input.zoom;
    const cx = lngToGlobalPx(input.lng, z), cy = latToGlobalPx(input.lat, z);
    const toPx = (lat: number, lng: number) => ({
      x: input.imageWidth / 2 + (lngToGlobalPx(lng, z) - cx),
      y: input.imageHeight / 2 + (latToGlobalPx(lat, z) - cy),
    });
    const pts = rings.flat().map(v => toPx(v.lat, v.lng));
    const pad = 14;
    const x0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p.x)) - pad));
    const y0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p.y)) - pad));
    const x1 = Math.min(input.imageWidth, Math.ceil(Math.max(...pts.map(p => p.x)) + pad));
    const y1 = Math.min(input.imageHeight, Math.ceil(Math.max(...pts.map(p => p.y)) + pad));
    const cw = x1 - x0, ch = y1 - y0;
    if (cw < 40 || ch < 40) return [];   // roof not meaningfully inside the frame

    const raw = Buffer.from(input.imageBase64.slice(input.imageBase64.indexOf(',') + 1), 'base64');
    const cropJpeg = await sharp(raw)
      .extract({ left: x0, top: y0, width: cw, height: ch })
      .resize({ width: cw * UPSCALE, height: ch * UPSCALE, kernel: 'lanczos3' })
      .jpeg({ quality: 92 })
      .toBuffer();

    // ── 2. Claude vision: mark every roof penetration in the crop ──
    const prompt =
      `This is a high-resolution orthophoto crop of ONE residential roof (7.5 cm/px, upscaled 2x). ` +
      `Identify EVERY roof-mounted obstruction/penetration: plumbing vent pipes (tiny dark circles, often with a small point shadow), ` +
      `exhaust vents, attic fans, chimneys, skylights, satellite dishes, and rooftop HVAC. ` +
      `Small pipes may be only a few pixels — look for the dot + shadow signature along plumbing lines and near ridge/eave runs, ` +
      `including in partially shaded areas. ` +
      `Do NOT report: shadows alone, trees/vegetation, existing solar modules, ridge caps, valleys, discoloration/stains, patched shingles, or anything on a NEIGHBORING structure at the crop edges. ` +
      `Report each object's center as integer pixel coordinates in THIS image (width ${cw * UPSCALE}, height ${ch * UPSCALE}), ` +
      `confidence 0-1, and a short note describing the visual evidence.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        max_tokens: 2000,
        output_config: { format: { type: 'json_schema', schema: DETECTION_SCHEMA } },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: cropJpeg.toString('base64') } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.log('[aerialVision] API non-OK:', res.status, (await res.text()).slice(0, 200));
      return [];
    }
    const json = await res.json() as any;
    if (json.stop_reason === 'refusal') return [];
    const text = (json.content ?? []).find((b: any) => b.type === 'text')?.text;
    if (!text) return [];
    const detections: Array<{ kind: string; x: number; y: number; confidence: number; note: string }> =
      (JSON.parse(text).detections ?? []).slice(0, MAX_DETECTIONS);

    // ── 3. Map crop px → lat/lng; keep on-design-roof; dedupe vs Nearmap ──
    const existingCentroids = (input.existing ?? []).map(o => {
      const p = o.polygon;
      return {
        lat: p.reduce((s, v) => s + v.lat, 0) / p.length,
        lng: p.reduce((s, v) => s + v.lng, 0) / p.length,
      };
    });
    const cosLat = Math.cos(input.lat * Math.PI / 180);
    const out: NearmapObstruction[] = [];
    for (const d of detections) {
      if (!isFinite(d.x) || !isFinite(d.y) || (d.confidence ?? 0) < 0.3) continue;
      const fullX = x0 + d.x / UPSCALE, fullY = y0 + d.y / UPSCALE;
      const lng = globalPxToLng(cx + (fullX - input.imageWidth / 2), z);
      const lat = globalPxToLat(cy + (fullY - input.imageHeight / 2), z);
      if (!rings.some(r => pipRing(lat, lng, r))) continue;   // off our roof → drop
      const dup = existingCentroids.some(c =>
        Math.hypot((c.lat - lat) * 111320, (c.lng - lng) * 111320 * cosLat) < DEDUPE_M);
      if (dup) continue;
      // small square footprint (±0.25 m) — a point object, drawn as a vent dot
      const dLat = 0.25 / 111320, dLng = 0.25 / (111320 * cosLat);
      const kindDesc = d.kind.replace(/_/g, ' ');
      out.push({
        type: mapObstructionDescription(kindDesc),
        description: `${kindDesc} (aerial vision — field verify)`,
        polygon: [
          { lat: lat - dLat, lng: lng - dLng }, { lat: lat - dLat, lng: lng + dLng },
          { lat: lat + dLat, lng: lng + dLng }, { lat: lat + dLat, lng: lng - dLng },
        ],
        confidence: Math.max(0, Math.min(1, d.confidence)),
        captureDate: null,
      });
    }
    console.log(`[aerialVision] ${detections.length} raw detection(s) → ${out.length} on-roof, non-duplicate`);
    visionCache.set(cacheKey, { result: out, ts: Date.now() });
    return out;
  } catch (e: unknown) {
    console.log('[aerialVision] sweep skipped:', (e as Error)?.message);
    return [];
  }
}
