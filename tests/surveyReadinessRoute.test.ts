// ============================================================================
// POST /api/survey/readiness
//
// The route is the delivery point for the Engineering Requirement Registry on
// the phone. These tests pin: token-scoped auth, that the survey id comes from
// the VERIFIED token rather than the body, and that a malformed photo entry
// cannot manufacture a satisfied requirement.
//
// Pure ASCII, no Unicode.
// ============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';

const HANDOFF_SECRET = 'test-handoff-secret-for-readiness-route-0123456789';

beforeAll(() => {
  process.env.SOLARPRO_HANDOFF_SECRET = HANDOFF_SECRET;
});

async function mintToken(projectId = 'project-abc'): Promise<string> {
  const { mintHandoffToken } = await import('../lib/survey/handoff/tokenMinter');
  const result = mintHandoffToken({ project_id: projectId, inspector_name: 'Field Tech' });
  if (result.ok !== true) {
    throw new Error('mintHandoffToken failed — SOLARPRO_HANDOFF_SECRET not usable in this test run');
  }
  return result.token;
}

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/survey/readiness', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function post(body: unknown) {
  const { POST } = await import('../app/api/survey/readiness/route');
  const res = await POST(request(body));
  return { status: res.status, body: await res.json() };
}

function photo(category: string, index: number) {
  return {
    id: `p-${index}`,
    category,
    tag: '',
    url: `https://blob.example/${category}-${index}.jpg`,
    uploadKey: `key/${category}/${index}`,
    capturedAt: '2026-09-25T12:00:00.000Z',
  };
}

const ALL_REQUIRED = [
  'main_panel_open',
  'main_panel_closed',
  'meter',
  'roof_overview',
  'service_entrance',
].map((category, index) => photo(category, index));

describe('POST /api/survey/readiness', () => {
  it('rejects a request with no token', async () => {
    const res = await post({ photos: [] });
    expect(res.status).toBe(400);
  });

  it('rejects an unverifiable token with 401 and returns no verdict', async () => {
    const res = await post({ token: 'not-a-real-jwt', photos: ALL_REQUIRED });
    expect(res.status).toBe(401);
    expect(res.body.readiness).toBeUndefined();
  });

  it('rejects a missing photos array', async () => {
    const res = await post({ token: await mintToken() });
    expect(res.status).toBe(400);
  });

  it('returns NOT ready for a survey with all five required photos', async () => {
    const res = await post({ token: await mintToken(), photos: ALL_REQUIRED });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const readiness = res.body.readiness;
    expect(readiness.requiredPhotosComplete).toBe(true);
    expect(readiness.readyToLeave).toBe(false);
    expect(readiness.readiness).toBe('needs_review');
    expect(readiness.engineSource).toBe('engineering_requirement_registry_v1');

    const structural = readiness.items.find(
      (item: { requirementId: string }) => item.requirementId === 'structural_access',
    );
    expect(structural.status).not.toBe('satisfied');
    expect(structural.movementZone).toBe('attic_structural_area');
  });

  it('scopes the verdict to the verified token, ignoring a body-supplied survey id', async () => {
    const res = await post({
      token: await mintToken('project-abc'),
      surveyId: 'someone-elses-survey',
      projectId: 'someone-elses-project',
      photos: ALL_REQUIRED,
    });
    expect(res.status).toBe(200);
    // The body values are not echoed back and cannot select another survey:
    // the route reads no database and derives scope from claims.jti only.
    expect(JSON.stringify(res.body)).not.toContain('someone-elses-survey');
    expect(JSON.stringify(res.body)).not.toContain('someone-elses-project');
  });

  it('drops malformed photo entries instead of coercing them into evidence', async () => {
    const res = await post({
      token: await mintToken(),
      photos: [
        null,
        'meter',
        { category: 'meter' },                       // no url
        { url: 'https://blob.example/x.jpg' },       // no category
        photo('meter', 9),                           // the only valid one
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.photosEvaluated).toBe(1);
    expect(res.body.readiness.readyToLeave).toBe(false);
    expect(res.body.readiness.outstandingCounts.blocking).toBe(2);
  });

  it('reports ready to leave once attic access is also captured', async () => {
    const res = await post({
      token: await mintToken(),
      photos: [...ALL_REQUIRED, photo('attic_access', 9)],
    });
    expect(res.status).toBe(200);
    expect(res.body.readiness.readyToLeave).toBe(true);
    expect(res.body.readiness.outstandingCounts.blocking).toBe(0);
    expect(res.body.readiness.outstandingCounts.review_required).toBe(0);
  });
});
