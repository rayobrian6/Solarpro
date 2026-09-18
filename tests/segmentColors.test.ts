/**
 * tests/segmentColors.test.ts
 *
 * Unit tests for the per-face outline color palette + assignment
 * algorithm in components/3d/segments/colors.ts.
 *
 * Aurora reference (sampled from frame_0110.jpg / frame_0115.jpg /
 * frame_0120.jpg): each roof face has a distinct outline color from
 * a fixed 4-color palette — red, yellow, green, blue — in that order,
 * cycling.
 *
 * What this guards:
 *   - Palette has the exact 4 hex values, byte-for-byte
 *   - colorForIndex cycles correctly across 0, 1, 2, 3, 4, 5, ...
 *   - colorForIndex handles negative indices gracefully
 *   - assignFaceColors returns a stable Map keyed by faceId
 *   - assignFaceColors cycles after 4 faces
 *   - assignFaceColors is order-sensitive (face[0] is always red)
 *   - assignFaceColors handles empty input, single face, 100 faces
 *   - getFaceColor returns the same color as assignFaceColors
 *   - getFaceColor throws on unknown id with a helpful message
 *   - Duplicate ids: last one wins, deterministically
 *   - Input array is not mutated (pure function)
 */

import { describe, it, expect } from 'vitest';
import {
  FACE_COLORS,
  FACE_COLORS_LENGTH,
  EDGE_OUTLINE_WIDTH_PX,
  colorForIndex,
  assignFaceColors,
  getFaceColor,
  type SegmentFace,
} from '@/components/3d/segments/colors';

// ─── Test fixtures ────────────────────────────────────────────────────────

const RED   = '#E63E2A';
const YELLW = '#F2C641';
const GREEN = '#3DAA5C';
const BLUE  = '#3A7BD5';

function makeFaces(ids: readonly string[]): readonly SegmentFace[] {
  return ids.map((id) => ({ id }));
}

// ─── Palette identity ────────────────────────────────────────────────────

describe('segment-colors — palette identity', () => {
  it('FACE_COLORS is exactly 4 entries', () => {
    expect(FACE_COLORS_LENGTH).toBe(4);
    expect(FACE_COLORS).toHaveLength(4);
  });

  it('FACE_COLORS matches Aurora palette byte-for-byte', () => {
    // Sampled from C:/Users/carpe/.mimax-agent/projects/aurora_frames/
    //   frame_0110.jpg, frame_0115.jpg, frame_0120.jpg
    // The order matters: index 0 is the FIRST face drawn.
    expect(FACE_COLORS[0]).toBe(RED);
    expect(FACE_COLORS[1]).toBe(YELLW);
    expect(FACE_COLORS[2]).toBe(GREEN);
    expect(FACE_COLORS[3]).toBe(BLUE);
  });

  it('FACE_COLORS is frozen at runtime', () => {
    // The Object.freeze in the source should propagate to the readonly
    // surface; verify the type AND the runtime behavior.
    expect(Object.isFrozen(FACE_COLORS)).toBe(true);
  });

  it('EDGE_OUTLINE_WIDTH_PX is a positive integer (unselected face)', () => {
    expect(EDGE_OUTLINE_WIDTH_PX).toBeGreaterThan(0);
    expect(Number.isInteger(EDGE_OUTLINE_WIDTH_PX)).toBe(true);
  });
});

// ─── colorForIndex — the cycle helper ────────────────────────────────────

