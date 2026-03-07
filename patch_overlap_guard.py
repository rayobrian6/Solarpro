#!/usr/bin/env python3
"""Insert the overlap guard helper before the wireSeg function."""

with open('lib/sld-professional-renderer.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the wireSeg function definition
target = 'function wireSeg(\n  x1: number, x2: number, y: number,\n  lines: string[],\n  opts: { openAir?: boolean; bundleCount?: number; above?: boolean } = {}\n): string {'

overlap_guard = '''// ── Segment Overlap Guard ───────────────────────────────────────────────────
// Tracks horizontal wire Y-coordinates to detect and offset parallel overlapping wires.
// Call resolveSegY() before drawing each horizontal segment to get a non-overlapping Y.
const OVERLAP_GUARD_OFFSET = 4; // px offset for parallel wires
function makeOverlapGuard() {
  const usedRanges: Array<{x1:number; x2:number; y:number}> = [];
  return function resolveSegY(x1: number, x2: number, y: number): number {
    const xMin = Math.min(x1, x2);
    const xMax = Math.max(x1, x2);
    let candidate = y;
    let attempts = 0;
    while (attempts < 10) {
      const conflict = usedRanges.find(r =>
        Math.abs(r.y - candidate) < OVERLAP_GUARD_OFFSET &&
        r.x1 < xMax && r.x2 > xMin
      );
      if (!conflict) break;
      candidate += OVERLAP_GUARD_OFFSET;
      attempts++;
    }
    usedRanges.push({x1: xMin, x2: xMax, y: candidate});
    return candidate;
  };
}

'''

if target in content:
    content = content.replace(target, overlap_guard + target)
    with open('lib/sld-professional-renderer.ts', 'w', encoding='utf-8') as f:
        f.write(content)
    print("SUCCESS: Overlap guard inserted before wireSeg function")
else:
    print("ERROR: Could not find wireSeg function target")
    # Show what's around line 658
    lines = content.split('\n')
    for i, line in enumerate(lines[655:670], start=656):
        print(f"{i}: {repr(line)}")