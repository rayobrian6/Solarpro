#!/usr/bin/env python3
"""
v58.18 patch 3 — Fix Battery → BUI wire routing

The battery's AC output lug (acOutX/Y) is on the RIGHT side of the battery
symbol (anchor 'ac_l1' at native x=180). The BUI battery port (batPortX/Y)
is at the BOTTOM CENTER of the BUI symbol. Since batCX == buiCX (same centre
X), a straight ln() between those two points produces a diagonal dashed line.

Fix:
  1. Add a synthetic bottom-center AC output point to renderBattery:
       acBotX = cx  (centre X of battery)
       acBotY = by2 + H2  (bottom edge of battery)
     and draw a short vertical stub from the bottom edge lug downward.
     Return { acOutX, acOutY } pointing to this bottom lug instead of the
     right-side anchor (the right-side lug/stub is kept for the symbol look).

  2. Update the battery → BUI wire to route straight down:
       ln(acBotX, acBotY, buiResult.batPortX, buiResult.batPortY)
     which is now a clean vertical line since both share cx == buiCX.

  3. Move the callout label to the right of the vertical wire at mid-height.
"""

from pathlib import Path

RENDERER = Path("lib/sld-professional-renderer.ts")
src = RENDERER.read_text(encoding="utf-8")
original = src

# ─── Patch 1: renderBattery — add bottom-center AC output terminal ────────────
# Replace the existing acOutX/acOutY derivation (which uses right-side ac_l1)
# with a bottom-centre point, keeping the right-side lug stub for visual style.
OLD_BAT_TERMINAL = (
    "  // SOT: BAT_AC_OUT terminal via anchor 'ac_l1' (right side: native 180,55)\n"
    "  const acPt = getAnchorPoint('battery-ac', 'ac_l1', cx, cy, W2, H2);\n"
    "  const acOutX = acPt.x;\n"
    "  const acOutY = acPt.y;\n"
    "  p.push(ln(acOutX, acOutY, acOutX + 10, acOutY, {stroke: BAT_HDR, sw: SW_MED}));\n"
    "  console.log(`[SLD WIRE TYPE: AC] battery-ac.ac_l1 \u2192 (${acOutX.toFixed(1)},${acOutY.toFixed(1)})`);")

NEW_BAT_TERMINAL = (
    "  // BAT_AC_OUT: use bottom-centre of symbol so the wire drops straight down\n"
    "  // to the BUI BATTERY port (which is also at bottom-centre of the BUI box).\n"
    "  // Keep the right-side ac_l1 lug stub for visual authenticity but route\n"
    "  // the connection wire from the bottom lug.\n"
    "  const acPt = getAnchorPoint('battery-ac', 'ac_l1', cx, cy, W2, H2);\n"
    "  // Right-side lug stub (decorative — shows AC terminals on symbol face)\n"
    "  p.push(ln(acPt.x, acPt.y, acPt.x + 10, acPt.y, {stroke: BAT_HDR, sw: SW_MED}));\n"
    "  // Bottom-centre AC output lug — this is the actual connection point to BUI\n"
    "  const acOutX = cx;            // centre X (aligns with BUI batPortX)\n"
    "  const acOutY = by2 + H2;      // bottom edge of battery symbol\n"
    "  p.push(ln(acOutX, acOutY - 4, acOutX, acOutY, {stroke: BAT_HDR, sw: SW_MED}));\n"
    "  console.log(`[SLD WIRE TYPE: AC] battery-ac.bottom \u2192 (${acOutX.toFixed(1)},${acOutY.toFixed(1)})`);")

assert src.count(OLD_BAT_TERMINAL) == 1, f"Patch 1: expected 1 match, got {src.count(OLD_BAT_TERMINAL)}"
src = src.replace(OLD_BAT_TERMINAL, NEW_BAT_TERMINAL)

