import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { placeRoofOrder, EagleViewProvider } from '../eagleViewProvider';

// Minimal EV Measurement JSON fixture: one ROOF facet (F1) from the real sample.
const GEOM = {
  EAGLEVIEW_EXPORT: {
    STRUCTURES: {
      '@northorientation': '299.8',
      ROOF: {
        FACES: { FACE: [{ '@id': 'F1', '@type': 'ROOF', POLYGON: { '@path': 'L1,L3,L4,L5,L2', '@pitch': '5', '@orientation': '330.2', '@size': '255' } }] },
        LINES: { LINE: [
          { '@id': 'L1', '@path': 'C5,C6', '@type': 'EAVE' },
          { '@id': 'L2', '@path': 'C9,C5', '@type': 'HIP' },
          { '@id': 'L3', '@path': 'C6,C7', '@type': 'RAKE' },
          { '@id': 'L4', '@path': 'C7,C8', '@type': 'RIDGE' },
          { '@id': 'L5', '@path': 'C8,C9', '@type': 'HIP' },
        ] },
        POINTS: { POINT: [
          { '@id': 'C5', '@data': '-4.54,84.64,32.51' }, { '@id': 'C6', '@data': '-4.54,55.79,32.51' },
          { '@id': 'C7', '@data': '4.74,55.79,36.38' }, { '@id': 'C8', '@data': '4.74,68.77,36.38' },
          { '@id': 'C9', '@data': '8.03,72.06,37.75' },
        ] },
      },
    },
  },
};

function mockRes(body: unknown, contentType = 'application/json') {
  return {
    ok: true, status: 200,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? contentType : null) },
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

beforeEach(() => {
  process.env.EAGLEVIEW_CLIENT_ID = 'id';
  process.env.EAGLEVIEW_CLIENT_SECRET = 'secret';
  process.env.EAGLEVIEW_ENV = 'sandbox';
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes('/oauth2/v1/token')) return mockRes({ access_token: 't', expires_in: 3600 });
    if (u.includes('/v2/Order/PlaceOrder')) return mockRes({ OrderId: 1, ReportIds: [999] });
    if (u.includes('/v3/Report/GetReport')) return mockRes({ Latitude: 37.9041155, Longitude: -122.5064934, DeliveryFilesAvailable: [{ DeliveryFileTypeId: 107 }] });
    if (u.includes('GetReportFileAnyFormat')) return mockRes(JSON.stringify(GEOM), 'application/octet-stream');
    throw new Error('unexpected url ' + u);
  }) as unknown as typeof fetch);
});

afterEach(() => vi.unstubAllGlobals());

describe('EagleView order flow', () => {
  it('placeRoofOrder returns the report id', async () => {
    const id = await placeRoofOrder({ lat: 37.9, lng: -122.5, address: '97 Via Los Altos', city: 'Tiburon', state: 'CA', zip: '94920' });
    expect(id).toBe(999);
  });

  it('placeRoofOrder rejects without address/state/zip', async () => {
    await expect(placeRoofOrder({ lat: 37.9, lng: -122.5 })).rejects.toThrow(/address, state, and zip/);
  });

  it('getRoofFacets orders, sees the file ready, and parses facets', async () => {
    const res = await new EagleViewProvider().getRoofFacets({ lat: 37.9, lng: -122.5, address: '97 Via Los Altos', city: 'Tiburon', state: 'CA', zip: '94920' });
    expect(res?.source).toBe('eagleview');
    expect(res?.reportId).toBe('999');
    expect(res?.facets.length).toBe(1);
    expect(res?.facets[0].pitchDegrees).toBeCloseTo(22.6, 1);
    expect(res?.facets[0].azimuthDegrees).toBe(330.2);
  });
});
