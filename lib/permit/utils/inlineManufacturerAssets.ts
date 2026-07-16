// ═══════════════════════════════════════════════════════════════════════════
// Self-contained export: rewrite root-relative /manufacturer-assets/*.png srcs
// into base64 data URIs so the exported HTML download AND the Puppeteer PDF are
// viewable offline / off-server (they otherwise resolve against about:blank and
// render blank pages). Server-only (uses fs). Only the handful of images a given
// planset actually references are read — not the whole 15MB library.
// Path-traversal hardened per security review (SEC): the src charset is
// restricted and the resolved path is confirmed to stay under public/.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import path from 'node:path';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

// Only filename-safe characters; no slashes beyond the fixed prefix, no '..'.
const ASSET_REF = /\/manufacturer-assets\/[A-Za-z0-9_.\-]+\.(?:png|jpe?g|svg|webp)/g;

/**
 * Inline every /manufacturer-assets/* reference in `html` as a data URI.
 * Returns the rewritten html plus the list of references that could not be
 * resolved (feeds the export-completeness gate). Unresolvable refs are left
 * unchanged so nothing crashes — the caller decides whether to block export.
 */
export function inlineManufacturerAssets(html: string): { html: string; missing: string[] } {
  if (typeof html !== 'string' || html.indexOf('/manufacturer-assets/') === -1) {
    return { html, missing: [] };
  }
  const missing: string[] = [];
  const cache = new Map<string, string | null>();
  const publicRoot = path.join(process.cwd(), 'public');

  const out = html.replace(ASSET_REF, (ref) => {
    if (cache.has(ref)) return cache.get(ref) ?? ref;
    try {
      const rel = ref.replace(/^\//, '');
      if (rel.includes('..')) throw new Error('path traversal rejected');
      const abs = path.resolve(publicRoot, rel);
      if (abs !== publicRoot && !abs.startsWith(publicRoot + path.sep)) {
        throw new Error('resolved path escapes public/');
      }
      const ext = path.extname(abs).toLowerCase();
      const b64 = readFileSync(abs).toString('base64');
      const uri = `data:${MIME[ext] || 'application/octet-stream'};base64,${b64}`;
      cache.set(ref, uri);
      return uri;
    } catch {
      cache.set(ref, null);
      if (!missing.includes(ref)) missing.push(ref);
      return ref;
    }
  });

  return { html: out, missing };
}
