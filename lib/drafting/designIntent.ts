// ============================================================
// SolarPro Drafting Engine — Design Intent Layer
// lib/drafting/designIntent.ts
//
// PHASE 1: Intelligence introduction — non-breaking, additive.
//
// PURPOSE:
//   Provide structured drafting instructions to the engine
//   WITHOUT modifying existing behavior.
//
// CONSTRAINTS:
//   - MUST NOT throw (safeBuildIntent guarantees this)
//   - MUST use only existing input data
//   - MUST be backward compatible (intent is always optional)
//   - NO external calls, NO new dependencies
// ============================================================

import type { DraftingInput, SysType } from './types';
import { resolveSystemType } from './resolver';

// ── DesignIntent Type ─────────────────────────────────────────
// Structured description of WHAT to draw and HOW.
// Consumed by template functions as an optional hint.

export type DesignIntent = {
  systemType: 'roof' | 'ground_mount' | 'solar_fence';

  geometry: {
    bounds: {
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
    };
    orientation?: number;      // azimuth degrees (0-360)
    primaryAxis?: 'x' | 'y';  // dominant layout axis
  };

  structural?: {
    spacing?: number;          // post/pile/rafter spacing (ft)
    embedmentDepth?: number;   // depth below grade (ft)
    height?: number;           // above-grade height (ft)
    tilt?: number;             // tilt angle (degrees)
  };

  electrical?: {
    stringCount?: number;
    inverterType?: string;
  };

  drafting: {
    scaleTarget: number;       // fraction of canvas to fill (default 0.85)
    focalElement: string;      // 'roof_array' | 'ground_array' | 'fence_elevation'
    dimensionStrategy: 'basic' | 'standard' | 'detailed';
  };
};

// ── buildDesignIntent ─────────────────────────────────────────
// Derives a DesignIntent from existing DraftingInput data.
//
// RULES:
//   - Uses ONLY project/layout/engineering fields
//   - Returns minimal intent if data is incomplete
//   - MUST NOT throw (caller wraps in safeBuildIntent)

export function buildDesignIntent(input: DraftingInput): DesignIntent {
  if (!input || !input.project) {
    return minimalIntent('roof');
  }

  // ── System type (via existing resolver) ──────────────────
  let sysType: SysType = 'roof';
  try {
    sysType = resolveSystemType(input);
  } catch (_) {
    sysType = 'roof';
  }

  // ── Focal element ─────────────────────────────────────────
  const focalElement =
    sysType === 'solar_fence'  ? 'fence_elevation' :
    sysType === 'ground_mount' ? 'ground_array'    :
    'roof_array';

  // ── Geometry bounds (derived from layout data) ────────────
  const bounds = computeBounds(input, sysType);

  // ── Primary axis ─────────────────────────────────────────
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const primaryAxis: 'x' | 'y' = spanX >= spanY ? 'x' : 'y';

  // ── Orientation / azimuth ─────────────────────────────────
  let orientation: number | undefined;
  if (sysType === 'solar_fence') {
    const segs = input.layout?.fenceSegments;
    if (segs && segs.length > 0) {
      orientation = segs[0].azimuth ?? 90;
    }
  } else if (sysType === 'ground_mount') {
    const arr0 = input.layout?.groundArrays?.[0];
    orientation = arr0?.azimuth ?? 180;
  } else {
    orientation = 180; // south-facing default for roof
  }

  // ── Structural parameters ─────────────────────────────────
  let structural: DesignIntent['structural'] | undefined;

  if (sysType === 'solar_fence') {
    const postSp  = input.layout?.fencePostSpacingFt;
    const embedDp = input.layout?.fencePostEmbedmentFt;
    const panHt   = input.layout?.fencePanelHeightFt;
    structural = {
      spacing:        postSp  !== undefined ? postSp  : 8,
      embedmentDepth: embedDp !== undefined ? embedDp : 2.5,
      height:         panHt   !== undefined ? panHt   : 5.5,
      tilt:           90,  // fence panels are vertical
    };
  } else if (sysType === 'ground_mount') {
    const arr0 = input.layout?.groundArrays?.[0];
    structural = {
      spacing:        arr0?.pileSpacingFt    ?? 8,
      embedmentDepth: arr0?.pileDepthFt      ?? 5,
      height:         (arr0?.groundClearanceIn ?? 18) / 12,
      tilt:           arr0?.tiltDeg          ?? 20,
    };
  } else {
    // Roof
    const pitch   = input.project?.roofPitch ?? 5;
    const tiltDeg = Math.atan(pitch / 12) * 180 / Math.PI;
    structural = {
      spacing: input.project?.rafterSpacing ?? 24,
      tilt:    Math.round(tiltDeg * 10) / 10,
    };
  }

  // ── Electrical parameters ──────────────────────────────────
  let electrical: DesignIntent['electrical'] | undefined;
  const invs = input.engineering ? (input as any).engineering?.inverters : undefined;
  const invType = input.project ? (input.project as any).inverterType : undefined;
  if (invType || invs) {
    electrical = {
      inverterType: invType,
      stringCount:  invs?.length,
    };
  }

  // ── Dimension strategy ────────────────────────────────────
  // 'detailed' if we have real layout data, 'standard' otherwise
  const hasRealData =
    (sysType === 'solar_fence'  && (input.layout?.fenceSegments?.length ?? 0) > 0) ||
    (sysType === 'ground_mount' && (input.layout?.groundArrays?.length ?? 0) > 0) ||
    (sysType === 'roof'         && ((input.project?.roofPlanes?.length ?? 0) > 0 ||
                                    (input.project?.panelPositions?.length ?? 0) > 0));

  const dimensionStrategy: 'basic' | 'standard' | 'detailed' =
    hasRealData ? 'detailed' : 'standard';

  return {
    systemType: sysType,
    geometry: {
      bounds,
      orientation,
      primaryAxis,
    },
    structural,
    electrical,
    drafting: {
      scaleTarget:       0.85,
      focalElement,
      dimensionStrategy,
    },
  };
}

