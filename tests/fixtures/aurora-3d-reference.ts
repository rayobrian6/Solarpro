/**
 * Aurora Solar — Smart Roof training reference frames
 * Source video: https://www.youtube.com/watch?v=oVuMUmybd0s
 * Captured: 2026-08-14 (720p H.264 from ffmpeg seek on raw download)
 *
 * Used by Solarpro design tests as a competitive reference: each frame
 * documents a specific UI element or 3D-design capability that Aurora's
 * Smart Roof tool surfaces. The test code can load these as fixtures for
 * visual diff, "do we have this feature" parity probes, or regression
 * reference images.
 *
 * NOTE: paths are absolute, host-specific (worklaptop carpe). For CI,
 * re-capture from YouTube or vendor a neutral copy under
 * `tests/fixtures/aurora-3d-reference/<file>.jpg`.
 */

export type Aurora3DFrame = {
  /** Stable id, lowercase, dash-separated. */
  readonly id: string;
  /** Frame filename on disk (01_ui_overhead_45.jpg, etc.). */
  readonly file: string;
  /** Seconds into the source video where the frame was captured. */
  readonly timestampSec: number;
  /** Human-readable label shown in test reports. */
  readonly label: string;
  /**
   * The Aurora capability / UI element this frame documents. Tests can
   * use this as a parity check ("does Solarpro's design surface have
   * a counterpart?") or as a screenshot baseline.
   */
  readonly documents: string;
};

export const AURORA_3D_REFERENCE_FRAMES: readonly Aurora3DFrame[] = [
  {
    id: 'ui-overhead-45',
    file: '01_ui_overhead_45.jpg',
    timestampSec: 48,
    label: 'UI overview, 45° rotatable overhead view',
    documents: 'overhead 45° rotatable view with N/S/E/W spin buttons',
  },
  {
    id: 'roof-taxonomy',
    file: '02_roof_taxonomy.jpg',
    timestampSec: 132,
    label: 'Roof type taxonomy slide',
    documents: 'roof type vocabulary (hip, ridge, eve, rake, valley, gable, fascia)',
  },
  {
    id: 'compass-2d-3d',
    file: '03_compass_2d3d.jpg',
    timestampSec: 321,
    label: 'Compass in center, 2D↔3D toggle',
    documents: 'center compass: click to toggle 2D↔3D, ring to tilt, N-reset',
  },
  {
    id: 'lidar-overlay',
    file: '04_lidar_overlay.jpg',
    timestampSec: 655,
    label: 'LiDAR point cloud overlay on 3D',
    documents: 'LiDAR overlay toggle for visual verify of point cloud vs roof line',
  },
  {
    id: 'flat-fold-3d',
    file: '05_flat_fold_3d.jpg',
    timestampSec: 880,
    label: 'Flat fold on top of pitched roof, 3D',
    documents: 'flat-fold primitive (top is flat instead of ridge)',
  },
  {
    id: 'measurements-3d',
    file: '06_measurements_3d.jpg',
    timestampSec: 1068,
    label: '3D measurements on the model',
    documents: 'in-scene measurement annotations (e.g. 3.7 ft, 5 ft)',
  },
  {
    id: 'dormer-3d',
    file: '07_dormer_3d.jpg',
    timestampSec: 1480,
    label: 'Dormer 3D (auto-flipped over ridge)',
    documents: 'dormer primitives (gable/hip/shed) with auto-flip over major ridge',
  },
  {
    id: 'multisection-3d',
    file: '08_multisection_3d.jpg',
    timestampSec: 2022,
    label: 'Multi-section (2 stories) 3D',
    documents: 'multi-section roof with different eve heights, 2-story input',
  },
  {
    id: 'vertical-folds-3d',
    file: '09_vertical_folds_3d.jpg',
    timestampSec: 2218,
    label: 'Vertical folds + valley meeting garage',
    documents: 'vertical fold (Dutch gable) primitives + valley with continuous face',
  },
] as const;

/** Absolute base path on the worklaptop. */
export const AURORA_3D_REFERENCE_DIR =
  'C:\\Users\\carpe\\mavis\\v2\\assets\\aurora_3d_frames';

/** Resolve a frame's absolute path on the local machine. */
export function aurora3DPath(frame: Aurora3DFrame): string {
  return `${AURORA_3D_REFERENCE_DIR}\\${frame.file}`;
}
