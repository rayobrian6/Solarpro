# components/3d/segments/colors.ts — Face Color Assignment

> **Status:** designed, implemented, unit-tested. Awaiting integration in
> `components/3d/SolarEngine3D.tsx` and `lib/roofPlane3D.ts`.

This document is the design rationale for the per-face outline color
palette used to satisfy the Aurora 2017 "Segments color-coded" parity
requirement (see `HANDOFF_2026-08-25_AURORA_ANALYSIS.md` §3, frames
110 / 115 / 120).

---

## Aurora parity bar (the standard)

When a user is drawing roof faces in Aurora's "Mark roof edges" step
(frame 110 of the handoff), each **face** of the roof gets a distinct
outline color from a fixed 4-color palette. Edges of the same face share
a color, so you can visually group edges that belong together as a
single roof plane.

The exact 4-color palette, sampled from frames 110 / 115 / 120:

| Index | Name       | Hex        | Approx. use in Aurora    |
| ----- | ---------- | ---------- | ------------------------ |
| 0     | Red        | `#E63E2A`  | First face drawn         |
| 1     | Yellow     | `#F2C641`  | Second face drawn        |
| 2     | Green      | `#3DAA5C`  | Third face drawn         |
| 3     | Blue       | `#3A7BD5`  | Fourth face drawn        |

Faces cycle through the palette in that order. If a roof has more than
4 faces, the 5th face re-uses Red, the 6th Yellow, and so on.

---

## Design constraints

1. **Per-face, not per-edge.** A face is one `RoofPlane`; an edge is one
   side of the polygon. Cesium's `polygon.outlineColor` is a single
   color for the entire outline, so we map **face → color** and let
   Cesium draw the edges.
2. **Stable across re-renders.** The color of a face MUST NOT change
   just because React re-rendered or a sibling plane was added.
   Stability is provided by the caller's stable `roofPlanes` array
   order, not by an internal cache.
3. **Pure functions, no side effects.** No DOM, no Cesium, no module-level
   state. Same input → same output, every time. This is the only way
   the algorithm can be unit-tested without a 3D scene.
4. **No dependency on `RoofPlane`'s full type.** The algorithm only
   needs `id`. We accept the structural minimum `{ id: string }[]` so
   the module can be reused if the segment-arrows agent needs the same
   data without importing `types/index.ts`.
5. **Deterministic overflow.** More than 4 faces cycles through the
   palette. There is no "next unique color" generator — the contract is
   explicitly 4 colors.

---

## Public API

```ts
/** The 4-color palette, in assignment order. Index 0 = first face. */
export const FACE_COLORS: readonly string[];

/** Cycles FACE_COLORS by index, with negative-index safety. */
export function colorForIndex(index: number): string;

/**
 * Returns a Map from faceId to its assigned outline color.
 * Order in `faces` is order of assignment: faces[0] gets FACE_COLORS[0],
 * faces[1] gets FACE_COLORS[1], etc. Cycle after 4.
 */
export function assignFaceColors(
  faces: readonly { readonly id: string }[],
): ReadonlyMap<string, string>;

/**
 * Returns the color of a single faceId. Throws if faceId is not in
 * `knownFaces` — callers are expected to look up colors for faces they
 * already know about.
 */
export function getFaceColor(
  faceId: string,
  knownFaces: readonly { readonly id: string }[],
): string;
```

---

## Algorithm

### `colorForIndex(i)`

```
return FACE_COLORS[((i % 4) + 4) % 4];
```

The `((i % 4) + 4) % 4` pattern handles negative indices gracefully
(returning the same color as `4 + i`). In practice callers only pass
non-negative indices, but the safety is cheap.

### `assignFaceColors(faces)`

```ts
const map = new Map<string, string>();
for (let i = 0; i < faces.length; i++) {
  map.set(faces[i].id, colorForIndex(i));
}
return map;
```

Deterministic, order-preserving, and O(n). Empty input returns an
empty map.

### `getFaceColor(faceId, knownFaces)`

```ts
const idx = knownFaces.findIndex(f => f.id === faceId);
if (idx === -1) {
  throw new Error(
    `getFaceColor: faceId "${faceId}" not found in knownFaces ` +
    `(${knownFaces.length} face(s)). Pass the same faces list you ` +
    `passed to assignFaceColors().`
  );
}
return colorForIndex(idx);
```

The throw-on-missing policy is deliberate: silently returning a default
color would hide integration bugs (e.g., a stale faceId that was
already deleted from state). The error message tells the caller
exactly what to fix.

---

## Deletion / re-add behavior (caller's responsibility)

This module does NOT track which faces existed previously. It is a
**pure function of the input array**. The integrator is responsible
for choosing the deletion policy:

- **Stable-list policy (default):** the integrator keeps a stable
  array of `roofPlanes` even across deletions, so a face's position
  in the array (and therefore its color) never changes.
- **Listens-to-state policy:** the integrator passes the raw
  `roofPlanes` array, so deleting the 2nd face shifts all subsequent
  faces down by one. The 3rd face becomes yellow (was green), the
  4th becomes green (was blue), and so on.

Both policies are valid. We pick at integration time. v1 will use the
listens-to-state policy (the simpler, default) and we can revisit if
the color flicker on delete is jarring in QA.

---

## Performance

`assignFaceColors` is O(n) in the number of faces. For a residential
roof (≤ 10 faces), this is a few microseconds. We do not memoize the
result because the cost of recomputing is below the noise floor and
memoization would introduce cache-key bugs.

---

## What this module does NOT do

- Does NOT apply the color anywhere. It exports a palette + a map. The
  integrator reads the map and calls
  `C.Color.fromCssColorString(faceColor).withAlpha(...)` at the
  `polygon.outlineColor` site in `lib/roofPlane3D.ts:renderPlane3DEntity`.
- Does NOT compute the outline width. The integrator decides width
  (current Aurora equivalent: 2px for unselected, 3px for selected).
- Does NOT handle the "currently drawing / not yet committed" state
  for the in-progress polygon. The preview polyline stays its current
  yellow color; per-face color only applies to **committed** faces.
- Does NOT touch the polygon FILL color. Aurora does not tint the
  fill (the fill is the satellite imagery showing through), and we
  match that.

---

## Test coverage

`tests/segmentColors.test.ts` covers:

1. Palette has exactly 4 colors in the documented order
2. Hex values match Aurora frames to the byte
3. `colorForIndex(0..3)` returns palette 0..3
4. `colorForIndex(4..7)` wraps to palette 0..3
5. `colorForIndex(-1)` returns the last palette entry (graceful wrap)
6. `assignFaceColors([])` returns an empty map
7. `assignFaceColors([{id:'a'}])` returns one entry
8. 4 faces → red, yellow, green, blue in order
9. 5 faces → 5th wraps to red
10. 8 faces → 2 full cycles
11. Reorder changes the assignment (stability contract verified)
12. `getFaceColor` returns the same color as the map
13. `getFaceColor` throws for unknown id
14. `getFaceColor` error message mentions the unknown id (debuggability)
15. Duplicate ids in input: last one wins (deterministic)
16. Frozen input array: not mutated
