import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { inlineManufacturerAssets } from '@/lib/permit/utils/inlineManufacturerAssets';
import { roofProject } from '../../test-fixtures/roofProject';

// Phase 6/9 acceptance: the exported permit package must be self-contained —
// no root-relative /manufacturer-assets/* references may survive, so the
// downloaded HTML and the server-rendered PDF render offline / off-server.
describe('self-contained export (offline)', () => {
  const html = generatePermitHTML(JSON.parse(JSON.stringify(roofProject)));

  it('no root-relative manufacturer-asset URL survives in the generated package', () => {
    const rootRefs = html.match(/["'(]\/manufacturer-assets\/[^"')]+/g) || [];
    expect(rootRefs, `found unresolved root-relative refs: ${rootRefs.slice(0, 5).join(', ')}`).toHaveLength(0);
  });

  it('manufacturer images are embedded as base64 data URIs', () => {
    const dataUris = html.match(/src="data:image\/[a-z+]+;base64,/g) || [];
    expect(dataUris.length).toBeGreaterThan(0);
  });

  it('inliner is idempotent and reports nothing missing for the fixture equipment', () => {
    const again = inlineManufacturerAssets(html);
    expect(again.missing).toHaveLength(0);
    // already-inlined html has no more refs to rewrite
    expect(again.html).toBe(html);
  });

  it('inliner rejects path traversal in an asset reference', () => {
    const evil = '<img src="/manufacturer-assets/..%2f..%2fetc%2fpasswd.png">';
    const { html: out, missing } = inlineManufacturerAssets(evil);
    // charset guard: the ".." ref is not a valid asset filename, so it is left
    // untouched (never read from disk) — no data URI, no crash.
    expect(out).not.toContain('data:');
    expect(out).toBe(evil);
    expect(missing).toHaveLength(0);
  });
});
