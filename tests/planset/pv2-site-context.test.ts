import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { generatePermitHTML } from '@/lib/permit';
import { roofProject } from '../../test-fixtures/roofProject';

// Representative rectangular parcel around the roofProject building (the real
// county-GIS boundary is fetched in the route + unit-tested separately with a
// mock; here we inject a representative polygon to exercise the full render).
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
const OUT = process.env.PV2_OUT_DIR; // set by the evidence run to also dump HTML

describe('PV-2 site-context inset (integration render)', () => {
  it('renders the inset WITH a parcel and omits it (roof plan intact) WITHOUT one', () => {
    const before = generatePermitHTML(clone(roofProject));                                   // no aerialData.parcel
    const afterInput = clone(roofProject) as unknown as Record<string, unknown>;
    afterInput.aerialData = { parcel: REP_PARCEL };
    const after = generatePermitHTML(afterInput as never);

    // Both are full plansets with a PV-2 sheet.
    expect(before).toContain('PV-2');
    expect(after).toContain('PV-2');

    // NO-PARCEL FALLBACK: roof plan kept, no site-context inset, no fabricated lot.
    expect(before).not.toContain('site-context-inset');
    expect(before).not.toContain('SITE / PLOT PLAN');

    // WITH PARCEL: inset renders with APPROXIMATE / COUNTY GIS labeling.
    expect(after).toContain('site-context-inset');
    expect(after).toContain('SITE / PLOT PLAN');
    expect(after).toContain('APPROXIMATE PROPERTY LINE');
    expect(after).toContain('BASED ON COUNTY GIS');
    expect(after).toContain('301-45-072'); // APN

    // NO FABRICATION: no provider feature drawn (none approved), and none of the
    // forbidden ground features appear inside the site-context inset group.
    expect(after).not.toContain('data-feature');
    const insetStart = after.indexOf('site-context-inset');
    const insetSlice = after.slice(insetStart, insetStart + 6000).toLowerCase();
    for (const w of ['driveway', 'sidewalk', 'curb', 'right-of-way', 'easement']) {
      expect(insetSlice).not.toContain(w);
    }

    if (OUT) {
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(path.join(OUT, 'pv2_before.html'), before);
      fs.writeFileSync(path.join(OUT, 'pv2_after.html'), after);
    }
  });
});