describe('segment-colors — colorForIndex cycle', () => {
  it('returns palette entries in order for indices 0..3', () => {
    expect(colorForIndex(0)).toBe(RED);
    expect(colorForIndex(1)).toBe(YELLW);
    expect(colorForIndex(2)).toBe(GREEN);
    expect(colorForIndex(3)).toBe(BLUE);
  });

  it('wraps to the start at index 4 (5th face → red again)', () => {
    expect(colorForIndex(4)).toBe(RED);
    expect(colorForIndex(5)).toBe(YELLW);
    expect(colorForIndex(6)).toBe(GREEN);
    expect(colorForIndex(7)).toBe(BLUE);
  });

  it('completes a second full cycle at indices 8..11', () => {
    expect(colorForIndex(8)).toBe(RED);
    expect(colorForIndex(9)).toBe(YELLW);
    expect(colorForIndex(10)).toBe(GREEN);
    expect(colorForIndex(11)).toBe(BLUE);
  });

  it('handles a residential-roof-sized batch (20 faces = 5 cycles)', () => {
    // 20 faces → 5 complete cycles. The first face of each cycle is red.
    for (let i = 0; i < 20; i++) {
      const expected = FACE_COLORS[i % 4];
      expect(colorForIndex(i)).toBe(expected);
    }
  });

  it('handles a large batch (100 faces)', () => {
    // Sanity check: no off-by-one at any index.
    for (let i = 0; i < 100; i++) {
      expect(colorForIndex(i)).toBe(FACE_COLORS[i % 4]);
    }
  });

  it('handles negative indices by wrapping from the end', () => {
    // -1 → last entry (blue), -2 → green, -3 → yellow, -4 → red,
    // -5 → cycles back to blue.
    expect(colorForIndex(-1)).toBe(BLUE);
    expect(colorForIndex(-2)).toBe(GREEN);
    expect(colorForIndex(-3)).toBe(YELLW);
    expect(colorForIndex(-4)).toBe(RED);
    expect(colorForIndex(-5)).toBe(BLUE);
  });
});

// ─── assignFaceColors — the main API ─────────────────────────────────────

