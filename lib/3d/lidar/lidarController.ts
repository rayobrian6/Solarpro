/**
 * lib/3d/lidar/lidarController.ts
 *
 * Owns the lifecycle of the LiDAR render output inside a Cesium viewer.
 *
 * Coupled to Cesium (window.Cesium). Loaded only on the client side via
 * dynamic import from the React layer.
 */

import type { LiDARDataset, LiDAROffset, LiDARState, LiDARStyle } from './types';
import { renderPointCloud } from './pointCloudRenderer';
import { renderMesh } from './meshRenderer';

export interface LiDARController {
  setDataset(dataset: LiDARDataset | null): void;
  setStyle(style: LiDARStyle): void;
  setOffset(offset: LiDAROffset): void;
  setTextured(on: boolean): void;
  /** Tear down all primitives. Call when the 3D engine unmounts. */
  destroy(): void;
}

export function createLiDARController(
  viewer: any,
  initialState: LiDARState,
): LiDARController {
  let state: LiDARState = { ...initialState };
  let cleanup: (() => void) | null = null;

  function teardown() {
    if (cleanup) {
      try { cleanup(); } catch { /* ignore */ }
      cleanup = null;
    }
  }

  function remount() {
    teardown();
    if (!state.dataset || !viewer) return;
    try {
      if (state.style === 'pointCloud') {
        cleanup = renderPointCloud(viewer, state.dataset, state.offset, 2);
      } else {
        cleanup = renderMesh(viewer, state.dataset, state.offset, {
          textured: state.textured,
        });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[lidar] render failed:', e);
    }
  }

  return {
    setDataset(dataset) { state = { ...state, dataset }; remount(); },
    setStyle(style)     { state = { ...state, style };   remount(); },
    setOffset(offset)   { state = { ...state, offset }; remount(); },
    setTextured(on)     { state = { ...state, textured: on }; remount(); },
    destroy()           { teardown(); },
  };
}
