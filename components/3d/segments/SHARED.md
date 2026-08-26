# `components/3d/segments/` — shared contract

> **Owners:** `segment-arrows` (this agent) + `segment-colors`
> **Status:** proposed interface — sign off before either agent lands

---

## 1. Goal

Both agents work in the same folder. `segment-arrows` draws the
**yellow chevron at each segment midpoint**; `segment-colors` paints
the **outline color of each segment** (the per-face red/yellow/green/
blue from Aurora frames 0110/0115). They need to share one data
shape: a `SegmentDescriptor` per edge.

If we each invent our own type, the two passes will be hard to
combine when the wizard asks for "draw all segments, arrows + colors"
in Step 1. The contract below is the minimum both agents agree on.

---

## 2. Shared data shape

```ts
// lib/3d/segmentArrows.ts (owned by segment-arrows, but the type
// is the shared contract — segment-colors imports it)

export type SegmentDescriptor = {
  id: string;                          // stable per draw session, e.g. "seg-0"
  from: { lat: number; lng: number };
  to:   { lat: number; lng: number };
  /**
   * +1 = default outward normal (perpendicular to edge, away from
   * polygon centroid).
   * -1 = flipped (user clicked the arrow to invert it).
   *
   * segment-colors does not read this field — colors are based on
   * face membership, not flip state — but it lives on the shared
   * type so a unified overlay pass has everything it needs.
   */
  normalDir: 1 | -1;
  /**
   * The face this segment belongs to. For a simple closed polygon
   * (block line-trace) this is the polygon itself; for a multi-face
   * gable/hip it identifies which roof face.
   *
   * segment-colors uses this to pick the outline color. The default
   * is "this segment is the only edge of the face" (single face).
   */
  faceId: string;
};
```

### Why these fields, no more

- `id` — both agents need it to address a segment.
- `from`, `to` — both agents need the edge geometry.
- `normalDir` — segment-arrows writes / reads; segment-colors ignores.
- `faceId` — segment-colors writes / reads; segment-arrows uses it as
  a stable key for the picker if needed.

We deliberately do **not** put:
- `color` (segment-colors derives it from `faceId`, not from
  `SegmentDescriptor`)
- `bearing` (segment-arrows computes it from the geometry, not stored)
- `lengthM` (callers can compute it from `from`/`to` if they need it)

---

## 3. Build / consume contract

```ts
// Pure function — same signature, both agents can call it.
import { buildSegmentsFromPoints } from '@/lib/3d/segmentArrows';

const segments = buildSegmentsFromPoints(
  [
    { lat: 38.818, lng: -77.082 },
    { lat: 38.819, lng: -77.081 },
    { lat: 38.820, lng: -77.083 },
  ],
  new Set<string>(),  // flippedIds — empty for a fresh draw
  'face-block-1'      // faceId — same for all 3 edges in a simple block
);
// → 2 SegmentDescriptor entries: seg-0 (p0→p1), seg-1 (p1→p2)
```

For a closed polygon, callers append the first point to the end of
the array before calling `buildSegmentsFromPoints`. The function
does NOT auto-close — it just makes one segment per consecutive
pair.

---

## 4. Per-agent ownership

| Concern | Owner | Notes |
| --- | --- | --- |
| `SegmentDescriptor` type | `segment-arrows` (in `lib/3d/segmentArrows.ts`) | shared import path |
| `buildSegmentsFromPoints` factory | `segment-arrows` | pure, exported |
| `midpoint`, `defaultOutwardNormal`, `bearingOf`, `flipNormalDir` | `segment-arrows` | pure math |
| Yellow chevron billboard | `segment-arrows` (in `SegmentArrowOverlay.ts`) | renders from `SegmentDescriptor[]` |
| Outline color picker | `segment-colors` | given `SegmentDescriptor[]`, outputs `string` (CSS color) per id |
| Outline polyline color update | `segment-colors` | may share a single `viewer.entities.add({ polyline: {...} })` with the existing block preview, OR replace its `material` — caller's choice |

If a future integration needs both at once, the wizard can call:

```ts
import { buildSegmentsFromPoints } from '@/lib/3d/segmentArrows';
import { colorForSegment } from '@/components/3d/segments/segmentColors';

const segs = buildSegmentsFromPoints(points, flips, 'face-1');
const colors = new Map(segs.map(s => [s.id, colorForSegment(s)]));
```

No other coordination is required.

---

## 5. Versioning

If `segment-arrows` needs to change `SegmentDescriptor` (add a field,
rename one), it MUST:
1. Update this file in the same commit.
2. Mention the breaking change in the commit body so `segment-colors`
   can catch up before the next sync.

Conversely, `segment-colors` MUST NOT import from `segmentArrows.ts`
anything other than `SegmentDescriptor` and `buildSegmentsFromPoints`.
Those are the published surface; the rest is internal.
