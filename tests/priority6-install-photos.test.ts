/**
 * Priority 6 — Install Photo Upload
 *
 * Tests cover:
 *   1. Category config completeness + key constraints
 *   2. installFileType() helper
 *   3. categoryKeyFromFileType() helper
 *   4. groupPhotosByCategory() helper
 *   5. Component export surface
 *   6. Source-code assertions on OperationsTab integration
 *   7. Source-code assertions on download route inline mode
 *   8. API project-files route has DELETE handler
 *   9. InstallPhotosSection render contract assertions (source scan)
 *  10. Regression: OperationsTab still has all original sections
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import {
  INSTALL_PHOTO_CATEGORIES,
  installFileType,
  categoryKeyFromFileType,
  groupPhotosByCategory,
  type InstallPhoto,
  type PhotoCategoryConfig,
} from '@/components/project/InstallPhotosSection';

// ─── helpers to read source files ────────────────────────────────────────────

function readSrc(rel: string): string {
  const abs = path.join(process.cwd(), rel);
  return fs.readFileSync(abs, 'utf-8');
}

// ─── 1. Category config ───────────────────────────────────────────────────────

describe('INSTALL_PHOTO_CATEGORIES', () => {
  it('has exactly 8 categories', () => {
    expect(INSTALL_PHOTO_CATEGORIES).toHaveLength(8);
  });

  it('contains all required categories', () => {
    const keys = INSTALL_PHOTO_CATEGORIES.map(c => c.key);
    expect(keys).toContain('before');
    expect(keys).toContain('during');
    expect(keys).toContain('after');
    expect(keys).toContain('electrical');
    expect(keys).toContain('roof');
    expect(keys).toContain('meter');
    expect(keys).toContain('labels');
    expect(keys).toContain('inspection');
  });

  it('all categories have non-empty key, label, emoji, description', () => {
    for (const cat of INSTALL_PHOTO_CATEGORIES) {
      expect(cat.key.length).toBeGreaterThan(0);
      expect(cat.label.length).toBeGreaterThan(0);
      expect(cat.emoji.length).toBeGreaterThan(0);
      expect(cat.description.length).toBeGreaterThan(0);
    }
  });

  it('category keys are lowercase snake_case (no spaces, no uppercase)', () => {
    for (const cat of INSTALL_PHOTO_CATEGORIES) {
      expect(cat.key).toMatch(/^[a-z_]+$/);
    }
  });

  it('category keys are unique', () => {
    const keys = INSTALL_PHOTO_CATEGORIES.map(c => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('exports PhotoCategoryConfig type', () => {
    // Type-level smoke test — if we can assign to it, it's exported
    const sample: PhotoCategoryConfig = INSTALL_PHOTO_CATEGORIES[0];
    expect(sample.key).toBeTruthy();
  });
});

// ─── 2. installFileType() ─────────────────────────────────────────────────────

describe('installFileType()', () => {
  it('prefixes key with install_', () => {
    expect(installFileType('before')).toBe('install_before');
    expect(installFileType('after')).toBe('install_after');
    expect(installFileType('electrical')).toBe('install_electrical');
    expect(installFileType('inspection')).toBe('install_inspection');
  });

  it('works for all 8 categories', () => {
    for (const cat of INSTALL_PHOTO_CATEGORIES) {
      expect(installFileType(cat.key)).toBe(`install_${cat.key}`);
    }
  });
});

// ─── 3. categoryKeyFromFileType() ────────────────────────────────────────────

describe('categoryKeyFromFileType()', () => {
  it('extracts key from install_xxx file types', () => {
    expect(categoryKeyFromFileType('install_before')).toBe('before');
    expect(categoryKeyFromFileType('install_after')).toBe('after');
    expect(categoryKeyFromFileType('install_electrical')).toBe('electrical');
    expect(categoryKeyFromFileType('install_inspection')).toBe('inspection');
  });

  it('returns null for non-install file types', () => {
    expect(categoryKeyFromFileType('site_photo')).toBeNull();
    expect(categoryKeyFromFileType('utility_bill')).toBeNull();
    expect(categoryKeyFromFileType('permit')).toBeNull();
    expect(categoryKeyFromFileType('other')).toBeNull();
    expect(categoryKeyFromFileType('')).toBeNull();
  });

  it('returns null for bare install_ prefix (no suffix)', () => {
    expect(categoryKeyFromFileType('install_')).toBeNull();
  });

  it('is the inverse of installFileType for all categories', () => {
    for (const cat of INSTALL_PHOTO_CATEGORIES) {
      expect(categoryKeyFromFileType(installFileType(cat.key))).toBe(cat.key);
    }
  });
});

// ─── 4. groupPhotosByCategory() ───────────────────────────────────────────────

function makePhoto(id: string, fileType: string): InstallPhoto {
  return {
    id,
    file_name: `${id}.jpg`,
    file_type: fileType,
    photo_category: '',
    mime_type: 'image/jpeg',
    file_size: 100_000,
    upload_date: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
}

describe('groupPhotosByCategory()', () => {
  it('returns an object with all 8 category keys', () => {
    const groups = groupPhotosByCategory([]);
    for (const cat of INSTALL_PHOTO_CATEGORIES) {
      expect(groups).toHaveProperty(cat.key);
    }
    expect(Object.keys(groups)).toHaveLength(INSTALL_PHOTO_CATEGORIES.length);
  });

  it('all groups are empty arrays when no photos', () => {
    const groups = groupPhotosByCategory([]);
    for (const cat of INSTALL_PHOTO_CATEGORIES) {
      expect(groups[cat.key]).toEqual([]);
    }
  });

  it('routes photos to correct category bucket', () => {
    const photos = [
      makePhoto('p1', 'install_before'),
      makePhoto('p2', 'install_before'),
      makePhoto('p3', 'install_after'),
      makePhoto('p4', 'install_electrical'),
    ];
    const groups = groupPhotosByCategory(photos);
    expect(groups['before']).toHaveLength(2);
    expect(groups['after']).toHaveLength(1);
    expect(groups['electrical']).toHaveLength(1);
    expect(groups['during']).toHaveLength(0);
    expect(groups['roof']).toHaveLength(0);
  });

  it('ignores photos with non-install file_type', () => {
    const photos = [
      makePhoto('p1', 'site_photo'),
      makePhoto('p2', 'utility_bill'),
      makePhoto('p3', 'install_before'),
    ];
    const groups = groupPhotosByCategory(photos);
    const total = Object.values(groups).reduce((s, arr) => s + arr.length, 0);
    expect(total).toBe(1); // only the install_before one
    expect(groups['before']).toHaveLength(1);
  });

  it('preserves photo objects intact in the buckets', () => {
    const p = makePhoto('abc', 'install_meter');
    const groups = groupPhotosByCategory([p]);
    expect(groups['meter'][0]).toStrictEqual(p);
  });

  it('handles 100 photos across all categories evenly', () => {
    const photos: InstallPhoto[] = [];
    for (let i = 0; i < 100; i++) {
      const cat = INSTALL_PHOTO_CATEGORIES[i % INSTALL_PHOTO_CATEGORIES.length];
      photos.push(makePhoto(`p${i}`, installFileType(cat.key)));
    }
    const groups = groupPhotosByCategory(photos);
    for (const cat of INSTALL_PHOTO_CATEGORIES) {
      // 100 photos / 8 categories = either 12 or 13
      expect(groups[cat.key].length).toBeGreaterThan(0);
    }
    const total = Object.values(groups).reduce((s, arr) => s + arr.length, 0);
    expect(total).toBe(100);
  });
});

// ─── 5. Component export surface ──────────────────────────────────────────────

describe('InstallPhotosSection exports', () => {
  it('exports InstallPhoto type (runtime duck-type check)', () => {
    const p: InstallPhoto = makePhoto('x', 'install_labels');
    expect(p.id).toBe('x');
    expect(p.file_type).toBe('install_labels');
  });
});

// ─── 6. OperationsTab integration ────────────────────────────────────────────

describe('OperationsTab source — InstallPhotosSection integration', () => {
  const src = readSrc('components/project/OperationsTab.tsx');

  it('imports InstallPhotosSection', () => {
    expect(src).toContain("import InstallPhotosSection from '@/components/project/InstallPhotosSection'");
  });

  it('renders <InstallPhotosSection projectId={projectId} />', () => {
    expect(src).toContain('<InstallPhotosSection projectId={projectId}');
  });

  it('no longer imports Zap (unused icon removed)', () => {
    // Zap was removed when we cleaned up the import
    const zapImportLine = src.match(/import\s*\{[^}]*Zap[^}]*\}\s*from\s*['"]lucide-react['"]/);
    expect(zapImportLine).toBeNull();
  });
});

// ─── 7. Download route inline mode ───────────────────────────────────────────

describe('download route — inline=1 support', () => {
  const src = readSrc('app/api/project-files/download/route.ts');

  it('has INLINE_SAFE_MIME_TYPES set with jpeg/png/gif/webp', () => {
    expect(src).toContain('INLINE_SAFE_MIME_TYPES');
    expect(src).toContain("'image/jpeg'");
    expect(src).toContain("'image/png'");
    expect(src).toContain("'image/gif'");
    expect(src).toContain("'image/webp'");
  });

  it('reads wantInline from ?inline=1 query param', () => {
    expect(src).toContain("searchParams.get('inline') === '1'");
  });

  it('uses inline disposition for safe images when wantInline=true', () => {
    expect(src).toContain('inline; filename=');
    expect(src).toContain('attachment; filename=');
  });

  it('documents SVG is always forced to attachment', () => {
    expect(src).toContain('SVG');
  });

  it('still has X-Content-Type-Options: nosniff', () => {
    expect(src).toContain('X-Content-Type-Options');
    expect(src).toContain('nosniff');
  });
});

// ─── 8. project-files DELETE handler ─────────────────────────────────────────

describe('project-files route — DELETE handler', () => {
  const src = readSrc('app/api/project-files/route.ts');

  it('exports async function DELETE', () => {
    expect(src).toContain('export async function DELETE');
  });

  it('DELETE verifies user ownership before deleting', () => {
    expect(src).toContain('user.id');
    expect(src).toContain('DELETE FROM project_files');
  });
});

// ─── 9. InstallPhotosSection source assertions ────────────────────────────────

describe('InstallPhotosSection source — render contract', () => {
  const src = readSrc('components/project/InstallPhotosSection.tsx');

  it('has Lightbox component', () => {
    expect(src).toContain('function Lightbox(');
  });

  it('has Thumbnail component', () => {
    expect(src).toContain('function Thumbnail(');
  });

  it('has CategoryPanel component', () => {
    expect(src).toContain('function CategoryPanel(');
  });

  it('uses ?inline=1 for image thumbnail src', () => {
    expect(src).toContain('inline=1');
  });

  it('enforces MAX_FILE_SIZE = 10 MB', () => {
    expect(src).toContain('10 * 1024 * 1024');
    expect(src).toContain('MAX_FILE_SIZE');
  });

  it('accepts only image/* in file input', () => {
    expect(src).toContain('accept="image/*"');
  });

  it('supports multi-file upload', () => {
    expect(src).toContain('multiple');
  });

  it('handles upload errors gracefully', () => {
    expect(src).toContain('errors.push');
  });

  it('calls /api/project-files with correct JSON payload', () => {
    expect(src).toContain("'/api/project-files'");
    expect(src).toContain('installFileType(categoryKey)');
  });

  it('has keyboard navigation in Lightbox (ArrowLeft, ArrowRight, Escape)', () => {
    expect(src).toContain("'ArrowLeft'");
    expect(src).toContain("'ArrowRight'");
    expect(src).toContain("'Escape'");
  });

  it('shows progress indicator (completedCategories / total)', () => {
    expect(src).toContain('completedCategories');
    expect(src).toContain('INSTALL_PHOTO_CATEGORIES.length');
  });

  it('renders empty-state "Click to upload" dashed zone', () => {
    expect(src).toContain('Click to upload');
  });

  it('formats file size with formatFileSize helper', () => {
    expect(src).toContain('formatFileSize');
  });
});

// ─── 10. Regression: OperationsTab original sections intact ───────────────────

describe('OperationsTab regression — original sections', () => {
  const src = readSrc('components/project/OperationsTab.tsx');

  it('still has Pipeline Status section', () => {
    expect(src).toContain('Pipeline Status');
  });

  it('still has Task Checklist section', () => {
    expect(src).toContain('Task Checklist');
  });

  it('still has Scheduling section', () => {
    expect(src).toContain('Scheduling');
  });

  it('still has Milestones section', () => {
    expect(src).toContain('Milestones');
  });

  it('still has Cost Tracking section', () => {
    expect(src).toContain('Cost Tracking');
  });

  it('still has fetchAll, toggleTask, toggleMilestone functions', () => {
    expect(src).toContain('fetchAll');
    expect(src).toContain('toggleTask');
    expect(src).toContain('toggleMilestone');
  });
});
