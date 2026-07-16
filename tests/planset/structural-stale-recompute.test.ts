// A stale worst-case STICK structural result saved on the payload must NOT
// survive when the current design resolves to truss (24" O.C.). The permit
// recomputes and prints truss/PASS, not a false stick "DO NOT ISSUE".
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { roofProject } from '@/test-fixtures/roofProject';

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

describe('structural: stale saved result is recomputed (not trusted)', () => {
  it('replaces a stale stick DO-NOT-ISSUE with the live truss analysis', () => {
    const input = clone(roofProject) as unknown as Record<string, unknown>;
    // roofProject is 24" O.C. with no explicit framing → resolves to TRUSS.
    // Bake in a stale STICK result (as an old engineering report would carry).
    (input.compliance as Record<string, unknown>) = {
      ...(input.compliance as Record<string, unknown>),
      structural: {
        rafter: {
          framingType: 'rafter',
          bendingMoment: 1119.3,
          allowableBendingMoment: 1000,
          rafterSpan: 12,
          utilizationRatio: 1.09,
          deflection: 0.87,
          allowableDeflection: 0.8,
          Fb_prime: 1977,
        },
      },
    };

    const html = generatePermitHTML(input as never);
    // The stale stick framing must be gone; truss analysis present.
    expect(html).toContain('Truss');
    // The false stick DO-NOT-ISSUE must not survive on a resolved-truss house.
    const letterStart = html.indexOf('LETTER OF STRUCTURAL');
    const letter = letterStart >= 0 ? html.slice(letterStart, letterStart + 12000) : html;
    expect(letter).not.toContain('Stick (rafter)');
  });
});
