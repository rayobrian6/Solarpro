/**
 * lib/3d/lidar/liftRoofs.ts
 *
 * "Lift Roofs" and "Flatten Roofs" actions (Aurora frame 130, 135).
 *
 * Pure: no DOM, no Cesium, no React.
 */

import type { LiDARDataset, LiDAROffset } from './types';
import { applyOffset } from './offsetTransform';

export interface RoofPlaneLike {
  id: string;
  vertices: Array<{ lat: number; lng: number }>;
  planeHeightAtCenterMeters?: number;
  [key: string]: unknown;
}

export interface RoofActionsOptions {
  /** Padding in meters around the bounding box when sampling. Default 1.0. */
  bboxPadM?: number;
  /** Number of highest-Z points to include in the "lift" mean. Default 25. */
  topK?: number;
}

const METERS_PER_DEG_LAT = 111_320;

/** Lift each roof plane to the mean Z of its highest-K points. */
export function liftRoofs(
  dataset: LiDARDataset,
  roofPlanes: RoofPlaneLike[],
  offset: LiDAROffset,
  options: RoofActionsOptions = {},
): RoofPlaneLike[] {
  const ds = applyOffset(dataset, offset);
  const topK = options.topK ?? 25;
  const padM = options.bboxPadM ?? 1.0;

  if (roofPlanes.length === 0 || ds.points.length === 0) return roofPlanes;

  const pointLat = new Float64Array(ds.points.length);
  const pointLng = new Float64Array(ds.points.length);
  const pointZ = new Float64Array(ds.points.length);
  const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos((ds.centroidLat * Math.PI) / 180);
  for (let i = 0; i < ds.points.length; i++) {
    pointLat[i] = ds.centroidLat + ds.points[i].y / METERS_PER_DEG_LAT;
    pointLng[i] = ds.centroidLng + ds.points[i].x / metersPerDegLng;
    pointZ[i] = ds.points[i].z;
  }

  return roofPlanes.map((plane) => {
    const bbox = planeBbox(plane.vertices);
    if (!bbox) return plane;
    const padDeg = padM / METERS_PER_DEG_LAT;
    const minLat = bbox.minLat - padDeg;
    const maxLat = bbox.maxLat + padDeg;
    const minLng = bbox.minLng - padDeg;
    const maxLng = bbox.maxLng + padDeg;

    const inside: number[] = [];
    for (let i = 0; i < pointLat.length; i++) {
      if (pointLat[i] < minLat || pointLat[i] > maxLat) continue;
      if (pointLng[i] < minLng || pointLng[i] > maxLng) continue;
      inside.push(pointZ[i]);
    }
    if (inside.length === 0) return plane;

    inside.sort((a, b) => b - a);
    const k = Math.min(topK, inside.length);
    let sum = 0;
    for (let i = 0; i < k; i++) sum += inside[i];
    const meanZ = sum / k;

    return { ...plane, planeHeightAtCenterMeters: meanZ };
  });
}

/** Flatten each roof plane to the median Z of points under it. */
export function flattenRoofs(
  dataset: LiDARDataset,
  roofPlanes: RoofPlaneLike[],
  offset: LiDAROffset,
  options: RoofActionsOptions = {},
): RoofPlaneLike[] {
  const ds = applyOffset(dataset, offset);
  const padM = options.bboxPadM ?? 1.0;

  if (roofPlanes.length === 0 || ds.points.length === 0) return roofPlanes;

  const pointLat = new Float64Array(ds.points.length);
  const pointLng = new Float64Array(ds.points.length);
  const pointZ = new Float64Array(ds.points.length);
  const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos((ds.centroidLat * Math.PI) / 180);
  for (let i = 0; i < ds.points.length; i++) {
    pointLat[i] = ds.centroidLat + ds.points[i].y / METERS_PER_DEG_LAT;
    pointLng[i] = ds.centroidLng + ds.points[i].x / metersPerDegLng;
    pointZ[i] = ds.points[i].z;
  }

  return roofPlanes.map((plane) => {
    const bbox = planeBbox(plane.vertices);
    if (!bbox) return plane;
    const padDeg = padM / METERS_PER_DEG_LAT;
    const minLat = bbox.minLat - padDeg;
    const maxLat = bbox.maxLat + padDeg;
    const minLng = bbox.minLng - padDeg;
    const maxLng = bbox.maxLng + padDeg;

    const inside: number[] = [];
    for (let i = 0; i < pointLat.length; i++) {
      if (pointLat[i] < minLat || pointLat[i] > maxLat) continue;
      if (pointLng[i] < minLng || pointLng[i] > maxLng) continue;
      inside.push(pointZ[i]);
    }
    if (inside.length === 0) return plane;

    inside.sort((a, b) => a - b);
    const medianZ = inside[Math.floor(inside.length / 2)];

    return { ...plane, planeHeightAtCenterMeters: medianZ };
  });
}

function planeBbox(vertices: Array<{ lat: number; lng: number }>): { minLat: number; maxLat: number; minLng: number; maxLng: number } | null {
  if (vertices.length === 0) return null;
  let minLat = vertices[0].lat, maxLat = vertices[0].lat;
  let minLng = vertices[0].lng, maxLng = vertices[0].lng;
  for (let i = 1; i < vertices.length; i++) {
    const v = vertices[i];
    if (v.lat < minLat) minLat = v.lat; else if (v.lat > maxLat) maxLat = v.lat;
    if (v.lng < minLng) minLng = v.lng; else if (v.lng > maxLng) maxLng = v.lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}
