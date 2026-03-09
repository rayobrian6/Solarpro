#!/usr/bin/env python3
"""
Fix v34.2 → v34.3: PRIMARY PATH setback filter regression fix.
Uses exact byte-level string matching to avoid encoding issues.
"""

import re

SRC = 'components/3d/SolarEngine3D.tsx'
VER = 'lib/version.ts'

with open(SRC, 'r', encoding='utf-8') as f:
    content = f.read()

# ── Patch 1: Replace PRIMARY PATH Step 2 ─────────────────────────────────────
# Find the exact block using a unique anchor
ANCHOR = 'Step 2: Apply fire setback filter using shrunk clip polygon'
idx = content.find(ANCHOR)
if idx < 0:
    print("❌ ANCHOR not found in file!")
    exit(1)

# Find the start of the comment line (6 chars back for '      //')
block_start = idx - 6

# Find the end: the addLog line that ends with panels kept`);
END_MARKER = "addLog('FILL', `seg ${seg?.id}: PRIMARY after setback filter: ${setbackFilteredGp.length}/${validGp.length} panels kept`);"
end_idx = content.find(END_MARKER, idx)
if end_idx < 0:
    print("❌ END_MARKER not found!")
    exit(1)
block_end = end_idx + len(END_MARKER)

old_block = content[block_start:block_end]
print(f"Found block ({len(old_block)} chars):")
print(old_block)
print()

new_block = '''// \u2500\u2500 Step 2: Boundary-clip Google panels against ORIGINAL (unshrunk) polygon \u2500\u2500
      // IMPORTANT: Google Solar API already places panels with fire setbacks applied.
      // We must NOT filter against the shrunk polygon (clipPoly) \u2014 that rejects
      // all Google panels since they are already inset from the roof edge.
      // Instead, filter against the original roof boundary (rawClipPoly) to remove
      // any panels truly outside the roof footprint (data quality guard only).
      // Safety fallback: if rawClipPoly rejects ALL panels, trust Google's positions
      // (handles coordinate system mismatches between convexHull and Google lat/lng).
      let setbackFilteredGp: GpWithCoords[];
      if (rawClipPoly.length >= 3) {
        const boundaryFiltered = validGp.filter(gp => pointInPolygon(gp.lat, gp.lng, rawClipPoly));
        // If boundary filter removes everything, skip it (trust Google's setback-compliant positions)
        setbackFilteredGp = boundaryFiltered.length > 0 ? boundaryFiltered : validGp;
        addLog('FILL', `seg ${seg?.id}: PRIMARY boundary-clip: ${boundaryFiltered.length}/${validGp.length} kept (safety=${boundaryFiltered.length === 0 ? 'BYPASSED' : 'ok'})`);
      } else {
        setbackFilteredGp = validGp;
        addLog('FILL', `seg ${seg?.id}: PRIMARY no boundary polygon \u2014 using all ${validGp.length} Google panels`);
      }'''

content = content[:block_start] + new_block + content[block_end:]
print("✅ Patch 1 applied: PRIMARY PATH Step 2 replaced")

# ── Patch 2: Update version in SolarEngine3D.tsx ─────────────────────────────
old_ver_comment = "// v31.9: Added rich debug logging + fixed elevation for PRIMARY PATH + setback polygon support."
new_ver_comment = "// v34.3: PRIMARY PATH now filters against original boundary polygon only (Google panels already have setbacks)."
if old_ver_comment in content:
    content = content.replace(old_ver_comment, new_ver_comment)
    print("✅ Patch 2 applied: version comment updated in SolarEngine3D.tsx")
else:
    print("⚠️  Patch 2 skipped: version comment not found (non-critical)")

with open(SRC, 'w', encoding='utf-8') as f:
    f.write(content)
print(f"✅ Written {SRC}")

# ── Patch 3: Update lib/version.ts ───────────────────────────────────────────
with open(VER, 'r', encoding='utf-8') as f:
    ver_content = f.read()

# Replace version number
ver_content = ver_content.replace("export const BUILD_VERSION = 'v34.2';",
                                   "export const BUILD_VERSION = 'v34.3';")

# Replace BUILD_DATE
ver_content = ver_content.replace("export const BUILD_DATE = '2026-03-09';",
                                   "export const BUILD_DATE = '2026-03-10';")

# Replace BUILD_DESCRIPTION (find and replace the whole line)
desc_pattern = r"export const BUILD_DESCRIPTION = 'AUTO FILL FIX v8[^']*';"
new_desc = ("export const BUILD_DESCRIPTION = 'AUTO FILL FIX v9 \u2014 PRIMARY PATH Boundary Fix: "
            "Google Solar API panels already have fire setbacks applied by Google. "
            "PRIMARY PATH now filters against original roof boundary polygon only (not shrunk polygon). "
            "Safety fallback: if boundary filter removes all panels, trust Google positions entirely. "
            "FALLBACK PATH unchanged (still uses shrunk polygon for our own Cartesian3 grid). "
            "Fixes 0-panel regression introduced in v34.2.';")

if re.search(desc_pattern, ver_content):
    ver_content = re.sub(desc_pattern, new_desc, ver_content)
    print("✅ Patch 3a applied: BUILD_DESCRIPTION updated")
else:
    print("❌ Patch 3a FAILED: BUILD_DESCRIPTION pattern not found")

with open(VER, 'w', encoding='utf-8') as f:
    f.write(ver_content)
print(f"✅ Written {VER}")

print("\n✅ All patches applied. Ready to build.")