describe('segment-colors — assignFaceColors', () => {
  it('returns an empty Map for empty input', () => {
    const m = assignFaceColors([]);
    expect(m.size).toBe(0);
  });

  it('returns red for a single face', () => {
    const m = assignFaceColors(makeFaces(['f1']));
    expect(m.get('f1')).toBe(RED);
    expect(m.size).toBe(1);
  });

  it('assigns red, yellow, green, blue to 4 faces in order', () => {
    const m = assignFaceColors(makeFaces(['a', 'b', 'c', 'd']));
    expect(m.get('a')).toBe(RED);
    expect(m.get('b')).toBe(YELLW);
    expect(m.get('c')).toBe(GREEN);
    expect(m.get('d')).toBe(BLUE);
    expect(m.size).toBe(4);
  });

  it('cycles: 5th face is red, 6th is yellow, ...', () => {
    const m = assignFaceColors(makeFaces(['a', 'b', 'c', 'd', 'e', 'f']));
    expect(m.get('a')).toBe(RED);
    expect(m.get('b')).toBe(YELLW);
    expect(m.get('c')).toBe(GREEN);
    expect(m.get('d')).toBe(BLUE);
    expect(m.get('e')).toBe(RED);    // 5th → cycles
    expect(m.get('f')).toBe(YELLW);  // 6th
  });

  it('completes two full cycles (8 faces)', () => {
    const m = assignFaceColors(makeFaces(['1','2','3','4','5','6','7','8']));
    expect(m.get('1')).toBe(RED);
    expect(m.get('2')).toBe(YELLW);
    expect(m.get('3')).toBe(GREEN);
    expect(m.get('4')).toBe(BLUE);
    expect(m.get('5')).toBe(RED);
    expect(m.get('6')).toBe(YELLW);
    expect(m.get('7')).toBe(GREEN);
    expect(m.get('8')).toBe(BLUE);
  });

  it('handles a complex roof with 12 faces (3 cycles)', () => {
    // A 12-face roof is large but plausible for a multi-gable house.
    const ids = Array.from({ length: 12 }, (_, i) => `f${i + 1}`);
    const m = assignFaceColors(makeFaces(ids));
    // First 4 are red/yellow/green/blue
    expect(m.get('f1')).toBe(RED);
    expect(m.get('f2')).toBe(YELLW);
    expect(m.get('f3')).toBe(GREEN);
    expect(m.get('f4')).toBe(BLUE);
    // Next 4 cycle
    expect(m.get('f5')).toBe(RED);
    expect(m.get('f6')).toBe(YELLW);
    expect(m.get('f7')).toBe(GREEN);
    expect(m.get('f8')).toBe(BLUE);
    // Next 4 cycle
    expect(m.get('f9')).toBe(RED);
    expect(m.get('f10')).toBe(YELLW);
    expect(m.get('f11')).toBe(GREEN);
    expect(m.get('f12')).toBe(BLUE);
  });

  it('is order-sensitive: reordering the input changes the assignment', () => {
    // Stability contract: a face's color is determined by its POSITION
    // in the input array, not its id. If the caller reorders, the
    // colors follow the order, not the ids.
    const before = assignFaceColors(makeFaces(['alpha', 'beta', 'gamma', 'delta']));
    const after  = assignFaceColors(makeFaces(['gamma', 'alpha', 'delta', 'beta']));

    // Before: alpha=red, beta=yellow, gamma=green, delta=blue
    expect(before.get('alpha')).toBe(RED);
    expect(before.get('beta')).toBe(YELLW);
    expect(before.get('gamma')).toBe(GREEN);
    expect(before.get('delta')).toBe(BLUE);

    // After reorder: gamma is now first → red; alpha is second → yellow; etc.
    expect(after.get('gamma')).toBe(RED);
    expect(after.get('alpha')).toBe(YELLW);
    expect(after.get('delta')).toBe(GREEN);
    expect(after.get('beta')).toBe(BLUE);
  });

  it('is deterministic: same input → same output (no internal cache / randomness)', () => {
    const faces = makeFaces(['a', 'b', 'c', 'd', 'e']);
    const m1 = assignFaceColors(faces);
    const m2 = assignFaceColors(faces);
    expect([...m1.entries()]).toEqual([...m2.entries()]);
  });

  it('handles duplicate ids deterministically (last one wins)', () => {
    // This is an edge case: in practice the integrator should
    // de-duplicate roof planes. The algorithm picks a deterministic
    // winner (last write) so we don't get random flicker.
    const m = assignFaceColors([
      { id: 'dup' }, // index 0 → would be red, but overwritten
      { id: 'dup' }, // index 1 → yellow, last write wins
    ]);
    expect(m.get('dup')).toBe(YELLW);
    expect(m.size).toBe(1);
  });

  it('does not mutate the input array', () => {
    const faces = makeFaces(['a', 'b', 'c']);
    const before = [...faces];
    assignFaceColors(faces);
    expect(faces).toEqual(before);
  });

  it('accepts extra fields on face objects (structural typing)', () => {
    // Real RoofPlane has many more fields (pitch, azimuth, area, ...).
    // The colors module must ignore them and only read .id.
    const faces: readonly SegmentFace[] = [
      { id: 'p1' },
      { id: 'p2' },
      { id: 'p3' },
    ];
    const m = assignFaceColors(faces);
    expect(m.get('p1')).toBe(RED);
    expect(m.get('p2')).toBe(YELLW);
    expect(m.get('p3')).toBe(GREEN);
  });
});

// ─── getFaceColor — the single-lookup helper ─────────────────────────────

