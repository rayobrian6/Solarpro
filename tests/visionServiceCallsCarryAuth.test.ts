/**
 * tests/visionServiceCallsCarryAuth.test.ts
 *
 * EVERY CALL TO A RENDER VISION SERVICE CARRIES THE SERVICE BEARER.
 *
 * SAM2 (+ MiDaS) and the OpenCV photo-vision worker now refuse every request
 * except /health without `Authorization: Bearer <VISION_SERVICE_TOKEN>`
 * (sam2-service/service_auth.py, tests/python/test_vision_service_auth.py).
 * This is the other half: the website's clients must send it, through the one
 * helper (lib/renderServiceAuth.ts), on every non-health call — including ones
 * added later, which the census at the bottom catches.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withVisionServiceAuth } from '@/lib/renderServiceAuth';

const TOKEN = 'test-vision-token-0123456789abcdef';
const ROOT = join(__dirname, '..');

type Call = { url: string; auth: string | null };
let calls: Call[] = [];

function mockFetch(respond: (url: string) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, auth: new Headers(init?.headers ?? undefined).get('authorization') });
    return respond(u);
  }));
}

beforeEach(() => {
  calls = [];
  vi.stubEnv('VISION_SERVICE_TOKEN', TOKEN);
  vi.stubEnv('SAM2_SERVICE_URL', 'https://sam2.test');
  vi.stubEnv('MIDAS_SERVICE_URL', 'https://sam2.test');
  vi.stubEnv('OPEN_SOURCE_PHOTO_VISION_WORKER_URL', 'https://opencv.test');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('withVisionServiceAuth', () => {
  it('adds the bearer and keeps the caller\'s headers', () => {
    const init = withVisionServiceAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const h = new Headers(init.headers);
    expect(h.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(h.get('content-type')).toBe('application/json');
    expect(init.method).toBe('POST');
  });
  it('leaves a FormData body untouched (no content-type forced — multipart boundary survives)', () => {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array([1, 2, 3])]), 'x.png');
    const init = withVisionServiceAuth({ method: 'POST', body: fd });
    expect(init.body).toBe(fd);
    expect(new Headers(init.headers).get('content-type')).toBeNull();
  });
  it('sends no Authorization header when the token is unset', () => {
    vi.stubEnv('VISION_SERVICE_TOKEN', '');
    expect(new Headers(withVisionServiceAuth({}).headers).get('authorization')).toBeNull();
  });
});

describe('🚨 the clients send the bearer on real calls', () => {
  it('SAM2 /segment', async () => {
    mockFetch(() => new Response(JSON.stringify({ masks: [], image_width: 1, image_height: 1, processing_time_ms: 1, model_name: 'x', num_masks: 0 }), { status: 200 }));
    const { segmentWithSAM2 } = await import('@/lib/siteSurveys/geometryReconstruction/workers/segmentation/sam2Client');
    await segmentWithSAM2(Buffer.from([1, 2, 3]));
    const seg = calls.filter(c => c.url.includes('/segment'));
    expect(seg.length).toBeGreaterThan(0);
    for (const c of seg) expect(c.auth).toBe(`Bearer ${TOKEN}`);
  });

  it('MiDaS /depth', async () => {
    mockFetch(() => new Response(JSON.stringify({}), { status: 200 }));
    const { estimateDepthWithMidas } = await import('@/lib/siteSurveys/geometryReconstruction/workers/depth/midasClient');
    await estimateDepthWithMidas(Buffer.from([1, 2, 3]));
    const depth = calls.filter(c => c.url.includes('/depth'));
    expect(depth.length).toBeGreaterThan(0);
    for (const c of depth) expect(c.auth).toBe(`Bearer ${TOKEN}`);
  });

  it('OpenCV /vision/match-features', async () => {
    mockFetch(() => new Response(JSON.stringify({ success: false }), { status: 200 }));
    const { matchFeatures } = await import('@/lib/vision/projection/featureMatching');
    await matchFeatures('https://a.test/1.jpg', 'https://a.test/2.jpg', { workerUrl: 'https://opencv.test' });
    expect(calls.map(c => c.auth)).toEqual([`Bearer ${TOKEN}`]);
  });

  it('OpenCV /vision/estimate-homography', async () => {
    mockFetch(() => new Response(JSON.stringify({ success: false }), { status: 200 }));
    const { estimateHomography } = await import('@/lib/vision/projection/homographyPipeline');
    const pts = Array.from({ length: 8 }, (_, i) => ({ x: i, y: i * 2 }));
    await estimateHomography(pts, pts, { workerUrl: 'https://opencv.test' });
    expect(calls.map(c => c.auth)).toEqual([`Bearer ${TOKEN}`]);
  });
});

// ── Census: no unauthenticated call can be added to these clients ───────────

const CLIENT_FILES = [
  'lib/siteSurveys/geometryReconstruction/workers/segmentation/sam2Client.ts',
  'lib/siteSurveys/geometryReconstruction/workers/depth/midasClient.ts',
  'lib/vision/projection/featureMatching.ts',
  'lib/vision/projection/homographyPipeline.ts',
  'lib/assistedEvidenceSources/externalOpenCvPhotoVisionClient.ts',
  'lib/assistedEvidenceSources/asyncPhotoVisionJobManager.ts',
];

describe('🚨 census — every non-health fetch in the vision clients is wrapped', () => {
  for (const file of CLIENT_FILES) {
    it(file, () => {
      const src = readFileSync(join(ROOT, file), 'utf8');
      const offences: string[] = [];
      const re = /\bfetch\(([^,]+),\s*([^\n]*)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const target = m[1];
        const initStart = m[2];
        if (/\/health/.test(target)) continue;           // Render health probe stays public
        if (!/^withVisionServiceAuth\(/.test(initStart.trim())) {
          offences.push(`fetch(${target}, ${initStart.trim().slice(0, 40)}…`);
        }
      }
      expect(offences, `${file} calls a vision service without withVisionServiceAuth`).toEqual([]);
    });
  }
});
