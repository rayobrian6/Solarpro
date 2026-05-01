/**
 * 3D utility functions extracted from SolarEngine3D.tsx.
 * Pure functions with no Cesium viewer state dependency.
 */

/** Convert meters to feet */
export function mToFt(m: number): number { return m * 3.28084; }

/** Format meters as feet string with decimals */
export function ftStr(m: number, decimals = 1): string {
  return `${mToFt(m).toFixed(decimals)} ft`;
}

/** Format meters as full feet-inches string */
export function ftStrFull(m: number): string {
  const totalFt = mToFt(m);
  const feet = Math.floor(totalFt);
  const inches = Math.round((totalFt - feet) * 12);
  return inches === 0 ? `${feet} ft` : `${feet}\' ${inches}"`;
}

/** Convert azimuth (0=N, 90=E, 180=S) to Cesium heading */
export function headingFromAzimuth(azDeg: number): number {
  return ((azDeg + 180) % 360) * Math.PI / 180;
}

/**
 * Calculate minimum row spacing for ground-mount to avoid inter-row shading.
 * Uses simplified solar geometry for worst-case winter solstice.
 */
export function calcMinRowSpacing(tiltDeg: number, panelHeightM: number, latitudeDeg: number): number {
  const tiltRad = tiltDeg * Math.PI / 180;
  const latRad = Math.abs(latitudeDeg) * Math.PI / 180;
  const solarElevation = Math.max(0.1, (90 - Math.abs(latitudeDeg) - 23.45) * Math.PI / 180);
  const shadowLength = panelHeightM * Math.sin(tiltRad) / Math.tan(solarElevation);
  const panelProjection = panelHeightM * Math.cos(tiltRad);
  return panelProjection + shadowLength;
}

/** Validate geographic coordinates */
export function isValidCoord(lat: number, lng: number, alt?: number): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (isNaN(lat) || isNaN(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  if (alt !== undefined && (isNaN(alt) || !isFinite(alt))) return false;
  return true;
}

/** Safe Cartesian3 creation with validation */
export function safeCartesian3(C: any, lng: number, lat: number, alt: number): any {
  if (!isValidCoord(lat, lng, alt)) {
    console.warn('[safeCartesian3] Invalid coordinates:', { lat, lng, alt });
    return C.Cartesian3.fromDegrees(0, 0, 0);
  }
  return C.Cartesian3.fromDegrees(lng, lat, alt);
}

/** Structured error handler for Cesium operations */
export function handleCesiumError(operation: string, error: any, warn = false) {
  const msg = `[3D] ${operation}: ${error?.message || error}`;
  if (warn) { console.warn(msg); }
  else { console.error(msg); }
}
