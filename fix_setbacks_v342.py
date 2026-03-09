#!/usr/bin/env python3
"""
Fix v34.2 → v34.3: PRIMARY PATH setback filter regression fix.

Problem: In v34.2, we added pointInPolygon(shrunkPoly) to PRIMARY PATH.
But Google Solar API already places panels with their own setbacks.
The shrunk polygon is too small for the Google panels, rejecting ALL of them → 0 panels.

Fix:
1. PRIMARY PATH: Filter Google panels against the ORIGINAL (unshrunk) polygon only.
   Google's positions are already setback-compliant. We just need to ensure they're
   within the roof boundary (not outside the roof entirely).
   Safety: if original polygon also rejects all panels, skip filtering entirely.

2. FALLBACK PATH: Keep using shrunk polygon (correct for our own grid generation).

3. Add detailed logging so we can see exactly what's happening.
"""

import re

SRC = 'components/3d/SolarEngine3D.tsx'

with open(SRC, 'r', encoding='utf-8') as f:
    content = f.read()

# ── Patch 1: Replace the PRIMARY PATH Step 2 setback filter ──────────────────
# Old code (v34.2): filters against shrunk clipPoly → rejects all Google panels
old_step2 = '''      // ── Step 2: Apply fire setback filter using shrunk clip polygon ──
      // Re-enable setback clipping for PRIMARY PATH now that we use the correct
      // shrunk polygon (shrinkPoly uses the actual fireSetbacks values from UI).
      const setbackFilteredGp = clipPoly.length >= 3
        ? validGp.filter(gp => pointInPolygon(gp.lat, gp.lng, clipPoly))
        : validGp;

      addLog('FILL', `seg ${seg?.id}: PRIMARY after setback filter: ${setbackFilteredGp.length}/${validGp.length} panels kept`);'''

# New code (v34.3): filter against ORIGINAL polygon only for PRIMARY PATH
# Google Solar API already applies setbacks — we just need boundary clipping
new_step2 = '''      // ── Step 2: Boundary-clip Google panels against ORIGINAL (unshrunk) polygon ──
      // IMPORTANT: Google Solar API already places panels with fire setbacks applied.
      // We must NOT filter against the shrunk polygon (clipPoly) — that would reject
      // all Google panels since they're already inset from the roof edge.
      // Instead, filter against the original roof boundary polygon to remove any
      // panels that are truly outside the roof footprint (data quality guard).
      // Safety: if original polygon rejects ALL panels, skip filtering entirely
      // (this handles cases where convexHull/polygon coords don't match Google coords).
      let setbackFilteredGp: GpWithCoords[];
      if (rawClipPoly.length >= 3) {
        const boundaryFiltered = validGp.filter(gp => pointInPolygon(gp.lat, gp.lng, rawClipPoly));
        // Safety fallback: if boundary filter removes everything, trust Google's positions
        setbackFilteredGp = boundaryFiltered.length > 0 ? boundaryFiltered : validGp;
        addLog('FILL', `seg ${seg?.id}: PRIMARY boundary filter: ${boundaryFiltered.length}/${validGp.length} kept (rawPoly=${rawClipPoly.length}pts, safety=${boundaryFiltered.length === 0 ? 'YES-skipped' : 'no'})`);
      } else {
        // No polygon available — trust all Google panels
        setbackFilteredGp = validGp;
        addLog('FILL', `seg ${seg?.id}: PRIMARY no boundary polygon, using all ${validGp.length} Google panels`);
      }'''

if old_step2 in content:
    content = content.replace(old_step2, new_step2)
    print("✅ Patch 1 applied: PRIMARY PATH setback filter fixed")
else:
    print("❌ Patch 1 FAILED: old_step2 not found")
    # Try to find it with flexible whitespace
    import re as re2
    pattern = r'// ── Step 2: Apply fire setback filter using shrunk clip polygon'
    matches = list(re2.finditer(pattern, content))
    print(f"   Pattern search found {len(matches)} matches")
    if matches:
        start = matches[0].start()
        print(f"   Context around match:\n{content[start:start+500]}")

# ── Patch 2: Update version to v34.3 ─────────────────────────────────────────
old_version = "export const BUILD_VERSION = 'v34.2';"
new_version = "export const BUILD_VERSION = 'v34.3';"

old_desc = "export const BUILD_DESCRIPTION = 'AUTO FILL FIX v8"
new_desc_full = """export const BUILD_DESCRIPTION = 'AUTO FILL FIX v9 — PRIMARY PATH Setback Fix: Google Solar API panels already have setbacks applied. PRIMARY PATH now filters against original roof boundary polygon only (not shrunk polygon). Safety fallback: if boundary filter removes all panels, trust Google positions entirely. FALLBACK PATH unchanged (still uses shrunk polygon for our own grid). Fixes 0-panel regression from v34.2.';"""

# Find and replace the full BUILD_DESCRIPTION line
desc_pattern = r"export const BUILD_DESCRIPTION = 'AUTO FILL FIX v8[^']*';"
if re.search(desc_pattern, content):
    content = re.sub(desc_pattern, new_desc_full, content)
    print("✅ Patch 2a applied: BUILD_DESCRIPTION updated")
else:
    print("❌ Patch 2a FAILED: BUILD_DESCRIPTION pattern not found")

if old_version in content:
    content = content.replace(old_version, new_version)
    print("✅ Patch 2b applied: version bumped to v34.3")
else:
    print("❌ Patch 2b FAILED: version string not found")

with open(SRC, 'w', encoding='utf-8') as f:
    f.write(content)

print("\nDone. Now update lib/version.ts separately.")