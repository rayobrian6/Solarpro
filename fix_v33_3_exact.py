"""
v33.3 - Solar placement logic overhaul using exact string matching
"""

with open('components/3d/SolarEngine3D.tsx', 'r') as f:
    content = f.read()

original_len = len(content)

# ============================================================
# FIX 1: Replace segment filtering with solar rules
# ============================================================
old_filter = """    const sortedSegs = [...twinData.roofSegments].sort((a: any, b: any) => b.sunshineHours - a.sunshineHours);
    const maxSunshine = sortedSegs[0]?.sunshineHours ?? 0;
    const minThreshold = maxSunshine * 0.5;
    const eligibleSegs = sortedSegs.filter((seg: any) =>
      seg.sunshineHours >= minThreshold && seg.areaM2 >= (PW * PH)
    );

    addLog('AUTO', `eligible: ${eligibleSegs.length}/${sortedSegs.length} segs`);"""

new_filter = """    const sortedSegs = [...twinData.roofSegments].sort((a: any, b: any) => b.sunshineHours - a.sunshineHours);
    const maxSunshine = sortedSegs[0]?.sunshineHours ?? 0;
    const minThreshold = maxSunshine * 0.5;

    // ── Solar placement rules ──────────────────────────────────────────────
    // Rule 1: No north-facing segments (az 315-360 or 0-45) — minimal sun in N hemisphere
    // Rule 2: No steep pitch on unfavorable faces (>45° always skip; >35° on E/W skip)
    // Rule 3: Target building only — segment center must be within 25m of clicked point
    // Rule 4: Minimum sunshine (50% of best segment)
    // Rule 5: Minimum area (must fit at least one panel)
    const MAX_BUILDING_RADIUS_M = 25;
    const cosLatRad = Math.cos(lat * Math.PI / 180);
    const mLatPx = 111320;
    const mLngPx = 111320 * cosLatRad;

    function isNorthFacing(azDeg: number): boolean {
      const az = ((azDeg % 360) + 360) % 360;
      return az >= 315 || az <= 45;
    }
    function isTooSteep(pitchDeg: number, azDeg: number): boolean {
      if (pitchDeg > 45) return true;
      const az = ((azDeg % 360) + 360) % 360;
      const isEW = (az > 45 && az < 135) || (az > 225 && az < 315);
      if (isEW && pitchDeg > 35) return true;
      return false;
    }
    function distToTarget(segLat: number, segLng: number): number {
      const dN = (segLat - lat) * mLatPx;
      const dE = (segLng - lng) * mLngPx;
      return Math.sqrt(dN * dN + dE * dE);
    }

    const eligibleSegs = sortedSegs.filter((seg: any) => {
      const azDeg = isFinite(seg.azimuthDegrees) ? seg.azimuthDegrees : 180;
      const pitchDeg = isFinite(seg.pitchDegrees) ? seg.pitchDegrees : 20;
      const dist = distToTarget(seg.center?.lat ?? lat, seg.center?.lng ?? lng);
      if (isNorthFacing(azDeg)) {
        addLog('AUTO', `seg ${seg.id}: SKIP north-facing az=${azDeg.toFixed(0)}`); return false;
      }
      if (isTooSteep(pitchDeg, azDeg)) {
        addLog('AUTO', `seg ${seg.id}: SKIP steep pitch=${pitchDeg.toFixed(0)} az=${azDeg.toFixed(0)}`); return false;
      }
      if (dist > MAX_BUILDING_RADIUS_M) {
        addLog('AUTO', `seg ${seg.id}: SKIP neighbor dist=${dist.toFixed(0)}m`); return false;
      }
      if (seg.sunshineHours < minThreshold) {
        addLog('AUTO', `seg ${seg.id}: SKIP low sunshine`); return false;
      }
      if (seg.areaM2 < (PW * PH)) {
        addLog('AUTO', `seg ${seg.id}: SKIP too small`); return false;
      }
      addLog('AUTO', `seg ${seg.id}: OK az=${azDeg.toFixed(0)} pitch=${pitchDeg.toFixed(0)} dist=${dist.toFixed(0)}m area=${seg.areaM2.toFixed(0)}m2`);
      return true;
    });

    addLog('AUTO', `eligible: ${eligibleSegs.length}/${sortedSegs.length} segs after solar rules`);"""

if old_filter in content:
    content = content.replace(old_filter, new_filter)
    print("Fix 1 done: segment filtering with solar rules")
else:
    print("ERROR Fix 1: not found, trying line-by-line search")
    lines = content.split('\n')
    for i, line in enumerate(lines):
        if 'const sortedSegs' in line and 'twinData.roofSegments' in line:
            print(f"Found at line {i}: {repr(line)}")

# ============================================================
# FIX 2: Setback enforcement in fillRoofSegmentWithPanels
# ============================================================
old_clip = """    // \u2500\u2500 Clip polygon \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    const clipPoly: Array<{ lat: number; lng: number }> =
      (seg.convexHull && seg.convexHull.length >= 3) ? seg.convexHull :
      (seg.polygon    && seg.polygon.length    >= 3) ? seg.polygon    : [];"""

new_clip = """    // \u2500\u2500 Clip polygon with setback \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    // Shrink roof polygon inward by SETBACK_M to enforce edge setbacks
    const SETBACK_M_FILL = 0.5; // 0.5m edge setback
    const rawClipPoly: Array<{ lat: number; lng: number }> =
      (seg.convexHull && seg.convexHull.length >= 3) ? seg.convexHull :
      (seg.polygon    && seg.polygon.length    >= 3) ? seg.polygon    : [];

    function shrinkPoly(
      poly: Array<{ lat: number; lng: number }>,
      setbackM: number
    ): Array<{ lat: number; lng: number }> {
      if (poly.length < 3) return poly;
      const cLat = poly.reduce((s, p) => s + p.lat, 0) / poly.length;
      const cLng = poly.reduce((s, p) => s + p.lng, 0) / poly.length;
      return poly.map(p => {
        const dLatM = (p.lat - cLat) * mLat;
        const dLngM = (p.lng - cLng) * mLng;
        const dist = Math.sqrt(dLatM * dLatM + dLngM * dLngM);
        if (dist <= setbackM) return { lat: cLat, lng: cLng };
        const scale = (dist - setbackM) / dist;
        return {
          lat: cLat + (p.lat - cLat) * scale,
          lng: cLng + (p.lng - cLng) * scale,
        };
      });
    }

    const clipPoly = rawClipPoly.length >= 3
      ? shrinkPoly(rawClipPoly, SETBACK_M_FILL)
      : rawClipPoly;"""

if old_clip in content:
    content = content.replace(old_clip, new_clip)
    print("Fix 2 done: setback enforcement via polygon shrink")
else:
    print("ERROR Fix 2: clip polygon not found, searching...")
    idx = content.find("const clipPoly")
    if idx >= 0:
        print(repr(content[max(0,idx-100):idx+200]))

print(f"\nContent: {original_len} -> {len(content)} (+{len(content)-original_len} chars)")

with open('components/3d/SolarEngine3D.tsx', 'w') as f:
    f.write(content)

print("Done")