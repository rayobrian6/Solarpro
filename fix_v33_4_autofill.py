import re

with open('components/3d/SolarEngine3D.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# ─── Fix 1: Replace the solar rules section in handleAutoRoof ───────────────
old_rules = '''    // ─── Solar placement rules ──────────────────────────────────────────────────
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
      }'''

new_rules = '''    // ─── Solar placement rules ──────────────────────────────────────────────────
    // Rule 1: No north-facing segments (az 315-360 or 0-45) — minimal sun in N hemisphere
    // Rule 2: No steep pitch on unfavorable faces (>45° always skip; >35° on E/W skip)
    // Rule 3: Target building only — segment center must be within MAX_BUILDING_RADIUS_M of twin center
    // Rule 4: Minimum sunshine (50% of best segment)
    // Rule 5: Minimum area (must fit at least one panel)
    //
    // CRITICAL: Use twinData.lat/lng as the reference point — NOT the component's lat/lng props.
    // The component props may be stale (original project location) while twinData reflects
    // the actual building the Solar API was called for (e.g. after Pick House).
    const MAX_BUILDING_RADIUS_M = 40; // increased from 25m — Google Solar API spreads segments
    // Use twin center as reference (always matches the Solar API response)
    const refLat = twinData.lat;
    const refLng = twinData.lng;
    const cosLatRad = Math.cos(refLat * Math.PI / 180);
    const mLatPx = 111320;
    const mLngPx = 111320 * cosLatRad;

    function isNorthFacing(azDeg: number): boolean {
      const az = ((azDeg % 360) + 360) % 360;
      // North-facing: 315°-360° or 0°-45° (NW through N through NE)
      return az >= 315 || az < 45;
    }
    function isTooSteep(pitchDeg: number, azDeg: number): boolean {
      if (pitchDeg > 45) return true; // always skip very steep
      const az = ((azDeg % 360) + 360) % 360;
      // East/West facing: skip if pitch > 35° (poor production + structural risk)
      const isEW = (az >= 45 && az <= 135) || (az >= 225 && az <= 315);
      if (isEW && pitchDeg > 35) return true;
      return false;
    }
    function distToRef(segLat: number, segLng: number): number {
      const dN = (segLat - refLat) * mLatPx;
      const dE = (segLng - refLng) * mLngPx;
      return Math.sqrt(dN * dN + dE * dE);
    }

    // First pass: apply all rules
    const eligibleSegs = sortedSegs.filter((seg: any) => {
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
        addLog('AUTO', `seg ${seg.id}: SKIP neighbor dist=${dist.toFixed(0)}m (ref=${refLat.toFixed(5)},${refLng.toFixed(5)})`); return false;
      }
      if (seg.sunshineHours < minThreshold) {
        addLog('AUTO', `seg ${seg.id}: SKIP low sunshine`); return false;
      }
      if (seg.areaM2 < (PW * PH)) {
        addLog('AUTO', `seg ${seg.id}: SKIP too small`); return false;
      }'''

if old_rules in content:
    content = content.replace(old_rules, new_rules)
    print("✅ Fix 1: Solar rules updated (twinData.lat/lng reference + 40m radius)")
else:
    print("❌ Fix 1: Could not find old_rules block")
    # Try to find partial match
    idx = content.find('const MAX_BUILDING_RADIUS_M = 25;')
    if idx >= 0:
        print(f"  Found MAX_BUILDING_RADIUS_M at char {idx}")
    idx2 = content.find('function distToTarget')
    if idx2 >= 0:
        print(f"  Found distToTarget at char {idx2}")

with open('components/3d/SolarEngine3D.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done.")