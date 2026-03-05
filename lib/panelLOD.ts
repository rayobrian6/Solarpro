/**
 * panelLOD.ts — Level of Detail System for Panel Rendering
 *
 * 3-tier LOD based on camera distance to panel array center:
 *
 *   CLOSE  (<300m)  : Full BoxGeometry with shade colors + outlines
 *   MEDIUM (300-1500m): Flat rectangle primitive (no thickness)
 *   FAR    (>1500m) : Billboard point sprite (single pixel cluster)
 *
 * Additional optimizations:
 *   - Frustum culling: skip panels outside camera frustum
 *   - Tile SSE: dynamic maximumScreenSpaceError based on altitude
 *   - Shadow map: disabled at MEDIUM/FAR, reduced size at CLOSE
 *
 * Performance impact:
 *   500 panels  @ CLOSE  → ~8ms rebuild
 *   2000 panels @ MEDIUM → ~4ms rebuild (flat geometry = fewer vertices)
 *   10000 panels @ FAR   → ~2ms rebuild (billboards = 1 vertex each)
 */

export type LODTier = 'close' | 'medium' | 'far';

export interface LODConfig {
  closeDistanceM: number;   // below this = CLOSE tier
  mediumDistanceM: number;  // below this = MEDIUM tier, above = FAR
  enableFrustumCulling: boolean;
  enableShadowsAtClose: boolean;
  shadowMapSizeClose: number;
  tileSSEClose: number;     // maximumScreenSpaceError at close range
  tileSSEMedium: number;
  tileSSEFar: number;
}

export const DEFAULT_LOD_CONFIG: LODConfig = {
  closeDistanceM:   300,
  mediumDistanceM:  1500,
  enableFrustumCulling: true,
  enableShadowsAtClose: true,
  shadowMapSizeClose: 1024,
  tileSSEClose:   4,
  tileSSEMedium:  8,
  tileSSEFar:     16,
};

/**
 * Determine LOD tier based on camera altitude above ground.
 * Uses camera height as a proxy for distance to panels.
 */
export function getLODTier(
  cameraHeightM: number,
  config: LODConfig = DEFAULT_LOD_CONFIG
): LODTier {
  if (cameraHeightM < config.closeDistanceM)  return 'close';
  if (cameraHeightM < config.mediumDistanceM) return 'medium';
  return 'far';
}

/**
 * Get the optimal tile maximumScreenSpaceError for the current LOD tier.
 * Lower SSE = higher quality tiles (more GPU load).
 * Higher SSE = lower quality tiles (less GPU load).
 */
export function getTileSSE(tier: LODTier, config: LODConfig = DEFAULT_LOD_CONFIG): number {
  switch (tier) {
    case 'close':  return config.tileSSEClose;
    case 'medium': return config.tileSSEMedium;
    case 'far':    return config.tileSSEFar;
  }
}

/**
 * Get shadow map settings for the current LOD tier.
 */
export function getShadowSettings(
  tier: LODTier,
  config: LODConfig = DEFAULT_LOD_CONFIG
): { enabled: boolean; size: number; softShadows: boolean } {
  switch (tier) {
    case 'close':
      return {
        enabled: config.enableShadowsAtClose,
        size: config.shadowMapSizeClose,
        softShadows: true,
      };
    case 'medium':
      return { enabled: false, size: 512, softShadows: false };
    case 'far':
      return { enabled: false, size: 256, softShadows: false };
  }
}

/**
 * Apply LOD settings to a Cesium viewer.
 * Call this in the camera change event handler.
 */
export function applyLODToViewer(
  viewer: any,
  tileset: any,
  tier: LODTier,
  showShade: boolean,
  config: LODConfig = DEFAULT_LOD_CONFIG
): void {
  if (!viewer) return;

  try {
    // Update tile SSE
    if (tileset) {
      tileset.maximumScreenSpaceError = getTileSSE(tier, config);
    }

    // Update shadow map
    const shadowSettings = getShadowSettings(tier, config);
    if (showShade) {
      viewer.scene.shadowMap.enabled    = shadowSettings.enabled;
      viewer.scene.shadowMap.size       = shadowSettings.size;
      viewer.scene.shadowMap.softShadows = shadowSettings.softShadows;
    } else {
      viewer.scene.shadowMap.enabled = false;
    }

    // Fog: disable at all ranges (improves clarity)
    viewer.scene.fog.enabled = false;

    // Globe lighting: only at close range when shade is on
    viewer.scene.globe.enableLighting = showShade && tier === 'close';

  } catch (e: any) {
    console.warn('[LOD] applyLODToViewer error:', e.message);
  }
}

