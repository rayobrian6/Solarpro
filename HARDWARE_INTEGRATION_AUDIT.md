# Hardware Config Integration Audit
## Version: v27.1 — Pre-Integration Analysis

---

## EXECUTIVE SUMMARY

The system has **two separate equipment data sources** that are NOT connected:

| Source | Location | Used By | Fields |
|--------|----------|---------|--------|
| `equipment-db.ts` | `lib/equipment-db.ts` | Engineering page (electrical calcs) | `watts`, `voc`, `vmp`, `isc`, `imp`, `tempCoeff*`, `maxSystemVoltage` |
| `db.ts` (file DB) | `lib/db.ts` | Design Studio, Hardware Config UI | `wattage`, `width`, `height`, `efficiency`, `pricePerWatt` |

**The Equipment Library UI (Hardware Config) edits `db.ts` panels — but Engineering uses `equipment-db.ts` panels.**
This means user edits in Hardware Config have NO effect on engineering calculations.

---

## CRITICAL DISCONNECTS

### 1. Panel Data Split (HIGH PRIORITY)
- **Design Studio** → fetches `/api/hardware` → uses `db.ts` panels (27 models, layout/visual only)
- **Engineering page** → imports `SOLAR_PANELS` from `equipment-db.ts` (static, electrical specs)
- **Result**: Panel selection in Design Studio ≠ Panel used in Engineering calcs

### 2. Inverter Data Split (HIGH PRIORITY)
- **Design Studio** → fetches `/api/hardware` → uses `db.ts` inverters
- **Engineering page** → imports `STRING_INVERTERS`, `MICROINVERTERS` from `equipment-db.ts`
- **Result**: Inverter selection in Design Studio ≠ Inverter used in Engineering calcs

### 3. Pricing Tab Removed — But Pricing Config Still in db.ts (MEDIUM)
- `db.ts` still has `getPricing()` / `updatePricing()` methods
- `PricingConfig` interface still in `types/index.ts`
- These are now orphaned — pricing is handled by `db-neon.ts` + `pricingEngine.ts`
- **Action**: Keep `PricingConfig` in types for backward compat, but stop exposing via Hardware Config

### 4. AppShell Navigation Label (LOW)
- Sidebar still shows "Hardware Config" — should be "Equipment Library"

### 5. Equipment Library → Pricing Engine Integration (MEDIUM)
- `pricePerWatt` on panels in `db.ts` is NOT used by the pricing engine
- Pricing engine uses `pricingEngine.ts` → `companyPricing.ts` → `db-neon.ts`
- Panel `pricePerWatt` should feed into the cost-plus pricing calculation

---

## DATA FLOW MAP

```
USER EDITS PANEL IN EQUIPMENT LIBRARY
         ↓
    /api/hardware (PUT)
         ↓
    db.ts panels Map
         ↓
    Design Studio (visual layout only)
         ↓
    Layout saved to DB (panel count, size)
         ↓
    Proposals page (uses panel count × price/W from pricingEngine)

ENGINEERING PAGE (separate flow)
    ↓
    equipment-db.ts SOLAR_PANELS (static, hardcoded)
    ↓
    Electrical calcs (Voc, Isc, string sizing, OCPD)
```

---

## INTEGRATION PLAN

### Step 1: Rename "Hardware Config" → "Equipment Library" in AppShell
- Change label in `components/ui/AppShell.tsx`
- Update description in page header

### Step 2: Bridge db.ts panels → equipment-db.ts
- When user selects a panel in Engineering, look up by ID in BOTH sources
- Add a `getUnifiedPanelById()` function that checks equipment-db first, then db.ts

### Step 3: Feed panel pricePerWatt into Pricing Engine
- When pricing engine calculates cost-plus, use panel's `pricePerWatt` from db.ts
- `materialCostPerPanel = panel.pricePerWatt × panel.wattage`

### Step 4: Sync panel selection between Design Studio and Engineering
- When user picks a panel in Design Studio, store `panelId` in project state
- Engineering page reads `panelId` from project and uses it

### Step 5: Equipment Library → Proposal Equipment Cards
- Proposals page currently hardcodes equipment descriptions
- Should pull from Equipment Library for panel/inverter specs

---

## FILES TO MODIFY

| File | Change |
|------|--------|
| `components/ui/AppShell.tsx` | Rename "Hardware Config" → "Equipment Library" |
| `lib/equipment-library.ts` | NEW: unified equipment resolver |
| `app/engineering/page.tsx` | Use unified panel resolver |
| `app/proposals/page.tsx` | Pull panel/inverter specs from Equipment Library |
| `app/admin/hardware/page.tsx` | Already updated ✓ |
| `app/api/hardware/route.ts` | Already updated ✓ |

---

## WHAT IS WORKING CORRECTLY

- ✅ Pricing tab removed from Hardware Config
- ✅ Main Pricing page is sole pricing engine
- ✅ Equipment Library UI has Edit/Duplicate/Disable/Datasheet
- ✅ Autosave with 2s debounce
- ✅ Batteries tab added
- ✅ Database migration created for user_equipment_* tables
- ✅ CRUD API for all equipment types
- ✅ Build passes cleanly

---

## WHAT NEEDS INTEGRATION

1. **AppShell label** — "Hardware Config" → "Equipment Library"
2. **Unified equipment resolver** — bridge db.ts ↔ equipment-db.ts
3. **Panel price → pricing engine** — feed pricePerWatt into cost-plus calc
4. **Proposal equipment cards** — pull from Equipment Library
5. **Engineering panel selector** — show Equipment Library panels