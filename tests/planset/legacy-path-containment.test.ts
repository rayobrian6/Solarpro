/**
 * tests/planset/legacy-path-containment.test.ts
 *
 * W4 §6 — PERMANENT RESOLUTION of the parallel lib/plan-set/* planset path.
 *
 * The W3.1 §3 interim containment (fail-closed LEGACY banner via
 * legacy-path-guard) has been SUPERSEDED by permanent deletion:
 *   - the /api/engineering/plan-set route is now an HTTP 410 tombstone;
 *   - the snapshot-blind sheet builders and the legacy-path-guard are deleted;
 *   - the only production planset authority is /api/engineering/permit.
 *
 * These tests prove the bypass is gone for good: the route can no longer
 * generate a permit artifact, and no PASS-capable legacy builder remains
 * importable.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/engineering/plan-set/route';

const ROOT = path.resolve(__dirname, '../..');

function req(method: 'GET' | 'POST'): NextRequest {
  return new NextRequest('http://localhost/api/engineering/plan-set', { method });
}

describe('W4 §6 — legacy /api/engineering/plan-set route is retired (410 Gone)', () => {
  it('GET returns 410 with the retirement code — no artifact, no PASS', async () => {
    const res = await GET(req('GET'));
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('PLAN_SET_ROUTE_RETIRED');
    expect(body.canonicalRoute).toBe('/api/engineering/permit');
    // The retired route never emits a structural PASS / permit-ready artifact.
    expect(JSON.stringify(body)).not.toContain('STRUCTURAL_PASS');
    expect(body.permitReady).toBeUndefined();
  });

  it('POST returns 410 with the retirement code — the generator cannot run', async () => {
    const res = await POST(req('POST'));
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.code).toBe('PLAN_SET_ROUTE_RETIRED');
    expect(res.headers.get('X-Canonical-Route')).toBe('/api/engineering/permit');
  });

  it('route source contains no snapshot-blind sheet generation', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'app/api/engineering/plan-set/route.ts'),
      'utf8',
    );
    // No sheet builders imported, no compute/PDF pipeline, no PASS declaration.
    expect(src).not.toContain('buildStructuralSheet');
    expect(src).not.toContain('buildComplianceSheet');
    expect(src).not.toContain('generatePdfFromHtml');
    expect(src).not.toContain('resolveLegacyPathStatus');
    expect(src).not.toContain('computeSystem');
    expect(src).not.toContain('STRUCTURAL_PASS');
  });
});

describe('W4 §6 — the PASS-capable legacy builders are deleted (not importable)', () => {
  const deleted = [
    'lib/plan-set/legacy-path-guard.ts',
    'lib/plan-set/cover-sheet.ts',
    'lib/plan-set/electrical-sheet.ts',
    'lib/plan-set/structural-sheet.ts',
    'lib/plan-set/equipment-schedule.ts',
    'lib/plan-set/site-layout-sheet.ts',
    'lib/plan-set/mounting-details-sheet.ts',
    'lib/plan-set/compliance-sheet.ts',
    'lib/plan-set/title-block.ts',
  ];

  it.each(deleted)('deleted file no longer exists: %s', (rel) => {
    expect(fs.existsSync(path.join(ROOT, rel))).toBe(false);
  });

  it('the legacy-path-guard module cannot be imported', async () => {
    // Non-literal specifier: the module is deleted, so tsc/vite must not resolve
    // it statically — resolution fails at runtime, which is exactly the proof.
    const spec = ['@/lib', 'plan-set', 'legacy-path-guard'].join('/');
    await expect(import(/* @vite-ignore */ spec)).rejects.toBeTruthy();
  });

  it('permit-system-model (pure ComputedSystem bridge, still used by /api/engineering/sld) is retained', () => {
    expect(fs.existsSync(path.join(ROOT, 'lib/plan-set/permit-system-model.ts'))).toBe(true);
  });
});
