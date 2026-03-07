# Mounting Details & Structural Page — Full Audit Report
## Date: 2026-03-07 | Version: v25.6

---

## EXECUTIVE SUMMARY

The system has **three separate mounting databases** that are not synchronized:
1. `lib/equipment-db.ts` → `RACKING_SYSTEMS[]` — used by Structural Page dropdowns (7 entries)
2. `lib/mounting-hardware-db.ts` → `MOUNTING_SYSTEMS[]` — used by Mounting Details tab (38 entries)
3. `lib/equipment-registry-v4.ts` → registry entries — used by BOM engine (14 racking entries)

**The Structural Page reads from database #1 (7 entries). The Mounting Details page reads from database #2 (38 entries). The BOM reads from database #3 (14 entries). None of them are synchronized.** When a user selects "Roof Tech RT-MINI" on the Mounting Details page, the Structural page still shows only the 7 old brands, and the BOM uses a different ID mapping.

---

## ISSUE 1: STRUCTURAL PAGE — RACKING SYSTEM DROPDOWN IS STALE

**File:** `app/engineering/page.tsx` lines 3836–3862  
**Problem:** The Structural page's "Racking System" section uses `RACKING_SYSTEMS` from `equipment-db.ts` which has only **7 brands**:
- IronRidge XR100
- Unirac SolarMount
- SnapNrack Series 100
- QuickMount PV Classic Mount
- Esdec FlatFix Fusion
- S-5! PVKIT 2.0
- Roof Tech RT-MINI Rail-Less

**Missing from Structural dropdown (but in Mounting Details):**
- IronRidge XR1000, Flat Roof
- Unirac SME, RM10 EVO
- QuickMount QM-Tile
- K2 Systems CrossRail Pro
- EcoFasten Rock-It Gen 4
- Schletter Classic Rail
- SunModo EZ
- DPW Solar Power Rail
- PanelClaw Polar Bear 3
- Tamarack Solar UTR-100
- ProSolar TopTrack 2.0
- Clenergy ezRack SB
- Renusol VS+ / Console+
- Everest Solar E-Mount AF
- MSE Rapid Rail
- Sollega FastRack FC350
- TerraSmart GLIDE
- Polar Racking PR Ground
- NEXTracker NX Horizon (2024)
- GameChange GCX Tracker
- Soltec SF7
- PV Hardware Titan

**Root Cause:** The Structural page was built before `mounting-hardware-db.ts` existed. It was never updated to use the new database.

**Fix:** Replace `RACKING_SYSTEMS` in the Structural page with `getAllMountingSystems()` from `mounting-hardware-db.ts`.

---

## ISSUE 2: ROOF TECH HAS ONLY 1 MODEL VARIATION (SHOULD HAVE 3+)

