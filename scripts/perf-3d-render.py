#!/usr/bin/env python3
"""
v58.19 — 3D render performance improvements

Bottlenecks addressed:
  1. Solar API quality=HIGH → MEDIUM  (~2-3s savings, in digitalTwin.ts)
  2. Skip elevationGrid on boot       (~0.5-1s, 25 fewer API calls, in digitalTwin.ts)
  3. In-session digitalTwin cache     (0ms on repeat loads, in digitalTwin.ts)
  4. Tileset MSE 4→16 on boot         (~1-2s, in SolarEngine3D.tsx)
  5. Terrain sample 5s timeout guard  (in SolarEngine3D.tsx)
  6. CesiumJS timeout 20s→45s         (in SolarEngine3D.tsx)
  7. DSM route cache 1h               (in app/api/dsm/route.ts)
"""

from pathlib import Path

# lib/digitalTwin.ts already patched in prior run — skip
print("ℹ️  lib/digitalTwin.ts already patched — skipping")

# ─── Patch components/3d/SolarEngine3D.tsx ────────────────────────────────────
SE = Path("components/3d/SolarEngine3D.tsx")
src = SE.read_text(encoding="utf-8")
orig = src

# 4. Tileset MSE 4 → 16 on boot
assert src.count("              maximumScreenSpaceError: 4,") >= 1
src = src.replace(
    "              maximumScreenSpaceError: 4,",
    "              maximumScreenSpaceError: 16, // PERF v58.19: start coarse; camera optimizer drops to 4 on zoom-in",
    1  # only replace first occurrence (the boot tileset creation)
)

# 5. Terrain sample timeout guard — replace all occurrences (boot + flyTo handler)
OLD_TERRAIN_AWAIT = (
    "          const sampledPositions = await C.sampleTerrainMostDetailed(terrainProvider, positions);"
)
NEW_TERRAIN_AWAIT = (
    "          // PERF v58.19: 5s timeout guard\n"
    "          const _terrTimeout = new Promise<never>((_,rej)=>setTimeout(()=>rej(new Error('terrain timeout')),5000));\n"
    "          const sampledPositions = await Promise.race([C.sampleTerrainMostDetailed(terrainProvider, positions), _terrTimeout]) as any[];"
)
count = src.count(OLD_TERRAIN_AWAIT)
assert count >= 1, f"terrain await: {count} matches"
src = src.replace(OLD_TERRAIN_AWAIT, NEW_TERRAIN_AWAIT)

# 6. CesiumJS timeout 20s → 45s
assert src.count("20000)") >= 1
src = src.replace(
    "      const timeout = setTimeout(() => reject(new Error('CesiumJS load timeout')), 20000);",
    "      const timeout = setTimeout(() => reject(new Error('CesiumJS load timeout')), 45000); // PERF v58.19: CDN cold-start"
)

assert src != orig
SE.write_text(src, encoding="utf-8")
print("✅ components/3d/SolarEngine3D.tsx patched")

# ─── Patch app/api/dsm/route.ts ───────────────────────────────────────────────
DSM = Path("app/api/dsm/route.ts")
src = DSM.read_text(encoding="utf-8")
orig = src
assert src.count("export const revalidate = 0;") == 1
src = src.replace(
    "export const revalidate = 0;",
    "export const revalidate = 3600; // PERF v58.19: cache DSM (roof geometry stable)"
)
assert src != orig
DSM.write_text(src, encoding="utf-8")
print("✅ app/api/dsm/route.ts patched")

# ─── Patch app/api/solar/route.ts (if exists) ─────────────────────────────────
SOLAR = Path("app/api/solar/route.ts")
if SOLAR.exists():
    src = SOLAR.read_text(encoding="utf-8")
    orig = src
    if "export const revalidate = 0;" in src:
        src = src.replace(
            "export const revalidate = 0;",
            "export const revalidate = 3600; // PERF v58.19: cache Solar API 1h"
        )
        if src != orig:
            SOLAR.write_text(src, encoding="utf-8")
            print("✅ app/api/solar/route.ts patched")
        else:
            print("ℹ️  app/api/solar/route.ts unchanged")
    else:
        print("ℹ️  app/api/solar/route.ts — no revalidate=0 found, skipped")
else:
    print("ℹ️  app/api/solar/route.ts not found")

print("\n✅ All performance patches applied")