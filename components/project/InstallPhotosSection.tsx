'use client';

/**
 * InstallPhotosSection
 * ─────────────────────────────────────────────────────────────────────────────
 * Photo upload panel for the OperationsTab.
 *
 * Features:
 *  - 8 install photo categories (Before, During, After, Electrical, Roof,
 *    Meter, Labels, Inspection) each with its own upload trigger + thumbnail grid
 *  - Reuses the existing /api/project-files multipart endpoint — no new API
 *  - Thumbnails served via /api/project-files/download?id=xxx&inline=1
 *  - Click-to-enlarge lightbox (full-size download link)
 *  - Per-photo delete
 *  - Max 10 MB per photo; only image/* accepted
 *  - Graceful errors: bad file type, oversized, upload failure
 *  - Zero external dependencies beyond what is already in the project
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Camera, Upload, X, ZoomIn, Download, Loader2, ImageOff,
  ChevronLeft, ChevronRight, AlertTriangle,
} from 'lucide-react';
import { Section } from '@/components/ui/Section';
import { Card } from '@/components/ui/Card';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface InstallPhoto {
  id: string;
  file_name: string;
  file_type: string;          // the DB category (e.g. 'install_before')
  photo_category: string;     // notes field we repurpose: 'before'|'during'|…
  mime_type: string;
  file_size: number;
  upload_date: string;
  created_at: string;
}

export interface InstallPhotosSectionProps {
  projectId: string;
}

// ─── Category config ─────────────────────────────────────────────────────────

export interface PhotoCategoryConfig {
  key: string;        // stored in `notes` field
  label: string;
  emoji: string;
  description: string;
}

export const INSTALL_PHOTO_CATEGORIES: PhotoCategoryConfig[] = [
  { key: 'before',     label: 'Before',     emoji: '🏠', description: 'Pre-install site conditions' },
  { key: 'during',     label: 'During',     emoji: '🔨', description: 'Install in progress' },
  { key: 'after',      label: 'After',      emoji: '✅', description: 'Completed installation' },
  { key: 'electrical', label: 'Electrical', emoji: '⚡', description: 'Panel, disconnect, conduit' },
  { key: 'roof',       label: 'Roof',       emoji: '🛋️',  description: 'Racking, flashing, attachment' },
  { key: 'meter',      label: 'Meter',      emoji: '🔌', description: 'Meter, interconnection' },
  { key: 'labels',     label: 'Labels',     emoji: '🏷️',  description: 'Warning labels, placards, NEC' },
  { key: 'inspection', label: 'Inspection', emoji: '📋', description: 'Inspector photos, sign-off docs' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** The file_type stored in project_files.file_type for install photos */
export function installFileType(categoryKey: string): string {
  return `install_${categoryKey}`;
}

/** Parse category key from file_type (install_before → before) */
export function categoryKeyFromFileType(fileType: string): string | null {
  if (!fileType.startsWith('install_')) return null;
  return fileType.slice('install_'.length) || null;
}