// ── safeBuildIntent ───────────────────────────────────────────
// Guaranteed-safe wrapper around buildDesignIntent.
// Returns null on any error — templates treat null as "no hint".

export function safeBuildIntent(input: DraftingInput): DesignIntent | null {
  try {
    return buildDesignIntent(input);
  } catch (_) {
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────

function minimalIntent(sysType: SysType): DesignIntent {
  return {
    systemType: sysType,
    geometry: {
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      primaryAxis: 'x',
    },
    drafting: {
      scaleTarget:       0.85,
      focalElement:
        sysType === 'solar_fence'  ? 'fence_elevation' :
        sysType === 'ground_mount' ? 'ground_array'    :
        'roof_array',
      dimensionStrategy: 'standard',
    },
  };
}

// computeBounds: derive approximate drawing bounds from layout data.
// Returns a schematic bounding box in feet.

function computeBounds(
  input: DraftingInput,
  sysType: SysType
): DesignIntent['geometry']['bounds'] {
  if (sysType === 'solar_fence') {
    const segs = input.layout?.fenceSegments;
    const totalLen = input.layout?.fenceTotalLengthFt ??
      (segs ? segs.reduce((s: number, seg: any) => s + (seg.lengthFt || 0), 0) : 0);
    const panHt = input.layout?.fencePanelHeightFt || 5.5;
    const embedDp = input.layout?.fencePostEmbedmentFt || 2.5;
    return {
      minX: 0,
      minY: -(embedDp),
      maxX: Math.max(totalLen, 8),
      maxY: panHt,
    };
  }

  if (sysType === 'ground_mount') {
    const arr0 = input.layout?.groundArrays?.[0];
    const rows = arr0?.rowCount || 4;
    const ppRow = arr0?.panelsPerRow || 5;
    const rowSp = arr0?.rowSpacingFt || 10;
    const panelWFt = 11 / 12;
    const panelHFt = 5.5;
    const arrayW = ppRow * panelWFt;
    const arrayH = rows * (panelHFt + rowSp) - rowSp;
    const embedDp = arr0?.pileDepthFt || 5;
    return {
      minX: 0,
      minY: -(embedDp),
      maxX: Math.max(arrayW, 4),
      maxY: Math.max(arrayH, 8),
    };
  }

  // Roof: use GPS if available, else schematic
  const planes = input.project?.roofPlanes;
  if (planes && planes.length > 0) {
    const allLats = planes.flatMap((rp: any) => (rp.vertices || []).map((v: any) => v.lat || 0));
    const allLngs = planes.flatMap((rp: any) => (rp.vertices || []).map((v: any) => v.lng || 0));
    if (allLats.length > 0) {
      return {
        minX: Math.min(...allLngs),
        minY: Math.min(...allLats),
        maxX: Math.max(...allLngs),
        maxY: Math.max(...allLats),
      };
    }
  }
  // Schematic roof
  const panels = input.engineering?.totalPanels || 10;
  const approxSideFt = Math.sqrt(panels) * 5;
  return {
    minX: 0,
    minY: 0,
    maxX: Math.max(approxSideFt, 10),
    maxY: Math.max(approxSideFt * 0.6, 8),
  };
}