/**
 * tests/geometryMutationPolicy.test.ts
 *
 * AUTOMATIC / INFERRED MUTATION ≠ EXPLICIT USER-AUTHORED MUTATION.
 *
 * `lib/3d/abutment.ts` said "Horizontal position is NEVER touched — the
 * plan-view footprint the user traced is theirs". Read literally that forbids a
 * Move tool, and a UX proposal turned on re-reading it. Rather than reinterpret
 * the repo's most consequential geometry rule in passing, it was put to the
 * product owner. The ruling (Ray, 2026-09-21):
 *
 *   An explicit user gesture MAY move a traced footprint horizontally. The
 *   existing rule means INFERENCE AND AUTOMATIC RECONCILIATION must never
 *   SILENTLY move the user's traced plan geometry.
 *
 * This file pins that distinction so it cannot be quietly re-narrowed or
 * re-widened by the next reader of either comment.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluateGeometryMutation,
  mayMoveFootprint,
  type GeometryMutationIntent,
} from '@/lib/3d/geometryMutationPolicy';

const intent = (o: Partial<GeometryMutationIntent> = {}): GeometryMutationIntent => ({
  operation: 'test',
  authorship: 'inferred',
  effect: 'moves-footprint',
  ...o,
});

describe('the one combination the rule exists to stop', () => {
  it('🚨 INFERENCE MAY NOT MOVE A TRACED FOOTPRINT', () => {
    const v = evaluateGeometryMutation(intent({ operation: 'abutment snap', authorship: 'inferred' }));
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/never silently move/i);
    expect(mayMoveFootprint('inferred')).toBe(false);
  });
});

describe('the three combinations it permits', () => {
  it('an EXPLICIT USER GESTURE may move a traced footprint', () => {
    const v = evaluateGeometryMutation(intent({ operation: 'drag section', authorship: 'user-authored' }));
    expect(v.allowed).toBe(true);
    expect(mayMoveFootprint('user-authored')).toBe(true);
  });

  it('inference may still change HEIGHT — that is what abutment does', () => {
    const v = evaluateGeometryMutation(
      intent({ operation: 'abutment lift', authorship: 'inferred', effect: 'preserves-footprint' }),
    );
    expect(v.allowed).toBe(true);
  });

  it('a user gesture that changes only height is allowed too', () => {
    expect(
      evaluateGeometryMutation(
        intent({ operation: 'walls stepper', authorship: 'user-authored', effect: 'preserves-footprint' }),
      ).allowed,
    ).toBe(true);
  });
});

describe('a verdict always carries its reason, including when it allows', () => {
  it('every combination explains itself', () => {
    // The reason is the audit record. A bare boolean cannot tell a later reader
    // WHICH half of the rule let a mutation through, which is how the original
    // sentence came to be read two different ways in the first place.
    for (const authorship of ['inferred', 'user-authored'] as const) {
      for (const effect of ['preserves-footprint', 'moves-footprint'] as const) {
        const v = evaluateGeometryMutation(intent({ authorship, effect }));
        expect(v.reason.length, `${authorship}/${effect} returned an empty reason`).toBeGreaterThan(20);
        expect(v.reason).toContain('test');   // the operation name is always named
      }
    }
  });
});

describe('the ruling is recorded where both readers will look', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

  it('abutment.ts no longer states the rule without its scope', () => {
    // The original sentence is KEPT — it is still true for that module — but it
    // must not stand alone, because standing alone is what made it ambiguous.
    const src = read('lib/3d/abutment.ts');
    expect(src, 'the original rule should still be there').toContain('Horizontal position is NEVER touched');
    expect(src, 'and it must carry the scope it was ruled to have')
      .toMatch(/EXPLICIT USER-AUTHORED MUTATION/);
    expect(src, 'and point at the one place the policy lives')
      .toContain('lib/3d/geometryMutationPolicy.ts');
  });

  it('the policy module records who ruled and when', () => {
    // An undated rule attributed to nobody is how the first one drifted.
    const src = read('lib/3d/geometryMutationPolicy.ts');
    expect(src).toMatch(/Ray, 2026-09-21/);
    expect(src).toMatch(/AUTOMATIC \/ INFERRED MUTATION\s+≠\s+EXPLICIT USER-AUTHORED MUTATION/);
  });

  it('🚨 the ruling permits the gesture and does NOT declare it ready to build', () => {
    // The distinction that stops this file being read as a green light.
    const src = read('lib/3d/geometryMutationPolicy.ts');
    expect(src).toMatch(/stays unbuilt until/i);
  });
});
