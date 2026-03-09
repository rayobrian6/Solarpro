import re

with open('components/3d/SolarEngine3D.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# ── Fix 1: Replace hardcoded SETBACK_M_FILL with actual fireSetbacks prop values ──
old_setback = """    // Shrink roof polygon inward by SETBACK_M to enforce edge setbacks
    const SETBACK_M_FILL = 0.5; // 0.5m edge setback
    const rawClipPoly: Array<{ lat: number; lng: number }> =
      (seg.convexHull && seg.convexHull.length >= 3) ? seg.convexHull :
      (seg.polygon    && seg.polygon.length    >= 3) ? seg.polygon    : [];"""

new_setback = """    // Use actual fire setback values from UI config (passed as prop), fallback to IFC defaults
    const edgeSetbackM  = (fireSetbacks?.edgeSetbackM  ?? 0.457); // 18 inches default
    const ridgeSetbackM = (fireSetbacks?.ridgeSetbackM ?? 0.457); // 18 inches default
    // Use the larger of edge/ridge for uniform polygon shrink (conservative, safe)
    const SETBACK_M_FILL = Math.max(edgeSetbackM, ridgeSetbackM);
    addLog('FILL', `seg ${seg?.id}: setbacks edge=${(edgeSetbackM*39.37).toFixed(0)}" ridge=${(ridgeSetbackM*39.37).toFixed(0)}" effective=${(SETBACK_M_FILL*39.37).toFixed(0)}"`);

    const rawClipPoly: Array<{ lat: number; lng: number }> =
      (seg.convexHull && seg.convexHull.length >= 3) ? seg.convexHull :
      (seg.polygon    && seg.polygon.length    >= 3) ? seg.polygon    : [];"""

if old_setback in content:
    content = content.replace(old_setback, new_setback)
    print("✅ Fix 1: SETBACK_M_FILL now uses fireSetbacks prop")
else:
    print("❌ Fix 1: Could not find SETBACK_M_FILL block")

# ── Fix 2: PRIMARY PATH — apply setback filter + re-sort into clean aligned rows ──
old_primary = """    if (googlePanels.length > 0) {
      addLog('FILL', `seg ${seg?.id}: PRIMARY PATH -- ${googlePanels.length} googlePanels, limit=${Math.min(googlePanels.length, maxPanelsLimit)}`);
      const limit  = Math.min(googlePanels.length, maxPanelsLimit);
      const azRad  = azDeg * Math.PI / 180;
      const slopeE = Math.sin(azRad);
      const slopeN = Math.cos(azRad);

      let placed = 0, skipped = 0;
      for (let i = 0; i < limit; i++) {
        const gp = googlePanels[i];
        if (!isValidCoord(gp.lat, gp.lng)) { skipped++; continue; }

        const dN = (gp.lat - seg.center.lat) * mLat;
        const dE = (gp.lng - seg.center.lng) * mLng;
        const alongSlope = dE * slopeE + dN * slopeN;
        const pHeight = segElev + tanPitch * alongSlope + PANEL_OFFSET;

        if (!isValidCoord(gp.lat, gp.lng, pHeight)) { skipped++; continue; }

        const gpOrient: PanelOrientation =
          gp.orientation?.toUpperCase() === 'PORTRAIT' ? 'portrait' : 'landscape';

        // CRITICAL FIX v33.7: Do NOT clip Google pre-computed panel positions against
        // our derived convex hull. Google already placed these panels correctly on the
        // roof surface. Our convexHull may come from DSM (different coordinate system)
        // and clipping against it incorrectly rejects all valid Google panels.
        // The clip polygon is only needed for the FALLBACK grid path below.

        const panel = createPanel({
          lat: gp.lat, lng: gp.lng, height: pHeight,
          tilt: pitchDeg, azimuth: azDeg, systemType: 'roof',
          heading, pitch: pitchDeg, roll: 0, orientation: gpOrient,
        });
        panels.push(panel);
        placed++;
      }
      addLog('FILL', `seg ${seg?.id}: PRIMARY placed=${placed} skipped=${skipped}`);
      if (panels.length > 0) return panels;
    }"""

new_primary = """    if (googlePanels.length > 0) {
      addLog('FILL', `seg ${seg?.id}: PRIMARY PATH -- ${googlePanels.length} googlePanels, limit=${Math.min(googlePanels.length, maxPanelsLimit)}`);
      const azRad  = azDeg * Math.PI / 180;
      const slopeE = Math.sin(azRad);
      const slopeN = Math.cos(azRad);
      const ridgeE = Math.cos(azRad);
      const ridgeN = -Math.sin(azRad);

      // ── Step 1: Filter valid panels and compute roof-local coordinates ──
      type GpWithCoords = {
        lat: number; lng: number; orientation: string;
        slopeProj: number; ridgeProj: number; height: number;
      };
      const validGp: GpWithCoords[] = [];
      for (const gp of googlePanels) {
        if (!isValidCoord(gp.lat, gp.lng)) continue;
        const dN = (gp.lat - seg.center.lat) * mLat;
        const dE = (gp.lng - seg.center.lng) * mLng;
        const slopeProj = dE * slopeE + dN * slopeN;
        const ridgeProj = dE * ridgeE + dN * ridgeN;
        const height = segElev + tanPitch * slopeProj + PANEL_OFFSET;
        if (!isValidCoord(gp.lat, gp.lng, height)) continue;
        validGp.push({ lat: gp.lat, lng: gp.lng, orientation: gp.orientation, slopeProj, ridgeProj, height });
      }

      // ── Step 2: Apply fire setback filter using shrunk clip polygon ──
      // Re-enable setback clipping for PRIMARY PATH now that we use the correct
      // shrunk polygon (shrinkPoly uses the actual fireSetbacks values from UI).
      const setbackFilteredGp = clipPoly.length >= 3
        ? validGp.filter(gp => pointInPolygon(gp.lat, gp.lng, clipPoly))
        : validGp;

      addLog('FILL', `seg ${seg?.id}: PRIMARY after setback filter: ${setbackFilteredGp.length}/${validGp.length} panels kept`);

      // ── Step 3: Sort into clean aligned rows (by slopeProj then ridgeProj) ──
      // Quantize slopeProj into rows using panel height as bucket size.
      // This groups Google panels into neat rows matching the roof slope direction,
      // producing the same clean appearance as the manual Row tool.
      const rowBucket = (PH_O + 0.10); // panel height + gap
      setbackFilteredGp.sort((a, b) => {
        const rowA = Math.round(a.slopeProj / rowBucket);
        const rowB = Math.round(b.slopeProj / rowBucket);
        if (rowA !== rowB) return rowA - rowB;
        return a.ridgeProj - b.ridgeProj; // left to right within row
      });

      // ── Step 4: Place panels up to maxPanelsLimit ──
      let placed = 0, skipped = 0;
      const limit = Math.min(setbackFilteredGp.length, maxPanelsLimit);
      for (let i = 0; i < limit; i++) {
        const gp = setbackFilteredGp[i];
        const gpOrient: PanelOrientation =
          gp.orientation?.toUpperCase() === 'PORTRAIT' ? 'portrait' : 'landscape';
        const panel = createPanel({
          lat: gp.lat, lng: gp.lng, height: gp.height,
          tilt: pitchDeg, azimuth: azDeg, systemType: 'roof',
          heading, pitch: pitchDeg, roll: 0, orientation: gpOrient,
        });
        panels.push(panel);
        placed++;
      }
      skipped = validGp.length - placed;
      addLog('FILL', `seg ${seg?.id}: PRIMARY placed=${placed} skipped/setback=${skipped}`);
      if (panels.length > 0) return panels;
    }"""

if old_primary in content:
    content = content.replace(old_primary, new_primary)
    print("✅ Fix 2: PRIMARY PATH now applies setback filter + clean row sorting")
else:
    print("❌ Fix 2: Could not find PRIMARY PATH block")

with open('components/3d/SolarEngine3D.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done writing file.")