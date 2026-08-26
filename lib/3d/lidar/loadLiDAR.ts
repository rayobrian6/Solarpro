/**
 * lib/3d/lidar/loadLiDAR.ts
 *
 * Browser-side helper: open a file picker, parse the chosen file as
 * LAS, and return a `LiDARDataset`. The dataset is tagged with the
 * project centroid (lat/lng) so the renderer can place it correctly.
 */

import type { LiDARDataset } from './types';
import { parseLAS, parseLASFile } from './lasParser';

export interface LoadOptions {
  /** Project centroid — used to translate the LAS X/Y origin to WGS84. */
  centroidLat: number;
  centroidLng: number;
  /** Max points to parse. Default 500_000. */
  maxPoints?: number;
  /** Progress hook: `true` while loading, `false` after. */
  onLoadingChange?: (loading: boolean) => void;
  /** Optional override of the file picker. Mostly for tests. */
  picker?: () => Promise<File | null>;
}

export type LoadResult =
  | { ok: true; dataset: LiDARDataset }
  | { ok: false; error: string; cancelled?: boolean };

/** Open a file picker, read the chosen file as LAS, return the dataset. */
export async function loadLiDARFromFilePicker(options: LoadOptions): Promise<LoadResult> {
  const picker = options.picker ?? defaultPicker;
  options.onLoadingChange?.(true);
  let file: File | null;
  try {
    file = await picker();
  } catch (e) {
    options.onLoadingChange?.(false);
    return { ok: false, error: `File picker failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!file) {
    options.onLoadingChange?.(false);
    return { ok: false, error: 'No file selected', cancelled: true };
  }
  const result = await parseLASFile(file, { maxPoints: options.maxPoints });
  options.onLoadingChange?.(false);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, dataset: stampDataset(result.dataset, file.name, options.centroidLat, options.centroidLng) };
}

/** Load LiDAR from a known File/Blob (no file picker). */
export async function loadLiDARFromFile(
  file: File | Blob,
  options: LoadOptions,
): Promise<LoadResult> {
  options.onLoadingChange?.(true);
  const result = await parseLASFile(file, { maxPoints: options.maxPoints });
  options.onLoadingChange?.(false);
  if (!result.ok) return { ok: false, error: result.error };
  const source = (file as File).name ?? 'blob';
  return { ok: true, dataset: stampDataset(result.dataset, source, options.centroidLat, options.centroidLng) };
}

/** Load LiDAR from an in-memory ArrayBuffer (test / drag-and-drop). */
export function loadLiDARFromBuffer(
  buf: ArrayBuffer,
  source: string,
  options: LoadOptions,
): LoadResult {
  options.onLoadingChange?.(true);
  const result = parseLAS(buf, { maxPoints: options.maxPoints });
  options.onLoadingChange?.(false);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, dataset: stampDataset(result.dataset, source, options.centroidLat, options.centroidLng) };
}

function stampDataset(ds: LiDARDataset, source: string, centroidLat: number, centroidLng: number): LiDARDataset {
  return { ...ds, source, centroidLat, centroidLng };
}

/** Default file picker using a hidden <input type="file">. */
function defaultPicker(): Promise<File | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.las,.laz,.copc.laz';
    input.style.display = 'none';
    let resolved = false;
    const finish = (file: File | null) => {
      if (resolved) return;
      resolved = true;
      try { document.body.removeChild(input); } catch { /* ignore */ }
      resolve(file);
    };
    input.addEventListener('change', () => {
      finish(input.files?.[0] ?? null);
    });
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}
