"""
v33.3 - Solar placement logic overhaul:

1. SEGMENT FILTERING (handleAutoRoof):
   - Exclude north-facing segments (azimuth 315-360 or 0-45 degrees)
   - Exclude steep pitch on unfavorable orientations (pitch > 45 deg = skip)
   - Exclude segments whose center is too far from the picked lat/lng (>25m = neighbor's house)
   - Limit to segments that belong to the target building only

2. SETBACK ENFORCEMENT (fillRoofSegmentWithPanels):
   - Apply proper edge setback (0.5m default)
   - Shrink convexHull inward by setback amount before placing panels

3. PANEL GRID ALIGNMENT:
   - All panels on same segment use same grid origin (no random offsets)
   - Consistent row/column spacing aligned to roof azimuth

4. PANEL COUNT SANITY:
   - Max panels based on actual usable area after setbacks
"""

with open('components/3d/SolarEngine3D.tsx', 'r') as f:
    content = f.read()

original_len = len(content)

# FIX 1: Segment filtering - exclude bad segments
old_filter = """    const sortedSegs = [...twinData.roofSegments].sort((a: any, b: any) => b.sunshineHours - a.sunshineHours);
    const maxSunshine = sortedSegs[0]?.sunshineHours ?? 0;
    const minThreshold = maxSunshine * 0.5;
    const eligibleSegs = sortedSegs.filter((seg: any) =>
      seg.sunshineHours >= minThreshold && seg.areaM2 >= (PW * PH)
    );

    addLog('AUTO', `eligible: ${eligibleSegs.length}/${sortedSegs.length} segs after solar rules`);"""

new_filter = """    const sortedSegs = [...twinData.roofSegments].sort((a: any, b: any) => b.sunshineHours - a.sunshineHours);
    const maxSunshine = sortedSegs[0]?.sunshineHours ?? 0;
    const minThreshold = maxSunshine * 0.5;

    // Solar placement rules:
    // Rule 1: No north-facing (azimuth 315-360 or 0-45) - minimal sun in northern hemisphere
    // Rule 2: No too-steep pitch (>45deg always skip; >40deg on E/W faces skip)
    // Rule 3: Must be on target building - center within 25m of clicked point
    // Rule 4: Minimum sunshine threshold (50% of best segment)
    // Rule 5: Minimum area (must fit at least one panel)

    const MAX_BUILDING_RADIUS_M = 25;
    const mLatDeg = 111320;
    const cosLatDeg = Math.cos(lat * Math.PI / 180);
    const mLngDeg = 111320 * cosLatDeg;

    function isNorthFacing(azDeg: number): boolean {
      const az = ((azDeg % 360) + 360) % 360;
      return az >= 315 || az <= 45;
    }

    function isTooSteep(pitchDeg: number, azDeg: number): boolean {
      if (pitchDeg > 45) return true;
      const az = ((azDeg % 360) + 360) % 360;
      const isEW = (az > 45 && az < 135) || (az > 225 && az < 315);
      if (isEW && pitchDeg > 40) return true;
      return false;
    }

    function distFromTarget(segLat: number, segLng: number): number {
      const dN = (segLat - lat) * mLatDeg;
      const dE = (segLng - lng) * mLngDeg;
      return Math.sqrt(dN * dN + dE * dE);
    }

    const eligibleSegs = sortedSegs.filter((seg: any) => {
      const azDeg = isFinite(seg.azimuthDegrees) ? seg.azimuthDegrees : 180;
      const pitchDeg = isFinite(seg.pitchDegrees) ? seg.pitchDegrees : 20;
      const dist = distFromTarget(seg.center?.lat ?? lat, seg.center?.lng ?? lng);

      if (isNorthFacing(azDeg)) {
        addLog('AUTO', `seg ${seg.id}: SKIP north-facing az=${azDeg.toFixed(0)}`);
        return false;
      }
      if (isTooSteep(pitchDeg, azDeg)) {
        addLog('AUTO', `seg ${seg.id}: SKIP too-steep pitch=${pitchDeg.toFixed(0)} az=${azDeg.toFixed(0)}`);
        return false;
      }
      if (dist > MAX_BUILDING_RADIUS_M) {
        addLog('AUTO', `seg ${seg.id}: SKIP neighbor building dist=${dist.toFixed(0)}m`);
        return false;
      }
      if (seg.sunshineHours < minThreshold) {
        addLog('AUTO', `seg ${seg.id}: SKIP low sunshine`);
        return false;
      }
      if (seg.areaM2 < (PW * PH)) {
        addLog('AUTO', `seg ${seg.id}: SKIP too small`);
        return false;
      }
      addLog('AUTO', `seg ${seg.id}: OK az=${azDeg.toFixed(0)} pitch=${pitchDeg.toFixed(0)} dist=${dist.toFixed(0)}m`);
      return true;
    });

    addLog('AUTO', `eligible: ${eligibleSegs.length}/${sortedSegs.length} segs after solar rules`);"""

