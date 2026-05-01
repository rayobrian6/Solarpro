// ============================================================================
// v47.437 - Survey V2: Step 5 - Photos
//
// Photo capture step. Renders required slots first, then optional slots.
// Each slot calls POST /api/survey/upload-photo on file selection.
// Upload state (uploading, progress, error) is managed locally per slot.
//
// After successful upload, the returned { url, uploadKey } is written
// into the draft photos array via onPhotoUploaded().
//
// Pure ASCII, no Unicode.
// ============================================================================

import React, { useState, useCallback } from 'react';
import type { SurveyPhotos, SurveyPhoto, PhotoCategory } from '../../lib/survey/v2/types';
import { REQUIRED_PHOTO_CATEGORIES } from '../../lib/survey/v2/types';
import { PhotoSlot, PHOTO_SLOT_META } from './ui/PhotoSlot';

// ---------------------------------------------------------------------------
// Upload slot state
// ---------------------------------------------------------------------------
interface SlotState {
  uploading: boolean;
  progress: number;
  error: string | null;
}

function blankSlotState(): SlotState {
  return { uploading: false, progress: 0, error: null };
}

// ---------------------------------------------------------------------------
// StepPhotos
// ---------------------------------------------------------------------------
interface StepPhotosProps {
  surveyToken: string;
  data: SurveyPhotos;
  onPhotoUploaded: (photo: SurveyPhoto) => void;
  onPhotoRemoved: (photoId: string) => void;
  disabled?: boolean;
}

export function StepPhotos({
  surveyToken,
  data,
  onPhotoUploaded,
  onPhotoRemoved,
  disabled,
}: StepPhotosProps) {
  // Per-category upload state
  const [slotStates, setSlotStates] = useState<Record<string, SlotState>>({});

  function getSlotState(category: PhotoCategory): SlotState {
    return slotStates[category] ?? blankSlotState();
  }

  function setSlotState(category: PhotoCategory, patch: Partial<SlotState>) {
    setSlotStates((prev) => ({
      ...prev,
      [category]: { ...(prev[category] ?? blankSlotState()), ...patch },
    }));
  }

  // Get the current photo for a category (last one wins for non-multi slots)
  function getPhotoForCategory(category: PhotoCategory): SurveyPhoto | undefined {
    return data.photos.filter((p) => p.category === category).slice(-1)[0];
  }

  // ---------------------------------------------------------------------------
  // handleCapture - called when user selects a file from a slot
  // ---------------------------------------------------------------------------
  const handleCapture = useCallback(
    async (category: PhotoCategory, file: File) => {
      setSlotState(category, { uploading: true, progress: 10, error: null });

      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('category', category);
        formData.append('token', surveyToken);

        // Simulate progress while uploading (XHR would give real progress)
        setSlotState(category, { progress: 30 });

        const res = await fetch('/api/survey/upload-photo', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });

        setSlotState(category, { progress: 90 });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const msg = (body as { error?: string }).error ?? `Upload failed (${res.status})`;
          setSlotState(category, { uploading: false, progress: 0, error: msg });
          return;
        }

        const result = await res.json() as { url: string; uploadKey: string };

        const photo: SurveyPhoto = {
          id: `photo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          category,
          tag: category,
          url: result.url,
          uploadKey: result.uploadKey,
          capturedAt: new Date().toISOString(),
        };

        onPhotoUploaded(photo);
        setSlotState(category, { uploading: false, progress: 100, error: null });

        // Reset progress after brief delay
        setTimeout(() => setSlotState(category, { progress: 0 }), 800);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        setSlotState(category, { uploading: false, progress: 0, error: msg });
      }
    },
    [surveyToken, onPhotoUploaded],
  );

  // ---------------------------------------------------------------------------
  // handleRemove - removes a photo from the draft
  // ---------------------------------------------------------------------------
  function handleRemove(category: PhotoCategory) {
    const photo = getPhotoForCategory(category);
    if (photo) {
      onPhotoRemoved(photo.id);
    }
    setSlotState(category, blankSlotState());
  }

  // ---- Completion stats ----
  const requiredCount = REQUIRED_PHOTO_CATEGORIES.length;
  const capturedRequiredCount = REQUIRED_PHOTO_CATEGORIES.filter(
    (cat) => !!getPhotoForCategory(cat),
  ).length;
  const allRequiredDone = capturedRequiredCount === requiredCount;

  // Sort: required first, then optional
  const requiredMeta = PHOTO_SLOT_META.filter((m) => m.required);
  const optionalMeta = PHOTO_SLOT_META.filter((m) => !m.required);

  return (
    <div className="space-y-4">
      {/* ---- Progress header ---- */}
      <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold text-gray-800">Required Photos</p>
          <span
            className={`text-xs font-bold px-2 py-0.5 rounded-full ${
              allRequiredDone
                ? 'bg-green-100 text-green-700'
                : 'bg-orange-100 text-orange-700'
            }`}
          >
            {capturedRequiredCount}/{requiredCount}
          </span>
        </div>
        {/* Mini progress bar */}
        <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              allRequiredDone ? 'bg-green-500' : 'bg-cyan-500'
            }`}
            style={{
              width: `${(capturedRequiredCount / requiredCount) * 100}%`,
            }}
          />
        </div>
        {allRequiredDone && (
          <p className="mt-1.5 text-xs text-green-600 font-medium">
            All required photos captured. You can proceed.
          </p>
        )}
      </div>

      {/* ---- Required slots ---- */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 px-1">
          Required
        </p>
        <div className="grid grid-cols-2 gap-3">
          {requiredMeta.map((meta) => {
            const slot = getSlotState(meta.category);
            const photo = getPhotoForCategory(meta.category);
            return (
              <PhotoSlot
                key={meta.category}
                meta={meta}
                url={photo?.url}
                uploading={slot.uploading}
                uploadProgress={slot.progress}
                error={slot.error ?? undefined}
                onCapture={(file) => handleCapture(meta.category, file)}
                onRemove={() => handleRemove(meta.category)}
                disabled={disabled}
              />
            );
          })}
        </div>
      </div>

      {/* ---- Optional slots ---- */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 px-1">
          Optional
        </p>
        <div className="grid grid-cols-2 gap-3">
          {optionalMeta.map((meta) => {
            const slot = getSlotState(meta.category);
            const photo = getPhotoForCategory(meta.category);
            return (
              <PhotoSlot
                key={meta.category}
                meta={meta}
                url={photo?.url}
                uploading={slot.uploading}
                uploadProgress={slot.progress}
                error={slot.error ?? undefined}
                onCapture={(file) => handleCapture(meta.category, file)}
                onRemove={() => handleRemove(meta.category)}
                disabled={disabled}
              />
            );
          })}
        </div>
      </div>

      {/* ---- All photos total ---- */}
      {data.photos.length > 0 && (
        <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3">
          <p className="text-xs text-gray-500">
            <span className="font-semibold text-gray-700">{data.photos.length}</span>{' '}
            photo{data.photos.length !== 1 ? 's' : ''} captured for this survey
          </p>
        </div>
      )}
    </div>
  );
}