# ─── Patch 2: Battery → BUI wire — straight vertical + label on right ─────────
OLD_BAT_WIRE = (
    "    // Wire: battery AC OUT terminal \u2192 BUI BATTERY port (vertical dashed blue line)\n"
    "    // Use explicit terminal coordinates: batResult.acOutX/Y \u2192 buiResult.batPortX/Y\n"
    "    parts.push(ln(batResult.acOutX, batResult.acOutY, buiResult.batPortX, buiResult.batPortY, {stroke: '#1565C0', sw: SW_MED, dash: '6,3'}));\n"
    "    // Wire callout\n"
    "    // BUILD v24: Use computed conductorCallout from BATTERY_TO_BUI_RUN (NEC-sized)\n"
    "    // Fallback to legacy hardcoded gauge only if segment not computed\n"
    "    const batWireGauge = batToBuiRun?.wireGauge\n"
    "      ? `${batToBuiRun.wireGauge} THWN-2`\n"
    "      : (bfA <= 20 ? '#12 AWG THWN-2' : bfA <= 30 ? '#10 AWG THWN-2' : '#8 AWG THWN-2');\n"
    "    const batCalloutLines = batToBuiRun?.conductorCallout\n"
    "      ? batToBuiRun.conductorCallout.split('\\n').filter((l:string)=>l.trim()).slice(0,2)\n"
    "      : [batWireGauge, `${bfA}A CIRCUIT`];\n"
    "    parts.push(tspan(batResult.acOutX + 8, batResult.acOutY + (buiResult.batPortY - batResult.acOutY)/2,\n"
    "      batCalloutLines,\n"
    "      {sz: F.tiny, anc: 'start', fill: '#1565C0'}));")

NEW_BAT_WIRE = (
    "    // Wire: battery bottom-centre AC OUT \u2192 BUI BATTERY port\n"
    "    // Both share the same centre X (batCX == buiCX) so this is a clean\n"
    "    // vertical dashed line straight down.\n"
    "    parts.push(ln(batResult.acOutX, batResult.acOutY, buiResult.batPortX, buiResult.batPortY, {stroke: '#1565C0', sw: SW_MED, dash: '6,3'}));\n"
    "    // Wire callout — placed to the right of the vertical wire at mid-height\n"
    "    const batWireGauge = batToBuiRun?.wireGauge\n"
    "      ? `${batToBuiRun.wireGauge} THWN-2`\n"
    "      : (bfA <= 20 ? '#12 AWG THWN-2' : bfA <= 30 ? '#10 AWG THWN-2' : '#8 AWG THWN-2');\n"
    "    const batCalloutLines = batToBuiRun?.conductorCallout\n"
    "      ? batToBuiRun.conductorCallout.split('\\n').filter((l:string)=>l.trim()).slice(0,2)\n"
    "      : [batWireGauge, `${bfA}A CIRCUIT`];\n"
    "    const _batWireMidY = (batResult.acOutY + buiResult.batPortY) / 2;\n"
    "    parts.push(tspan(batResult.acOutX + 6, _batWireMidY,\n"
    "      batCalloutLines,\n"
    "      {sz: F.tiny, anc: 'start', fill: '#1565C0'}));")

assert src.count(OLD_BAT_WIRE) == 1, f"Patch 2: expected 1 match, got {src.count(OLD_BAT_WIRE)}"
src = src.replace(OLD_BAT_WIRE, NEW_BAT_WIRE)

# ─── Write back ──────────────────────────────────────────────────────────────
assert src != original, "No changes made!"
RENDERER.write_text(src, encoding="utf-8")
print("✅ lib/sld-professional-renderer.ts patched (battery→BUI wire fix)")

# Sanity checks
checks_present = [
    "acOutX = cx;            // centre X (aligns with BUI batPortX)",
    "acOutY = by2 + H2;      // bottom edge of battery symbol",
    "_batWireMidY = (batResult.acOutY + buiResult.batPortY) / 2",
]
checks_gone = [
    "const acOutX = acPt.x;",
    "const acOutY = acPt.y;",
]
ok = True
for s in checks_present:
    if s not in src:
        print(f"  ❌ MISSING: {s!r}")
        ok = False
for s in checks_gone:
    if s in src:
        print(f"  ❌ STILL PRESENT: {s!r}")
        ok = False
if ok:
    print("✅ All sanity checks passed")