**File:** `lib/mounting-hardware-db.ts` line ~432  
**Problem:** Roof Tech only has `RT-MINI` in the database. The actual Roof Tech product line includes:
- **RT-MINI** — standard shingle/shake mount (2 lag bolts, 48" max spacing)
- **RT-MINI Tile** — concrete/clay tile variant (tile hook, different embedment)
- **RT-MINI Metal** — metal roof variant (corrugated clamp, no lag bolt)
- **RT-TILT** — adjustable tilt mount for flat/low-slope roofs
- **RT-HOOK** — S-hook for standing seam metal roofs

**Fix:** Add RT-MINI Tile, RT-MINI Metal, RT-TILT, RT-HOOK to `mounting-hardware-db.ts`.

---

## ISSUE 3: BOM ENGINE USES DIFFERENT IDs THAN MOUNTING DETAILS PAGE

**File:** `lib/equipment-registry-v4.ts` + `app/engineering/page.tsx` line 1239  
**Problem:** The BOM engine uses `equipment-registry-v4.ts` IDs:
- `rooftech-rt-mini` (registry) vs `rooftech-mini` (mounting-hardware-db)
- `snapnrack-series-100` (registry) vs `snapnrack-100` (mounting-hardware-db)
- `unirac-sunframe` (registry) vs `unirac-solarmount` (mounting-hardware-db)
- `quickmount-tile-hook` (registry) vs `quickmount-tile` (mounting-hardware-db)
- `s5-pvkit-2` (registry) vs `s5-pvkit` (mounting-hardware-db)

The page has a `rackingIdMap` that tries to bridge these but it's incomplete and maps to old IDs.

**Fix:** Unify IDs across all three databases OR add all new mounting-hardware-db IDs to equipment-registry-v4.ts.

---

## ISSUE 4: STRUCTURAL PAGE DOESN'T SYNC WITH MOUNTING DETAILS SELECTION

**File:** `app/engineering/page.tsx`  
**Problem:** When a user selects "Renusol VS+" on the Mounting Details tab, the Structural page still shows "IronRidge XR100" because:
1. `config.mountingId` is updated correctly
2. But the Structural page dropdown reads from `RACKING_SYSTEMS` which doesn't have Renusol
3. So the dropdown shows a blank/wrong value
4. The structural calc falls back to IronRidge XR100 with a warning

**Fix:** Structural page must read from `getAllMountingSystems()` and filter by install type.

---

## ISSUE 5: MOUNTING DETAILS PAGE — NO SEARCH/FILTER BY ROOF TYPE

**Problem:** The Mounting Details page shows all residential systems regardless of the project's roof type. A user with a standing seam metal roof sees IronRidge XR100 (shingle only) listed first.

**Fix:** Add roof type filter chips that filter `filteredSystems` by `compatibleRoofTypes`.

---

## ISSUE 6: STRUCTURAL PAGE — RACKING SECTION SHOWS WRONG STRUCTURAL SPECS

**File:** `app/engineering/page.tsx` lines 3902–3920  
**Problem:** The structural specs display (load model, fasteners/mount, uplift capacity) reads from `RACKING_SYSTEMS` which has `loadModel`, `fastenersPerAttachment`, `upliftCapacity` fields. But the new `mounting-hardware-db.ts` uses `mount.fastenersPerMount`, `mount.upliftCapacityLbs`. These are different field names, so the display shows nothing for new systems.

**Fix:** Update the structural specs display to read from `getMountingSystemById(config.mountingId)`.

---

## ISSUE 7: SLD DOESN'T SHOW MOUNTING SYSTEM

**Problem:** The Single-Line Diagram doesn't reference the mounting system at all. For permit sets, the SLD should show the racking brand/model in the system notes or title block.

**Fix:** Pass `config.mountingId` to the SLD generator and display it in the notes section.

---

## IMPLEMENTATION PRIORITY

### Priority 1 — CRITICAL (fixes data flow breakage)
1. **Replace `RACKING_SYSTEMS` with `getAllMountingSystems()` in Structural page** — this is the core fix that makes all 38 systems available in the Structural dropdown
2. **Add Roof Tech model variations** (RT-MINI Tile, RT-MINI Metal, RT-TILT, RT-HOOK) to mounting-hardware-db.ts
3. **Update `rackingIdMap` in page.tsx** to include all new mounting-hardware-db IDs

### Priority 2 — HIGH (improves data accuracy)
4. **Add all mounting-hardware-db systems to equipment-registry-v4.ts** so BOM generates correct line items
5. **Update structural specs display** to use `getMountingSystemById()` field names

### Priority 3 — MEDIUM (UX improvements)
6. **Add roof type filter** to Mounting Details page
7. **Add mounting system to SLD notes**
8. **Add "Sync to Structural" button** on Mounting Details page

---

## UI STREAMLINING RECOMMENDATIONS

### Structural Page — Racking System Section
- Replace 2-dropdown (Brand → Model) with single searchable select showing "Brand — Model" 
- Add live structural spec preview below dropdown (uplift capacity, max spacing, load model)
- Show compatibility warning if selected system doesn't match roof type
- Add "← From Mounting Details" indicator when mountingId is set from the Mounting Details tab

### Mounting Details Page
- Add roof type filter chips (Asphalt Shingle | Tile | Metal | Flat)
- Add "Use for Structural Calc" button that sets config.mountingId and switches to Structural tab
- Show BOM preview (estimated hardware count) in the selected system panel
- Add "Compare" mode to show 2 systems side-by-side

### Data Flow Architecture (Target State)
```
User selects system on Mounting Details tab
    ↓
config.mountingId = 'renusol-vs-plus'
    ↓
Structural page reads getMountingSystemById('renusol-vs-plus')
    ↓
Structural calc uses correct uplift/spacing from mounting-hardware-db
    ↓
BOM engine uses equipment-registry-v4 entry for 'renusol-vs-plus'
    ↓
Equipment Schedule shows "Renusol VS+ Rail System"
    ↓
SLD notes show "Renusol VS+ Rail System — ICC-ES ESR-3987"
```