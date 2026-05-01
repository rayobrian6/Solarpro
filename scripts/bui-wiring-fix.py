#!/usr/bin/env python3
"""
v58.18 patch 2 — Fix BUI wiring connections
Three bugs:
  1. MSP busOut → BUI GRID wire: starts from mspRX/gridPortY instead of
     mspResult.busOutX/Y with proper L-route to BUI gridPortX/Y
  2. No explicit BUI LOAD → Meter wire: SEGMENT_6 starts from buiRX at
     mspResult.busOutY instead of buiResult.loadPortX/Y
  3. SEGMENT_6 uses wrong source coords when BUI is present
"""

from pathlib import Path

RENDERER = Path("lib/sld-professional-renderer.ts")
src = RENDERER.read_text(encoding="utf-8")
original = src

# ─── Patch 1: MSP busOut → BUI GRID wire ────────────────────────────────────
# Old code routes from mspRX directly across at gridPortY with a stub that
# only fires when gridPortY != BUS_Y. Replace with proper L-route from the
# MSP busOut anchor point (mspResult.busOutX/Y) to BUI gridPortX/Y.
OLD_BUI_WIRE = (
    "    // Wire: MSP output \u2192 BUI GRID terminal (route to exact terminal coordinate)\n"
    "    // gridPortX is the left edge lug; gridPortY is cy-14 (upper-left terminal)\n"
    "    parts.push(ln(mspRX, buiResult.gridPortY, buiResult.gridPortX, buiResult.gridPortY, {stroke: BLK, sw: SW_MED}));\n"
    "    // Vertical stub from bus line down to GRID terminal if needed\n"
    "    if (Math.abs(buiResult.gridPortY - BUS_Y) > 2) {\n"
    "      parts.push(ln(mspRX, BUS_Y, mspRX, buiResult.gridPortY, {stroke: BLK, sw: SW_MED}));\n"
    "    }"
)
NEW_BUI_WIRE = """\
    // Wire: MSP busOut terminal → BUI GRID terminal (L-route)
    // MSP busOut is at mspResult.busOutX/Y (anchor 'load_out' on MSP symbol).
    // BUI GRID port is at buiResult.gridPortX/Y (left-edge lug, cy-14).
    // Route: horizontal from busOut rightward to BUI left edge X, then
    // vertical stub to match gridPortY if the two Ys differ.
    const _mspToBuiX = buiResult.gridPortX;  // left edge of BUI
    // Horizontal segment at MSP busOut Y level
    parts.push(ln(mspResult.busOutX, mspResult.busOutY, _mspToBuiX, mspResult.busOutY, {stroke: BLK, sw: SW_MED}));
    // Vertical jog from busOutY down/up to BUI gridPortY (always draw — tiny if same)
    if (Math.abs(mspResult.busOutY - buiResult.gridPortY) > 1) {
      parts.push(ln(_mspToBuiX, mspResult.busOutY, _mspToBuiX, buiResult.gridPortY, {stroke: BLK, sw: SW_MED}));
    }
    // Final horizontal stub into BUI GRID lug (gridPortX is already the left edge lug)
    // The lug itself is drawn inside renderBUI; we just need to terminate at it.\
"""

assert src.count(OLD_BUI_WIRE) == 1, f"Patch 1: expected 1 match, got {src.count(OLD_BUI_WIRE)}"
src = src.replace(OLD_BUI_WIRE, NEW_BUI_WIRE)

# ─── Patch 2: SEGMENT_6 MSP → Meter: when BUI present, route from BUI LOAD port ─
# Old: starts from buiRX at mspResult.busOutY — wrong both X and Y when BUI present
# New: when BUI present, start from buiResult.loadPortX/Y; else from mspResult.busOutX/Y
OLD_SEG6 = (
    "    const segY = mspResult.busOutY;\n"
    "    const _s6Y = resolveSegY(buiRX, utilCX-mR-10, segY);\n"
    "    console.log('[WIRE RUN CREATED] SEGMENT_6_MSP_TO_METER: AC service run');\n"
    "    parts.push(renderWireRun(\n"
    "      buildWireRun('SEGMENT_6_MSP_TO_METER', buiRX, _s6Y, utilCX-mR-10, _s6Y, run, lines, false, 'RACEWAY'),  // Phase 1: RACEWAY\n"
    "      lines));"
)
NEW_SEG6 = """\
    // When BUI is present, the bus wire exits from BUI LOAD port (right-side lug).
    // When no BUI, it exits from MSP busOut terminal.
    const _seg6SrcX = buiResult ? buiResult.loadPortX : mspResult.busOutX;
    const _seg6SrcY = buiResult ? buiResult.loadPortY : mspResult.busOutY;
    const _s6Y = resolveSegY(_seg6SrcX, utilCX-mR-10, _seg6SrcY);
    console.log('[WIRE RUN CREATED] SEGMENT_6_MSP_TO_METER: AC service run');
    parts.push(renderWireRun(
      buildWireRun('SEGMENT_6_MSP_TO_METER', _seg6SrcX, _s6Y, utilCX-mR-10, _s6Y, run, lines, false, 'RACEWAY'),  // Phase 1: RACEWAY
      lines));\
"""

assert src.count(OLD_SEG6) == 1, f"Patch 2: expected 1 match, got {src.count(OLD_SEG6)}"
src = src.replace(OLD_SEG6, NEW_SEG6)

# ─── Write back ─────────────────────────────────────────────────────────────
assert src != original, "No changes made!"
RENDERER.write_text(src, encoding="utf-8")
print("✅ lib/sld-professional-renderer.ts patched (BUI wiring fix)")

# Sanity checks
checks_gone = [
    "parts.push(ln(mspRX, buiResult.gridPortY, buiResult.gridPortX, buiResult.gridPortY",
    "buildWireRun('SEGMENT_6_MSP_TO_METER', buiRX, _s6Y",
]
checks_present = [
    "mspResult.busOutX, mspResult.busOutY, _mspToBuiX",
    "_seg6SrcX = buiResult ? buiResult.loadPortX",
    "_seg6SrcY = buiResult ? buiResult.loadPortY",
]
ok = True
for s in checks_gone:
    if s in src:
        print(f"  ❌ STILL PRESENT (should be gone): {s!r}")
        ok = False
for s in checks_present:
    if s not in src:
        print(f"  ❌ MISSING (should be present): {s!r}")
        ok = False
if ok:
    print("✅ All sanity checks passed")