with open('components/3d/SolarEngine3D.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

start_marker = '    // \u2500\u2500 Solar placement rules \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'
end_marker = "      addLog('AUTO', `seg ${seg.id}: OK az=${azDeg.toFixed(0)} pitch=${pitchDeg.toFixed(0)} dist=${dist.toFixed(0)}m area=${seg.areaM2.toFixed(0)}m2`);\n      return true;\n    });"

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)
end_idx_full = end_idx + len(end_marker)

new_block = '''    // \u2500\u2500 Solar placement rules \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    // Rule 1: No north-facing segments (az 315-360 or 0-45) \u2014 minimal sun in N hemisphere
    // Rule 2: No steep pitch on unfavorable faces (>45\u00b0 always skip; >35\u00b0 on E/W skip)
    // Rule 3: Target building only \u2014 segment center must be within MAX_BUILDING_RADIUS_M of twin center
    // Rule 4: Minimum sunshine (50% of best segment)
    // Rule 5: Minimum area (must fit at least one panel)
    //
    // CRITICAL FIX v33.4: Use twinData.lat/lng as reference \u2014 NOT component props lat/lng.
    // Component props may be stale (original project location) while twinData.lat/lng
    // always reflects the actual building the Solar API was called for (e.g. after Pick House).
    const MAX_BUILDING_RADIUS_M = 40; // increased from 25m \u2014 Google Solar API spreads segments
    // Use twin center as reference (always matches the Solar API response)
    const refLat = twinData.lat;
    const refLng = twinData.lng;
    const cosLatRad = Math.cos(refLat * Math.PI / 180);
    const mLatPx = 111320;
    const mLngPx = 111320 * cosLatRad;

    addLog('AUTO', `distToRef reference: twinData=(${refLat.toFixed(5)},${refLng.toFixed(5)}) props=(${lat.toFixed(5)},${lng.toFixed(5)})`);

    function isNorthFacing(azDeg: number): boolean {
      const az = ((azDeg % 360) + 360) % 360;
      // North-facing: 315\u00b0-360\u00b0 or 0\u00b0-45\u00b0 (NW through N through NE)
      return az >= 315 || az < 45;
    }
    function isTooSteep(pitchDeg: number, azDeg: number): boolean {
      if (pitchDeg > 45) return true; // always skip very steep roofs
      const az = ((azDeg % 360) + 360) % 360;
      // East/West facing: skip if pitch > 35\u00b0 (poor production + structural risk)
      const isEW = (az >= 45 && az <= 135) || (az >= 225 && az <= 315);
      if (isEW && pitchDeg > 35) return true;
      return false;
    }
    function distToRef(segLat: number, segLng: number): number {
      const dN = (segLat - refLat) * mLatPx;
      const dE = (segLng - refLng) * mLngPx;
      return Math.sqrt(dN * dN + dE * dE);
    }

    // First pass: apply all solar rules
    let eligibleSegs = sortedSegs.filter((seg: any) => {
      const azDeg = isFinite(seg.azimuthDegrees) ? seg.azimuthDegrees : 180;
      const pitchDeg = isFinite(seg.pitchDegrees) ? seg.pitchDegrees : 20;
      const dist = distToRef(seg.center?.lat ?? refLat, seg.center?.lng ?? refLng);
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

    // Fallback: if ALL segments were filtered by distance (e.g. stale props), relax distance constraint
    // and use the closest cluster of segments (the target building)
    if (eligibleSegs.length === 0 && sortedSegs.length > 0) {
      addLog('AUTO', 'FALLBACK: all segs filtered \u2014 relaxing distance constraint, using closest segments');
      // Find the minimum distance among all segments
      const minDist = Math.min(...sortedSegs.map((seg: any) =>
        distToRef(seg.center?.lat ?? refLat, seg.center?.lng ?? refLng)
      ));
      // Use segments within 15m of the closest segment's distance (same building cluster)
      const relaxedRadius = minDist + 15;
      addLog('AUTO', `FALLBACK: minDist=${minDist.toFixed(0)}m, relaxedRadius=${relaxedRadius.toFixed(0)}m`);
      eligibleSegs = sortedSegs.filter((seg: any) => {
        const azDeg = isFinite(seg.azimuthDegrees) ? seg.azimuthDegrees : 180;
        const pitchDeg = isFinite(seg.pitchDegrees) ? seg.pitchDegrees : 20;
        const dist = distToRef(seg.center?.lat ?? refLat, seg.center?.lng ?? refLng);
        if (isNorthFacing(azDeg)) return false;
        if (isTooSteep(pitchDeg, azDeg)) return false;
        if (dist > relaxedRadius) return false;
        if (seg.areaM2 < (PW * PH)) return false;
        addLog('AUTO', `seg ${seg.id}: FALLBACK-OK dist=${dist.toFixed(0)}m az=${azDeg.toFixed(0)}`);
        return true;
      });
    }'''

content = content[:start_idx] + new_block + content[end_idx_full:]

with open('components/3d/SolarEngine3D.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print(f"✅ Replaced block ({end_idx_full - start_idx} chars old -> {len(new_block)} chars new)")

# Verify
with open('components/3d/SolarEngine3D.tsx', 'r', encoding='utf-8') as f:
    verify = f.read()

checks = [
    ('twinData.lat', 'refLat = twinData.lat'),
    ('MAX_BUILDING_RADIUS_M = 40', 'increased radius'),
    ('distToRef', 'new distance function'),
    ('FALLBACK: all segs filtered', 'fallback logic'),
    ('relaxedRadius', 'relaxed radius'),
]
for check, desc in checks:
    if check in verify:
        print(f"  ✅ {desc}: found")
    else:
        print(f"  ❌ {desc}: MISSING")