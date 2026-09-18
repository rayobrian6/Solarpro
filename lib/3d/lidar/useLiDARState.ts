/**
 * lib/3d/lidar/useLiDARState.ts
 *
 * React hook for the LiDAR feature.
 */

'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  DEFAULT_LIDAR_STATE,
  type LiDARDataset,
  type LiDAROffset,
  type LiDARState,
  type LiDARStyle,
} from './types';

export interface UseLiDARStateApi {
  state: LiDARState;
  setDataset: (ds: LiDARDataset | null) => void;
  setStyle: (style: LiDARStyle) => void;
  setTextured: (on: boolean) => void;
  setOffset: (offset: LiDAROffset) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export function useLiDARState(initial: Partial<LiDARState> = {}): UseLiDARStateApi {
  const [state, setState] = useState<LiDARState>({ ...DEFAULT_LIDAR_STATE, ...initial });

  const setDataset  = useCallback((dataset: LiDARDataset | null) => setState((s) => ({ ...s, dataset, error: null })), []);
  const setStyle    = useCallback((style: LiDARStyle) => setState((s) => ({ ...s, style })), []);
  const setTextured = useCallback((textured: boolean) => setState((s) => ({ ...s, textured })), []);
  const setOffset   = useCallback((offset: LiDAROffset) => setState((s) => ({ ...s, offset })), []);
  const setLoading  = useCallback((isLoading: boolean) => setState((s) => ({ ...s, isLoading })), []);
  const setError    = useCallback((error: string | null) => setState((s) => ({ ...s, error, isLoading: false })), []);
  const reset       = useCallback(() => setState(DEFAULT_LIDAR_STATE), []);

  return useMemo(() => ({
    state, setDataset, setStyle, setTextured, setOffset, setLoading, setError, reset,
  }), [state, setDataset, setStyle, setTextured, setOffset, setLoading, setError, reset]);
}