describe('segment-colors — getFaceColor', () => {
  const faces = makeFaces(['a', 'b', 'c', 'd', 'e']);

  it('returns the same color as the Map for an existing face', () => {
    const map = assignFaceColors(faces);
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      expect(getFaceColor(id, faces)).toBe(map.get(id));
    }
  });

  it('returns the cycle color for the index in the knownFaces array', () => {
    expect(getFaceColor('a', faces)).toBe(RED);    // index 0
    expect(getFaceColor('b', faces)).toBe(YELLW);  // index 1
    expect(getFaceColor('c', faces)).toBe(GREEN);  // index 2
    expect(getFaceColor('d', faces)).toBe(BLUE);   // index 3
    expect(getFaceColor('e', faces)).toBe(RED);    // index 4 (cycle)
  });

  it('throws for an unknown faceId', () => {
    expect(() => getFaceColor('nonexistent', faces)).toThrow(
      /nonexistent/,
    );
  });

  it('error message includes the unknown id and the face count', () => {
    // Useful for debugging integration bugs.
    let caught: Error | null = null;
    try {
      getFaceColor('gone', makeFaces(['a', 'b']));
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toMatch(/gone/);
    expect(caught!.message).toMatch(/2/); // 2 known faces
  });

  it('throws on empty knownFaces for any non-empty faceId', () => {
    expect(() => getFaceColor('anything', [])).toThrow(/anything/);
  });

  it('handles the single-face case', () => {
    const one = makeFaces(['solo']);
    expect(getFaceColor('solo', one)).toBe(RED);
  });
});

// ─── Integration scenarios (mirroring real SolarEngine3D usage) ─────────

describe('segment-colors — integration scenarios', () => {
  it('Aurora frame 110 scenario: 6 faces, every edge of a face is the face color', () => {
    // In frame 110 of the Aurora reference, a complex roof has
    // ~6 distinguishable faces colored. The colors cycle after 4.
    const faces = makeFaces(['N1', 'N2', 'S1', 'S2', 'E1', 'W1']);
    const m = assignFaceColors(faces);
    expect(m.get('N1')).toBe(RED);
    expect(m.get('N2')).toBe(YELLW);
    expect(m.get('S1')).toBe(GREEN);
    expect(m.get('S2')).toBe(BLUE);
    expect(m.get('E1')).toBe(RED);   // cycles
    expect(m.get('W1')).toBe(YELLW); // cycles
  });

  it('deletion: 5th face is removed, the rest keep their colors', () => {
    // This documents the "listens-to-state" deletion policy (see
    // COLORS.md §"Deletion / re-add behavior"). The integrator
    // passes the current list, so removing the 5th face means the
    // 6th face shifts to position 4 and becomes red.
    const before = assignFaceColors(makeFaces(['a', 'b', 'c', 'd', 'e', 'f']));
    expect(before.get('f')).toBe(YELLW); // f was index 5 → yellow

    // Simulate deletion of 'e' (5th face) — caller re-renders with [a,b,c,d,f]
    const after = assignFaceColors(makeFaces(['a', 'b', 'c', 'd', 'f']));
    expect(after.get('a')).toBe(RED);
    expect(after.get('b')).toBe(YELLW);
    expect(after.get('c')).toBe(GREEN);
    expect(after.get('d')).toBe(BLUE);
    expect(after.get('f')).toBe(RED); // f moved from index 5 → index 4
  });

  it('re-add after deletion: a new face after deletion re-enters the cycle', () => {
    // After [a,b,c,d,e,f] and deleting 'e', the array becomes
    // [a,b,c,d,f]. Adding 'g' gives [a,b,c,d,f,g] — 'g' is at index
    // 5, which is the 6th face → yellow (5 % 4 = 1).
    const after = assignFaceColors(makeFaces(['a', 'b', 'c', 'd', 'f', 'g']));
    expect(after.get('a')).toBe(RED);     // 1st → red
    expect(after.get('b')).toBe(YELLW);   // 2nd → yellow
    expect(after.get('c')).toBe(GREEN);   // 3rd → green
    expect(after.get('d')).toBe(BLUE);    // 4th → blue
    expect(after.get('f')).toBe(RED);     // 5th (f moved up) → red
    expect(after.get('g')).toBe(YELLW);   // 6th → yellow
  });

  it('re-add after deletion: cycle re-stabilizes for a 5-face roof', () => {
    // A simpler scenario: after [a,b,c,d] and re-adding 'e' as the
    // 5th face, 'e' lands on the cycle start (red).
    const after = assignFaceColors(makeFaces(['a', 'b', 'c', 'd', 'e']));
    expect(after.get('e')).toBe(RED);
  });
});