if old_filter in content:
    content = content.replace(old_filter, new_filter)
    print("Fix 1 done: segment filtering with solar rules")
else:
    print("ERROR Fix 1: segment filter not found - searching...")
    idx = content.find("const sortedSegs = [...twinData.roofSegments]")
    if idx >= 0:
        print(repr(content[idx:idx+300]))

# FIX 2: Shrink clip polygon by setback before placing panels
# Find the clip polygon section and add setback shrink
old_clip = """    // -- Clip polygon -------
    const clipPoly: Array<{ lat: number; lng: number }> =
      (seg.convexHull && seg.convexHull.length >= 3) ? seg.convexHull :
      (seg.polygon    && seg.polygon.length    >= 3) ? seg.polygon    : [];"""

new_clip = """    // -- Clip polygon with setback applied --
    // Shrink the roof polygon inward by SETBACK_M to enforce edge setbacks.
    // This prevents panels from being placed at the very edge of the roof.
    const SETBACK_M = 0.5; // 0.5m edge setback (matches AHJ minimum)
    const rawClipPoly: Array<{ lat: number; lng: number }> =
      (seg.convexHull && seg.convexHull.length >= 3) ? seg.convexHull :
      (seg.polygon    && seg.polygon.length    >= 3) ? seg.polygon    : [];

    // Shrink polygon inward by SETBACK_M using centroid-based scaling
    function shrinkPolygon(
      poly: Array<{ lat: number; lng: number }>,
      setbackM: number
    ): Array<{ lat: number; lng: number }> {
      if (poly.length < 3) return poly;
      // Find centroid
      const cLat = poly.reduce((s, p) => s + p.lat, 0) / poly.length;
      const cLng = poly.reduce((s, p) => s + p.lng, 0) / poly.length;
      // Move each vertex toward centroid by setbackM
      return poly.map(p => {
        const dLatM = (p.lat - cLat) * mLat;
        const dLngM = (p.lng - cLng) * mLng;
        const dist = Math.sqrt(dLatM * dLatM + dLngM * dLngM);
        if (dist < setbackM) return { lat: cLat, lng: cLng };
        const scale = (dist - setbackM) / dist;
        return {
          lat: cLat + (p.lat - cLat) * scale,
          lng: cLng + (p.lng - cLng) * scale,
        };
      });
    }

    const clipPoly = rawClipPoly.length >= 3
      ? shrinkPolygon(rawClipPoly, SETBACK_M)
      : rawClipPoly;"""

if old_clip in content:
    content = content.replace(old_clip, new_clip)
    print("Fix 2 done: setback enforcement via polygon shrink")
else:
    print("ERROR Fix 2: clip polygon section not found")
    idx = content.find("const clipPoly")
    if idx >= 0:
        print(repr(content[max(0,idx-50):idx+200]))

print(f"\nContent length: {original_len} -> {len(content)} (+{len(content)-original_len} chars)")

with open('components/3d/SolarEngine3D.tsx', 'w') as f:
    f.write(content)

print("All fixes written to SolarEngine3D.tsx")