/** Group photos by category key */
export function groupPhotosByCategory(photos: InstallPhoto[]): Record<string, InstallPhoto[]> {
  const groups: Record<string, InstallPhoto[]> = {};
  for (const cat of INSTALL_PHOTO_CATEGORIES) {
    groups[cat.key] = [];
  }
  for (const p of photos) {
    const key = categoryKeyFromFileType(p.file_type);
    if (key && groups[key] !== undefined) {
      groups[key].push(p);
    }
  }
  return groups;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Lightbox ────────────────────────────────────────────────────────────────

interface LightboxProps {
  photos: InstallPhoto[];
  initialIndex: number;
  onClose: () => void;
}

function Lightbox({ photos, initialIndex, onClose }: LightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const current = photos[index];

  const prev = useCallback(() => setIndex(i => Math.max(0, i - 1)), []);
  const next = useCallback(() => setIndex(i => Math.min(photos.length - 1, i + 1)), [photos.length]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, prev, next]);

  if (!current) return null;

  const thumbUrl = `/api/project-files/download?id=${current.id}&inline=1`;
  const downloadUrl = `/api/project-files/download?id=${current.id}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.9)' }}
      onClick={onClose}
    >
      <div
        className="relative max-w-4xl max-h-[90vh] flex flex-col items-center gap-3"
        onClick={e => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-0 right-0 -translate-y-10 translate-x-10 text-white/70 hover:text-white"
          aria-label="Close lightbox"
        >
          <X size={24} />
        </button>

        {/* Image */}
        <img
          src={thumbUrl}
          alt={current.file_name}
          className="max-w-[80vw] max-h-[75vh] object-contain rounded-lg"
          style={{ display: 'block' }}
        />

        {/* Caption + download */}
        <div className="flex items-center gap-4 text-white/70 text-xs">
          <span className="max-w-[40ch] truncate">{current.file_name}</span>
          <span>·</span>
          <span>{formatFileSize(current.file_size)}</span>
          <a
            href={downloadUrl}
            download={current.file_name}
            className="flex items-center gap-1 text-white/50 hover:text-white ml-2"
          >
            <Download size={12} /> Download
          </a>
        </div>

        {/* Prev / Next */}
        {photos.length > 1 && (
          <div className="absolute inset-y-0 w-full flex items-center justify-between pointer-events-none">
            <button
              onClick={prev}
              disabled={index === 0}
              className="pointer-events-auto p-2 text-white/50 hover:text-white disabled:opacity-20"
              aria-label="Previous photo"
            >
              <ChevronLeft size={28} />
            </button>
            <button
              onClick={next}
              disabled={index === photos.length - 1}
              className="pointer-events-auto p-2 text-white/50 hover:text-white disabled:opacity-20"
              aria-label="Next photo"
            >
              <ChevronRight size={28} />
            </button>
          </div>
        )}

        {/* Counter */}
        {photos.length > 1 && (
          <span className="text-white/50 text-[10px]">{index + 1} / {photos.length}</span>
        )}
      </div>
    </div>
  );
}

// ─── Thumbnail ────────────────────────────────────────────────────────────────

interface ThumbnailProps {
  photo: InstallPhoto;
  onClick: () => void;
  onDelete: (id: string) => void;
  deleting: boolean;
}

function Thumbnail({ photo, onClick, onDelete, deleting }: ThumbnailProps) {
  const url = `/api/project-files/download?id=${photo.id}&inline=1`;
  const [imgErr, setImgErr] = useState(false);

  return (
    <div
      className="relative group rounded-lg overflow-hidden border cursor-pointer"
      style={{
        aspectRatio: '1 / 1',
        borderColor: 'var(--border-color)',
        background: 'var(--bg-secondary)',
        minWidth: 0,
      }}
      onClick={onClick}
      title={photo.file_name}
    >
      {imgErr ? (
        <div className="flex flex-col items-center justify-center h-full text-[10px]"
          style={{ color: 'var(--text-muted)' }}>
          <ImageOff size={18} />
          <span className="mt-1 px-1 text-center truncate w-full" style={{ fontSize: 9 }}>
            {photo.file_name}
          </span>
        </div>
      ) : (
        <img
          src={url}
          alt={photo.file_name}
          className="w-full h-full object-cover"
          onError={() => setImgErr(true)}
        />
      )}

      {/* Hover overlay */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2"
        style={{ background: 'rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClick}
          className="p-1.5 rounded-full text-white hover:bg-white/20 transition-colors"
          title="Enlarge"
        >
          <ZoomIn size={14} />
        </button>
        <button
          onClick={() => onDelete(photo.id)}
          disabled={deleting}
          className="p-1.5 rounded-full text-red-400 hover:bg-white/20 transition-colors disabled:opacity-40"
          title="Delete photo"
        >
          {deleting ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
        </button>
      </div>

      {/* File size badge */}
      <div
        className="absolute bottom-0 left-0 right-0 px-1 py-0.5 text-[8px] text-center truncate"
        style={{ background: 'rgba(0,0,0,0.5)', color: 'rgba(255,255,255,0.7)' }}
      >
        {formatFileSize(photo.file_size)}
      </div>
    </div>
  );
}

// ─── Category Panel ───────────────────────────────────────────────────────────

interface CategoryPanelProps {
  category: PhotoCategoryConfig;
  photos: InstallPhoto[];
  onUpload: (categoryKey: string, files: FileList) => Promise<void>;
  onDelete: (photoId: string) => Promise<void>;
  uploading: boolean;
  deletingId: string | null;
}

function CategoryPanel({
  category, photos, onUpload, onDelete, uploading, deletingId,
}: CategoryPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const handleFilePick = () => inputRef.current?.click();
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await onUpload(category.key, e.target.files);
      // Reset so same file can be re-uploaded after delete
      e.target.value = '';
    }
  };

  return (
    <>
      <Card variant="ghost" padding="sm" className="space-y-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base leading-none">{category.emoji}</span>
            <div>
              <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                {category.label}
              </p>
              <p className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
                {category.description}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {photos.length > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                style={{ background: 'var(--accent-color)', color: '#fff' }}>
                {photos.length}
              </span>
            )}
            <button
              onClick={handleFilePick}
              disabled={uploading}
              className="flex items-center gap-1 text-[10px] font-medium px-2.5 py-1 rounded border transition-colors disabled:opacity-50"
              style={{
                borderColor: 'var(--border-color)',
                color: 'var(--text-secondary)',
              }}
              title="Upload photos for this category"
            >
              {uploading ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Upload size={11} />
              )}
              Upload
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileChange}
              aria-label={`Upload ${category.label} photos`}
            />
          </div>
        </div>

        {/* Thumbnail grid */}
        {photos.length > 0 && (
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))' }}
          >
            {photos.map((photo, idx) => (
              <Thumbnail
                key={photo.id}
                photo={photo}
                onClick={() => setLightboxIndex(idx)}
                onDelete={onDelete}
                deleting={deletingId === photo.id}
              />
            ))}
          </div>
        )}

        {photos.length === 0 && !uploading && (
          <div
            className="flex flex-col items-center justify-center py-4 rounded-lg border border-dashed gap-1 cursor-pointer"
            style={{ borderColor: 'var(--border-color)' }}
            onClick={handleFilePick}
          >
            <Camera size={18} style={{ color: 'var(--text-muted)' }} />
            <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
              Click to upload
            </span>
          </div>
        )}
      </Card>

      {lightboxIndex !== null && (
        <Lightbox
          photos={photos}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function InstallPhotosSection({ projectId }: InstallPhotosSectionProps) {
  const [photos, setPhotos] = useState<InstallPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);   // category key
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ─── Fetch all install photos for this project ──────────────────────────────
  const fetchPhotos = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/project-files?projectId=${projectId}`);
      if (!res.ok) throw new Error('Failed to load photos');
      const json = await res.json();
      const allFiles: InstallPhoto[] = Array.isArray(json?.data) ? json.data : [];
      // Filter to only install photo categories
      const installPhotos = allFiles.filter(f =>
        typeof f.file_type === 'string' && f.file_type.startsWith('install_'),
      );
      setPhotos(installPhotos);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to load photos');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchPhotos(); }, [fetchPhotos]);

  // ─── Upload ─────────────────────────────────────────────────────────────────
  const handleUpload = useCallback(async (categoryKey: string, files: FileList) => {
    setUploading(categoryKey);
    setError(null);

    const fileArr = Array.from(files);
    const errors: string[] = [];

    for (const file of fileArr) {
      // Validate
      if (!file.type.startsWith('image/')) {
        errors.push(`${file.name}: not an image`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name}: exceeds 10 MB limit`);
        continue;
      }

      try {
        const form = new FormData();
        form.append('file', file);
        form.append('projectId', projectId);
        // Use notes to carry category key; file_type will be auto-set by API
        // But we override it explicitly via a custom notes field approach —
        // the POST /api/project-files multipart path sets file_type via
        // categorizeFileType(). Images get 'site_photo'. We want 'install_before'
        // etc., so we pass fileType in JSON mode instead.
        //
        // Switch to JSON/base64 mode so we can set the fileType explicitly.
        const arrayBuffer = await file.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(arrayBuffer).reduce((s, b) => s + String.fromCharCode(b), ''),
        );
        const payload = {
          projectId,
          fileName: file.name,
          fileType: installFileType(categoryKey),
          mimeType: file.type,
          fileData: base64,
          notes: `install_photo:${categoryKey}`,
        };
        const res = await fetch('/api/project-files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          errors.push(`${file.name}: ${body?.error || 'Upload failed'}`);
        }
      } catch (e: unknown) {
        errors.push(`${file.name}: ${(e as Error)?.message || 'Upload error'}`);
      }
    }

    if (errors.length > 0) {
      setError(errors.join(' · '));
    }

    await fetchPhotos();
    setUploading(null);
  }, [projectId, fetchPhotos]);

  // ─── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = useCallback(async (photoId: string) => {
    setDeletingId(photoId);
    setError(null);
    try {
      const res = await fetch(`/api/project-files?id=${photoId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Delete failed');
      }
      setPhotos(prev => prev.filter(p => p.id !== photoId));
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  }, []);

  // ─── Grouped ─────────────────────────────────────────────────────────────────
  const grouped = groupPhotosByCategory(photos);
  const totalPhotos = photos.length;

  const completedCategories = INSTALL_PHOTO_CATEGORIES.filter(
    c => (grouped[c.key]?.length ?? 0) > 0,
  ).length;

  return (
    <Section
      title="Install Photos"
      subtitle={
        loading
          ? 'Loading…'
          : totalPhotos === 0
            ? 'No photos yet'
            : `${totalPhotos} photo${totalPhotos !== 1 ? 's' : ''} · ${completedCategories}/${INSTALL_PHOTO_CATEGORIES.length} categories`
      }
      action={
        totalPhotos > 0 ? (
          <div className="flex items-center gap-2">
            <div
              className="w-20 h-1.5 rounded-full overflow-hidden"
              style={{ background: 'var(--border-color)' }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${(completedCategories / INSTALL_PHOTO_CATEGORIES.length) * 100}%`,
                  background: completedCategories === INSTALL_PHOTO_CATEGORIES.length
                    ? '#22c55e'
                    : 'var(--accent-color)',
                }}
              />
            </div>
            <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {completedCategories}/{INSTALL_PHOTO_CATEGORIES.length}
            </span>
          </div>
        ) : undefined
      }
    >
      {error && (
        <div
          className="flex items-start gap-2 text-xs px-3 py-2 rounded-lg mb-3"
          style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}
        >
          <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto underline text-[10px]">dismiss</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10 gap-2"
          style={{ color: 'var(--text-muted)' }}>
          <Loader2 size={14} className="animate-spin" />
          <span className="text-xs">Loading photos…</span>
        </div>
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
        >
          {INSTALL_PHOTO_CATEGORIES.map(cat => (
            <CategoryPanel
              key={cat.key}
              category={cat}
              photos={grouped[cat.key] ?? []}
              onUpload={handleUpload}
              onDelete={handleDelete}
              uploading={uploading === cat.key}
              deletingId={deletingId}
            />
          ))}
        </div>
      )}
    </Section>
  );
}