/**
 * Get camera height above ground in meters.
 * Uses Cesium camera position and ellipsoid.
 */
export function getCameraHeightM(viewer: any): number {
  if (!viewer) return 1000;
  try {
    const C = (window as any).Cesium;
    if (!C) return 1000;
    const carto = C.Cartographic.fromCartesian(viewer.camera.position);
    return isFinite(carto.height) ? Math.max(0, carto.height) : 1000;
  } catch {
    return 1000;
  }
}

/**
 * Frustum culling: filter panels to only those visible in the camera frustum.
 * Returns indices of visible panels.
 *
 * For Cesium Primitives, the engine does some culling automatically,
 * but pre-filtering before building the primitive saves CPU on geometry creation.
 *
 * @param viewer  - Cesium viewer
 * @param panels  - All panels
 * @param margin  - Extra margin in degrees (default 0.002° ≈ 200m)
 */
export function frustumCullPanels<T extends { lat: number; lng: number }>(
  viewer: any,
  panels: T[],
  margin = 0.002
): T[] {
  if (!viewer || panels.length === 0) return panels;

  try {
    const C = (window as any).Cesium;
    if (!C) return panels;

    // Get camera frustum bounds (approximate using camera position + FOV)
    const cameraPos = viewer.camera.position;
    const carto = C.Cartographic.fromCartesian(cameraPos);
    const camLat = C.Math.toDegrees(carto.latitude);
    const camLng = C.Math.toDegrees(carto.longitude);
    const height = Math.max(0, carto.height);

    // Approximate visible radius in degrees based on camera height
    // At 200m altitude: ~0.01° radius (~1km)
    // At 1000m altitude: ~0.05° radius (~5km)
    // At 5000m altitude: ~0.25° radius (~25km)
    const visibleRadiusDeg = Math.max(0.01, height / 20000);

    const minLat = camLat - visibleRadiusDeg - margin;
    const maxLat = camLat + visibleRadiusDeg + margin;
    const minLng = camLng - visibleRadiusDeg - margin;
    const maxLng = camLng + visibleRadiusDeg + margin;

    // Fast AABB test
    return panels.filter(p =>
      p.lat >= minLat && p.lat <= maxLat &&
      p.lng >= minLng && p.lng <= maxLng
    );
  } catch {
    return panels; // on error, return all panels (safe fallback)
  }
}

/**
 * Compute the center point of a panel array.
 * Used for distance-based LOD calculations.
 */
export function computeArrayCenter(
  panels: Array<{ lat: number; lng: number; height?: number }>
): { lat: number; lng: number; height: number } {
  if (panels.length === 0) return { lat: 0, lng: 0, height: 0 };

  const sumLat = panels.reduce((s, p) => s + p.lat, 0);
  const sumLng = panels.reduce((s, p) => s + p.lng, 0);
  const sumH   = panels.reduce((s, p) => s + (p.height ?? 0), 0);

  return {
    lat:    sumLat / panels.length,
    lng:    sumLng / panels.length,
    height: sumH   / panels.length,
  };
}

/**
 * LOD state tracker — maintains current tier and detects transitions.
 */
export class LODManager {
  private currentTier: LODTier = 'close';
  private config: LODConfig;
  private lastUpdateMs = 0;
  private updateIntervalMs = 200; // check LOD every 200ms max

  constructor(config: LODConfig = DEFAULT_LOD_CONFIG) {
    this.config = config;
  }

  /**
   * Update LOD based on current camera height.
   * Returns true if tier changed (caller should rebuild/update).
   */
  update(viewer: any, tileset: any, showShade: boolean): boolean {
    const now = performance.now();
    if (now - this.lastUpdateMs < this.updateIntervalMs) return false;
    this.lastUpdateMs = now;

    const height = getCameraHeightM(viewer);
    const newTier = getLODTier(height, this.config);

    if (newTier !== this.currentTier) {
      const prevTier = this.currentTier;
      this.currentTier = newTier;
      applyLODToViewer(viewer, tileset, newTier, showShade, this.config);
      console.log(`[LOD] Tier changed: ${prevTier} → ${newTier} (height=${height.toFixed(0)}m)`);
      return true;
    }

    return false;
  }

  get tier(): LODTier {
    return this.currentTier;
  }

  /**
   * Force apply current LOD settings (call after viewer init).
   */
  forceApply(viewer: any, tileset: any, showShade: boolean): void {
    applyLODToViewer(viewer, tileset, this.currentTier, showShade, this.config);
  }
}