'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { SaveStatus } from '@/components/ui/SaveStatusBar';

interface AutoSaveOptions<T> {
  /** The data to save */
  data: T;
  /** Async function that performs the save — return true on success */
  onSave: (data: T) => Promise<void>;
  /** Debounce delay in ms after data changes (default: 2000ms) */
  debounceMs?: number;
  /** Interval for periodic saves in ms (default: 10000ms = 10s) */
  intervalMs?: number;
  /** Whether auto-save is enabled (default: true) */
  enabled?: boolean;
  /** Called when save status changes */
  onStatusChange?: (status: SaveStatus) => void;
}

interface AutoSaveResult {
  status: SaveStatus;
  lastSavedAt: Date | null;
  errorMessage: string | undefined;
  /** Manually trigger a save immediately */
  saveNow: () => Promise<void>;
}

export function useAutoSave<T>({
  data,
  onSave,
  debounceMs = 2000,
  intervalMs = 10000,
  enabled = true,
  onStatusChange,
}: AutoSaveOptions<T>): AutoSaveResult {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const dataRef = useRef<T>(data);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSaving = useRef(false);
  const lastSavedData = useRef<string>('');

  // Keep dataRef current
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const updateStatus = useCallback((s: SaveStatus, msg?: string) => {
    setStatus(s);
    setErrorMessage(msg);
    onStatusChange?.(s);
  }, [onStatusChange]);

  const performSave = useCallback(async () => {
    if (isSaving.current || !enabled) return;

    const currentDataStr = JSON.stringify(dataRef.current);
    // Skip if data hasn't changed since last save
    if (currentDataStr === lastSavedData.current) return;

    isSaving.current = true;
    updateStatus('saving');

    try {
      await onSave(dataRef.current);
      lastSavedData.current = currentDataStr;
      setLastSavedAt(new Date());
      updateStatus('saved');

      // Reset to idle after 3s
      setTimeout(() => {
        setStatus(prev => prev === 'saved' ? 'idle' : prev);
      }, 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      updateStatus('error', msg);
      console.error('[useAutoSave] Save failed:', err);

      // Retry after 5s on error
      setTimeout(() => {
        setStatus(prev => prev === 'error' ? 'idle' : prev);
      }, 5000);
    } finally {
      isSaving.current = false;
    }
  }, [enabled, onSave, updateStatus]);

  // Debounced save on data change
  useEffect(() => {
    if (!enabled) return;

    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      performSave();
    }, debounceMs);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [data, debounceMs, enabled, performSave]);

  // Periodic save interval
  useEffect(() => {
    if (!enabled) return;

    intervalTimer.current = setInterval(() => {
      performSave();
    }, intervalMs);

    return () => {
      if (intervalTimer.current) clearInterval(intervalTimer.current);
    };
  }, [intervalMs, enabled, performSave]);

  // Save on page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Best-effort synchronous save attempt on unload
      const currentDataStr = JSON.stringify(dataRef.current);
      if (currentDataStr !== lastSavedData.current) {
        // Store in localStorage as emergency backup
        try {
          localStorage.setItem(
            `autosave_emergency_${Date.now()}`,
            JSON.stringify({ data: dataRef.current, savedAt: new Date().toISOString() })
          );
        } catch {
          // ignore localStorage errors
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const saveNow = useCallback(async () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    await performSave();
  }, [performSave]);

  return { status, lastSavedAt, errorMessage, saveNow };
}

export default useAutoSave;