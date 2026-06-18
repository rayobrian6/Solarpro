// ============================================================================
// v47.437 - Survey V2: PhotoSlot
//
// A single photo capture/upload slot. Shows:
//   - Empty state: tap-to-capture prompt with category label
//   - Uploading state: spinner + progress bar
//   - Filled state: thumbnail + remove button
//
// Calls onCapture(file) when user selects a file from camera/gallery.
// Calls onRemove() when user taps the remove button.
//
// The parent (StepPhotos) handles the actual upload API call and updates
// the draft with the resulting URL.
//
// Pure ASCII, no Unicode.
// ============================================================================

import React, { useRef } from 'react';
import type { PhotoCategory } from '../../../lib/survey/v2/types';

// ---------------------------------------------------------------------------
// Photo category display metadata
// ---------------------------------------------------------------------------
export interface PhotoSlotMeta {
  category: PhotoCategory;
  label: string;
  hint: string;
  required: boolean;
}

export const PHOTO_SLOT_META: PhotoSlotMeta[] = [
  {
    category: 'main_panel_open',
    label: 'Main Panel - Open',
    hint: 'Full view with breakers visible',
    required: true,
  },
  {
    category: 'main_panel_closed',
    label: 'Main Panel - Closed',
    hint: 'Cover on, nameplate visible',
    required: true,
  },
  {
    category: 'meter',
    label: 'Meter',
    hint: 'Meter face + socket label',
    required: true,
  },
  {
    category: 'roof_overview',
    label: 'Roof Overview',
    hint: 'Full roof plane from ground or above',
    required: true,
  },
  {
    category: 'service_entrance',
    label: 'Service Entrance',
    hint: 'Overhead/underground entry point',
    required: true,
  },
  {
    category: 'roof_detail',
    label: 'Roof Detail',
    hint: 'Close-up of material and condition',
    required: false,
  },
  {
    category: 'attic_access',
    label: 'Attic Access',
    hint: 'Interior view of rafter bay if accessible',
    required: false,
  },
  {
    category: 'obstruction',
    label: 'Obstruction',
    hint: 'Each obstruction, one photo per item',
    required: false,
  },
  {
    category: 'additional',
    label: 'Additional',
    hint: 'Any other relevant site condition',
    required: false,
  },
];

// ---------------------------------------------------------------------------
// PhotoSlot component
// ---------------------------------------------------------------------------
interface PhotoSlotProps {
  meta: PhotoSlotMeta;
  url?: string;          // filled URL (after upload)
  uploading?: boolean;
  uploadProgress?: number; // 0-100
  error?: string;
  onCapture: (file: File) => void;
  onRemove: () => void;
  disabled?: boolean;
}

export function PhotoSlot({
  meta,
  url,
  uploading,
  uploadProgress = 0,
  error,
  onCapture,
  onRemove,
  disabled,
}: PhotoSlotProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleClick() {
    if (disabled || uploading || url) return;
    inputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      onCapture(file);
      // Reset input so same file can be re-selected after removal
      e.target.value = '';
    }
  }

  // ---- Filled state ----
  if (url && !uploading) {
    return (
      <div className="relative rounded-xl overflow-hidden border border-gray-200 aspect-[4/3] bg-gray-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={meta.label}
          className="w-full h-full object-cover"
        />
        {/* Overlay label */}
        <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-black/50">
          <p className="text-white text-xs font-medium truncate">{meta.label}</p>
        </div>
        {/* Required badge */}
        {meta.required ? (
          <div className="absolute top-1.5 left-1.5 bg-cyan-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
            REQ
          </div>
        ) : null}
        {/* Remove button */}
        {!disabled ? (
          <button
            type="button"
            onClick={onRemove}
            className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-red-500 text-white
              flex items-center justify-center text-xs font-bold hover:bg-red-600 transition-colors"
            aria-label={`Remove ${meta.label}`}
          >
            x
          </button>
        ) : null}
      </div>
    );
  }

  // ---- Uploading state ----
  if (uploading) {
    return (
      <div className="rounded-xl border-2 border-cyan-400 aspect-[4/3] bg-cyan-50
        flex flex-col items-center justify-center gap-2 px-3">
        {/* Spinner */}
        <div className="w-7 h-7 rounded-full border-2 border-cyan-300 border-t-cyan-600 animate-spin" />
        <p className="text-xs font-medium text-cyan-700">{meta.label}</p>
        {/* Progress bar */}
        <div className="w-full bg-cyan-100 rounded-full h-1.5">
          <div
            className="bg-cyan-500 h-1.5 rounded-full transition-all duration-200"
            style={{ width: `${uploadProgress}%` }}
          />
        </div>
        <p className="text-[10px] text-cyan-500">Uploading {uploadProgress}%</p>
      </div>
    );
  }

  // ---- Empty / error state ----
  const borderClass = error
    ? 'border-red-400 bg-red-50'
    : 'border-dashed border-gray-300 bg-gray-50 hover:border-cyan-400 hover:bg-cyan-50';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={`
        w-full rounded-xl border-2 aspect-[4/3]
        flex flex-col items-center justify-center gap-1.5 px-3
        transition-colors duration-150 cursor-pointer
        ${borderClass}
        disabled:opacity-50 disabled:cursor-not-allowed
      `}
      aria-label={`Capture ${meta.label}`}
    >
      {/* Camera icon (ASCII art fallback) */}
      <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-bold">
        +
      </div>
      <p className="text-xs font-semibold text-gray-700 text-center">{meta.label}</p>
      <p className="text-[10px] text-gray-400 text-center leading-tight">{meta.hint}</p>
      {meta.required ? (
        <span className="text-[10px] font-bold text-red-400 uppercase tracking-wide">
          Required
        </span>
      ) : null}
      {error ? (
        <p className="text-[10px] text-red-500 text-center">{error}</p>
      ) : null}
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={handleFileChange}
        aria-hidden="true"
        tabIndex={-1}
      />
    </button>
  );
}