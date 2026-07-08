import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { roofProject } from '../../test-fixtures/roofProject';

// Representative rectangular parcel around the roofProject building. Even WITH a
// county-GIS parcel available, PV-2 must NOT carry a second plot-plan visual.
const REP_PARCEL = {
  polygon: [
    { lat: 33.44820, lng: -112.07455 },
    { lat: 33.44820, lng: -112.07365 },
    { lat: 33.44875, lng: -112.07365 },
    { lat: 33.44875, lng: -112.07455 },
  ],
  apn: '301-45-072',
  acres: 0.18,
  source: 'County GIS',
};

function clone<T>(x: T): T { return JSON.parse(JSON.stringify(x)); }

// Ray, 2026-07-08: the site/plot context (property line, street, driveway,
// service equipment) belongs on the ONE integrated site drawing — PV-1
// "SITE PLAN WITH ROOF PLAN" — matching the professional reference. PV-2 is
// ONLY the to-scale module layout + fire setbacks. A separate plot-plan box
// bolted onto PV-2 was removed; this guards it from ever coming back.
describe('PV-2 carries NO separate site/plot-plan visual', () => {
  it('omits any bolted-on plot inset even when a county-GIS parcel is present', () => {
    const withoutParcel = generatePermitHTML(clone(roofProject));
    const withParcelInput = clone(roofProject) as unknown as Record<string, unknown>;
    withParcelInput.aerialData = { parcel: REP_PARCEL };
    const withParcel = generatePermitHTML(withParcelInput as never);

    // Both are full plansets with a PV-2 sheet.
    expect(withoutParcel).toContain('PV-2');
    expect(withParcel).toContain('PV-2');

    // NEVER a second plot-plan visual on the module-layout sheet — with or
    // without a parcel available.
    for (const html of [withoutParcel, withParcel]) {
      expect(html).not.toContain('site-context-inset');
      expect(html).not.toContain('SITE / PLOT PLAN');
    }

    // WITH a parcel: the site context is drawn INTEGRATED into the main roof
    // drawing (one drawing), not a box — property line + driveway rendered in
    // the roof's own frame (class "pv2-site").
    expect(withParcel).toContain('pv2-site');
    expect(withParcel).toContain('PROPERTY LINE');
    expect(withParcel).toContain('DRIVEWAY');

    // WITHOUT a parcel: no fabricated lot — roof plan exactly as before.
    expect(withoutParcel).not.toContain('pv2-site');
    expect(withoutParcel).not.toContain('DRIVEWAY');
  });
});
